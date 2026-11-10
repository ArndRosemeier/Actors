//! [`CharacterConfig`]: the whole look and motion of a character, the same JSON as
//! `@actors/generator`'s `CharacterConfig`.

use crate::catalog::{race_features, resolve_outfit, CharacterCatalog, FeatureLists};
use crate::data::data;
use actors_core::deform_recipe::DeformSpec;
use actors_human::costume::{CostumeParts, BELT_STYLES, CAPE_STYLES, COLLAR_STYLES, MASK_STYLES};
use actors_human::emblem::{EMBLEM_SHAPES, EMBLEM_SYMBOLS};
use actors_human::{HumanParams, RaceId, RaceSettings, ADULT_MIN_AGE, MAX_AGE};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

fn is_hex(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn unit(x: f64, default: f64) -> f64 {
    if x.is_finite() {
        x.clamp(0.0, 1.0)
    } else {
        default
    }
}

/// A robot's look: shape options plus colours (sRGB hex) and finish.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RobotLook {
    /// "visor", "optics", "mono" or "android".
    pub head: String,
    /// "none", "pods", "antennae" or "fins".
    pub ears: String,
    /// "sleek", "segmented" or "armored".
    pub plating: String,
    /// 0..1 plate thickness.
    pub thickness: f64,
    /// A light core in the chest.
    pub core: bool,
    /// Main plate colour.
    pub paint: String,
    /// Second plate colour: shoulders, hands, pelvis, feet, ear pods, visor frame.
    pub trim: String,
    /// Inner frame (the synthetic muscle in the gaps).
    pub frame: String,
    /// Joint housings and bezels.
    pub metal: String,
    /// Lights: visor, optics, joint rings, chest core.
    pub glow: String,
    /// 0..1 light strength (0 = off).
    pub glow_strength: f64,
    /// "gloss", "satin", "metallic" or "matte" (see `GeneratorData::robot_finishes`).
    pub finish: String,
}

impl Default for RobotLook {
    fn default() -> Self {
        let d = data();
        let r = &d.default_robot;
        let p = &d.robot_palettes[0].look;
        Self {
            head: r.head.clone(),
            ears: r.ears.clone(),
            plating: r.plating.clone(),
            thickness: r.thickness,
            core: r.core,
            paint: p.paint.clone(),
            trim: p.trim.clone(),
            frame: p.frame.clone(),
            metal: p.metal.clone(),
            glow: p.glow.clone(),
            glow_strength: 0.7,
            finish: p.finish.clone(),
        }
    }
}

impl RobotLook {
    /// A valid look (bad values fall back to the defaults).
    pub fn sanitized(&self) -> Self {
        let d = data();
        let def = Self::default();
        let pick = |v: &String, list: &[String], dv: &String| if list.contains(v) { v.clone() } else { dv.clone() };
        let color = |v: &String, dv: &String| if is_hex(v) { v.clone() } else { dv.clone() };
        Self {
            head: pick(&self.head, &d.robot_heads, &def.head),
            ears: pick(&self.ears, &d.robot_ears, &def.ears),
            plating: pick(&self.plating, &d.robot_plating, &def.plating),
            thickness: unit(self.thickness, def.thickness),
            core: self.core,
            paint: color(&self.paint, &def.paint),
            trim: color(&self.trim, &def.trim),
            frame: color(&self.frame, &def.frame),
            metal: color(&self.metal, &def.metal),
            glow: color(&self.glow, &def.glow),
            glow_strength: unit(self.glow_strength, def.glow_strength),
            finish: if d.robot_finishes.contains_key(&self.finish) { self.finish.clone() } else { def.finish },
        }
    }
}

/// The shape options of a skeleton (`@actors/human` SkeletalConfig).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SkeletalShape {
    pub robust: f64,
    pub wear: f64,
    pub missing: f64,
    pub jaw: bool,
    pub eyes: bool,
    pub heart: bool,
    pub seed: f64,
}

