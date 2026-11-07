//! Skeleton poses: bone-local rotations plus the root-motion bone's position, in flat arrays
//! that can be sampled, blended and copied every frame without allocating.

use crate::skeleton::FittedSkeleton;

/// Bone-local rotations (x, y, z, w per bone, parent-relative like
/// [`FittedSkeleton::local_rotations`]) and the local position of bone `root_index`
/// (relative to its parent's head, in the parent's frame).
#[derive(Clone, Debug, PartialEq)]
pub struct Pose {
    pub rotations: Vec<f32>,
    pub root: [f32; 3],
    pub root_index: usize,
}

impl Pose {
    /// Identity rotations for `bone_count` bones.
    pub fn new(bone_count: usize, root_index: usize) -> Self {
        let mut rotations = vec![0f32; bone_count * 4];
        for q in rotations.chunks_exact_mut(4) {
            q[3] = 1.0;
        }
        Self { rotations, root: [0.0; 3], root_index }
    }

    pub fn bone_count(&self) -> usize {
        self.rotations.len() / 4
    }

    pub fn rotation(&self, i: usize) -> [f32; 4] {
        let r = &self.rotations[i * 4..i * 4 + 4];
        [r[0], r[1], r[2], r[3]]
    }

    /// The skeleton's bind pose. `root_index`: the bone whose position the pose carries
    /// (default: "pelvis", else 0).
    pub fn bind(skeleton: &FittedSkeleton, root_index: Option<usize>) -> Self {
        let root_index = root_index.unwrap_or_else(|| skeleton.index_of("pelvis").unwrap_or(0));
        let mut pose = Self::new(skeleton.len(), root_index);
        for (i, q) in skeleton.local_rotations.iter().enumerate() {
            for c in 0..4 {
                pose.rotations[i * 4 + c] = q[c] as f32;
            }
        }
        let lp = skeleton.local_positions[root_index];
        pose.root = [lp[0] as f32, lp[1] as f32, lp[2] as f32];
        pose
    }

    pub fn copy_from(&mut self, src: &Pose) {
        self.rotations.clone_from(&src.rotations);
        self.root = src.root;
        self.root_index = src.root_index;
    }
}

/// `out` = a → b by `t` per bone (normalized lerp on the shorter arc; `mask` scales t per bone,
/// the root position follows t · mask[root_index]).
pub fn blend_poses(a: &Pose, b: &Pose, t: f32, out: &mut Pose, mask: Option<&[f32]>) {
    let n = a.rotations.len() / 4;
    out.rotations.resize(a.rotations.len(), 0.0);
    for i in 0..n {
        let k = mask.map_or(t, |m| t * m[i]);
        let o = i * 4;
        let (ar, br) = (&a.rotations[o..o + 4], &b.rotations[o..o + 4]);
        if k <= 0.0 {
            out.rotations[o..o + 4].copy_from_slice(ar);
            continue;
        }
        let d = ar[0] * br[0] + ar[1] * br[1] + ar[2] * br[2] + ar[3] * br[3];
        let s = if d < 0.0 { -k } else { k };
        let q = [0, 1, 2, 3].map(|c| ar[c] as f64 * (1.0 - k as f64) + br[c] as f64 * s as f64);
        let l = crate::math::hypot4(q[0], q[1], q[2], q[3]);
        let l = if l == 0.0 { 1.0 } else { l };
        for c in 0..4 {
            out.rotations[o + c] = (q[c] / l) as f32;
        }
    }
    let kr = mask.map_or(t, |m| t * m[a.root_index]);
    for c in 0..3 {
        out.root[c] = a.root[c] + (b.root[c] - a.root[c]) * kr;
    }
    out.root_index = a.root_index;
}

/// Weighted blend of any number of poses (idle, walk and run by speed): per bone a weighted
/// sum of rotations on one hemisphere, normalized. Weights need not sum to 1.
///
/// ```ignore
/// mixer.begin().add(&idle, 0.3, None).add(&walk, 0.7, Some(&upper_body));
/// mixer.end(&mut out, None);
/// ```
///
/// Bones no pose added weight to keep `fallback` (or what `out` held).
#[derive(Clone, Debug)]
pub struct PoseMixer {
    acc: Vec<f64>,
    wsum: Vec<f64>,
    root: [f64; 3],
    root_w: f64,
    root_index: usize,
}

