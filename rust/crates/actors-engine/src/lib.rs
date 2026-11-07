//! Actors characters for [Engine](https://github.com/ArndRosemeier/Engine).
//!
//! A [`CharacterBuilder`] holds a loaded human pack; [`CharacterBuilder::build`] turns a
//! [`CharacterConfig`] (the same JSON as the web generator) into an [`engine::anim::AnimatedModel`]:
//! the shaped body, eyes, hair, brows and clothes as skinned meshes with their textures and
//! colours, the fitted skeleton, and the chosen clips retargeted and baked as keyframes. Spawn it
//! with `world.spawn_animated` and play clips by name.
//!
//! ```no_run
//! use actors_engine::{BuildOptions, CharacterBuilder};
//! use actors_generator::{AllowOptions, RandomOptions};
//!
//! let mut builder = CharacterBuilder::load("assets/packs")?;
//! builder.allow(&AllowOptions::preset("fantasy").unwrap());
//! let config = builder.random(7, &RandomOptions::default());
//! let character = builder.build(&config, &BuildOptions::default())?;
//! // world.spawn_animated(character.model, Place::at(0.0, 0.0, 0.0)?)?; world.play_animation(id, "idle")?;
//! # Ok::<(), actors_core::Error>(())
//! ```
//!
//! What is baked is a snapshot: change the config and build again (about 0.3 to 0.6 s in a
//! release build with three clips; build on a worker thread in a game). The engine has no polygon
//! offset, so outer garments sit a millimetre or two further out per layer instead. Not yet carried over from the three.js adapter: robots and
//! skeletons, generated race add-ons (horns, tails, tusks, beards, leaves), the skin shader's
//! patterns, stubble and detail, iris colours, and face animation.

pub mod texture;

use actors_core::format::{MaterialKind, MeshRole};
use actors_core::{
    ActorRuntime, ActorShape, DirSource, Error, FittedSkeleton, InPlace, MeshData, Result, RetargetOptions, Retargeter, Weights,
};
use actors_generator::{
    allow_catalog, build_catalog, concealed_garments, default_config, height_fit, random_config, sanitize_config, AllowOptions,
    CharacterCatalog, CharacterConfig, Detail, RandomOptions, SeededRandom, SkinKind,
};
use actors_human::{expression, shape_modifiers, Human, HumanPack};
use engine::anim::{AnimatedModel, AnimationClip, JointChannels, QuatTrack, Skeleton, SkinMesh, Vec3Track, MAX_JOINTS};
use engine::mesh::{AlbedoMap, MaterialMaps};
use glam::{Mat4, Quat, Vec3, Vec4};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use texture::{hex_linear, luminance, srgb_to_linear};

/// How to build a character.
#[derive(Clone, Debug)]
pub struct BuildOptions {
    /// Clips to bake, by name (see `catalog().animations`). Empty: the config's animation plus
    /// idle, walk and run where the pack has them.
    pub clips: Vec<String>,
    /// Keyframes per second of the baked clips.
    pub fps: f64,
    /// Locomotion clips walk on the spot (the game moves the character) or carry their travel.
    pub in_place: InPlace,
    /// Photo skins blended for the body texture (more is closer to the web editor, slower to build).
    pub skin_layers: usize,
}

impl Default for BuildOptions {
    fn default() -> Self {
        Self { clips: Vec::new(), fps: 30.0, in_place: InPlace::On, skin_layers: 3 }
    }
}

/// A built character.
#[derive(Clone, Debug)]
pub struct CharacterModel {
    pub model: AnimatedModel,
    /// The config as built (made valid: adult age, wearable outfit, allowed race).
    pub config: CharacterConfig,
    /// Standing height in meters (after the catalog's height range).
    pub height: f32,
    /// The meshes drawn, by pack name, in the order of `model.meshes`.
    pub meshes: Vec<String>,
}

/// A loaded human pack that builds characters for the engine.
pub struct CharacterBuilder {
    rt: ActorRuntime,
    pack: Arc<HumanPack>,
    full: CharacterCatalog,
    catalog: CharacterCatalog,
    known: HashMap<String, f64>,
    textures: HashMap<String, Arc<AlbedoMap>>,
}

