//! Fantasy races (ported from the Norgo game, same author): per race the random-generation
//! ranges and palettes, and the fixed body shaping laid over the MakeHuman body. The tables
//! live in `data/human.json`; see `packages/human/src/races.ts` for their documentation.
//!
//! Adult-only: every race is shaped from an adult body, small races keep adult proportions.
//! Children are the adult body with child proportions ([`Youth`]) and never get anatomy.
//! All colours are sRGB 0..1.

use crate::data::data;
use actors_core::BoneScale;
use indexmap::IndexMap;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RaceId {
    #[default]
    Human,
    Elf,
    Dwarf,
    Orc,
    Halfling,
    Goblin,
    Sylvan,
    Drakeborn,
    Umbral,
    Giantkin,
}

impl RaceId {
    pub const ALL: [RaceId; 10] = [
        RaceId::Human,
        RaceId::Elf,
        RaceId::Dwarf,
        RaceId::Orc,
        RaceId::Halfling,
        RaceId::Goblin,
        RaceId::Sylvan,
        RaceId::Drakeborn,
        RaceId::Umbral,
        RaceId::Giantkin,
    ];

    /// The race with this id ("elf"), if there is one.
    pub fn parse(s: &str) -> Option<RaceId> {
        serde_json::from_value(serde_json::Value::String(s.to_string())).ok()
    }

    pub fn as_str(self) -> &'static str {
        ["human", "elf", "dwarf", "orc", "halfling", "goblin", "sylvan", "drakeborn", "umbral", "giantkin"][self as usize]
    }

    pub fn info(self) -> &'static RaceInfo {
        &data().races[&self]
    }

    pub fn style(self) -> &'static RaceStyle {
        &data().race_styles[&self]
    }
}

pub type Rgb = [f64; 3];
/// Entries with weights (for weighted random picks).
pub type Weighted<T> = Vec<(T, f64)>;

/// Lore and display data.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaceInfo {
    pub id: RaceId,
    pub name: String,
    pub plural: String,
    pub description: String,
    /// Typical adult height range in meters.
    pub height_m: [f64; 2],
}

/// Accent (pattern) colour: derived from the skin, or an explicit palette.
#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum Accent {
    /// "darker" or "lighter".
    Derived(String),
    Palette(Weighted<Rgb>),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaceStyle {
    // Distributions (random generation).
    pub height: [f64; 2],
    pub weight: [f64; 2],
    pub muscle: [f64; 2],
    pub proportions: [f64; 2],
    pub scale: [f64; 2],
    /// Ethnic presets [african, asian, caucasian] with weights.
    pub ethnic: Weighted<Rgb>,
    pub skin: Weighted<Rgb>,
    pub accent: Accent,
    pub pattern: Weighted<String>,
    pub pattern_strength: [f64; 2],
    pub hair: Weighted<Rgb>,
    pub greying: f64,
    pub eyes: Weighted<Rgb>,
    pub eye_glow: [f64; 2],
    pub pupil: Weighted<String>,
    pub hair_styles_male: Weighted<String>,
    pub hair_styles_female: Weighted<String>,
    pub beard_styles: Weighted<String>,
    /// Probability of a beard for males / females.
    pub beard_chance: [f64; 2],
    pub brow_styles: Weighted<String>,
    pub tusks: [f64; 2],
    pub tusk_chance: f64,
    pub horns: Weighted<String>,
    pub horn_size: [f64; 2],
    pub horn_colors: Weighted<Rgb>,
    pub tail: Weighted<String>,
    pub tail_length: [f64; 2],
    /// Typical face / body features, -1..1 (part of the fixed shaping).
    pub face: IndexMap<String, f64>,
    pub body: IndexMap<String, f64>,
    pub marks: Weighted<String>,
    pub mark_chance: f64,
    // Fixed shaping.
    /// Extra target weights (bare MakeHuman names, "%" = both sides).
    pub targets: IndexMap<String, f64>,
    /// By bone group (see [`bone_in_group`]).
    pub bones: IndexMap<String, BoneScale>,
    /// Head scale relative to the body (capped at MAX_HEAD_SCALE).
    pub head_scale: f64,
    /// Procedural ear-tip elongation, 0..1.5.
    pub ear_tip: f64,
    /// Ear tip direction: 0 = up/back (elf), 1 = sideways (goblin).
    pub ear_sideways: f64,
}

impl RaceStyle {
    /// A face or body feature (0 when the race has no bias).
    pub fn feature(&self, key: &str) -> f64 {
        self.face.get(key).or_else(|| self.body.get(key)).copied().unwrap_or(0.0)
    }
}

/// A child's proportions laid over the adult body: youth 1 is a child of about five.
#[derive(Clone, Debug, Deserialize)]
pub struct Youth {
    /// Overall scale at youth 1.
    pub scale: f64,
    /// Head scale at youth 1 (not capped).
    pub head: f64,
    pub bones: IndexMap<String, BoneScale>,
    pub face: IndexMap<String, f64>,
    pub body: IndexMap<String, f64>,
}

/// Whether a bone (game-engine rig names) belongs to a bone group ("legs", "spine", ...).
pub fn bone_in_group(group: &str, bone: &str) -> bool {
    static RE: OnceLock<IndexMap<String, Regex>> = OnceLock::new();
    let re =
        RE.get_or_init(|| data().bone_groups.iter().map(|(k, src)| (k.clone(), Regex::new(src).expect("bone group pattern"))).collect());
    re.get(group).is_some_and(|r| r.is_match(bone))
}

/// Largest head scale any race (or mix) gets.
pub fn max_head_scale() -> f64 {
    data().max_head_scale
}
