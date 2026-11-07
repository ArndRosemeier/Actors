//! [`ActorRuntime`]: loads an actor pack and turns target weights into a finished shape:
//! morphed body, refitted skeleton and refitted proxies (garments). Renderer-free.

use crate::blob::{read_f32, read_u16, read_u32};
use crate::deform::{apply_bone_scales, apply_scale, apply_tip, target_mask, ShapeOptions};
use crate::error::{Error, Result};
use crate::format::*;
use crate::normals::{compute_normals, hair_shell_normals, TriangleList};
use crate::proxy::{fit_proxy, proxy_skin, JointAcc, ProxyBinding};
use crate::retarget::{decode_clip, Clip};
use crate::skeleton::{fit_skeleton, FittedSkeleton};
use crate::source::PackSource;
use crate::subdivide::{subdivide_quad_mesh, Stencil};
use crate::target::MorphTarget;
use indexmap::IndexMap;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// Target weights by target name. Insertion order is the order targets are added in.
pub type Weights = IndexMap<String, f64>;

/// An extra per render vertex attribute (see `MeshDef.attributes`).
#[derive(Clone, Debug, PartialEq)]
pub struct Attribute {
    pub data: Vec<f32>,
    pub size: usize,
}

/// Static, shape-independent data of one mesh.
#[derive(Clone, Debug)]
pub struct MeshData {
    pub def: MeshDef,
    /// Render vertex -> source vertex (base vertex, proxy vertex for garments, or stencil row).
    pub map: Vec<u32>,
    /// 2 floats per render vertex.
    pub uv: Vec<f32>,
    pub indices: Vec<u32>,
    /// Skin influences per render vertex (4 each).
    pub joints: Option<Vec<u16>>,
    pub weights: Option<Vec<f32>>,
    pub hides_base_vertices: Option<Vec<u32>>,
    /// Per render vertex cut value (see `MeshDef.clip`).
    pub clip: Option<Vec<f32>>,
    /// For meshes with their own vertex space (subdivided): map from base vertices.
    pub stencil: Option<Stencil>,
    /// Per source vertex: the base vertex that influences it most, for hiding skin under garments.
    pub dominant: Option<Vec<u32>>,
    /// Reduced triangle lists by detail level, ascending.
    pub simplified: Vec<(usize, Vec<u32>)>,
    pub attributes: IndexMap<String, Attribute>,
}

impl MeshData {
    pub fn name(&self) -> &str {
        &self.def.name
    }
    pub fn vertex_count(&self) -> usize {
        self.map.len()
    }
}

impl TriangleList for MeshData {
    fn indices(&self) -> &[u32] {
        &self.indices
    }
    fn map(&self) -> &[u32] {
        &self.map
    }
}

/// Whether a mesh moves with the face (expressions, blinking): base-following meshes other than
/// garments, and the proxies that sit on the face (teeth, tongue, eyebrows).
pub fn follows_face(def: &MeshDef) -> bool {
    if def.role == MeshRole::Garment {
        return false;
    }
    def.source == MeshSource::Base || def.role == MeshRole::Bodypart || def.has_tag("brows")
}

/// The vertex space a mesh's vertices index: "" the base mesh, a stencil mesh's name, or
/// "proxy:" and the proxy's name.
pub fn face_space(m: &MeshData) -> String {
    if m.stencil.is_some() {
        return m.def.name.clone();
    }
    match &m.def.source {
        MeshSource::Proxy { proxy } => format!("proxy:{proxy}"),
        MeshSource::Base => String::new(),
    }
}

/// Positions and normals (3 floats per vertex) of one vertex space.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Surface {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
}

/// Everything that changes when the shape changes.
#[derive(Clone, Debug, Default)]
pub struct ActorShape {
    /// Base shape positions and normals (per shape vertex).
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    /// Per proxy: fitted positions and normals (per proxy vertex).
    pub proxies: HashMap<String, Surface>,
    /// Per stencil mesh (by mesh name): positions and normals in the mesh's own vertex space.
    pub meshes: HashMap<String, Surface>,
    pub skeleton: Option<FittedSkeleton>,
}

