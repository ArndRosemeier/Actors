//! Detail sliders (nose width, upper-arm length, ...) and muscle shaping.

use crate::data::data;
use actors_core::Weights;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

/// A detail slider. Value -1..1: negative values blend in the `negative` targets, positive
/// values the `positive` ones. Left/right pairs share one slider.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ModifierDef {
    pub id: String,
    pub group: String,
    pub label: String,
    pub negative: Vec<String>,
    pub positive: Vec<String>,
}

pub(crate) fn add(out: &mut Weights, name: &str, w: f64) {
    match out.get_mut(name) {
        Some(v) => *v += w,
        None => {
            out.insert(name.to_string(), w);
        }
    }
}

/// Adds the detail sliders' target weights to `out`.
pub fn modifier_target_weights(defs: &[ModifierDef], values: &IndexMap<String, f64>, out: &mut Weights) {
    for def in defs {
        let v = values.get(&def.id).copied().unwrap_or(0.0);
        let v = if v.is_nan() { 0.0 } else { v.clamp(-1.0, 1.0) };
        if v < 0.0 {
            for t in &def.negative {
                add(out, t, -v);
            }
        }
        if v > 0.0 {
            for t in &def.positive {
                add(out, t, v);
            }
        }
    }
}

/// Below average muscle thins the limbs a little less than above average bulks them.
const LOSS: f64 = 0.7;

/// Bare target weights for a muscle value (0..1, 0.5 adds nothing) and gender (0 female, 1 male).
/// MakeHuman's muscle macros mostly redistribute torso fat; these add limb, shoulder, neck and
/// chest bulk that follows the muscle value.
pub fn muscle_bare_target_weights(muscle: f64, gender: f64) -> Weights {
    let mut out = Weights::new();
    let m = ((muscle - 0.5) * 2.0).clamp(-1.0, 1.0);
    if m == 0.0 || m.is_nan() {
        return out;
    }
    let male = if gender.is_nan() { 0.0 } else { gender.clamp(0.0, 1.0) };
    let amount = if m > 0.0 { m } else { -m * LOSS };
    let suffix = if m > 0.0 { "incr" } else { "decr" };
    for (base, gain, male_only) in &data().muscle_terms {
        let w = amount * gain * (1.0 - male_only + male_only * male);
        if w == 0.0 {
            continue;
        }
        if base.contains('%') {
            for s in ["l", "r"] {
                out.insert(format!("{}-{suffix}", base.replacen('%', s, 1)), w);
            }
        } else {
            out.insert(format!("{base}-{suffix}"), w);
        }
    }
    out
}

/// Adds muscle shaping to a pack's target weights (unknown targets are skipped).
pub fn muscle_target_weights(muscle: f64, gender: f64, resolve: &crate::TargetResolver, out: &mut Weights) {
    for (bare, w) in muscle_bare_target_weights(muscle, gender) {
        if let Some(name) = resolve.resolve(&bare) {
            add(out, name, w);
        }
    }
}
