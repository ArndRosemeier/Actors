//! Shape sliders: plain-language sliders ("Shoulders", "Jaw", "Body fat") on top of the raw
//! modifiers, each driving several modifiers at once. Plus body types: named starting points
//! that set macro and shape sliders together. No shape touches genitals or breasts.

use crate::data::data;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ShapeSlider {
    pub id: String,
    pub label: String,
    /// "Body" or "Face".
    pub group: String,
    pub low: String,
    pub high: String,
    /// Modifier id -> weight (the modifier moves by weight x slider value).
    pub drives: IndexMap<String, f64>,
}

/// A named starting point: macro sliders and shape sliders together.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BodyType {
    pub id: String,
    pub label: String,
    /// Macro sliders it sets (muscle, weight, height, proportions).
    pub body: IndexMap<String, f64>,
    pub shape: IndexMap<String, f64>,
}

pub fn shape_sliders() -> &'static [ShapeSlider] {
    &data().shape_sliders
}

pub fn body_types() -> &'static [BodyType] {
    &data().body_types
}

/// The raw modifier values for shape slider values, added to `details` (the raw sliders) and
/// clamped to each modifier's range. `known` limits the result to modifiers the pack has and
/// gives their lower bound (-1 two-sided, 0 one-sided).
pub fn shape_modifiers(
    shape: &IndexMap<String, f64>,
    details: &IndexMap<String, f64>,
    known: Option<&HashMap<String, f64>>,
) -> IndexMap<String, f64> {
    let mut out = details.clone();
    for s in shape_sliders() {
        let Some(&v) = shape.get(&s.id) else { continue };
        if v == 0.0 || !v.is_finite() {
            continue;
        }
        let k = v.clamp(-1.0, 1.0);
        for (id, w) in &s.drives {
            if known.is_some_and(|k| !k.contains_key(id)) {
                continue;
            }
            *out.entry(id.clone()).or_insert(0.0) += w * k;
        }
    }
    for (id, v) in out.iter_mut() {
        let min = known.and_then(|k| k.get(id)).copied().unwrap_or(-1.0);
        *v = v.clamp(min, 1.0);
    }
    out
}
