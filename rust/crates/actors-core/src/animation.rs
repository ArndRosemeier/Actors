//! Rig-agnostic procedural clips: each key rotates a bone around an axis given in model space
//! as it is in the bind pose ("swing the thigh forward around X"). Converting to bone-local
//! rotations happens against the fitted skeleton, so clips work for any body shape.

use crate::math::*;
use crate::skeleton::FittedSkeleton;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct AxisKey {
    pub t: f64,
    pub deg: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AxisTrack {
    pub bone: String,
    pub axis: Vec3,
    pub keys: Vec<AxisKey>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AxisClip {
    pub name: String,
    pub duration: f64,
    pub tracks: Vec<AxisTrack>,
}

fn sample_keys(keys: &[AxisKey], t: f64) -> f64 {
    let Some(first) = keys.first() else { return 0.0 };
    if t <= first.t {
        return first.deg;
    }
    for w in keys.windows(2) {
        let (a, b) = (w[0], w[1]);
        if t <= b.t {
            let u = (t - a.t) / (b.t - a.t);
            let s = u * u * (3.0 - 2.0 * u); // smoothstep between keys
            return a.deg + (b.deg - a.deg) * s;
        }
    }
    keys[keys.len() - 1].deg
}

/// Bone-local rotations (bind rotation combined with the clip's deltas) for the bones the clip
/// touches, as (bone index, rotation) in first-touched order.
pub fn sample_axis_clip(skeleton: &FittedSkeleton, clip: &AxisClip, time: f64) -> Vec<(usize, Quat)> {
    let mut deltas: Vec<(usize, Quat)> = Vec::new();
    for track in &clip.tracks {
        let Some(i) = skeleton.index_of(&track.bone) else { continue };
        // The model-space axis in the bone's own bind frame.
        let local_axis = mat3_apply(&mat3_transpose(&skeleton.world_rotations[i]), track.axis);
        let q = quat_axis_angle(local_axis, sample_keys(&track.keys, time).to_radians());
        match deltas.iter_mut().find(|d| d.0 == i) {
            Some(d) => d.1 = quat_mul(d.1, q),
            None => deltas.push((i, q)),
        }
    }
    deltas.into_iter().map(|(i, d)| (i, quat_mul(skeleton.local_rotations[i], d))).collect()
}