/// A skeleton's look: shape options plus bone and light colours.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SkeletalLook {
    /// 0..1 bone thickness (gracile to robust).
    pub robust: f64,
    /// 0..1 weathering.
    pub wear: f64,
    /// 0..1 how many small bones are lost.
    pub missing: f64,
    /// Lower jaw present.
    pub jaw: bool,
    /// Lights in the eye sockets.
    pub eyes: bool,
    /// A light inside the rib cage.
    pub heart: bool,
    /// Bone colour (sRGB hex).
    pub bone: String,
    /// Eye and heart light colour.
    pub glow: String,
    /// 0..1 light strength.
    pub glow_strength: f64,
    /// 0..1 surface roughness (polished to dry and chalky).
    pub dryness: f64,
}

impl Default for SkeletalLook {
    fn default() -> Self {
        let d = data();
        let s = &d.default_skeletal;
        let mut look = Self {
            robust: s.robust,
            wear: s.wear,
            missing: s.missing,
            jaw: s.jaw,
            eyes: s.eyes,
            heart: s.heart,
            bone: String::new(),
            glow: String::new(),
            glow_strength: 0.7,
            dryness: 0.0,
        };
        look.apply_palette(&d.skeletal_palettes[0].look);
        look
    }
}

impl SkeletalLook {
    pub(crate) fn apply_palette(&mut self, p: &crate::catalog::SkeletalColors) {
        self.bone = p.bone.clone();
        self.glow = p.glow.clone();
        self.dryness = p.dryness;
        if let Some(v) = p.robust {
            self.robust = v;
        }
        if let Some(v) = p.wear {
            self.wear = v;
        }
        if let Some(v) = p.missing {
            self.missing = v;
        }
        if let Some(v) = p.jaw {
            self.jaw = v;
        }
        if let Some(v) = p.eyes {
            self.eyes = v;
        }
        if let Some(v) = p.heart {
            self.heart = v;
        }
    }

    /// A valid look (bad values fall back to the defaults).
    pub fn sanitized(&self) -> Self {
        let def = Self::default();
        let s = &data().default_skeletal;
        let color = |v: &String, dv: &String| if is_hex(v) { v.clone() } else { dv.clone() };
        Self {
            robust: unit(self.robust, s.robust),
            wear: unit(self.wear, s.wear),
            missing: unit(self.missing, s.missing),
            jaw: self.jaw,
            eyes: self.eyes,
            heart: self.heart,
            bone: color(&self.bone, &def.bone),
            glow: color(&self.glow, &def.glow),
            glow_strength: unit(self.glow_strength, def.glow_strength),
            dryness: unit(self.dryness, def.dryness),
        }
    }
}

/// Surface finishes for costume pieces: (id, label, metalness, roughness, clearcoat, sheen).
pub const COSTUME_FINISHES: [(&str, &str, f64, f64, f64, f64); 6] = [
    ("cloth", "Cloth", 0.0, 0.85, 0.0, 0.3),
    ("satin", "Satin (spandex)", 0.0, 0.42, 0.15, 0.8),
    ("leather", "Leather", 0.0, 0.55, 0.25, 0.0),
    ("rubber", "Rubber", 0.0, 0.32, 0.5, 0.0),
    ("gloss", "Gloss vinyl", 0.05, 0.14, 1.0, 0.0),
    ("metallic", "Metal", 1.0, 0.28, 0.3, 0.0),
];

/// Material settings of a finish: (metalness, roughness, clearcoat, sheen).
pub fn costume_finish(id: &str) -> Option<(f64, f64, f64, f64)> {
    COSTUME_FINISHES.iter().find(|f| f.0 == id).map(|f| (f.2, f.3, f.4, f.5))
}

/// How much of a garment texture's pattern stays when a costume finish dyes the garment (any
/// finish but "cloth"): prints and weaves fade to faint folds, so a spandex suit reads as one
/// colour. 0 is flat colour, 1 the whole pattern.
pub const COSTUME_DYED_PATTERN: f64 = 0.12;

/// Whether a costume finish dyes a recoloured garment one colour (see [`COSTUME_DYED_PATTERN`]).
pub fn costume_dyes_solid(id: &str) -> bool {
    id != "cloth" && costume_finish(id).is_some()
}