impl ActorShape {
    /// Positions and normals a mesh reads (its source space: base, proxy or own stencil vertices).
    pub fn source_of(&self, mesh: &MeshData) -> Option<(&[f32], &[f32])> {
        if mesh.stencil.is_some() {
            return self.meshes.get(&mesh.def.name).map(|s| (&s.positions[..], &s.normals[..]));
        }
        match &mesh.def.source {
            MeshSource::Base => Some((&self.positions, &self.normals)),
            MeshSource::Proxy { proxy } => self.proxies.get(proxy).map(|s| (&s.positions[..], &s.normals[..])),
        }
    }
}

/// Per-vertex deltas on top of an [`ActorShape`] (same layout, without proxies and skeleton).
#[derive(Clone, Debug, Default)]
pub struct SurfaceDelta {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    /// By mesh name: stencil meshes and face proxies.
    pub meshes: HashMap<String, Surface>,
}

/// Loads an actor pack and turns target weights into a finished shape. Loading methods take
/// `&mut self`; evaluation only reads, so a loaded runtime can be shared across threads.
pub struct ActorRuntime {
    source: Box<dyn PackSource>,
    base: String,
    manifest: ActorPackManifest,
    targets: HashMap<String, Arc<MorphTarget>>,
    meshes: Vec<MeshData>,
    proxies: IndexMap<String, ProxyBinding>,
    base_positions: Vec<f32>,
    garment_vertex_of: Option<Vec<u32>>,
    base_skin: Option<(Vec<u16>, Vec<f32>)>,
    proxy_skins: HashMap<String, (Vec<u16>, Vec<f32>)>,
    masks: HashMap<String, Vec<f32>>,
    library_clips: IndexMap<String, Vec<ClipDef>>,
    clips: HashMap<String, Arc<Clip>>,
}

impl std::fmt::Debug for ActorRuntime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ActorRuntime")
            .field("pack", &self.manifest.id)
            .field("meshes", &self.meshes.len())
            .field("targets_loaded", &self.targets.len())
            .finish()
    }
}

fn json<T: serde::de::DeserializeOwned>(bytes: &[u8], path: &str) -> Result<T> {
    serde_json::from_slice(bytes).map_err(|source| Error::Json { path: path.to_string(), source })
}

impl ActorRuntime {
    /// Loads the manifest at `manifest_path` (relative to `source`) and its base blob.
    pub fn load(source: impl PackSource + 'static, manifest_path: &str) -> Result<Self> {
        let source: Box<dyn PackSource> = Box::new(source);
        let manifest: ActorPackManifest = json(&source.read(manifest_path)?, manifest_path)?;
        if manifest.format != "actors-pack" || manifest.version != 1 {
            return Err(Error::format(format!("{manifest_path}: unsupported actor pack")));
        }
        let base = manifest_path.rfind('/').map_or(String::new(), |i| manifest_path[..=i].to_string());
        let blob = source.read(&format!("{base}{}", manifest.blob))?;
        Self::from_parts(source, base, manifest, &blob)
    }