impl PoseMixer {
    pub fn new(bone_count: usize) -> Self {
        Self { acc: vec![0.0; bone_count * 4], wsum: vec![0.0; bone_count], root: [0.0; 3], root_w: 0.0, root_index: 0 }
    }

    pub fn bone_count(&self) -> usize {
        self.wsum.len()
    }

    pub fn begin(&mut self) -> &mut Self {
        self.acc.fill(0.0);
        self.wsum.fill(0.0);
        self.root = [0.0; 3];
        self.root_w = 0.0;
        self
    }

    pub fn add(&mut self, pose: &Pose, weight: f64, mask: Option<&[f32]>) -> &mut Self {
        if weight <= 0.0 {
            return self;
        }
        let r = &pose.rotations;
        for i in 0..self.wsum.len() {
            let w = mask.map_or(weight, |m| weight * m[i] as f64);
            if w <= 0.0 {
                continue;
            }
            let o = i * 4;
            let a = &mut self.acc[o..o + 4];
            // Onto the hemisphere of what is already there (q and -q are the same rotation).
            let d = a[0] * r[o] as f64 + a[1] * r[o + 1] as f64 + a[2] * r[o + 2] as f64 + a[3] * r[o + 3] as f64;
            let s = if d < 0.0 { -w } else { w };
            for c in 0..4 {
                a[c] += r[o + c] as f64 * s;
            }
            self.wsum[i] += w;
        }
        let wr = mask.map_or(weight, |m| weight * m[pose.root_index] as f64);
        if wr > 0.0 {
            for c in 0..3 {
                self.root[c] += pose.root[c] as f64 * wr;
            }
            self.root_w += wr;
            self.root_index = pose.root_index;
        }
        self
    }

    /// Total weight added on bone `i` (0: no pose touched it).
    pub fn weight(&self, i: usize) -> f64 {
        self.wsum[i]
    }

    pub fn end(&self, out: &mut Pose, fallback: Option<&Pose>) {
        for i in 0..self.wsum.len() {
            let o = i * 4;
            let a = &self.acc[o..o + 4];
            let l = crate::math::hypot4(a[0], a[1], a[2], a[3]);
            if self.wsum[i] <= 0.0 || l < 1e-9 {
                if let Some(f) = fallback {
                    out.rotations[o..o + 4].copy_from_slice(&f.rotations[o..o + 4]);
                }
                continue;
            }
            for c in 0..4 {
                out.rotations[o + c] = (a[c] / l) as f32;
            }
        }
        if self.root_w > 0.0 {
            for c in 0..3 {
                out.root[c] = (self.root[c] / self.root_w) as f32;
            }
            out.root_index = self.root_index;
        } else if let Some(f) = fallback {
            out.root = f.root;
            out.root_index = f.root_index;
        }
    }
}

/// Forward kinematics: model-space rotation (x, y, z, w per bone) and head position
/// (x, y, z per bone) of every bone in a pose. Bones other than the root-motion bone keep their
/// bind offsets.
pub fn pose_world(skeleton: &FittedSkeleton, pose: &Pose, rotations: &mut [f64], heads: &mut [f64]) {
    let r = &pose.rotations;
    for i in 0..skeleton.parents.len() {
        let (o, h) = (i * 4, i * 3);
        let lp = if i == pose.root_index {
            [pose.root[0] as f64, pose.root[1] as f64, pose.root[2] as f64]
        } else {
            skeleton.local_positions[i]
        };
        let Some(p) = skeleton.parent(i) else {
            for c in 0..4 {
                rotations[o + c] = r[o + c] as f64;
            }
            heads[h..h + 3].copy_from_slice(&lp);
            continue;
        };
        let (po, ph) = (p * 4, p * 3);
        let (ax, ay, az, aw) = (rotations[po], rotations[po + 1], rotations[po + 2], rotations[po + 3]);
        let (bx, by, bz, bw) = (r[o] as f64, r[o + 1] as f64, r[o + 2] as f64, r[o + 3] as f64);
        rotations[o] = aw * bx + ax * bw + ay * bz - az * by;
        rotations[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
        rotations[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
        rotations[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
        let v = crate::math::quat_rotate([ax, ay, az, aw], lp);
        heads[h] = heads[ph] + v[0];
        heads[h + 1] = heads[ph + 1] + v[1];
        heads[h + 2] = heads[ph + 2] + v[2];
    }
}