/// Finish of costume parts that have none set, by part name.
pub const COSTUME_PART_FINISH: [(&str, &str); 7] = [
    ("cape", "satin"),
    ("cape-lining", "satin"),
    ("mask", "satin"),
    ("belt", "leather"),
    ("buckle", "metallic"),
    ("emblem", "gloss"),
    ("emblem-rim", "metallic"),
];

fn hex_rgb(s: &str) -> [f64; 3] {
    let c = |i: usize| u8::from_str_radix(&s[i..i + 2], 16).unwrap_or(0) as f64 / 255.0;
    if is_hex(s) {
        [c(1), c(3), c(5)]
    } else {
        [1.0, 1.0, 1.0]
    }
}

/// A hero costume on top of the outfit: a cape (with a collar), a mask, a belt and a chest emblem
/// (see `actors_human::costume`), their colours (sRGB hex), and a finish for any piece: a garment
/// id or a costume part ("cape", "mask", "belt", "buckle", "emblem", "rim").
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CostumeLook {
    pub cape: String,
    pub collar: String,
    pub cape_color: String,
    pub lining_color: String,
    pub mask: String,
    pub mask_color: String,
    pub belt: String,
    pub belt_color: String,
    pub buckle_color: String,
    pub emblem: String,
    pub symbol: String,
    /// 0..1
    pub emblem_size: f64,
    pub emblem_color: String,
    pub symbol_color: String,
    pub rim_color: String,
    pub finishes: IndexMap<String, String>,
}

impl Default for CostumeLook {
    fn default() -> Self {
        Self {
            cape: "none".into(),
            collar: "none".into(),
            cape_color: "#c8202a".into(),
            lining_color: "#f2c230".into(),
            mask: "none".into(),
            mask_color: "#1f2a6b".into(),
            belt: "none".into(),
            belt_color: "#f2c230".into(),
            buckle_color: "#d8dde4".into(),
            emblem: "none".into(),
            symbol: "bolt".into(),
            emblem_size: 0.5,
            emblem_color: "#c8202a".into(),
            symbol_color: "#f2c230".into(),
            rim_color: "#f2c230".into(),
            finishes: IndexMap::new(),
        }
    }
}

impl CostumeLook {
    /// A valid costume (bad values fall back to the defaults).
    pub fn sanitized(&self) -> Self {
        let d = Self::default();
        let color = |v: &String, dv: &String| if is_hex(v) { v.clone() } else { dv.clone() };
        let pick = |list: &[&str], v: &String, dv: &String| if list.contains(&v.as_str()) { v.clone() } else { dv.clone() };
        Self {
            cape: pick(&CAPE_STYLES, &self.cape, &d.cape),
            collar: pick(&COLLAR_STYLES, &self.collar, &d.collar),
            cape_color: color(&self.cape_color, &d.cape_color),
            lining_color: color(&self.lining_color, &d.lining_color),
            mask: pick(&MASK_STYLES, &self.mask, &d.mask),
            mask_color: color(&self.mask_color, &d.mask_color),
            belt: pick(&BELT_STYLES, &self.belt, &d.belt),
            belt_color: color(&self.belt_color, &d.belt_color),
            buckle_color: color(&self.buckle_color, &d.buckle_color),
            emblem: pick(&EMBLEM_SHAPES, &self.emblem, &d.emblem),
            symbol: pick(&EMBLEM_SYMBOLS, &self.symbol, &d.symbol),
            emblem_size: unit(self.emblem_size, d.emblem_size),
            emblem_color: color(&self.emblem_color, &d.emblem_color),
            symbol_color: color(&self.symbol_color, &d.symbol_color),
            rim_color: color(&self.rim_color, &d.rim_color),
            finishes: self
                .finishes
                .iter()
                .filter(|(k, v)| k.len() < 64 && costume_finish(v).is_some())
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        }
    }

    /// True if the costume adds any part.
    pub fn any(&self) -> bool {
        self.cape != "none" || self.mask != "none" || self.belt != "none" || self.emblem != "none"
    }