    /// A runtime from an already parsed manifest and its base blob; further files are read from
    /// `source` at `base` + their path (`base` is empty or ends with '/').
    pub fn from_parts(source: Box<dyn PackSource>, base: String, manifest: ActorPackManifest, blob: &[u8]) -> Result<Self> {
        let base_positions = read_f32(blob, &manifest.base_positions, "basePositions")?;
        if base_positions.len() != manifest.vertex_count * 3 {
            return Err(Error::format("basePositions does not match vertexCount"));
        }
        let garment_vertex_of = manifest.garment_vertex_of.as_ref().map(|r| read_u32(blob, r, "garmentVertexOf")).transpose()?;
        let base_skin = match &manifest.skin {
            Some(s) => Some((read_u16(blob, &s.joints, "skin.joints")?, read_f32(blob, &s.weights, "skin.weights")?)),
            None => None,
        };
        if let Some(sk) = &manifest.skeleton {
            for (i, b) in sk.bones.iter().enumerate() {
                if b.parent >= i as i32 || b.parent < -1 {
                    return Err(Error::format(format!("bone {}: parent must come before it", b.name)));
                }
                if b.head.vertices.iter().chain(&b.tail.vertices).any(|&v| v as usize >= manifest.vertex_count) {
                    return Err(Error::format(format!("bone {}: joint vertex outside the base mesh", b.name)));
                }
            }
        }
        if let Some((j, w)) = &base_skin {
            let bones = manifest.skeleton.as_ref().map_or(0, |s| s.bones.len());
            if j.len() != manifest.vertex_count * 4 || w.len() != manifest.vertex_count * 4 || j.iter().any(|&j| j as usize >= bones.max(1))
            {
                return Err(Error::format("skin does not match the vertices or the skeleton"));
            }
        }
        let mut rt = Self {
            source,
            base,
            manifest,
            targets: HashMap::new(),
            meshes: Vec::new(),
            proxies: IndexMap::new(),
            base_positions,
            garment_vertex_of,
            base_skin,
            proxy_skins: HashMap::new(),
            masks: HashMap::new(),
            library_clips: IndexMap::new(),
            clips: HashMap::new(),
        };
        let proxies: Vec<ProxyDef> = rt.manifest.proxies.iter().filter(|p| p.blob.is_none()).cloned().collect();
        for p in proxies {
            rt.bind_proxy(p, blob)?;
        }
        let defs: Vec<MeshDef> = rt.manifest.meshes.iter().filter(|m| m.blob.is_none()).cloned().collect();
        for def in defs {
            let mesh = rt.build_mesh(def, blob)?;
            rt.meshes.push(mesh);
        }
        Ok(rt)
    }

    pub fn manifest(&self) -> &ActorPackManifest {
        &self.manifest
    }

    /// Folder of the manifest inside the source ("" or ending with '/').
    pub fn base_path(&self) -> &str {
        &self.base
    }

    pub fn base_positions(&self) -> &[f32] {
        &self.base_positions
    }

    /// Per base vertex skin influences (4 joints, 4 weights), if the pack is rigged.
    pub fn base_skin(&self) -> Option<(&[u16], &[f32])> {
        self.base_skin.as_ref().map(|(j, w)| (&j[..], &w[..]))
    }

    /// See `ActorPackManifest.garmentVertexOf`.
    pub fn garment_vertex_of(&self) -> Option<&[u32]> {
        self.garment_vertex_of.as_deref()
    }

    /// Loaded meshes, in load order.
    pub fn meshes(&self) -> &[MeshData] {
        &self.meshes
    }

    pub fn mesh(&self, name: &str) -> Option<&MeshData> {
        self.meshes.iter().find(|m| m.def.name == name)
    }

    /// Loaded proxies.
    pub fn proxies(&self) -> &IndexMap<String, ProxyBinding> {
        &self.proxies
    }

    pub fn target(&self, name: &str) -> Option<&Arc<MorphTarget>> {
        self.targets.get(name)
    }

    /// Whether a mesh's data is loaded (always true for meshes without their own `blob`).
    pub fn is_loaded(&self, name: &str) -> bool {
        self.mesh(name).is_some()
    }

    fn bind_proxy(&mut self, def: ProxyDef, blob: &[u8]) -> Result<()> {
        let what = def.name.clone();
        let binding = ProxyBinding {
            refs: read_u32(blob, &def.refs, &what)?,
            weights: read_f32(blob, &def.weights, &what)?,
            offsets: read_f32(blob, &def.offsets, &what)?,
            def,
        };
        let n = binding.def.vertex_count * 3;
        if binding.refs.len() < n || binding.weights.len() < n || binding.offsets.len() < n {
            return Err(Error::format(format!("{what}: proxy buffers are shorter than its vertex count")));
        }
        if binding.refs.iter().any(|&r| r as usize >= self.manifest.vertex_count) {
            return Err(Error::format(format!("{what}: proxy refers to a vertex outside the base mesh")));
        }
        self.proxies.insert(binding.def.name.clone(), binding);
        Ok(())
    }

