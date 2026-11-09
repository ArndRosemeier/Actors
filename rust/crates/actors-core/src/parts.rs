//! Extra skinned meshes generated at runtime (horns, beards, tails, robot plates, bones), in
//! the same model space and skeleton as the actor's pack meshes.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PartKind {
    Hair,
    Leaf,
    Horn,
    Tusk,
    Skin,
    Fin,
    Fur,
    // Robot parts: painted armour plates, second paint, inner frame, joint housings, visor glass, lights.
    Plate,
    Trim,
    Frame,
    Joint,
    Visor,
    Glow,
    /// Skeleton (undead) bones; their eye and heart lights use `Glow`.
    Bone,
    /// Costume cloth (cape, mask, belt, buckle, emblem rim): coloured by `PartMesh::color`.
    Cloth,
    /// A chest emblem plate, painted with the emblem texture.
    Emblem,
}

/// An extra bone a part adds (a tail chain), in model space (bind pose).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PartBone {
    pub name: String,
    /// A pack bone or an earlier extra bone.
    pub parent: String,
    pub head: [f32; 3],
}

#[derive(Clone, Debug, PartialEq)]
pub struct PartMesh {
    pub name: String,
    pub kind: PartKind,
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    /// Per vertex brightness factor.
    pub shade: Vec<f32>,
    /// 4 influences per vertex, as bone indices of the pack skeleton (indices past it refer to
    /// `bones` of all parts, in part order).
    pub joints: Vec<u16>,
    pub weights: Vec<f32>,
    pub indices: Vec<u32>,
    /// Base colour (sRGB 0..1); hair-like parts take the hair colour instead when it is set.
    pub color: Option<[f32; 3]>,
    pub bones: Vec<PartBone>,
    /// Per vertex: a base vertex the part follows in face morphs. Empty = rigid.
    pub anchors: Vec<u32>,
}
