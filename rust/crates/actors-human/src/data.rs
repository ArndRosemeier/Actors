//! The data tables of `@actors/human`, exported to `data/human.json` by
//! `rust/golden/export-data.ts` (CI checks the file is current).

use crate::races::{RaceId, RaceInfo, RaceStyle, Youth};
use crate::shapes::{BodyType, ShapeSlider};
use actors_core::animation::AxisClip;
use indexmap::IndexMap;
use serde::Deserialize;
use std::sync::OnceLock;

/// Face-unit weights by unit name (0..1).
pub type UnitWeights = IndexMap<String, f64>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HumanData {
    pub race_ids: Vec<RaceId>,
    pub races: IndexMap<RaceId, RaceInfo>,
    pub race_styles: IndexMap<RaceId, RaceStyle>,
    pub youth: Youth,
    pub max_head_scale: f64,
    /// Regex sources by bone group.
    pub bone_groups: IndexMap<String, String>,
    /// Feature -> [bare target base, opposing pair index, gain].
    pub feature_targets: IndexMap<String, Vec<(String, usize, f64)>>,
    pub ear_masks: EarMasks,
    /// [bare target base ("%" = both sides), gain, male-only share].
    pub muscle_terms: Vec<(String, f64, f64)>,
    pub expressions: IndexMap<String, UnitWeights>,
    pub blink: UnitWeights,
    pub wrinkle_groups: Vec<String>,
    pub wrinkles: IndexMap<String, UnitWeights>,
    pub shape_sliders: Vec<ShapeSlider>,
    pub body_types: Vec<BodyType>,
    pub axis_clips: Vec<AxisClip>,
}

#[derive(Debug, Deserialize)]
pub struct EarMasks {
    pub l: String,
    pub r: String,
}

/// The tables, parsed once.
pub fn data() -> &'static HumanData {
    static DATA: OnceLock<HumanData> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("../data/human.json")).expect("data/human.json matches HumanData"))
}