    fn build_mesh(&mut self, def: MeshDef, blob: &[u8]) -> Result<MeshData> {
        let name = def.name.clone();
        let (map, uv, indices, mut stencil) = if let Some(sub) = &def.subdivide {
            let src = self
                .mesh(&sub.source)
                .ok_or_else(|| Error::format(format!("{name}: subdivision source {} must come first", sub.source)))?;
            let s = subdivide_quad_mesh(&src.map, &src.uv, &src.indices)?;
            (s.map, s.uv, s.indices, Some(s.stencil))
        } else {
            let need = |r: &Option<BufferRef>, what: &str| r.ok_or_else(|| Error::format(format!("{name}: no {what}")));
            (
                read_u32(blob, &need(&def.base_index, "baseIndex")?, &name)?,
                read_f32(blob, &need(&def.uv, "uv")?, &name)?,
                read_u32(blob, &need(&def.indices, "indices")?, &name)?,
                None,
            )
        };
        if stencil.is_none() {
            if let Some(st) = &def.stencil {
                stencil = Some(Stencil {
                    rows: st.rows,
                    row_ptr: read_u32(blob, &st.row_ptr, &name)?,
                    cols: read_u32(blob, &st.cols, &name)?,
                    weights: read_f32(blob, &st.weights, &name)?,
                });
            }
        }
        // Every index has to stay inside its vertex space, so evaluation can index freely.
        let space = match (&stencil, &def.source) {
            (Some(s), _) => s.rows,
            (None, MeshSource::Base) => self.manifest.vertex_count,
            (None, MeshSource::Proxy { proxy }) => self.proxies.get(proxy).ok_or_else(|| Error::unknown("proxy", proxy))?.def.vertex_count,
        };
        if map.iter().any(|&v| v as usize >= space) || indices.iter().any(|&i| i as usize >= map.len()) || uv.len() < map.len() * 2 {
            return Err(Error::format(format!("{name}: indices out of range")));
        }
        if let Some(s) = &stencil {
            if s.row_ptr.len() != s.rows + 1
                || s.cols.iter().any(|&c| c as usize >= self.manifest.vertex_count)
                || s.row_ptr.last().is_some_and(|&n| n as usize > s.cols.len().min(s.weights.len()))
            {
                return Err(Error::format(format!("{name}: invalid stencil")));
            }
        }
        let mut mesh = MeshData {
            hides_base_vertices: def.hides_base_vertices.as_ref().map(|r| read_u32(blob, r, &name)).transpose()?,
            clip: def.clip.as_ref().map(|r| read_f32(blob, r, &name)).transpose()?,
            simplified: def.simplified.iter().map(|s| Ok((s.level, read_u32(blob, &s.indices, &name)?))).collect::<Result<_>>()?,
            attributes: match &def.attributes {
                Some(a) => a
                    .iter()
                    .map(|(k, a)| Ok((k.clone(), Attribute { data: read_f32(blob, &a.data, &name)?, size: a.size })))
                    .collect::<Result<_>>()?,
                None => IndexMap::new(),
            },
            dominant: None,
            joints: None,
            weights: None,
            stencil: None,
            def,
            map,
            uv,
            indices,
        };
        mesh.simplified.sort_by_key(|s| s.0);
        if mesh.simplified.iter().any(|(_, ix)| ix.iter().any(|&i| i as usize >= mesh.map.len())) {
            return Err(Error::format(format!("{name}: simplified indices out of range")));
        }
        if let Some(s) = &stencil {
            mesh.dominant = Some(s.dominant_columns());
        } else if let Some(p) = mesh.def.source.proxy() {
            mesh.dominant = self.proxies.get(p).map(dominant_refs);
        }
        if let Some((bj, bw)) = &self.base_skin {
            let skin: (Vec<u16>, Vec<f32>);
            let (sj, sw): (&[u16], &[f32]) = if let Some(s) = &stencil {
                skin = stencil_skin(s, bj, bw);
                (&skin.0, &skin.1)
            } else if let Some(p) = mesh.def.source.proxy() {
                if !self.proxy_skins.contains_key(p) {
                    let names: Vec<String> =
                        self.manifest.skeleton.as_ref().map_or(Vec::new(), |s| s.bones.iter().map(|b| b.name.clone()).collect());
                    let ps = proxy_skin(&self.proxies[p], bj, bw, &names);
                    self.proxy_skins.insert(p.to_string(), ps);
                }
                let s = &self.proxy_skins[p];
                (&s.0, &s.1)
            } else {
                (bj, bw)
            };
            let n = mesh.map.len();
            let mut joints = vec![0u16; n * 4];
            let mut weights = vec![0f32; n * 4];
            for (i, &v) in mesh.map.iter().enumerate() {
                let v = v as usize * 4;
                joints[i * 4..i * 4 + 4].copy_from_slice(&sj[v..v + 4]);
                weights[i * 4..i * 4 + 4].copy_from_slice(&sw[v..v + 4]);
            }
            mesh.joints = Some(joints);
            mesh.weights = Some(weights);
        }
        mesh.stencil = stencil;
        Ok(mesh)
    }