    /// The parts' shapes and colours for [`actors_human::PartsConfig::costume`].
    pub fn parts(&self) -> CostumeParts {
        CostumeParts {
            cape: self.cape.clone(),
            collar: self.collar.clone(),
            cape_color: hex_rgb(&self.cape_color),
            lining_color: hex_rgb(&self.lining_color),
            mask: self.mask.clone(),
            mask_color: hex_rgb(&self.mask_color),
            belt: self.belt.clone(),
            belt_color: hex_rgb(&self.belt_color),
            buckle_color: hex_rgb(&self.buckle_color),
            emblem: self.emblem.clone(),
            symbol: self.symbol.clone(),
            emblem_size: self.emblem_size,
            rim_color: hex_rgb(&self.rim_color),
        }
    }

    /// The finish of a costume part (by part name) or a garment (by id): the one set in
    /// `finishes`, else the part's default; garments without one have none.
    pub fn finish_of(&self, name: &str) -> Option<&str> {
        let key = match name {
            "cape" | "cape-lining" => "cape",
            "emblem-rim" => "rim",
            n => n,
        };
        if let Some(f) = self.finishes.get(key) {
            return Some(f.as_str());
        }
        COSTUME_PART_FINISH.iter().find(|p| p.0 == name).map(|p| p.1)
    }
}

/// Which skin the body wears.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkinKind {
    /// Photographic skins that follow gender, age and ethnicity.
    #[default]
    Photo,
    /// A generated skin coloured by `skin_tone` (or `skin_color`).
    Procedural,
}

/// Where a living face looks.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Gaze {
    Ahead,
    #[default]
    Camera,
}

/// Mesh detail: the subdivided body or the base mesh.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Detail {
    #[default]
    High,
    Low,
}

/// The whole look and motion of a character, serialisable as the same JSON as the TypeScript
/// `CharacterConfig`. Missing fields take the defaults (see [`default_config`] for a catalog's).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CharacterConfig {
    pub race: RaceId,
    /// Second race for mixed heritage (half-elf, half-orc...).
    pub race2: Option<RaceId>,
    /// 0..1 share of `race2`.
    pub race_mix: f64,
    /// 0..1 within the race's size range (0.5 = typical).
    pub race_size: f64,
    /// A deformed body (a recipe, a seed and a strength) laid over the race.
    pub deform: Option<DeformSpec>,
    /// 0 = grown up .. 1 = a child of about five: child proportions on the adult body. A child
    /// never shows anatomy, whatever `anatomy` says.
    pub youth: f64,
    pub body: HumanParams,
    /// Detail slider values by id (missing = 0).
    pub details: IndexMap<String, f64>,
    /// Shape slider values by id (-1..1), added to `details`.
    pub shape: IndexMap<String, f64>,
    pub skin: SkinKind,
    /// 0 = light .. 1 = dark, for the procedural skin.
    pub skin_tone: f64,
    /// Skin colour (sRGB hex) for non-human tones.
    pub skin_color: Option<String>,
    /// Iris preset (see `catalog.eyes`).
    pub eyes: String,
    /// Iris colour (sRGB hex) instead of the preset's.
    pub eye_color: Option<String>,
    /// 0..1 glowing iris.
    pub eye_glow: f64,
    /// "round", "slit", "goat" or "none".
    pub pupil: String,
    /// Race skin pattern ("none", "scales", "bark", ...).
    pub skin_pattern: String,
    pub pattern_strength: f64,
    /// Pattern colour (sRGB hex), or none for a darker shade of the skin.
    pub pattern_color: Option<String>,
    /// 0..1, varies procedural details.
    pub seed: f64,
    /// Hair mesh id, a generated style ("leaves", "crest"), or none.
    pub hair: Option<String>,
    /// Generated beard style ("none" for none).
    pub beard: String,
    /// 0..1 painted stubble.
    pub stubble: f64,
    pub horns: String,
    pub horn_size: f64,
    pub horn_color: Option<String>,
    /// 0..1, 0 = no tusks.
    pub tusks: f64,
    pub tail: String,
    pub tail_length: f64,
    /// sRGB hex, or none for the hairstyle's own colour.
    pub hair_color: Option<String>,
    /// Eyebrow mesh id, "painted", or none.
    pub brows: Option<String>,
    /// Garment ids that are worn; empty = nude.
    pub outfit: Vec<String>,
    /// Garment colours by garment id (sRGB hex).
    pub garment_colors: IndexMap<String, String>,
    /// Genital mesh / detail. Adults only: off whenever `youth` > 0.
    pub anatomy: bool,
    /// Clip name, or none for the bind pose.
    pub animation: Option<String>,
    pub expression: String,
    pub expression_intensity: f64,
    pub blink: bool,
    /// Every face unit as its own GPU morph.
    pub face_rig: bool,
    /// Natural blinks, saccades, idle movement, lip-sync.
    pub face_animation: bool,
    pub gaze: Gaze,
    /// Expression wrinkles in the skin shader.
    pub wrinkles: bool,
    /// Blood flush, pores and the like in the skin shader.
    pub skin_detail: bool,
    /// 0 (dry) .. 1 (wet).
    pub skin_wetness: f64,
    /// Tuck covered skin and inner layers under garments.
    pub cloth_tuck: bool,
    /// Loose garments swing as the character moves.
    pub cloth_motion: bool,
    pub detail: Detail,
    /// A robot instead of a human: same skeleton and clips, drawn with plates.
    pub robot: bool,
    pub robot_look: RobotLook,
    /// A skeleton (undead) instead of a human. Ignored while `robot` is set.
    pub skeletal: bool,
    pub skeletal_look: SkeletalLook,
    /// A hero costume (cape, mask, belt, emblem) and finishes, on top of the outfit.
    pub costume: CostumeLook,
}

