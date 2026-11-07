//! The tables of `@actors/generator` (outfits, palettes, themes, allow presets, race look meshes),
//! exported to `data/generator.json` by `rust/golden/export-data.ts` (CI checks the file is current).

use crate::allow::AllowOptions;
use crate::catalog::{Choice, OutfitPreset, RobotFinishInfo, RobotPalette, SkeletalPalette};
use crate::config::SkeletalShape;
use actors_human::RaceId;
use indexmap::IndexMap;
use serde::Deserialize;
use std::sync::OnceLock;

/// A theme or theme flag with its description.
#[derive(Clone, Debug, Deserialize)]
pub struct Theme {
    pub id: String,
    pub label: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct KindThemes {
    pub robot: Vec<String>,
    pub skeletal: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RobotShape {
    pub head: String,
    pub ears: String,
    pub plating: String,
    pub thickness: f64,
    pub core: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorData {
    pub beard_styles: Vec<String>,
    pub horn_styles: Vec<String>,
    pub tail_styles: Vec<String>,
    pub pupils: Vec<String>,
    pub skin_patterns: Vec<String>,
    /// Iris colour presets of the three.js adapter (`IRIS_PRESETS`), in order.
    pub iris_presets: Vec<String>,
    pub robot_heads: Vec<String>,
    pub robot_head_labels: IndexMap<String, String>,
    pub robot_ears: Vec<String>,
    pub robot_plating: Vec<String>,
    pub default_robot: RobotShape,
    pub default_skeletal: SkeletalShape,
    pub robot_finishes: IndexMap<String, RobotFinishInfo>,
    pub robot_palettes: Vec<RobotPalette>,
    pub skeletal_palettes: Vec<SkeletalPalette>,
    pub outfits: Vec<OutfitPreset>,
    pub hair_colors: Vec<Choice>,
    pub garment_colors: Vec<Choice>,
    pub procedural_hair: IndexMap<String, String>,
    pub procedural_hair_race: IndexMap<String, RaceId>,
    pub painted_brows: String,
    pub hair_style_meshes: IndexMap<String, Vec<Option<String>>>,
    pub brow_style_meshes: IndexMap<String, Vec<Option<String>>>,
    pub themes: Vec<Theme>,
    pub theme_flags: Vec<Theme>,
    pub garment_themes: IndexMap<String, Vec<String>>,
    pub hair_themes: IndexMap<String, Vec<String>>,
    pub race_themes: IndexMap<String, Vec<String>>,
    pub kind_themes: KindThemes,
    pub allow_presets: IndexMap<String, AllowOptions>,
}

/// The shared tables (parsed once).
pub fn data() -> &'static GeneratorData {
    static DATA: OnceLock<GeneratorData> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("../data/generator.json")).expect("data/generator.json"))
}