impl CharacterBuilder {
    /// Loads `<packs>/human/manifest.json` (packs from `npm run import:human` or a release's
    /// actors-packs archive).
    pub fn load(packs: impl AsRef<Path>) -> Result<Self> {
        Self::from_runtime(ActorRuntime::load(DirSource::new(packs.as_ref()), "human/manifest.json")?)
    }

    /// Uses an already loaded human runtime (any [`actors_core::PackSource`]).
    pub fn from_runtime(rt: ActorRuntime) -> Result<Self> {
        let pack = HumanPack::new(rt.manifest())?;
        let mut full = build_catalog(rt.manifest(), &pack, rt.clip_defs(), None);
        // Robots and skeletons are not ported to the engine yet.
        full.robot = None;
        full.skeletal = None;
        let known = pack.extra.modifiers.iter().map(|m| (m.id.clone(), if m.negative.is_empty() { 0.0 } else { -1.0 })).collect();
        Ok(Self { rt, pack, catalog: full.clone(), full, known, textures: HashMap::new() })
    }

    /// What can be built (after [`Self::allow`]).
    pub fn catalog(&self) -> &CharacterCatalog {
        &self.catalog
    }

    /// The runtime (to load clip libraries, say).
    pub fn runtime(&mut self) -> &mut ActorRuntime {
        &mut self.rt
    }

    /// Keeps characters to what a game allows (races, clothing, height).
    pub fn allow(&mut self, allow: &AllowOptions) {
        self.catalog = allow_catalog(&self.full, allow);
    }

    /// The default character.
    pub fn default_config(&self) -> CharacterConfig {
        default_config(&self.catalog)
    }

    /// A random adult character; the same seed gives the same character (also in TypeScript).
    pub fn random(&self, seed: u32, options: &RandomOptions) -> CharacterConfig {
        random_config(&self.catalog, &self.default_config(), options, &mut SeededRandom::new(seed as f64))
    }

    /// Builds the character.
    pub fn build(&mut self, config: &CharacterConfig, options: &BuildOptions) -> Result<CharacterModel> {
        let c = sanitize_config(&self.catalog, config);
        let names = self.mesh_names(&c);
        self.rt.load_meshes(&names)?;
        let fit: Vec<&str> = names.iter().map(String::as_str).collect();

        let mut human = Human::new(self.pack.clone());
        human.params = c.body;
        human.modifier_values = shape_modifiers(&c.shape, &c.details, Some(&self.known));
        human.race = c.race_settings();
        human.deform = c.deform.as_ref().map(actors_core::deform_recipe::deform);
        let mut shape = self.evaluate(&human, &c, &fit)?;
        let body = names.first().and_then(|n| self.rt.mesh(n)).filter(|m| m.def.role == MeshRole::Body).cloned();
        let range = |s: &ActorShape| body_range(s, body.as_ref());
        let mut height = range(&shape).1 - range(&shape).0;
        let scale = height_fit(height as f64, self.catalog.height.as_ref());
        if scale != 1.0 {
            human.fit_scale = scale;
            shape = self.evaluate(&human, &c, &fit)?;
            height = range(&shape).1 - range(&shape).0;
        }
        let sk = shape.skeleton.clone().ok_or_else(|| Error::Format("pack has no skeleton".into()))?;
        if sk.len() > MAX_JOINTS {
            return Err(Error::Format(format!("{} bones, the engine takes {MAX_JOINTS}", sk.len())));
        }

        let skin = self.skin_albedo(&human, &c, options.skin_layers)?;
        // Drawing order as in the three.js adapter: the body, then garments by layer, and within a
        // layer by their place in the outfit. What a later garment covers is not drawn under it
        // (skin under clothes, briefs under trousers), so it can't poke through.
        let order: Vec<f32> = names.iter().map(|n| self.rt.mesh(n).map_or(0.0, |m| depth_order(m, &names, &self.rt))).collect();
        let covers: Vec<(f32, &[u32])> = names
            .iter()
            .zip(&order)
            .filter_map(|(n, &o)| self.rt.mesh(n).and_then(|m| m.hides_base_vertices.as_deref()).map(|h| (o, h)))
            .collect();
        let hides: Vec<HashSet<u32>> =
            order.iter().map(|&mine| covers.iter().filter(|(o, _)| *o > mine).flat_map(|(_, h)| h.iter().copied()).collect()).collect();
        // Pack shapes are centred on the body; the engine's characters stand on y = 0.
        let lift = -range(&shape).0;
        let mut meshes = Vec::with_capacity(names.len());
        for (i, n) in names.iter().enumerate() {
            let md = self.rt.mesh(n).ok_or_else(|| Error::Unknown { kind: "mesh", name: n.clone() })?.clone();
            let material = self.material(&md, &c, &human, skin.as_deref())?;
            // The engine has no polygon offset: outer layers sit a little further out instead.
            let offset = if md.def.material.kind == MaterialKind::Cloth { order[i] * LAYER_GAP } else { 0.0 };
            meshes.push(skin_mesh(&md, &shape, &hides[i], material, lift, offset)?);
        }

        let clips = self.clips(&sk, &c, options)?;
        let (skeleton, bind_local) = engine_skeleton(&sk, lift);
        Ok(CharacterModel { model: AnimatedModel { skeleton, meshes, clips, bind_local }, config: c, height, meshes: names })
    }