    /// Loads meshes that live in their own binary file (`MeshDef.blob`), with their proxies.
    /// Already loaded meshes are skipped. Shapes evaluated afterwards include their proxies.
    pub fn load_meshes<S: AsRef<str>>(&mut self, names: impl IntoIterator<Item = S>) -> Result<()> {
        let mut seen = HashSet::new();
        for name in names {
            let name = name.as_ref();
            if !seen.insert(name.to_string()) || self.is_loaded(name) {
                continue;
            }
            let def = self.manifest.mesh(name).ok_or_else(|| Error::unknown("mesh", name))?.clone();
            let file = def.blob.clone().ok_or_else(|| Error::format(format!("{name}: not a lazily loaded mesh")))?;
            let blob = self.source.read(&format!("{}{file}", self.base))?;
            if let Some(p) = def.source.proxy() {
                if !self.proxies.contains_key(p) {
                    let proxy = self.manifest.proxy(p).ok_or_else(|| Error::unknown("proxy", p))?.clone();
                    self.bind_proxy(proxy, &blob)?;
                }
            }
            let mesh = self.build_mesh(def, &blob)?;
            self.meshes.push(mesh);
        }
        Ok(())
    }

    /// Clips listed in the manifest plus those of every loaded clip library.
    pub fn clip_defs(&self) -> impl Iterator<Item = &ClipDef> {
        self.manifest.clips.iter().chain(self.library_clips.values().flatten())
    }

    pub fn clip_def(&self, name: &str) -> Option<&ClipDef> {
        self.clip_defs().find(|c| c.name == name)
    }

    /// Loads a clip library's index (see `manifest.clipLibraries`), so its clips can be played.
    pub fn load_clip_library(&mut self, name: &str) -> Result<&[ClipDef]> {
        if !self.library_clips.contains_key(name) {
            let r = self.manifest.clip_libraries.iter().find(|l| l.name == name).ok_or_else(|| Error::unknown("clip library", name))?;
            let path = format!("{}{}", self.base, r.file);
            let lib: ClipLibrary = json(&self.source.read(&path)?, &path)?;
            let dir = r.file.rfind('/').map_or(String::new(), |i| r.file[..=i].to_string());
            let mut defs = Vec::with_capacity(lib.clips.len());
            for c in lib.clips {
                let rig = lib.rigs.get(&c.rig).ok_or_else(|| Error::unknown("clip rig", &c.rig))?;
                defs.push(ClipDef {
                    name: c.name,
                    file: format!("{dir}{}", c.file),
                    fps: c.fps,
                    frame_count: c.frame_count,
                    looping: c.looping,
                    bones: rig.bones.clone(),
                    ref_dirs: rig.ref_dirs.clone(),
                    root_bone: rig.root_bone.clone(),
                    source: c.source,
                    category: c.category,
                    description: c.description,
                    encoding: c.encoding,
                });
            }
            self.library_clips.insert(name.to_string(), defs);
        }
        Ok(&self.library_clips[name])
    }

