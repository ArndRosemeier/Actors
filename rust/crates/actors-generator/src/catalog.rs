//! What a pack offers, as plain ids and labels ([`CharacterCatalog`]), and the outfit rules.

use crate::allow::HeightRange;
use crate::data::data;
use actors_core::ActorPackManifest;
use actors_human::{tables, HumanPack, HumanParams, RaceId};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// One choice in a list: the id the API takes and a display label.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Choice {
    pub id: String,
    pub label: String,
    /// Author, pack and licence, for assets whose licence asks for credit (CC-BY).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit: Option<String>,
    /// Settings the option fits (see [`crate::themes`]); absent = every setting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub themes: Option<Vec<String>>,
}

impl Choice {
    pub fn new(id: impl Into<String>, label: impl Into<String>) -> Self {
        Self { id: id.into(), label: label.into(), credit: None, themes: None }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RaceChoice {
    pub id: RaceId,
    pub label: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub themes: Option<Vec<String>>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GarmentChoice {
    pub id: String,
    pub label: String,
    /// Garments sharing a slot replace each other (e.g. the two skirts).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot: Option<String>,
    /// Body layers the garment takes ("top", "bottom", "shoes", "hat", ...): putting on a garment
    /// takes off the others that share one of its layers.
    pub occupies: Vec<String>,
    /// UI group ("Tops", "Shoes", ...).
    pub category: String,
    /// Hides the genital mesh/detail while worn.
    pub covers_anatomy: bool,
    /// Hides the hair while worn (closed helmets, hoods).
    #[serde(default)]
    pub hides_hair: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// Typical wearer ("female" / "male"), for random outfits; absent = anyone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gender: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub themes: Option<Vec<String>>,
}

/// A named outfit. `female` items are only added for female-leaning bodies (gender < 0.5).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct OutfitPreset {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub garments: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub female: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gender: Option<String>,
    /// Garment colours (sRGB hex) the preset starts with; others keep their own colours.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colors: Option<IndexMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub themes: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AnimationChoice {
    pub id: String,
    pub label: String,
    /// Menu group, e.g. "Locomotion" or "Combat".
    pub category: String,
    /// Made to loop (idles, walks); the rest are one-shots.
    #[serde(rename = "loop")]
    pub looping: bool,
    /// "" for the pack's own clips, else the clip library's name (e.g. "cmu").
    pub library: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DetailChoice {
    pub id: String,
    pub label: String,
    pub group: String,
    pub min: f64,
    pub max: f64,
}

/// Material settings of a robot finish.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RobotFinishInfo {
    pub label: String,
    pub metalness: f64,
    pub roughness: f64,
    pub clearcoat: f64,
    pub clearcoat_roughness: f64,
}

/// Colours of a robot palette.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RobotColors {
    pub paint: String,
    pub trim: String,
    pub frame: String,
    pub metal: String,
    pub glow: String,
    pub finish: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RobotPalette {
    pub id: String,
    pub label: String,
    pub look: RobotColors,
}

/// A skeleton palette: colours and roughness, and some shape settings.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SkeletalColors {
    pub bone: String,
    pub glow: String,
    pub dryness: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub robust: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wear: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub missing: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jaw: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eyes: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heart: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SkeletalPalette {
    pub id: String,
    pub label: String,
    pub look: SkeletalColors,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RobotOptions {
    pub heads: Vec<Choice>,
    pub ears: Vec<Choice>,
    pub plating: Vec<Choice>,
    pub finishes: Vec<Choice>,
    pub palettes: Vec<RobotPalette>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SkeletalOptions {
    pub palettes: Vec<SkeletalPalette>,
}

/// Everything a pack offers, as plain ids and labels (for UIs and random generation).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterCatalog {
    /// Races (human first).
    pub races: Vec<RaceChoice>,
    pub animations: Vec<AnimationChoice>,
    /// Animation sources: "" = the pack's own clips, then each clip library.
    pub libraries: Vec<Choice>,
    pub garments: Vec<GarmentChoice>,
    pub outfits: Vec<OutfitPreset>,
    pub hair: Vec<Choice>,
    pub hair_colors: Vec<Choice>,
    /// Suggested garment colours (sRGB hex ids); any other hex colour works too.
    pub garment_colors: Vec<Choice>,
    pub brows: Vec<Choice>,
    pub eyes: Vec<Choice>,
    pub expressions: Vec<Choice>,
    /// Detail sliders, grouped; values -1..1 or 0..1.
    pub details: Vec<DetailChoice>,
    /// Photographic skins are available.
    pub photo_skin: bool,
    /// Robot options (absent: no robots offered).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub robot: Option<RobotOptions>,
    /// Skeleton options (absent: no skeletons offered).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skeletal: Option<SkeletalOptions>,
    /// False when the game offers no living people, only robots or skeletons: `races` then holds
    /// just the human body they are built on. Absent: people are offered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub people: Option<bool>,
    /// Standing height range in meters the character is kept in. Absent: any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<HeightRange>,
}

impl CharacterCatalog {
    pub fn garment(&self, id: &str) -> Option<&GarmentChoice> {
        self.garments.iter().find(|g| g.id == id)
    }

    pub fn outfit(&self, id: &str) -> Option<&OutfitPreset> {
        self.outfits.iter().find(|o| o.id == id)
    }

    pub fn offers_race(&self, race: RaceId) -> bool {
        self.races.iter().any(|r| r.id == race)
    }
}

/// First letter upper case.
pub(crate) fn cap(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().chain(c).collect(),
        None => String::new(),
    }
}

fn themed(table: &IndexMap<String, Vec<String>>, id: &str) -> Option<Vec<String>> {
    table.get(id).cloned()
}

fn choices(map: &IndexMap<String, String>) -> Vec<Choice> {
    map.iter().map(|(id, label)| Choice::new(id, label)).collect()
}

/// The catalog of a human pack. `iris_presets` are the eye colour presets the renderer has
/// (`None`: the three.js adapter's, see [`crate::data::GeneratorData::iris_presets`]).
/// `library_clips` are the clips of loaded clip libraries (`ActorRuntime::clip_defs` lists the
/// pack's own clips first, then those).
pub fn build_catalog<'a>(
    manifest: &ActorPackManifest,
    pack: &HumanPack,
    clips: impl IntoIterator<Item = &'a actors_core::format::ClipDef>,
    iris_presets: Option<&[String]>,
) -> CharacterCatalog {
    let d = data();
    let extra = &pack.extra;
    let garments: Vec<GarmentChoice> = manifest
        .meshes
        .iter()
        .filter(|m| m.role == actors_core::format::MeshRole::Garment && !m.internal)
        .map(|m| {
            let g = extra.garments.get(&m.name).cloned().unwrap_or_default();
            let cc_by = m.has_tag("license:CC-BY") && g.credit.is_some();
            GarmentChoice {
                id: m.name.clone(),
                label: g.label.clone().or_else(|| extra.garment_labels.get(&m.name).cloned()).unwrap_or_else(|| m.name.clone()),
                slot: m.slot.clone(),
                occupies: g.occupies.clone(),
                category: g.category.clone().unwrap_or_else(|| "Clothes".into()),
                covers_anatomy: m.has_tag("covers:anatomy"),
                hides_hair: m.has_tag("covers:hair"),
                credit: if cc_by { g.credit.clone() } else { None },
                author: if cc_by { g.author.clone() } else { None },
                gender: g.gender.clone(),
                themes: themed(&d.garment_themes, &m.name),
            }
        })
        .collect();
    let have: HashSet<&str> = garments.iter().map(|g| g.id.as_str()).collect();
    let outfits = d
        .outfits
        .iter()
        .filter(|o| o.garments.iter().all(|g| have.contains(g.as_str())))
        .map(|o| OutfitPreset {
            female: o.female.as_ref().map(|f| f.iter().filter(|g| have.contains(g.as_str())).cloned().collect()),
            ..o.clone()
        })
        .collect();
    let cc_by: HashSet<&str> = manifest.meshes.iter().filter(|m| m.has_tag("license:CC-BY")).map(|m| m.name.as_str()).collect();
    let animations = clips
        .into_iter()
        .map(|c| {
            let library = manifest
                .clip_libraries
                .iter()
                .find(|l| c.file.starts_with(&l.file[..l.file.rfind('/').map_or(0, |i| i + 1)]))
                .map(|l| l.name.clone())
                .unwrap_or_default();
            let label = match (&c.description, library.is_empty()) {
                (Some(desc), false) if !desc.is_empty() => {
                    // The name without its first word (the library's subject number).
                    let name = match c.name.char_indices().find(|(_, ch)| ch.is_whitespace()) {
                        Some((i, ch)) if i > 0 => c.name[i + ch.len_utf8()..].to_string(),
                        _ => c.name.clone(),
                    };
                    format!("{name} · {desc}")
                }
                _ => cap(&c.name),
            };
            AnimationChoice {
                id: c.name.clone(),
                label,
                category: c.category.clone().unwrap_or_else(|| "Other".into()),
                looping: c.looping,
                library,
                description: c.description.clone(),
            }
        })
        .collect();
    let mut libraries = vec![Choice::new("", format!("Animations ({})", manifest.clips.len()))];
    for l in &manifest.clip_libraries {
        let name = if l.name == "cmu" { "CMU motion capture" } else { &l.name };
        libraries.push(Choice::new(&l.name, format!("{name} ({})", l.count)));
    }
    let mut hair: Vec<Choice> = choices(&extra.hair_labels)
        .into_iter()
        .map(|mut h| {
            if cc_by.contains(h.id.as_str()) {
                h.credit = extra.hair_credits.get(&h.id).cloned();
            }
            h
        })
        .collect();
    hair.extend(choices(&d.procedural_hair));
    for h in &mut hair {
        h.themes = themed(&d.hair_themes, &h.id);
    }
    let iris = iris_presets.unwrap_or(&d.iris_presets);
    CharacterCatalog {
        races: RaceId::ALL
            .iter()
            .map(|&id| RaceChoice {
                id,
                label: id.info().name.clone(),
                description: id.info().description.clone(),
                themes: themed(&d.race_themes, id.as_str()),
            })
            .collect(),
        animations,
        libraries,
        garments,
        outfits,
        hair,
        hair_colors: d.hair_colors.clone(),
        garment_colors: d.garment_colors.clone(),
        brows: choices(&extra.brow_labels),
        eyes: iris.iter().map(|id| Choice::new(id, cap(id))).collect(),
        expressions: tables().expressions.keys().map(|id| Choice::new(id, cap(id))).collect(),
        details: extra
            .modifiers
            .iter()
            .map(|m| DetailChoice {
                id: m.id.clone(),
                label: m.label.clone(),
                group: m.group.clone(),
                min: if m.negative.is_empty() { 0.0 } else { -1.0 },
                max: 1.0,
            })
            .collect(),
        photo_skin: !extra.skins.is_empty(),
        robot: Some(RobotOptions {
            heads: d
                .robot_heads
                .iter()
                .map(|id| Choice::new(id, d.robot_head_labels.get(id).cloned().unwrap_or_else(|| cap(id))))
                .collect(),
            ears: d.robot_ears.iter().map(|id| Choice::new(id, cap(id))).collect(),
            plating: d.robot_plating.iter().map(|id| Choice::new(id, cap(id))).collect(),
            finishes: d.robot_finishes.iter().map(|(id, f)| Choice::new(id, &f.label)).collect(),
            palettes: d.robot_palettes.clone(),
        }),
        skeletal: Some(SkeletalOptions { palettes: d.skeletal_palettes.clone() }),
        people: None,
        height: None,
    }
}

/// A wearable outfit from a list of garment ids: unknown ids are dropped, and a later garment
/// takes off earlier ones it shares a slot or body layer with (a dress replaces a T-shirt and jeans).
pub fn resolve_outfit(catalog: &CharacterCatalog, outfit: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for id in outfit {
        let Some(g) = catalog.garment(id) else { continue };
        if out.contains(id) {
            continue;
        }
        out.retain(|p| {
            let prev = catalog.garment(p).expect("resolved garment");
            !((g.slot.is_some() && prev.slot == g.slot) || g.occupies.iter().any(|l| prev.occupies.contains(l)))
        });
        out.push(id.clone());
    }
    out
}

/// Worn garments that need not be drawn because outer clothes cover them completely (briefs
/// under trousers, a bra under a top), so they can never peek through.
pub fn concealed_garments(catalog: &CharacterCatalog, outfit: &[String]) -> Vec<String> {
    let under = |layer: &str| -> &'static [&'static str] {
        match layer {
            "top" => &["bra"],
            "bottom" => &["briefs"],
            _ => &[],
        }
    };
    let worn: Vec<&GarmentChoice> = catalog.garments.iter().filter(|g| outfit.contains(&g.id)).collect();
    let covered: HashSet<&str> = worn.iter().flat_map(|g| g.occupies.iter().flat_map(|l| under(l).iter().copied())).collect();
    worn.iter()
        .filter(|g| !g.occupies.is_empty() && g.occupies.iter().all(|l| covered.contains(l.as_str())))
        .map(|g| g.id.clone())
        .collect()
}

