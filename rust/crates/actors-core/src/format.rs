//! The actor pack format: an engine-agnostic description of a morphable, rigged character,
//! produced offline by an importer (`tools/` in the repository) and read by [`ActorRuntime`].
//!
//! A pack is a JSON manifest plus one binary blob for the base data and one small binary file
//! per morph target, so targets can be loaded on demand. Meshes and proxies that are rarely
//! shown (a large garment library) can live in their own binary files (`blob`).
//!
//! Conventions: meters, +Y up, the character faces +Z (same as glTF).
//!
//! These types mirror `packages/core/src/format.ts`; field names are the same in camelCase JSON.
//!
//! [`ActorRuntime`]: crate::ActorRuntime

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

/// Element type of a [`BufferRef`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScalarType {
    F32,
    U32,
    U16,
    I16,
    U8,
}

impl ScalarType {
    pub fn size(self) -> usize {
        match self {
            ScalarType::F32 | ScalarType::U32 => 4,
            ScalarType::U16 | ScalarType::I16 => 2,
            ScalarType::U8 => 1,
        }
    }
}

/// A typed slice of the pack's base blob (or of a mesh's or proxy's own `blob`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BufferRef {
    /// Byte offset into the blob. Always aligned to 4.
    pub offset: usize,
    /// Number of scalars (not bytes).
    pub count: usize,
    #[serde(rename = "type")]
    pub ty: ScalarType,
}

/// Free-form material kind the renderer adapter maps to its own material.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MaterialKind {
    Skin,
    Eye,
    Cloth,
    Hair,
    Teeth,
    Mouth,
    Fur,
    #[serde(other)]
    Other,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MaterialHint {
    pub kind: MaterialKind,
    /// sRGB 0..1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<[f32; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roughness: Option<f32>,
}

/// Which shape a mesh follows: the actor's base shape, or a proxy (garment) by name.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum MeshSource {
    Base,
    Proxy { proxy: String },
}