    fn evaluate(&mut self, human: &Human, c: &CharacterConfig, fit: &[&str]) -> Result<ActorShape> {
        let mut weights: Weights = human.target_weights()?;
        // The expression is baked into the shape (no face animation yet).
        if let Some(units) = expression(&c.expression) {
            for (k, v) in human.face_weights(units, c.expression_intensity) {
                *weights.entry(k).or_insert(0.0) += v;
            }
        }
        self.rt.evaluate(&weights, Some(&human.shape_options()), Some(fit))
    }

    /// Pack meshes the config shows, the way the web generator picks them.
    fn mesh_names(&self, c: &CharacterConfig) -> Vec<String> {
        let has = |n: &str| self.rt.manifest().meshes.iter().any(|m| m.name == n);
        let mut out: Vec<String> = Vec::new();
        let body = if c.detail == Detail::Low && has("body-low") { "body-low" } else { "body" };
        out.push(body.into());
        for n in ["eyes", "eyelashes", "teeth", "tongue"] {
            if has(n) {
                out.push(n.into());
            }
        }
        let concealed = concealed_garments(&self.catalog, &c.outfit);
        let worn: Vec<&String> = c.outfit.iter().filter(|g| !concealed.contains(g) && has(g)).collect();
        let garment = |id: &str| self.catalog.garment(id);
        let hides_hair = c.outfit.iter().any(|g| garment(g).is_some_and(|g| g.hides_hair));
        if let Some(h) = c.hair.as_deref().filter(|h| has(h) && !hides_hair) {
            out.push(h.into());
        }
        if let Some(b) = c.brows.as_deref().filter(|b| has(b)) {
            out.push(b.into());
        }
        // Adults only (sanitize_config turns anatomy off for children); hidden under covering clothes.
        let covered = c.outfit.iter().any(|g| garment(g).is_some_and(|g| g.covers_anatomy));
        if c.anatomy && c.youth == 0.0 && c.body.gender >= 0.5 && !covered && has("genitals-male") {
            out.push("genitals-male".into());
        }
        out.extend(worn.into_iter().cloned());
        out
    }

    fn texture(&mut self, file: &str) -> Result<Arc<AlbedoMap>> {
        if let Some(t) = self.textures.get(file) {
            return Ok(t.clone());
        }
        let bytes = self.rt.load_file(file)?;
        let map = Arc::new(texture::decode(&bytes).map_err(|e| Error::Format(format!("{file}: {e}")))?);
        self.textures.insert(file.to_string(), map.clone());
        Ok(map)
    }

    /// The body texture: photo skins blended for gender, age and ethnicity.
    fn skin_albedo(&mut self, human: &Human, c: &CharacterConfig, layers: usize) -> Result<Option<Arc<AlbedoMap>>> {
        if c.skin != SkinKind::Photo {
            return Ok(None);
        }
        let skins = human.skin_textures(layers.max(1));
        if skins.is_empty() {
            return Ok(None);
        }
        let key = format!("skin:{skins:?}");
        if let Some(t) = self.textures.get(&key) {
            return Ok(Some(t.clone()));
        }
        let maps: Vec<(Arc<AlbedoMap>, f32)> = skins.iter().map(|(f, w)| self.texture(f).map(|t| (t, *w as f32))).collect::<Result<_>>()?;
        let refs: Vec<(&AlbedoMap, f32)> = maps.iter().map(|(m, w)| (m.as_ref(), *w)).collect();
        let mut blended = texture::blend(&refs).ok_or_else(|| Error::Format("no skin texture".into()))?;
        texture::opaque(&mut blended);
        let blended = Arc::new(blended);
        // Blends are reused for similar bodies; keep the cache small.
        if self.textures.keys().filter(|k| k.starts_with("skin:")).count() > 16 {
            self.textures.retain(|k, _| !k.starts_with("skin:"));
        }
        self.textures.insert(key, blended.clone());
        Ok(Some(blended))
    }