impl Default for CharacterConfig {
    fn default() -> Self {
        let d = data();
        Self {
            race: RaceId::Human,
            race2: None,
            race_mix: 0.0,
            race_size: 0.5,
            deform: None,
            youth: 0.0,
            body: HumanParams::default(),
            details: IndexMap::new(),
            shape: IndexMap::new(),
            skin: SkinKind::Photo,
            skin_tone: 0.3,
            skin_color: None,
            eyes: d.iris_presets.first().cloned().unwrap_or_else(|| "brown".into()),
            eye_color: None,
            eye_glow: 0.0,
            pupil: "round".into(),
            skin_pattern: "none".into(),
            pattern_strength: 0.6,
            pattern_color: None,
            seed: 0.5,
            hair: None,
            beard: "none".into(),
            stubble: 0.0,
            horns: "none".into(),
            horn_size: 0.7,
            horn_color: None,
            tusks: 0.0,
            tail: "none".into(),
            tail_length: 0.8,
            hair_color: None,
            brows: Some(d.painted_brows.clone()),
            outfit: Vec::new(),
            garment_colors: IndexMap::new(),
            anatomy: true,
            animation: Some("idle".into()),
            expression: "neutral".into(),
            expression_intensity: 0.8,
            blink: true,
            face_rig: false,
            face_animation: false,
            gaze: Gaze::Camera,
            wrinkles: false,
            skin_detail: true,
            skin_wetness: 0.0,
            cloth_tuck: true,
            cloth_motion: true,
            detail: Detail::High,
            robot: false,
            robot_look: RobotLook::default(),
            skeletal: false,
            skeletal_look: SkeletalLook::default(),
            costume: CostumeLook::default(),
        }
    }
}

impl CharacterConfig {
    /// The race settings of the body (for [`actors_human::Human::race`]).
    pub fn race_settings(&self) -> RaceSettings {
        RaceSettings {
            race: self.race,
            race2: self.race2,
            mix: self.race_mix,
            size: self.race_size,
            youth: (self.youth > 0.0).then_some(self.youth),
        }
    }
}

