//! Photographic skin textures (MakeHuman's age x gender x ethnicity set), blended like the shape.

use crate::params::HumanParams;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SkinTextureDef {
    /// "young", "middleage" or "old".
    pub age: String,
    /// "female" or "male".
    pub gender: String,
    /// "african", "asian" or "caucasian".
    pub ethnicity: String,
    /// Pack-relative file (body UV layout).
    pub file: String,
    /// Mean sRGB colour of the skin.
    #[serde(default)]
    pub tone: Option<[f64; 3]>,
}

/// Ages the three texture groups represent (years); weights are linear in between.
const AGE_ANCHORS: [(&str, f64); 3] = [("young", 25.0), ("middleage", 50.0), ("old", 80.0)];

fn age_weight(years: f64, group: &str) -> f64 {
    let mut w = [0.0; 3];
    if years <= AGE_ANCHORS[0].1 {
        w[0] = 1.0;
    } else if years >= AGE_ANCHORS[2].1 {
        w[2] = 1.0;
    } else {
        for i in 0..2 {
            let (ya, yb) = (AGE_ANCHORS[i].1, AGE_ANCHORS[i + 1].1);
            if years <= yb {
                let t = (years - ya) / (yb - ya);
                w[i] = 1.0 - t;
                w[i + 1] = t;
                break;
            }
        }
    }
    AGE_ANCHORS.iter().position(|a| a.0 == group).map_or(0.0, |i| w[i])
}

/// How much each skin texture contributes: at most `max` (the strongest), weights summing to 1.
pub fn skin_texture_weights(skins: &[SkinTextureDef], params: &HumanParams, max: usize) -> Vec<(String, f64)> {
    let p = params.sanitized();
    let mut all: Vec<(String, f64)> = skins
        .iter()
        .map(|s| {
            let g = if s.gender == "male" { p.gender } else { 1.0 - p.gender };
            (s.file.clone(), age_weight(p.age_years, &s.age) * g * p.ethnicity(&s.ethnicity))
        })
        .filter(|s| s.1 > 1e-4)
        .collect();
    all.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    all.truncate(max);
    let sum: f64 = all.iter().map(|s| s.1).sum();
    let sum = if sum == 0.0 { 1.0 } else { sum };
    all.into_iter().map(|(f, w)| (f, w / sum)).collect()
}
