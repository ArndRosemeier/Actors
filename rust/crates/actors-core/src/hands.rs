//! Closing a hand into a fist.

use crate::math::*;
use crate::skeleton::FittedSkeleton;

/// One finger joint's curl: the bone, its bend axis in the bone's own frame, and the angle of a
/// full fist (radians).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FingerCurl {
    pub bone: usize,
    pub axis: Vec3,
    pub angle: f64,
}

/// Fist angles per joint (degrees): base, middle, tip; the thumb folds less.
const FIST: [(&str, [f64; 3]); 5] = [
    ("index", [70.0, 95.0, 60.0]),
    ("middle", [75.0, 95.0, 60.0]),
    ("ring", [80.0, 95.0, 60.0]),
    ("pinky", [85.0, 95.0, 60.0]),
    ("thumb", [10.0, 35.0, 45.0]),
];

/// How to close one hand (`side` 'l' or 'r') into a fist on a skeleton with game-engine finger
/// bones (`index_01_r` … `thumb_03_r`). Empty when the skeleton has no such hand.
pub fn fist_curls(s: &FittedSkeleton, side: char) -> Vec<FingerCurl> {
    let at = |name: &str| s.index_of(&format!("{name}_{side}"));
    let (Some(hand), Some(index), Some(pinky), Some(thumb)) = (at("hand"), at("index_01"), at("pinky_01"), at("thumb_01")) else {
        return Vec::new();
    };
    // The palm's normal: across the knuckles × along the hand, turned to the thumb's side.
    let across = sub(s.heads[index], s.heads[pinky]);
    let along = sub(s.heads[index], s.heads[hand]);
    let mut palm = normalize(cross(across, along));
    let knuckles = scale(add(s.heads[index], s.heads[pinky]), 0.5);
    if dot(palm, sub(s.tails[thumb], knuckles)) < 0.0 {
        palm = scale(palm, -1.0);
    }
    let mut out = Vec::new();
    for (finger, angles) in FIST {
        for (j, deg) in angles.iter().enumerate() {
            let Some(bone) = at(&format!("{finger}_0{}", j + 1)) else { continue };
            let dir = normalize(sub(s.tails[bone], s.heads[bone]));
            let axis = if finger == "thumb" { normalize(cross(dir, sub(knuckles, s.heads[bone]))) } else { normalize(cross(dir, palm)) };
            out.push(FingerCurl {
                bone,
                axis: normalize(mat3_apply(&mat3_transpose(&s.world_rotations[bone]), axis)),
                angle: deg.to_radians(),
            });
        }
    }
    out
}
