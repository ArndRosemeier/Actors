//! Shape passes that run after the morph targets and before anything is fitted to the body
//! (skeleton, proxies, subdivided meshes), so all of them follow:
//!
//! - tips: pulls a region out into a point (pointed ears),
//! - bone proportions: per-bone length and girth scale through the skin weights,
//! - a uniform scale of the whole actor.

use crate::skeleton::FittedSkeleton;
use crate::target::MorphTarget;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Length (along the bone) and girth (across it) factors; 1 = unchanged.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct BoneScale {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub len: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub girth: Option<f64>,
}

impl BoneScale {
    pub fn len(&self) -> f64 {
        self.len.unwrap_or(1.0)
    }
    pub fn girth(&self) -> f64 {
        self.girth.unwrap_or(1.0)
    }
}

/// Pulls the far end of a region out along `direction` (model space). The region and its
/// falloff come from a morph target: the larger a vertex's delta in `mask`, the more it belongs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TipDeform {
    pub mask: String,
    /// Tip growth in meters at full strength.
    pub amount: f64,
    pub direction: [f64; 3],
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ShapeOptions {
    /// By bone name.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub bones: HashMap<String, BoneScale>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tips: Vec<TipDeform>,
    /// Uniform scale about the origin.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
}

impl ShapeOptions {
    /// True if the options change anything.
    pub fn is_active(&self) -> bool {
        if self.scale.is_some_and(|s| (s - 1.0).abs() > 1e-5) {
            return true;
        }
        if self.tips.iter().any(|t| t.amount > 1e-5) {
            return true;
        }
        self.bones.values().any(|b| (b.len() - 1.0).abs() > 1e-5 || (b.girth() - 1.0).abs() > 1e-5)
    }
}

/// Per vertex 0..1: delta length of `target`, normalized to its largest delta.
pub fn target_mask(target: &MorphTarget, vertex_count: usize) -> Vec<f32> {
    let mut out = vec![0f32; vertex_count];
    let mut max = 0f64;
    for i in 0..target.count {
        let d = &target.deltas[i * 3..i * 3 + 3];
        let m = (d[0] as f64).hypot(d[1] as f64).hypot(d[2] as f64);
        out[target.vertex(i)] = m as f32;
        max = max.max(m);
    }
    if max > 0.0 {
        for v in &mut out {
            *v = (*v as f64 / max) as f32;
        }
    }
    out
}

/// Applies one tip deformation in place.
pub fn apply_tip(positions: &mut [f32], mask: &[f32], amount: f64, direction: [f64; 3]) {
    if amount <= 1e-5 {
        return;
    }
    let (mut cx, mut cy, mut cz, mut sw) = (0.0, 0.0, 0.0, 0.0);
    let (mut top, mut bottom) = (f64::NEG_INFINITY, f64::INFINITY);
    for (i, &m) in mask.iter().enumerate() {
        let m = m as f64;
        if m <= 0.15 {
            continue;
        }
        let p = &positions[i * 3..i * 3 + 3];
        cx += p[0] as f64 * m;
        cy += p[1] as f64 * m;
        cz += p[2] as f64 * m;
        sw += m;
        top = top.max(p[1] as f64);
        bottom = bottom.min(p[1] as f64);
    }
    if sw == 0.0 {
        return;
    }
    cx /= sw;
    cy /= sw;
    cz /= sw;
    let half = 0.01f64.max((top - bottom) / 2.0);
    let l = crate::math::length(direction);
    let l = if l == 0.0 { 1.0 } else { l };
    let [ux, uy, uz] = [direction[0] / l, direction[1] / l, direction[2] / l];
    for (i, &m) in mask.iter().enumerate() {
        let m = m as f64;
        if m <= 0.0 {
            continue;
        }
        let p = &mut positions[i * 3..i * 3 + 3];
        let along = ((p[0] as f64 - cx) * ux + (p[1] as f64 - cy) * uy + (p[2] as f64 - cz) * uz) / half;
        let t = 1.4f64.min(along - 0.05);
        if t <= 0.0 {
            continue;
        }
        let k = t.powf(2.2) * 1f64.min(m * 1.6) * amount;
        p[0] = (p[0] as f64 + ux * k) as f32;
        p[1] = (p[1] as f64 + uy * k) as f32;
        p[2] = (p[2] as f64 + uz * k) as f32;
    }
}