impl MeshSource {
    pub fn proxy(&self) -> Option<&str> {
        match self {
            MeshSource::Base => None,
            MeshSource::Proxy { proxy } => Some(proxy),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MeshRole {
    Body,
    Eyes,
    Garment,
    Bodypart,
    Hair,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubdivideDef {
    pub source: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StencilDef {
    pub rows: usize,
    pub row_ptr: BufferRef,
    pub cols: BufferRef,
    pub weights: BufferRef,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SimplifiedDef {
    pub level: usize,
    pub indices: BufferRef,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttributeDef {
    pub data: BufferRef,
    pub size: usize,
}

/// A renderable surface. Its vertices are split at UV seams; `baseIndex` maps each one back
/// to a shape vertex.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshDef {
    pub name: String,
    pub source: MeshSource,
    pub role: MeshRole,
    /// Render vertex -> source vertex index (u32). Absent for `subdivide` meshes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_index: Option<BufferRef>,
    /// Render vertex UVs (f32, 2 per vertex). Absent for `subdivide` meshes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uv: Option<BufferRef>,
    /// Triangle list in render vertex indices (u32). Absent for `subdivide` meshes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indices: Option<BufferRef>,
    /// Built at load time: one Catmull-Clark level of the named earlier mesh.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subdivide: Option<SubdivideDef>,
    /// Not rendered; only the source of other meshes.
    #[serde(default)]
    pub internal: bool,
    pub material: MaterialHint,
    /// Garments are optional and can be toggled.
    #[serde(default)]
    pub optional: bool,
    /// Base vertices hidden while this mesh is shown (skin under a sock).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hides_base_vertices: Option<BufferRef>,
    /// Sparse linear map (CSR) from base vertices to this mesh's own vertices.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stencil: Option<StencilDef>,
    /// Per render vertex (f32): surface where the interpolated value is below 0 is cut away.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clip: Option<BufferRef>,
    /// Push vertices out along their normal by this many meters (garment thickness).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inflate: Option<f32>,
    /// Mutually exclusive alternatives share a slot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot: Option<String>,
    /// Textures shipped with the pack, relative to the manifest (keys: color, normal, maskA..maskC).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub textures: Option<IndexMap<String, String>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Own binary file holding this mesh's buffers; loaded on demand.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob: Option<String>,
    /// Detail levels this mesh is drawn at. Absent: every level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lods: Option<Vec<usize>>,
    /// Stands in for the named mesh at levels that mesh is not drawn at.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lod_of: Option<String>,
    /// Reduced triangle lists for higher detail levels, over the same render vertices.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub simplified: Vec<SimplifiedDef>,
    /// Extra per render vertex data for the adapter's material (f32, `size` values per vertex).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attributes: Option<IndexMap<String, AttributeDef>>,
}

impl MeshDef {
    pub fn has_tag(&self, tag: &str) -> bool {
        self.tags.iter().any(|t| t == tag)
    }
}

/// A detail level (LOD). Level 0 is full detail.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LodDef {
    pub name: String,
    /// Suggested camera distance in meters from which this level is used.
    pub distance: f32,
    /// Bones that still animate at this level. Absent: every bone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bones: Option<Vec<String>>,
    /// Draw this level's opaque body and garments as one merged mesh.
    #[serde(default)]
    pub merge: bool,
}

/// A joint position: the mean of the given base vertices (after morphing).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct JointRef {
    pub vertices: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BoneDef {
    pub name: String,
    /// Index into `bones`, or -1 for a root. Parents always come before children.
    pub parent: i32,
    pub head: JointRef,
    pub tail: JointRef,
    /// Roll around the head->tail axis, in radians, using Blender's bone convention.
    pub roll: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SkeletonDef {
    pub name: String,
    pub bones: Vec<BoneDef>,
}

impl SkeletonDef {
    pub fn index_of(&self, name: &str) -> Option<usize> {
        self.bones.iter().position(|b| b.name == name)
    }
}

/// Per base-vertex skinning: 4 influences per vertex.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkinDef {
    /// u16, 4 per base vertex.
    pub joints: BufferRef,
    /// f32, 4 per base vertex.
    pub weights: BufferRef,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TargetRef {
    pub name: String,
    pub group: String,
    /// File name relative to the manifest.
    pub file: String,
    /// Number of vertices the target moves.
    pub count: usize,
}

/// Skirt-style skinning (see `ProxyDef.legBlend` in format.ts).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegBlend {
    pub remap: IndexMap<String, String>,
    pub pairs: Vec<(String, String)>,
    pub hip: String,
    pub hip_share: f64,
}

/// A separate mesh (garment, body part) whose vertices are bound to triangles of the base
/// shape: vertex = w0*V[r0] + w1*V[r1] + w2*V[r2] + offset * scale, where the per-axis scale is
/// the current distance between two reference vertices divided by its rest length.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyDef {
    pub name: String,
    pub vertex_count: usize,
    pub refs: BufferRef,
    pub weights: BufferRef,
    pub offsets: BufferRef,
    /// Per axis [vertexA, vertexB, restLength in meters].
    pub scale_refs: [[f64; 3]; 3],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub leg_blend: Option<LegBlend>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob: Option<String>,
}

/// Data layout of a clip file.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClipEncoding {
    /// Interleaved per frame: bones x quat (xyzw), then root translation xyz.
    #[default]
    F32,
    /// All frames' quaternions as int16 (value / 32767), then all frames' root translations as f32.
    I16,
}

/// A retargetable motion clip: per bone the world-space rotation change relative to a
/// reference pose, plus the direction the bone pointed in that pose. Root motion is stored in
/// units of hip height.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipDef {
    pub name: String,
    pub file: String,
    pub fps: f64,
    pub frame_count: usize,
    #[serde(rename = "loop")]
    pub looping: bool,
    pub bones: Vec<String>,
    /// Reference-pose direction (head -> tail, model space) per bone, 3 floats each.
    pub ref_dirs: Vec<f64>,
    /// Bone whose position carries the root motion (usually the pelvis).
    pub root_bone: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub encoding: ClipEncoding,
}

/// A large clip collection kept out of the manifest, loaded on demand.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClipLibraryRef {
    pub name: String,
    pub file: String,
    pub count: usize,
    pub source: String,
    pub license: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipRig {
    pub bones: Vec<String>,
    pub ref_dirs: Vec<f64>,
    pub root_bone: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryClip {
    pub name: String,
    pub file: String,
    pub fps: f64,
    pub frame_count: usize,
    #[serde(rename = "loop")]
    pub looping: bool,
    pub source: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub encoding: ClipEncoding,
    pub rig: String,
}

/// Clip library index: clips share bone lists and reference directions through named rigs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ClipLibrary {
    pub name: String,
    pub rigs: IndexMap<String, ClipRig>,
    pub clips: Vec<LibraryClip>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackSourceInfo {
    pub name: String,
    pub license: String,
    pub url: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorPackManifest {
    pub format: String,
    pub version: u32,
    pub id: String,
    pub species: String,
    pub units: String,
    pub source: PackSourceInfo,
    /// Base blob file name, relative to the manifest.
    pub blob: String,
    pub vertex_count: usize,
    pub base_positions: BufferRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub garment_vertex_of: Option<BufferRef>,
    pub meshes: Vec<MeshDef>,
    pub proxies: Vec<ProxyDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skeleton: Option<SkeletonDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skin: Option<SkinDef>,
    pub targets: Vec<TargetRef>,
    #[serde(default)]
    pub clips: Vec<ClipDef>,
    #[serde(default)]
    pub clip_libraries: Vec<ClipLibraryRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lods: Option<Vec<LodDef>>,
    /// Species-specific data (how sliders map to targets for humans, ...).
    #[serde(default)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl ActorPackManifest {
    pub fn mesh(&self, name: &str) -> Option<&MeshDef> {
        self.meshes.iter().find(|m| m.name == name)
    }
    pub fn proxy(&self, name: &str) -> Option<&ProxyDef> {
        self.proxies.iter().find(|p| p.name == name)
    }
    pub fn target(&self, name: &str) -> Option<&TargetRef> {
        self.targets.iter().find(|t| t.name == name)
    }
}

/// "AAGT" little-endian.
pub const TARGET_MAGIC: u32 = 0x5447_4141;
pub const TARGET_FLAG_DENSE: u32 = 1;
