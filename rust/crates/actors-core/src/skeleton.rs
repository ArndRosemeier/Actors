//! Fitting the rig to a morphed body: every joint is the mean of its marker vertices, bone
//! frames come from head, tail and roll (Blender's convention).

use crate::format::SkeletonDef;
use crate::math::*;

/// A skeleton fitted to the current body shape: bind pose in model space and parent-relative.
#[derive(Clone, Debug, PartialEq)]
pub struct FittedSkeleton {
    pub names: Vec<String>,
    /// Parent bone index, or -1 for a root. Parents come before children.
    pub parents: Vec<i32>,
    pub heads: Vec<Vec3>,
    pub tails: Vec<Vec3>,
    /// Model-space bind rotation of each bone (local +Y points from head to tail).
    pub world_rotations: Vec<Mat3>,
    /// Parent-relative bind transforms: translation and rotation.
    pub local_positions: Vec<Vec3>,
    pub local_rotations: Vec<Quat>,
}

impl FittedSkeleton {
    pub fn len(&self) -> usize {
        self.names.len()
    }
    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }
    pub fn index_of(&self, name: &str) -> Option<usize> {
        self.names.iter().position(|n| n == name)
    }
    pub fn parent(&self, i: usize) -> Option<usize> {
        let p = self.parents[i];
        (p >= 0).then_some(p as usize)
    }
}

// Blender is Z-up/-Y-forward, the pack is Y-up/+Z-forward: blender (x, y, z) = pack (x, -z, y).
const PACK_FROM_BLENDER: Mat3 = [1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 1.0, 0.0];

fn to_blender(v: Vec3) -> Vec3 {
    [v[0], -v[2], v[1]]
}

/// Rotation taking +Y onto `dir` by the shortest arc, then rolled around `dir`. Same result as
/// Blender's vec_roll_to_mat3, so rolls exported from Blender rigs apply unchanged.
pub fn bone_rotation_from_roll(dir: Vec3, roll: f64) -> Mat3 {
    let [x, y, z] = dir;
    let sin_a = x.hypot(z);
    let base = if 1.0 + y < 1e-8 {
        [-1.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 1.0]
    } else if sin_a < 1e-12 {
        MAT3_IDENTITY
    } else {
        // Axis = Y x dir = (z, 0, -x), angle = acos(y).
        mat3_axis_angle([z / sin_a, 0.0, -x / sin_a], sin_a.atan2(y))
    };
    mat3_mul(&mat3_axis_angle(dir, roll), &base)
}

fn joint_position(positions: &[f32], vertices: &[u32]) -> Vec3 {
    let (mut x, mut y, mut z) = (0.0, 0.0, 0.0);
    for &v in vertices {
        let v = v as usize * 3;
        x += positions[v] as f64;
        y += positions[v + 1] as f64;
        z += positions[v + 2] as f64;
    }
    let n = if vertices.is_empty() { 1.0 } else { vertices.len() as f64 };
    [x / n, y / n, z / n]
}

/// Places every joint from the morphed vertex positions and derives the bind pose.
pub fn fit_skeleton(def: &SkeletonDef, positions: &[f32]) -> FittedSkeleton {
    let n = def.bones.len();
    let mut s = FittedSkeleton {
        names: Vec::with_capacity(n),
        parents: Vec::with_capacity(n),
        heads: Vec::with_capacity(n),
        tails: Vec::with_capacity(n),
        world_rotations: Vec::with_capacity(n),
        local_positions: Vec::with_capacity(n),
        local_rotations: Vec::with_capacity(n),
    };
    for bone in &def.bones {
        s.names.push(bone.name.clone());
        s.parents.push(bone.parent);
        let head = joint_position(positions, &bone.head.vertices);
        let tail = joint_position(positions, &bone.tail.vertices);
        s.heads.push(head);
        s.tails.push(tail);
        let mut dir = sub(tail, head);
        if length(dir) < 1e-9 {
            dir = [0.0, 1.0, 0.0];
        }
        let dir_blender = normalize(to_blender(dir));
        // Bone axes in pack space: same local frame as in Blender, in Y-up coordinates.
        let rot = mat3_mul(&PACK_FROM_BLENDER, &bone_rotation_from_roll(dir_blender, bone.roll));
        if bone.parent < 0 {
            s.local_positions.push(head);
            s.local_rotations.push(quat_from_mat3(&rot));
        } else {
            let p = bone.parent as usize;
            let parent_inv = mat3_transpose(&s.world_rotations[p]);
            s.local_positions.push(mat3_apply(&parent_inv, sub(head, s.heads[p])));
            s.local_rotations.push(quat_from_mat3(&mat3_mul(&parent_inv, &rot)));
        }
        s.world_rotations.push(rot);
    }
    s
}