    /// Loads a motion clip listed in the manifest or a loaded clip library (once; later calls
    /// return the same clip).
    pub fn load_clip(&mut self, name: &str) -> Result<Arc<Clip>> {
        if let Some(c) = self.clips.get(name) {
            return Ok(c.clone());
        }
        let def = self.clip_def(name).ok_or_else(|| Error::unknown("clip", name))?.clone();
        if def.ref_dirs.len() < def.bones.len() * 3 || def.fps <= 0.0 || def.frame_count == 0 {
            return Err(Error::format(format!("{name}: invalid clip definition")));
        }
        let data = decode_clip(&def, &self.source.read(&format!("{}{}", self.base, def.file))?)?;
        let clip = Arc::new(Clip { def, data });
        self.clips.insert(name.to_string(), clip.clone());
        Ok(clip)
    }

    /// Reads a file shipped with the pack (a texture, say), relative to the manifest.
    pub fn load_file(&self, file: &str) -> Result<Vec<u8>> {
        self.source.read(&format!("{}{file}", self.base))
    }

    /// Loads the given targets (once each).
    pub fn ensure_targets<S: AsRef<str>>(&mut self, names: impl IntoIterator<Item = S>) -> Result<()> {
        for name in names {
            let name = name.as_ref();
            if self.targets.contains_key(name) {
                continue;
            }
            let r = self.manifest.target(name).ok_or_else(|| Error::unknown("target", name))?;
            let path = format!("{}{}", self.base, r.file);
            let t = MorphTarget::decode(&self.source.read(&path)?)?;
            let max = t.indices.as_ref().map_or(t.count, |ix| ix.iter().map(|&v| v as usize + 1).max().unwrap_or(0));
            if max > self.manifest.vertex_count {
                return Err(Error::format(format!("{path}: target moves vertices outside the base mesh")));
            }
            self.targets.insert(name.to_string(), Arc::new(t));
        }
        Ok(())
    }

    fn active(weights: &Weights) -> impl Iterator<Item = (&str, f64)> {
        weights.iter().filter(|(_, w)| w.abs() >= 1e-5).map(|(n, w)| (n.as_str(), *w))
    }

    /// Base positions plus the weighted sum of the given targets (which must be loaded).
    pub fn morph(&self, weights: &Weights, out: &mut Vec<f32>) -> Result<()> {
        out.clear();
        out.extend_from_slice(&self.base_positions);
        for (name, w) in Self::active(weights) {
            self.targets.get(name).ok_or_else(|| Error::NotLoaded(format!("target {name}")))?.apply(out, w);
        }
        Ok(())
    }

    /// Loads what an evaluation needs (weighted targets and tip masks), then evaluates.
    /// `fit`: the meshes the shape is needed for (only their proxies and stencil meshes are
    /// fitted); `None`: every loaded mesh.
    pub fn evaluate(&mut self, weights: &Weights, options: Option<&ShapeOptions>, fit: Option<&[&str]>) -> Result<ActorShape> {
        let mut need: Vec<String> = Self::active(weights).map(|(n, _)| n.to_string()).collect();
        if let Some(o) = options {
            need.extend(o.tips.iter().map(|t| t.mask.clone()));
        }
        self.ensure_targets(&need)?;
        if let Some(o) = options {
            for t in &o.tips {
                if !self.masks.contains_key(&t.mask) {
                    let m = target_mask(&self.targets[&t.mask], self.manifest.vertex_count);
                    self.masks.insert(t.mask.clone(), m);
                }
            }
        }
        let mut shape = ActorShape::default();
        self.evaluate_into(weights, options, fit, &mut shape)?;
        Ok(shape)
    }

