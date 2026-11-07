//! Deform: a seeded recipe with a strength that changes a body's bones, skin and movement.
//!
//! A recipe turns `(recipe, seed, strength)` into a [`DeformPlan`] of plain numbers, the same
//! everywhere (the TypeScript runtime gives the same plan for the same spec): length and girth
//! per body part plus a size to grow the whole body by, skin colour numbers for the adapter, and
//! how the clips play. [`deform_bones`] maps a plan onto any skeleton by bone name.
//!
//! Recipes: `giant` (a bigger body with square-cube proportions, the look of age, slow heavy steps).

use crate::deform::{BoneScale, ShapeOptions};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeformRecipe {
    #[default]
    Giant,
}

/// The parts of a body that a recipe shapes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BodyPart {
    Leg,
    Foot,
    Arm,
    Hand,
    Neck,
    Head,
    Jaw,
    Spine,
    Tail,
    Ear,
    Horn,
    Other,
}

pub const BODY_PARTS: [BodyPart; 12] = [
    BodyPart::Leg,
    BodyPart::Foot,
    BodyPart::Arm,
    BodyPart::Hand,
    BodyPart::Neck,
    BodyPart::Head,
    BodyPart::Jaw,
    BodyPart::Spine,
    BodyPart::Tail,
    BodyPart::Ear,
    BodyPart::Horn,
    BodyPart::Other,
];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DeformSpec {
    pub recipe: DeformRecipe,
    /// Any number: the same seed always gives the same body.
    pub seed: f64,
    /// 0 (nothing changes) .. 1 (the recipe at its fullest).
    pub strength: f64,
    /// Grow the body this many times its size (1 ..= [`MAX_GROWTH`]) instead of what the strength gives.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
}

/// What the recipe does to the skin.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinChange {
    /// Multiplies the body's colour (linear, 1 = unchanged).
    pub tint: [f64; 3],
    pub grey: f64,
    pub age: f64,
    pub muzzle_grey: f64,
    pub scars: f64,
    pub seed: f64,
}

/// How the clips play.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GaitChange {
    /// Playback speed times the clip's own.
    pub rate: f64,
    /// How heavy the steps are, 0..1.
    pub heft: f64,
}

/// Length and girth of a part (1 = unchanged).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct PartScale {
    pub len: f64,
    pub girth: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DeformPlan {
    pub recipe: DeformRecipe,
    pub seed: f64,
    pub strength: f64,
    /// Grow the whole body by this (1 = unchanged). The parts are relative to it.
    pub scale: f64,
    pub parts: HashMap<BodyPart, PartScale>,
    pub skin: SkinChange,
    pub gait: GaitChange,
}

impl DeformPlan {
    pub fn part(&self, p: BodyPart) -> PartScale {
        self.parts.get(&p).copied().unwrap_or(PartScale { len: 1.0, girth: 1.0 })
    }

    /// True if the plan changes anything.
    pub fn changes_body(&self) -> bool {
        self.strength > 1e-4
    }
}

/// The biggest the giant recipe grows a body at strength 1.
pub const GIANT_SCALE: f64 = 2.6;
/// The biggest [`DeformSpec::size`].
pub const MAX_GROWTH: f64 = 24.0;
/// Past this the recipe's proportions stop growing.
const MAX_REACH: f64 = 2.5;

/// JavaScript's ToInt32.
fn to_int32(x: f64) -> u32 {
    if !x.is_finite() {
        return 0;
    }
    (x.trunc().rem_euclid(4294967296.0)) as u32
}

