//! Facial expressions built from MakeHuman's face units (CC0). Each unit exists in an African,
//! Asian and Caucasian variant, mixed with the body's ethnic weights. Unit values are 0..1.

use crate::data::{data, UnitWeights};
use crate::params::HumanParams;
use actors_core::Weights;
use std::collections::HashSet;

/// A named expression ("smile", "angry", ...), if there is one.
pub fn expression(name: &str) -> Option<&'static UnitWeights> {
    data().expressions.get(name)
}

/// Names of the expressions, "neutral" first.
pub fn expression_names() -> impl Iterator<Item = &'static str> {
    data().expressions.keys().map(String::as_str)
}

/// Both eyes closed.
pub fn blink() -> &'static UnitWeights {
    &data().blink
}

const ETHNICITIES: [&str; 3] = ["african", "asian", "caucasian"];

/// Target weights for face units, mixed by the character's ethnic weights. `available`: the
/// pack's target names (others are skipped).
pub fn expression_target_weights(units: &UnitWeights, params: &HumanParams, scale: f64, available: Option<&HashSet<&str>>) -> Weights {
    let p = params.sanitized();
    let mut out = Weights::new();
    for (unit, w) in units {
        for eth in ETHNICITIES {
            let name = format!("expression/{eth}/{unit}");
            if available.is_some_and(|a| !a.contains(name.as_str())) {
                continue;
            }
            let v = w * scale * p.ethnicity(eth);
            if v.abs() > 1e-5 {
                crate::modifiers::add(&mut out, &name, v);
            }
        }
    }
    out
}

/// Wrinkle depth per group (forehead, frown, smile; 0..1) for face-unit weights, plus the lines
/// age leaves at rest (from about 35, deepest at 85+).
pub fn wrinkle_weights(units: &UnitWeights, age_years: f64) -> [f64; 3] {
    let age = ((age_years - 35.0) / 50.0).clamp(0.0, 1.0);
    let rest = [0.35, 0.25, 0.3];
    let mut out = [0.0; 3];
    for (i, g) in data().wrinkle_groups.iter().enumerate().take(3) {
        let w: f64 = data().wrinkles[g].iter().map(|(u, k)| units.get(u).copied().unwrap_or(0.0) * k).sum();
        out[i] = (w.max(0.0) + rest[i] * age * age * (3.0 - 2.0 * age)).min(1.0);
    }
    out
}