    /// Per base vertex 0..1 weights of a loaded target's region (see [`crate::TipDeform`]).
    pub fn target_mask(&self, name: &str) -> Result<std::borrow::Cow<'_, [f32]>> {
        if let Some(m) = self.masks.get(name) {
            return Ok(std::borrow::Cow::Borrowed(m));
        }
        let t = self.targets.get(name).ok_or_else(|| Error::NotLoaded(format!("target {name}")))?;
        Ok(std::borrow::Cow::Owned(target_mask(t, self.manifest.vertex_count)))
    }

    fn deform(&self, positions: &mut [f32], options: &ShapeOptions) -> Result<()> {
        for tip in &options.tips {
            apply_tip(positions, &self.target_mask(&tip.mask)?, tip.amount, tip.direction);
        }
        if let (Some(sk), Some((j, w))) = (&self.manifest.skeleton, &self.base_skin) {
            if !options.bones.is_empty() {
                let fitted = fit_skeleton(sk, positions);
                apply_bone_scales(positions, &fitted, j, w, &options.bones);
            }
        }
        if let Some(s) = options.scale {
            apply_scale(positions, s);
        }
        Ok(())
    }

    /// Evaluates a shape whose targets (and tip masks) are loaded, reusing `shape`'s buffers.
    pub fn evaluate_into(
        &self,
        weights: &Weights,
        options: Option<&ShapeOptions>,
        fit: Option<&[&str]>,
        shape: &mut ActorShape,
    ) -> Result<()> {
        self.morph(weights, &mut shape.positions)?;
        if let Some(o) = options.filter(|o| o.is_active()) {
            self.deform(&mut shape.positions, o)?;
        }
        let positions = &shape.positions;
        let base_lists = self.meshes.iter().filter(|m| m.def.source == MeshSource::Base && m.stencil.is_none());
        compute_normals(positions, self.manifest.vertex_count, base_lists, &mut shape.normals);
        let wanted: Option<HashSet<&str>> = fit.map(|f| f.iter().copied().collect());
        let used: Option<HashSet<&str>> = wanted
            .as_ref()
            .map(|w| self.meshes.iter().filter(|m| w.contains(m.def.name.as_str())).filter_map(|m| m.def.source.proxy()).collect());
        shape.skeleton = self.manifest.skeleton.as_ref().map(|s| fit_skeleton(s, positions));
        // Scalp hair lights as one mass: its card normals are bent outward from the middle of the head.
        let head_centre = shape.skeleton.as_ref().and_then(|s| {
            let h = s.index_of("head")?;
            Some([0, 1, 2].map(|k| s.heads[h][k] + 0.45 * (s.tails[h][k] - s.heads[h][k])))
        });
        shape.proxies.retain(|name, _| self.proxies.contains_key(name) && used.as_ref().is_none_or(|u| u.contains(name.as_str())));
        for (name, binding) in &self.proxies {
            if used.as_ref().is_some_and(|u| !u.contains(name.as_str())) {
                continue;
            }
            let surface = shape.proxies.entry(name.clone()).or_default();
            fit_proxy(binding, positions, &mut surface.positions);
            let lists: Vec<&MeshData> = self.meshes.iter().filter(|m| m.def.source.proxy() == Some(name.as_str())).collect();
            compute_normals(&surface.positions, binding.def.vertex_count, lists.iter().copied(), &mut surface.normals);
            if let Some(c) = head_centre {
                if lists.iter().any(|m| m.def.role == MeshRole::Hair && m.def.has_tag("scalp")) {
                    hair_shell_normals(&surface.positions, &mut surface.normals, c, 0.65);
                }
            }
        }
        shape.meshes.retain(|name, _| wanted.as_ref().is_none_or(|w| w.contains(name.as_str())));
        for m in &self.meshes {
            let Some(st) = &m.stencil else { continue };
            if wanted.as_ref().is_some_and(|w| !w.contains(m.def.name.as_str())) {
                continue;
            }
            let surface = shape.meshes.entry(m.def.name.clone()).or_default();
            st.apply(positions, &mut surface.positions);
            compute_normals(&surface.positions, st.rows, [m], &mut surface.normals);
        }
        Ok(())
    }

    /// Synchronous evaluation into a new shape; all weighted targets must be loaded.
    pub fn evaluate_loaded(&self, weights: &Weights, options: Option<&ShapeOptions>, fit: Option<&[&str]>) -> Result<ActorShape> {
        let mut shape = ActorShape::default();
        self.evaluate_into(weights, options, fit, &mut shape)?;
        Ok(shape)
    }

    /// How base-shape surfaces change when extra targets are added on top of a shape: position
    /// and normal deltas for the base shape, every stencil mesh and the face proxies (see
    /// [`follows_face`]), by mesh name. For GPU morph targets (expressions, blinking) blended
    /// every frame without re-evaluating the shape. The targets must be loaded.
    pub fn surface_delta(&self, shape: &ActorShape, weights: &Weights, only: Option<&HashSet<String>>) -> Result<SurfaceDelta> {
        let mut positions = shape.positions.clone();
        for (name, w) in Self::active(weights) {
            self.targets.get(name).ok_or_else(|| Error::NotLoaded(format!("target {name}")))?.apply(&mut positions, w);
        }
        let sub = |a: &mut Vec<f32>, b: &[f32]| {
            for (x, y) in a.iter_mut().zip(b) {
                *x -= *y;
            }
        };
        let mut normals = Vec::new();
        let base_lists = self.meshes.iter().filter(|m| m.def.source == MeshSource::Base && m.stencil.is_none());
        compute_normals(&positions, self.manifest.vertex_count, base_lists, &mut normals);
        let mut meshes = HashMap::new();
        for m in &self.meshes {
            let (Some(st), Some(cur)) = (&m.stencil, shape.meshes.get(&m.def.name)) else { continue };
            if only.is_some_and(|o| !o.contains(&m.def.name)) {
                continue;
            }
            let mut s = Surface::default();
            st.apply(&positions, &mut s.positions);
            compute_normals(&s.positions, st.rows, [m], &mut s.normals);
            sub(&mut s.positions, &cur.positions);
            sub(&mut s.normals, &cur.normals);
            meshes.insert(m.def.name.clone(), s);
        }
        // Proxies on the face (teeth, tongue, brows): refitted, under each mesh drawn from them.
        for (name, binding) in &self.proxies {
            let Some(cur) = shape.proxies.get(name) else { continue };
            let lists: Vec<&MeshData> = self.meshes.iter().filter(|m| m.def.source.proxy() == Some(name.as_str())).collect();
            let users: Vec<&MeshData> =
                lists.iter().copied().filter(|m| follows_face(&m.def) && only.is_none_or(|o| o.contains(&m.def.name))).collect();
            if users.is_empty() {
                continue;
            }
            let mut s = Surface::default();
            fit_proxy(binding, &positions, &mut s.positions);
            compute_normals(&s.positions, binding.def.vertex_count, lists.iter().copied(), &mut s.normals);
            sub(&mut s.positions, &cur.positions);
            sub(&mut s.normals, &cur.normals);
            for m in users {
                meshes.insert(m.def.name.clone(), s.clone());
            }
        }
        sub(&mut positions, &shape.positions);
        sub(&mut normals, &shape.normals);
        Ok(SurfaceDelta { positions, normals, meshes })
    }
}