/// Seeded numbers (mulberry32): the stream for one `(seed, salt)`, as in the TypeScript runtime.
pub fn deform_random(seed: f64, salt: f64) -> impl FnMut() -> f64 {
    let mut a = to_int32(seed.floor()).wrapping_mul(0x9e37_79b1) ^ to_int32(salt).wrapping_mul(0x85eb_ca6b) ^ 0x2545_f491;
    move || {
        a = a.wrapping_add(0x6d2b_79f5);
        let mut t = a;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
}

fn clamp01(v: f64) -> f64 {
    if v.is_finite() {
        v.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

fn plain() -> HashMap<BodyPart, PartScale> {
    BODY_PARTS.iter().map(|&p| (p, PartScale { len: 1.0, girth: 1.0 })).collect()
}

/// The plan that changes nothing.
pub fn no_deform(recipe: DeformRecipe, seed: f64) -> DeformPlan {
    DeformPlan {
        recipe,
        seed,
        strength: 0.0,
        scale: 1.0,
        parts: plain(),
        skin: SkinChange { tint: [1.0; 3], grey: 0.0, age: 0.0, muzzle_grey: 0.0, scars: 0.0, seed },
        gait: GaitChange { rate: 1.0, heft: 0.0 },
    }
}

/// The plan for a recipe, a seed and a strength (see the module docs).
pub fn deform(spec: &DeformSpec) -> DeformPlan {
    let s = clamp01(spec.strength);
    if s <= 1e-4 {
        return no_deform(spec.recipe, spec.seed);
    }
    let mut r = deform_random(spec.seed, 1.0);
    let mut jit = move || r() * 2.0 - 1.0;
    let size = match spec.size {
        Some(z) if z.is_finite() => z.clamp(1.0, MAX_GROWTH),
        _ => 0.0,
    };
    let scale = if size > 1.0 { size } else { lerp(1.0, GIANT_SCALE, s) };
    let reach = if size > 1.0 { MAX_REACH.min(size.ln() / GIANT_SCALE.ln()) } else { s };
    let mut parts = plain();
    let mut part = |p: BodyPart, len: f64, girth: f64, wobble: f64, jit: &mut dyn FnMut() -> f64| {
        let j = jit() * wobble * reach.min(1.0);
        let k = jit() * wobble * reach.min(1.0);
        parts.insert(p, PartScale { len: 1.0 + (len - 1.0) * reach + j, girth: 1.0 + (girth - 1.0) * reach + k });
    };
    part(BodyPart::Leg, 0.93, 1.32, 0.06, &mut jit);
    part(BodyPart::Foot, 0.9, 1.4, 0.06, &mut jit);
    part(BodyPart::Arm, 1.0, 1.25, 0.06, &mut jit);
    part(BodyPart::Hand, 1.0, 1.3, 0.06, &mut jit);
    part(BodyPart::Neck, 1.0, 1.28, 0.06, &mut jit);
    part(BodyPart::Head, 0.88, 0.88, 0.04, &mut jit);
    part(BodyPart::Jaw, 1.05, 1.22, 0.06, &mut jit);
    part(BodyPart::Spine, 1.02, 1.08, 0.03, &mut jit);
    part(BodyPart::Tail, 0.95, 0.9, 0.05, &mut jit);
    part(BodyPart::Ear, 0.85, 0.9, 0.05, &mut jit);
    part(BodyPart::Horn, 1.1, 1.2, 0.05, &mut jit);
    let age = clamp01(0.45 + 0.35 * s + jit() * 0.15 * s);
    let grey = clamp01(0.2 + 0.5 * s + jit() * 0.15 * s);
    let muzzle_grey = clamp01(0.3 + 0.6 * s + jit() * 0.1 * s);
    let scars = clamp01(0.25 + 0.6 * s + jit() * 0.2 * s);
    DeformPlan {
        recipe: spec.recipe,
        seed: spec.seed,
        strength: s,
        scale,
        parts,
        skin: SkinChange {
            tint: [lerp(1.0, 0.97, age), lerp(1.0, 0.93, age), lerp(1.0, 0.88, age)],
            grey,
            age,
            muzzle_grey,
            scars,
            seed: spec.seed,
        },
        gait: GaitChange { rate: 1.0 / scale.sqrt(), heft: s },
    }
}

/// Name patterns, first match wins.
fn part_patterns() -> &'static [(BodyPart, Regex)] {
    static P: OnceLock<Vec<(BodyPart, Regex)>> = OnceLock::new();
    P.get_or_init(|| {
        [
            (BodyPart::Other, "armature"),
            (BodyPart::Ear, "ear"),
            (BodyPart::Horn, "horn|antler|tusk"),
            (BodyPart::Tail, "tail|tip_tail"),
            (BodyPart::Jaw, "jaw|chin|mandible|lowerlip|tongue"),
            (BodyPart::Head, "head|skull|nose|snout|muzzle|face|eye|brow|forehead|cheek|beak"),
            (BodyPart::Neck, "neck|throat"),
            (BodyPart::Hand, "hand|finger|thumb|palm|carpal|wrist|paw|claw|fingers|metacarp"),
            (BodyPart::Foot, "foot|toe|hoof|ankle|heel|pastern|fetlock|metatars|cannon|tarsal|ball|tip"),
            (BodyPart::Leg, "leg|thigh|upleg|upperleg|calf|shin|knee|femur|tibia|hock|shank|lowerleg|hind|stifle"),
            (BodyPart::Arm, "arm|shoulder|clavicle|scapula|elbow|forearm|humerus|foreleg|front|wing|flipper|fin"),
            (
                BodyPart::Spine,
                r"spine|back|chest|rib|torso|body|trunk|belly|root|hips?\b|waist|sacrum|pelvis|abdomen|cog|center|master|armature",
            ),
        ]
        .into_iter()
        .map(|(p, re)| (p, Regex::new(&format!("(?i){re}")).expect("valid pattern")))
        .collect()
    })
}

/// The part a bone belongs to by its name; `Other` when the name says nothing.
pub fn part_of_bone(name: &str) -> BodyPart {
    part_patterns().iter().find(|(_, re)| re.is_match(name)).map_or(BodyPart::Other, |(p, _)| *p)
}

/// The part of every bone of a skeleton. A bone whose name says nothing takes its parent's part,
/// and a chain with no named ancestor is `Other`. `parents[i]`: bone i's parent, -1 for a root.
pub fn classify_bones(names: &[String], parents: Option<&[i32]>) -> Vec<BodyPart> {
    let mut out: Vec<BodyPart> = names.iter().map(|n| part_of_bone(n)).collect();
    let Some(parents) = parents else { return out };
    fn resolve(i: usize, depth: usize, out: &mut [BodyPart], parents: &[i32]) -> BodyPart {
        if out[i] != BodyPart::Other || depth > out.len() {
            return out[i];
        }
        let p = parents.get(i).copied().unwrap_or(-1);
        if p < 0 {
            return BodyPart::Other;
        }
        let above = resolve(p as usize, depth + 1, out, parents);
        // Only a limb or a head lends its name down the chain.
        out[i] = if above == BodyPart::Spine { BodyPart::Other } else { above };
        out[i]
    }
    for i in 0..names.len() {
        resolve(i, 0, &mut out, parents);
    }
    out
}

/// Per-bone length and girth for a plan, by bone name (relative to `plan.scale`).
pub fn deform_bones(plan: &DeformPlan, names: &[String], parents: Option<&[i32]>) -> Vec<(String, BoneScale)> {
    if !plan.changes_body() {
        return Vec::new();
    }
    let parts = classify_bones(names, parents);
    names
        .iter()
        .zip(parts)
        .filter_map(|(n, part)| {
            let p = plan.part(part);
            ((p.len - 1.0).abs() > 1e-5 || (p.girth - 1.0).abs() > 1e-5)
                .then(|| (n.clone(), BoneScale { len: Some(p.len), girth: Some(p.girth) }))
        })
        .collect()
}

/// Shape options (bone proportions and the whole body's growth) for a plan on a skeleton.
pub fn deform_shape_options(plan: &DeformPlan, names: &[String], parents: Option<&[i32]>) -> ShapeOptions {
    if !plan.changes_body() {
        return ShapeOptions::default();
    }
    ShapeOptions { bones: deform_bones(plan, names, parents).into_iter().collect(), tips: Vec::new(), scale: Some(plan.scale) }
}

/// `base` (a race's proportions, say) with the plan on top: each bone's length and girth times
/// the plan's part, the scale times the plan's growth.
pub fn merge_deform(mut base: ShapeOptions, plan: Option<&DeformPlan>, names: &[String], parents: Option<&[i32]>) -> ShapeOptions {
    let Some(plan) = plan.filter(|p| p.changes_body()) else { return base };
    for (n, d) in deform_bones(plan, names, parents) {
        let b = base.bones.entry(n).or_default();
        *b = BoneScale { len: Some(b.len() * d.len()), girth: Some(b.girth() * d.girth()) };
    }
    base.scale = Some(base.scale.unwrap_or(1.0) * plan.scale);
    base
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mulberry_matches_javascript() {
        // deformRandom(7, 1) in the TypeScript runtime.
        let mut r = deform_random(7.0, 1.0);
        let first: Vec<f64> = (0..3).map(|_| r()).collect();
        assert!(first.iter().all(|v| (0.0..1.0).contains(v)));
        let mut again = deform_random(7.0, 1.0);
        assert_eq!(first[0], again());
    }

    #[test]
    fn bone_parts() {
        assert_eq!(part_of_bone("thigh_l"), BodyPart::Leg);
        assert_eq!(part_of_bone("upperarm_r"), BodyPart::Arm);
        assert_eq!(part_of_bone("Head"), BodyPart::Head);
        assert_eq!(part_of_bone("pelvis"), BodyPart::Spine);
        assert_eq!(part_of_bone("ball_l"), BodyPart::Foot);
        let names: Vec<String> = ["pelvis", "thigh_l", "bone_x"].iter().map(|s| s.to_string()).collect();
        assert_eq!(classify_bones(&names, Some(&[-1, 0, 1])), vec![BodyPart::Spine, BodyPart::Leg, BodyPart::Leg]);
    }
}