    fn material(&mut self, md: &MeshData, c: &CharacterConfig, human: &Human, skin: Option<&AlbedoMap>) -> Result<Material> {
        let def = &md.def;
        let hint_lin = def.material.color.map(|col| col.map(srgb_to_linear));
        let mut m =
            Material { color: [1.0; 3], albedo: None, normal: None, roughness: def.material.roughness.unwrap_or(0.6), double_sided: false };
        let tex = def.textures.as_ref();
        match def.material.kind {
            MaterialKind::Skin => {
                match skin {
                    Some(s) => {
                        m.albedo = Some(s.clone());
                        // A custom skin colour scales the photo's channels so its mean becomes that colour.
                        if let (Some(custom), Some(tone)) = (c.skin_color.as_deref().and_then(hex_linear), human.skin_texture_tone(3)) {
                            let tone = tone.map(|v| srgb_to_linear(v as f32));
                            m.color = [0, 1, 2].map(|i| custom[i] / tone[i].max(1e-3));
                        }
                    }
                    None => m.color = c.skin_color.as_deref().and_then(hex_linear).unwrap_or_else(|| skin_tone_color(c.skin_tone)),
                }
            }
            MaterialKind::Hair => {
                m.double_sided = true;
                match tex.and_then(|t| t.get("color")) {
                    Some(file) => {
                        let t = self.texture(file)?;
                        m.albedo = Some(match c.hair_color.as_deref().and_then(hex_linear) {
                            Some(tint) => texture::tint(&t, tint, luminance(hint_lin.unwrap_or([0.3, 0.2, 0.1]))),
                            None => (*t).clone(),
                        });
                    }
                    // Eyelashes: near black either way (linear).
                    None => m.color = [0.05, 0.035, 0.03],
                }
            }
            MaterialKind::Cloth => {
                m.double_sided = true;
                let tint = c.garment_colors.get(&def.name).and_then(|h| hex_linear(h));
                match tex.and_then(|t| t.get("color")) {
                    Some(file) => {
                        let t = self.texture(file)?;
                        // Textured garments store their texture's mean colour (sRGB).
                        m.albedo = Some(match tint {
                            Some(tint) => texture::tint(&t, tint, luminance(hint_lin.unwrap_or([0.5; 3]))),
                            None => (*t).clone(),
                        });
                    }
                    // Plain garments store their colour linear.
                    None => m.color = tint.unwrap_or_else(|| def.material.color.unwrap_or([0.8; 3])),
                }
                if let Some(file) = tex.and_then(|t| t.get("normal")) {
                    m.normal = Some((*self.texture(file)?).clone());
                }
            }
            MaterialKind::Eye | MaterialKind::Teeth | MaterialKind::Mouth => {
                if let Some(file) = tex.and_then(|t| t.get("color")) {
                    let mut t = (*self.texture(file)?).clone();
                    texture::opaque(&mut t);
                    m.albedo = Some(t);
                } else {
                    m.color = def.material.color.unwrap_or([0.8; 3]);
                }
            }
            _ => m.color = def.material.color.unwrap_or([0.8; 3]),
        }
        Ok(m)
    }