/// `config` kept to what the catalog offers: a race it lists (else its first), robots and
/// skeletons only when it has them, a robot or skeleton when it offers no living people, and only
/// the horns, tails, pupils and skin patterns its races have.
pub fn fit_config(catalog: &CharacterCatalog, config: &CharacterConfig) -> CharacterConfig {
    let mut c = config.clone();
    let has = |r: RaceId| catalog.offers_race(r);
    if !catalog.races.is_empty() && !has(c.race) {
        c.race = if has(RaceId::Human) { RaceId::Human } else { catalog.races[0].id };
    }
    if let Some(r2) = c.race2 {
        if !has(r2) {
            c.race2 = None;
            c.race_mix = 0.0;
        }
    }
    if catalog.robot.is_none() {
        c.robot = false;
    }
    if catalog.skeletal.is_none() {
        c.skeletal = false;
    }
    if catalog.people == Some(false) && !c.robot && !c.skeletal {
        if catalog.robot.is_some() {
            c.robot = true;
        } else if catalog.skeletal.is_some() {
            c.skeletal = true;
        }
    }
    let (horns, tails, pupils, patterns) = ([c.horns.clone()], [c.tail.clone()], [c.pupil.clone()], [c.skin_pattern.clone()]);
    let f = race_features(&catalog.races, &FeatureLists { horns: &horns, tails: &tails, pupils: &pupils, patterns: &patterns });
    if !f.horns.contains(&c.horns) {
        c.horns = "none".into();
        c.horn_color = None;
    }
    if !f.tails.contains(&c.tail) {
        c.tail = "none".into();
    }
    if !f.pupils.contains(&c.pupil) {
        c.pupil = "round".into();
    }
    if !f.patterns.contains(&c.skin_pattern) {
        c.skin_pattern = "none".into();
    }
    if !f.tusks {
        c.tusks = 0.0;
    }
    if !f.eye_glow {
        c.eye_glow = 0.0;
    }
    if let Some(hair_race) = c.hair.as_ref().and_then(|h| data().procedural_hair_race.get(h)) {
        if !catalog.races.is_empty() && !has(*hair_race) {
            c.hair = None;
        }
    }
    c
}

/// The default character of a catalog.
pub fn default_config(catalog: &CharacterCatalog) -> CharacterConfig {
    let d = data();
    fit_config(
        catalog,
        &CharacterConfig {
            skin: if catalog.photo_skin { SkinKind::Photo } else { SkinKind::Procedural },
            eyes: catalog.eyes.first().map_or_else(|| "brown".into(), |e| e.id.clone()),
            brows: Some(catalog.brows.first().map_or_else(|| d.painted_brows.clone(), |b| b.id.clone())),
            animation: catalog.animations.iter().any(|a| a.id == "idle").then(|| "idle".into()),
            ..CharacterConfig::default()
        },
    )
}

/// A config made valid the way the TypeScript `Character.set` does: an adult age, a wearable
/// outfit, the catalog's races and features, sane race settings, robot and skeleton exclusive,
/// known beard, horn and tail styles, values in range, and no anatomy for children.
pub fn sanitize_config(catalog: &CharacterCatalog, config: &CharacterConfig) -> CharacterConfig {
    let d = data();
    let mut c = config.clone();
    c.body.age_years = c.body.age_years.clamp(ADULT_MIN_AGE, MAX_AGE);
    c.robot_look = c.robot_look.sanitized();
    c.skeletal_look = c.skeletal_look.sanitized();
    c.costume = c.costume.sanitized();
    if c.robot {
        c.skeletal = false;
    }
    c.outfit = resolve_outfit(catalog, &c.outfit);
    let mut c = fit_config(catalog, &c);
    let race = c.race_settings().sanitized();
    c.race = race.race;
    c.race2 = race.race2;
    if race.race2.is_some() {
        c.race_mix = race.mix;
    }
    c.race_size = race.size;
    c.youth = race.youth.unwrap_or(0.0);
    // A child never shows anatomy.
    if c.youth > 0.0 {
        c.anatomy = false;
    }
    if !d.beard_styles.contains(&c.beard) {
        c.beard = "none".into();
    }
    if !d.horn_styles.contains(&c.horns) {
        c.horns = "none".into();
    }
    if !d.tail_styles.contains(&c.tail) {
        c.tail = "none".into();
    }
    let clamp01 = |v: f64| if v.is_finite() { v.clamp(0.0, 1.0) } else { 0.0 };
    c.horn_size = clamp01(c.horn_size);
    c.tusks = clamp01(c.tusks);
    c.tail_length = clamp01(c.tail_length);
    c.stubble = clamp01(c.stubble);
    c
}