/// Garment ids of an outfit preset for a body.
pub fn outfit_garments(preset: &OutfitPreset, body: &HumanParams) -> Vec<String> {
    let mut out = preset.garments.clone();
    if body.gender < 0.5 {
        out.extend(preset.female.iter().flatten().cloned());
    }
    out
}

/// The race-only features the catalog's races grow (horns, tails, tusks, glowing eyes, pupils,
/// skin patterns) and whether the race size slider does anything.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaceFeatures {
    pub horns: Vec<String>,
    pub tails: Vec<String>,
    pub pupils: Vec<String>,
    pub patterns: Vec<String>,
    pub tusks: bool,
    pub eye_glow: bool,
    /// Whether the Size slider changes anything (humans all have the same scale).
    pub size: bool,
}

/// Every option of each feature, to pass to [`race_features`].
pub struct FeatureLists<'a> {
    pub horns: &'a [String],
    pub tails: &'a [String],
    pub pupils: &'a [String],
    pub patterns: &'a [String],
}

impl FeatureLists<'static> {
    /// All horn and tail styles, pupils and skin patterns.
    pub fn all() -> Self {
        let d = data();
        Self { horns: &d.horn_styles, tails: &d.tail_styles, pupils: &d.pupils, patterns: &d.skin_patterns }
    }
}