    fn clips(&mut self, sk: &FittedSkeleton, c: &CharacterConfig, options: &BuildOptions) -> Result<Vec<AnimationClip>> {
        let mut names = options.clips.clone();
        if names.is_empty() {
            names.extend(c.animation.iter().cloned());
            for n in ["idle", "walk", "run"] {
                if !names.iter().any(|x| x == n) && self.rt.clip_def(n).is_some() {
                    names.push(n.into());
                }
            }
        }
        let opts = RetargetOptions { in_place: options.in_place, ..Default::default() };
        let mut out = Vec::with_capacity(names.len());
        for name in names {
            let clip = self.rt.load_clip(&name)?;
            let baked = Retargeter::new(sk, clip, &opts)?.bake(options.fps);
            let times = baked.times.clone();
            let mut channels: Vec<JointChannels> = baked
                .rotations
                .iter()
                .map(|r| JointChannels {
                    rotation: Some(QuatTrack {
                        times: times.clone(),
                        values: r.as_chunks::<4>().0.iter().map(|q| Quat::from_xyzw(q[0], q[1], q[2], q[3])).collect(),
                    }),
                    ..Default::default()
                })
                .collect();
            channels[baked.root_index].translation = Some(Vec3Track {
                times: times.clone(),
                values: baked.root_positions.as_chunks::<3>().0.iter().map(|p| Vec3::new(p[0], p[1], p[2])).collect(),
            });
            out.push(AnimationClip { name, duration: times.last().copied().unwrap_or(0.0), channels });
        }
        Ok(out)
    }
}

/// The procedural skin colour for `skin_tone` (0 = light .. 1 = dark), linear.
pub fn skin_tone_color(tone: f64) -> [f32; 3] {
    const TONES: [[f32; 3]; 4] = [[0.93, 0.76, 0.66], [0.78, 0.57, 0.43], [0.5, 0.33, 0.22], [0.25, 0.15, 0.1]];
    let f = tone.clamp(0.0, 1.0) as f32 * 3.0;
    let i = (f.floor() as usize).min(2);
    let t = f - i as f32;
    [0, 1, 2].map(|c| {
        let (a, b) = (srgb_to_linear(TONES[i][c]), srgb_to_linear(TONES[i + 1][c]));
        a + (b - a) * t
    })
}

struct Material {
    /// Linear colour multiplied with the albedo.
    color: [f32; 3],
    albedo: Option<AlbedoMap>,
    normal: Option<AlbedoMap>,
    roughness: f32,
    double_sided: bool,
}

/// Lowest and highest point of the visible body (the base mesh also holds helper geometry, such
/// as the tights helper below the feet, which mustn't count).
fn body_range(shape: &ActorShape, body: Option<&MeshData>) -> (f32, f32) {
    let span = |it: &mut dyn Iterator<Item = f32>| it.fold((f32::MAX, f32::MIN), |(l, h), y| (l.min(y), h.max(y)));
    let (lo, hi) = match body.and_then(|b| shape.source_of(b).map(|(p, _)| (b, p))) {
        Some((b, p)) => span(&mut b.map.iter().map(|&v| p[v as usize * 3 + 1])),
        None => span(&mut shape.positions.iter().skip(1).step_by(3).copied()),
    };
    if hi > lo {
        (lo, hi)
    } else {
        (0.0, 0.0)
    }
}

/// Meters between garment layers (see [`depth_order`]).
const LAYER_GAP: f32 = 0.002;

/// A garment's layer (see `garmentLayer` in @actors/three): 0 for the body, then underwear,
/// fitted garments and explicit `layer:` tags.
fn garment_layer(md: &MeshData) -> f32 {
    let def = &md.def;
    if def.role == MeshRole::Body {
        return 0.0;
    }
    if let Some(l) = def.tags.iter().find_map(|t| t.strip_prefix("layer:")).and_then(|v| v.parse::<f32>().ok()) {
        return 2.0 + l;
    }
    let fitted = matches!(def.source, actors_core::format::MeshSource::Proxy { .. }) && !def.has_tag("tucked");
    (if fitted { 2.0 } else { 1.0 }) + def.inflate.unwrap_or(0.0) * 100.0
}

/// Drawing order: the layer, then a quarter step per garment of the same layer drawn before it.
fn depth_order(md: &MeshData, drawn: &[String], rt: &ActorRuntime) -> f32 {
    if md.def.material.kind != MaterialKind::Cloth {
        return garment_layer(md);
    }
    let layer = garment_layer(md);
    let mut rank = 0.0;
    for n in drawn {
        if n == md.name() {
            break;
        }
        if rt.mesh(n).is_some_and(|o| o.def.material.kind == MaterialKind::Cloth && garment_layer(o) == layer) {
            rank += 1.0;
        }
    }
    layer + rank * 0.25
}