/// Bone proportion pass, in place. Every bone gets the linear map
/// girth·I + (len − girth)·d·dᵀ (d = bone direction); joints are moved down the hierarchy with
/// their parent's map and every vertex follows its bones through the skin weights.
pub fn apply_bone_scales(
    positions: &mut [f32],
    skeleton: &FittedSkeleton,
    joints: &[u16],
    weights: &[f32],
    scales: &HashMap<String, BoneScale>,
) {
    let b_count = skeleton.names.len();
    let mut m = vec![0f64; b_count * 9];
    for i in 0..b_count {
        let s = scales.get(&skeleton.names[i]).copied().unwrap_or_default();
        let (len, girth) = (s.len(), s.girth());
        let (h, t) = (skeleton.heads[i], skeleton.tails[i]);
        let (mut dx, mut dy, mut dz) = (t[0] - h[0], t[1] - h[1], t[2] - h[2]);
        let dl = crate::math::hypot3(dx, dy, dz);
        let dl = if dl == 0.0 { 1.0 } else { dl };
        dx /= dl;
        dy /= dl;
        dz /= dl;
        let k = len - girth;
        let o = i * 9;
        m[o] = girth + k * dx * dx;
        m[o + 1] = k * dx * dy;
        m[o + 2] = k * dx * dz;
        m[o + 3] = k * dy * dx;
        m[o + 4] = girth + k * dy * dy;
        m[o + 5] = k * dy * dz;
        m[o + 6] = k * dz * dx;
        m[o + 7] = k * dz * dy;
        m[o + 8] = girth + k * dz * dz;
    }
    let mul = |b: usize, x: f64, y: f64, z: f64| {
        let o = b * 9;
        [m[o] * x + m[o + 1] * y + m[o + 2] * z, m[o + 3] * x + m[o + 4] * y + m[o + 5] * z, m[o + 6] * x + m[o + 7] * y + m[o + 8] * z]
    };
    // New joint positions: children keep their offset from the parent, mapped by the parent.
    // Parents come before children, so one pass in order places every joint.
    let mut moved = vec![[0f64; 3]; b_count];
    for i in 0..b_count {
        let h = skeleton.heads[i];
        moved[i] = match skeleton.parent(i) {
            None => h,
            Some(p) => {
                let ph = skeleton.heads[p];
                let d = mul(p, h[0] - ph[0], h[1] - ph[1], h[2] - ph[2]);
                [moved[p][0] + d[0], moved[p][1] + d[1], moved[p][2] + d[2]]
            }
        };
    }
    for (v, p) in positions.chunks_exact_mut(3).enumerate() {
        let (x, y, z) = (p[0] as f64, p[1] as f64, p[2] as f64);
        let (mut ox, mut oy, mut oz, mut sw) = (0.0, 0.0, 0.0, 0.0);
        for k in 0..4 {
            let w = weights[v * 4 + k] as f64;
            if w == 0.0 {
                continue;
            }
            let b = joints[v * 4 + k] as usize;
            let h = skeleton.heads[b];
            let d = mul(b, x - h[0], y - h[1], z - h[2]);
            ox += w * (moved[b][0] + d[0]);
            oy += w * (moved[b][1] + d[1]);
            oz += w * (moved[b][2] + d[2]);
            sw += w;
        }
        if sw < 1e-6 {
            continue;
        }
        p[0] = (ox / sw) as f32;
        p[1] = (oy / sw) as f32;
        p[2] = (oz / sw) as f32;
    }
}

/// Uniform scale about the origin, in place.
pub fn apply_scale(positions: &mut [f32], scale: f64) {
    if (scale - 1.0).abs() < 1e-6 {
        return;
    }
    for p in positions {
        *p = (*p as f64 * scale) as f32;
    }
}