/// Per proxy vertex: the bound base vertex with the largest weight.
fn dominant_refs(b: &ProxyBinding) -> Vec<u32> {
    (0..b.def.vertex_count)
        .map(|i| {
            let w = &b.weights[i * 3..i * 3 + 3];
            let mut k = 0;
            if w[1] > w[k] {
                k = 1;
            }
            if w[2] > w[k] {
                k = 2;
            }
            b.refs[i * 3 + k]
        })
        .collect()
}

/// Skin weights for stencil rows: weighted sum of base influences, top 4 renormalized.
fn stencil_skin(st: &Stencil, base_joints: &[u16], base_weights: &[f32]) -> (Vec<u16>, Vec<f32>) {
    let mut joints = vec![0u16; st.rows * 4];
    let mut weights = vec![0f32; st.rows * 4];
    let mut acc = JointAcc::default();
    for r in 0..st.rows {
        acc.clear();
        for k in st.row_ptr[r] as usize..st.row_ptr[r + 1] as usize {
            let (v, w) = (st.cols[k] as usize, st.weights[k] as f64);
            for j in 0..4 {
                let bw = base_weights[v * 4 + j] as f64 * w;
                if bw > 0.0 {
                    acc.add(base_joints[v * 4 + j], bw);
                }
            }
        }
        acc.write_top4(false, &mut joints[r * 4..r * 4 + 4], &mut weights[r * 4..r * 4 + 4]);
    }
    (joints, weights)
}