fn skin_mesh(md: &MeshData, shape: &ActorShape, hidden: &HashSet<u32>, m: Material, lift: f32, offset: f32) -> Result<SkinMesh> {
    let (pos, nrm) = shape.source_of(md).ok_or_else(|| Error::NotLoaded(format!("shape of mesh {}", md.name())))?;
    let n = md.vertex_count();
    let at = |a: &[f32], s: u32| {
        let i = s as usize * 3;
        Vec3::new(a[i], a[i + 1], a[i + 2])
    };
    let normals: Vec<Vec3> = md.map.iter().map(|&s| at(nrm, s).normalize_or_zero()).collect();
    let positions: Vec<Vec3> = md.map.iter().zip(&normals).map(|(&s, n)| at(pos, s) + Vec3::Y * lift + *n * offset).collect();
    let uvs: Vec<[f32; 2]> = (0..n).map(|i| md.uv.get(i * 2..i * 2 + 2).map_or([0.0, 0.0], |u| [u[0], u[1]])).collect();
    let joints: Vec<[u16; 4]> = match &md.joints {
        Some(j) => j.as_chunks::<4>().0.iter().map(|j| [j[0], j[1], j[2], j[3]]).collect(),
        None => vec![[0; 4]; n],
    };
    let weights: Vec<[f32; 4]> = match &md.weights {
        Some(w) => w.as_chunks::<4>().0.iter().map(|w| [w[0], w[1], w[2], w[3]]).collect(),
        None => vec![[1.0, 0.0, 0.0, 0.0]; n],
    };
    // Covered surface: a triangle goes when all its corners are covered (the body, garments cut
    // from it, and fitted garments under a fitted one). Cut hems (clip < 0) too.
    let coverable = md.def.role == MeshRole::Body
        || (md.def.role == MeshRole::Garment && (md.def.source == actors_core::format::MeshSource::Base || md.dominant.is_some()));
    let hidden_vertex = |v: u32| {
        if !coverable || hidden.is_empty() {
            return false;
        }
        let s = md.map[v as usize];
        let base = md.dominant.as_ref().map_or(s, |d| d[s as usize]);
        hidden.contains(&base)
    };
    let cut = |v: u32| md.clip.as_ref().is_some_and(|c| c[v as usize] < 0.0);
    let indices: Vec<u32> = md
        .indices
        .as_chunks::<3>()
        .0
        .iter()
        .filter(|t| !(t.iter().all(|&v| hidden_vertex(v)) || t.iter().all(|&v| cut(v))))
        .flatten()
        .copied()
        .collect();
    let color = Vec4::new(m.color[0], m.color[1], m.color[2], 1.0);
    let mut maps = MaterialMaps { normal: m.normal, ..MaterialMaps::default() };
    maps.roughness = m.roughness;
    maps.metallic = 0.0;
    Ok(SkinMesh {
        positions,
        normals,
        colors: vec![color; n],
        uvs,
        joints,
        weights,
        indices,
        double_sided: m.double_sided,
        albedo: m.albedo,
        maps,
    })
}

/// The engine's skeleton and bind pose from a fitted skeleton (bind matrices composed the way the
/// engine composes them, so the bind pose skins to exactly the shaped mesh).
fn engine_skeleton(sk: &FittedSkeleton, lift: f32) -> (Skeleton, Vec<(Vec3, Quat, Vec3)>) {
    let n = sk.len();
    let bind_local: Vec<(Vec3, Quat, Vec3)> = (0..n)
        .map(|i| {
            let p = sk.local_positions[i];
            let q = sk.local_rotations[i];
            let up = if sk.parent(i).is_none() { lift } else { 0.0 };
            (
                Vec3::new(p[0] as f32, p[1] as f32 + up, p[2] as f32),
                Quat::from_xyzw(q[0] as f32, q[1] as f32, q[2] as f32, q[3] as f32).normalize(),
                Vec3::ONE,
            )
        })
        .collect();
    let mut global = vec![Mat4::IDENTITY; n];
    for i in 0..n {
        let (t, r, s) = bind_local[i];
        let local = Mat4::from_scale_rotation_translation(s, r, t);
        global[i] = match sk.parent(i) {
            Some(p) => global[p] * local,
            None => local,
        };
    }
    let skeleton = Skeleton {
        joint_names: sk.names.clone(),
        parents: (0..n).map(|i| sk.parent(i)).collect(),
        inverse_bind: global.iter().map(|g| g.inverse()).collect(),
        joint_node_indices: (0..n).collect(),
        root_transforms: vec![Mat4::IDENTITY; n],
    };
    (skeleton, bind_local)
}
