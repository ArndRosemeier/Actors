//! What a game lets its players make ([`AllowOptions`]): races, robots and skeletons, clothing
//! categories and a height range.

use crate::catalog::CharacterCatalog;
use crate::data::data;
use crate::themes::keep_outfits;
use actors_human::RaceId;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// A set of switches: a list of what is allowed (`["human", "robot"]`, everything else off), or
/// flags (`{ "fantasy": false }`, anything not named stays on).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Flags {
    List(Vec<String>),
    Map(IndexMap<String, bool>),
}

impl Flags {
    pub fn on(&self, key: &str) -> bool {
        match self {
            Flags::List(l) => l.iter().any(|k| k == key),
            Flags::Map(m) => m.get(key) != Some(&false),
        }
    }
}

/// Whether `key` is on (absent flags: everything is on).
pub fn flag_on(flags: Option<&Flags>, key: &str) -> bool {
    flags.is_none_or(|f| f.on(key))
}

/// Standing height range in meters.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct HeightRange {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
}

/// What a game lets its players make.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AllowOptions {
    /// Races, "robot" and "skeleton". Default: all.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub races: Option<Flags>,
    /// Clothing categories (the themes: "modern", "medieval", ...). Default: all.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clothing: Option<Flags>,
    /// Standing height in meters: a body outside is scaled as a whole to the nearest limit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<HeightRange>,
}

impl AllowOptions {
    /// A ready-made setting: "city", "vintage", "fantasy" or "scifi".
    pub fn preset(name: &str) -> Option<AllowOptions> {
        data().allow_presets.get(name).cloned()
    }
}

/// The catalog with only what `allow` lets in: races (the human body stays as the base of robots
/// and skeletons even when humans are off; `catalog.people` then says so), robots, skeletons,
/// garments of the allowed clothing categories, and the outfit presets whose garments all remain.
pub fn allow_catalog(catalog: &CharacterCatalog, allow: &AllowOptions) -> CharacterCatalog {
    let races: Vec<_> = catalog.races.iter().filter(|r| flag_on(allow.races.as_ref(), r.id.as_str())).cloned().collect();
    let categories: Vec<&str> = data().themes.iter().map(|t| t.id.as_str()).collect();
    let garments: Vec<_> = match &allow.clothing {
        None => catalog.garments.clone(),
        Some(c) => catalog
            .garments
            .iter()
            .filter(|g| match &g.themes {
                None => true,
                Some(t) if t.is_empty() => true,
                Some(t) => t.iter().any(|t| c.on(t) && categories.contains(&t.as_str())),
            })
            .cloned()
            .collect(),
    };
    let outfits = keep_outfits(catalog, &garments.iter().map(|g| g.id.as_str()).collect());
    let robot = if flag_on(allow.races.as_ref(), "robot") { catalog.robot.clone() } else { None };
    let skeletal = if flag_on(allow.races.as_ref(), "skeleton") { catalog.skeletal.clone() } else { None };
    // No race at all: only robots or skeletons, built on the plain human body.
    let people = !races.is_empty() && catalog.people != Some(false);
    let kinds = robot.is_some() || skeletal.is_some();
    let race_ids: HashSet<RaceId> = races.iter().map(|r| r.id).collect();
    let race_of = &data().procedural_hair_race;
    let hair = catalog.hair.iter().filter(|h| race_of.get(&h.id).is_none_or(|r| race_ids.contains(r))).cloned().collect();
    let human = catalog.races.iter().find(|r| r.id == RaceId::Human);
    CharacterCatalog {
        hair,
        races: if people {
            races
        } else {
            match human {
                Some(h) if kinds => vec![h.clone()],
                _ => races,
            }
        },
        people: Some(people || !kinds),
        garments,
        outfits,
        robot,
        skeletal,
        height: merge_height(catalog.height, allow.height),
        ..catalog.clone()
    }
}

/// The narrower of two height ranges.
fn merge_height(a: Option<HeightRange>, b: Option<HeightRange>) -> Option<HeightRange> {
    match (a, b) {
        (None, b) => b,
        (a, None) => a,
        (Some(a), Some(b)) => {
            let pick = |x: Option<f64>, y: Option<f64>, f: fn(f64, f64) -> f64| match (x, y) {
                (None, y) => y,
                (x, None) => x,
                (Some(x), Some(y)) => Some(f(x, y)),
            };
            Some(HeightRange { min: pick(a.min, b.min, f64::max), max: pick(a.max, b.max, f64::min) })
        }
    }
}

/// The uniform scale that brings a body of `height` meters into `range` (1 when it fits).
pub fn height_fit(height: f64, range: Option<&HeightRange>) -> f64 {
    let Some(r) = range else { return 1.0 };
    if height.is_nan() || height <= 0.0 {
        return 1.0;
    }
    if let (Some(min), Some(max)) = (r.min, r.max) {
        if min > max {
            return (min + max) / 2.0 / height;
        }
    }
    if let Some(min) = r.min.filter(|&m| height < m) {
        return min / height;
    }
    if let Some(max) = r.max.filter(|&m| height > m) {
        return max / height;
    }
    1.0
}