/// With every race on offer, everything; a game that allows only some races offers just what
/// those races have.
pub fn race_features(races: &[RaceChoice], all: &FeatureLists) -> RaceFeatures {
    let mut ids: Vec<RaceId> = Vec::new();
    for r in races {
        if !ids.contains(&r.id) {
            ids.push(r.id);
        }
    }
    if ids.is_empty() || RaceId::ALL.iter().all(|id| ids.contains(id)) {
        return RaceFeatures {
            horns: all.horns.to_vec(),
            tails: all.tails.to_vec(),
            pupils: all.pupils.to_vec(),
            patterns: all.patterns.to_vec(),
            tusks: true,
            eye_glow: true,
            size: true,
        };
    }
    let styles: Vec<_> = ids.iter().map(|id| id.style()).collect();
    let used = |pick: &dyn Fn(&actors_human::RaceStyle) -> &Vec<(String, f64)>, keep: &str, list: &[String]| -> Vec<String> {
        let mut on: HashSet<&str> = HashSet::from([keep]);
        for s in &styles {
            for (v, w) in pick(s) {
                if *w > 0.0 {
                    on.insert(v);
                }
            }
        }
        list.iter().filter(|v| on.contains(v.as_str())).cloned().collect()
    };
    RaceFeatures {
        horns: used(&|s| &s.horns, "none", all.horns),
        tails: used(&|s| &s.tail, "none", all.tails),
        pupils: used(&|s| &s.pupil, "round", all.pupils),
        patterns: used(&|s| &s.pattern, "none", all.patterns),
        tusks: styles.iter().any(|s| s.tusk_chance > 0.0 && s.tusks[1] > 0.0),
        eye_glow: styles.iter().any(|s| s.eye_glow[1] > 0.0),
        size: styles.iter().any(|s| s.scale[0] != s.scale[1]),
    }
}
