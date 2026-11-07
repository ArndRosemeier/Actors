//! Random characters ([`random_config`]), with the same random stream as the TypeScript
//! `randomConfig`: the same seed gives the same character in both.

use crate::catalog::{outfit_garments, CharacterCatalog, Choice};
use crate::config::{fit_config, CharacterConfig, RobotLook, SkeletalLook};
use crate::data::data;
use actors_human::{race_scale, HumanParams, RaceId, RaceSettings, RaceStyle, ADULT_MIN_AGE, MAX_AGE};
use indexmap::IndexMap;

/// A source of random numbers in [0, 1).
pub trait Random {
    fn next(&mut self) -> f64;
}

impl<F: FnMut() -> f64> Random for F {
    fn next(&mut self) -> f64 {
        self()
    }
}

/// Seeded PRNG (mulberry32), the same stream as `seededRandom` in TypeScript.
#[derive(Clone, Debug)]
pub struct SeededRandom(u32);

impl SeededRandom {
    /// `seed` is taken as JavaScript's `seed >>> 0` does (wrapping to 32 bits).
    pub fn new(seed: f64) -> Self {
        Self(js_u32(seed))
    }
}

impl Random for SeededRandom {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
}

/// JavaScript's `x >>> 0`.
fn js_u32(x: f64) -> u32 {
    if !x.is_finite() {
        return 0;
    }
    (x.trunc().rem_euclid(4294967296.0)) as u32
}

/// JavaScript's `Math.round` (halves go up).
pub(crate) fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

fn clamp01(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// An index into a list of `len`, consuming one number (as `list[Math.floor(r() * len)]`).
fn index(r: &mut dyn Random, len: usize) -> Option<usize> {
    let i = (r.next() * len as f64).floor() as usize;
    (i < len).then_some(i)
}

fn pick<'a, T>(r: &mut dyn Random, list: &'a [T]) -> Option<&'a T> {
    index(r, list.len()).map(|i| &list[i])
}

/// sRGB 0..1 -> "#rrggbb".
pub fn rgb_to_hex(c: [f64; 3]) -> String {
    let mut s = String::from("#");
    for v in c {
        s.push_str(&format!("{:02x}", js_round(clamp01(v) * 255.0) as u32));
    }
    s
}

fn weighted<'a, T>(list: &'a [(T, f64)], r: &mut dyn Random) -> &'a T {
    let total: f64 = list.iter().map(|(_, w)| w).sum();
    let mut x = r.next() * total;
    for (v, w) in list {
        x -= w;
        if x <= 0.0 {
            return v;
        }
    }
    &list[list.len() - 1].0
}

fn jitter(c: [f64; 3], amount: f64, r: &mut dyn Random) -> [f64; 3] {
    c.map(|v| clamp01(v + (r.next() - 0.5) * amount))
}

/// What [`random_race_look`] picks.
#[derive(Clone, Debug, PartialEq)]
pub struct RaceLook {
    pub height: f64,
    pub weight: f64,
    pub muscle: f64,
    pub proportions: f64,
    pub ethnic: [f64; 3],
    pub race_size: f64,
    pub skin_color: Option<String>,
    pub eye_color: String,
    pub eye_glow: f64,
    pub pupil: String,
    pub skin_pattern: String,
    pub pattern_strength: f64,
    pub pattern_color: String,
    pub hair: Option<String>,
    pub hair_color: String,
    pub brows: Option<String>,
}

/// A random look for a member of a race (or a mix of two): body ranges, ethnic base shape,
/// size, skin, eye and hair colour, hair style and eyebrows. Discrete choices come from either
/// parent race (by mix share), numbers are blended. Gender and age are given.
pub fn random_race_look(
    catalog: &CharacterCatalog,
    race: RaceId,
    race2: Option<RaceId>,
    mix: f64,
    body: &HumanParams,
    r: &mut dyn Random,
) -> RaceLook {
    let d = data();
    let a = race.style();
    let b = race2.map_or(a, |r2| r2.style());
    let t = if race2.is_some() { clamp01(mix) } else { 0.0 };
    let side = |r: &mut dyn Random| -> &'static RaceStyle {
        if r.next() < t {
            b
        } else {
            a
        }
    };
    let range = |key: [[f64; 2]; 2], r: &mut dyn Random| {
        let u = r.next();
        lerp(lerp(key[0][0], key[0][1], u), lerp(key[1][0], key[1][1], u), t)
    };
    let female = body.gender < 0.5;
    let size = r.next();
    let scale = race_scale(&RaceSettings { race, race2, mix: t, size, youth: None });
    let (lore, lore2) = (race.info().height_m, race2.unwrap_or(race).info().height_m);
    let h1 = lerp(lore[0], lore[1], r.next());
    let h2 = lerp(lore2[0], lore2[1], r.next());
    let target = lerp(h1, h2, t) * if female { 0.93 } else { 1.0 };
    let height = clamp01((target / scale - lerp(1.03, 1.17, body.gender)) / 1.08);
    let ethnic = *weighted(&side(r).ethnic, r);
    let skin_base = *weighted(&side(r).skin, r);
    let skin_rgb = jitter(skin_base, 0.05, r);
    let skin_color = if race == RaceId::Human && (race2.is_none() || t < 0.5) { None } else { Some(rgb_to_hex(skin_rgb)) };
    let pat_side = side(r);
    let pattern = weighted(&pat_side.pattern, r).clone();
    let accent_rgb = match &pat_side.accent {
        actors_human::races::Accent::Derived(k) if k == "darker" => skin_rgb.map(|v| v * 0.55),
        actors_human::races::Accent::Derived(k) if k == "lighter" => skin_rgb.map(|v| v + (1.0 - v) * 0.4),
        actors_human::races::Accent::Derived(_) => skin_rgb,
        actors_human::races::Accent::Palette(p) => {
            let c = *weighted(p, r);
            jitter(c, 0.04, r)
        }
    };
    let eyes_base = *weighted(&side(r).eyes, r);
    let eye_color = rgb_to_hex(jitter(eyes_base, 0.04, r));
    let hair_side = side(r);
    let mut hair = *weighted(&hair_side.hair, r);
    let age = body.age_years.max(ADULT_MIN_AGE);
    if age > 50.0 && r.next() < hair_side.greying * clamp01((age - 50.0) / 25.0) {
        let x = 0.62 + r.next() * 0.25;
        let y = 0.6 + r.next() * 0.25;
        let z = 0.58 + r.next() * 0.25;
        hair = [x, y, z];
    }
    let styles = if female { &side(r).hair_styles_female } else { &side(r).hair_styles_male };
    let style = weighted(styles, r);
    let empty = Vec::new();
    let meshes = d.hair_style_meshes.get(style).unwrap_or(&empty);
    let options: Vec<&Option<String>> =
        meshes.iter().filter(|m| m.as_ref().is_none_or(|m| catalog.hair.iter().any(|h| &h.id == m))).collect();
    let hair_mesh = if !meshes.is_empty() {
        if options.len() > 1 {
            index(r, options.len()).and_then(|i| options[i].clone())
        } else {
            options.first().and_then(|m| (*m).clone())
        }
    } else {
        catalog.hair.first().map(|h| h.id.clone())
    };
    let brow_style = weighted(&side(r).brow_styles, r);
    let brow = d
        .brow_style_meshes
        .get(brow_style)
        .and_then(|list| list.iter().find(|m| m.as_ref().is_none_or(|m| catalog.brows.iter().any(|b| &b.id == m))));
    let weight = range([a.weight, b.weight], r);
    let muscle = range([a.muscle, b.muscle], r);
    let proportions = range([a.proportions, b.proportions], r);
    let g1 = lerp(a.eye_glow[0], a.eye_glow[1], r.next());
    let g2 = lerp(b.eye_glow[0], b.eye_glow[1], r.next());
    let eye_glow = lerp(g1, g2, t);
    let pupil = weighted(&side(r).pupil, r).clone();
    let pattern_strength = lerp(pat_side.pattern_strength[0], pat_side.pattern_strength[1], r.next());
    let hair_color = rgb_to_hex(jitter(hair, 0.04, r));
    RaceLook {
        height,
        weight,
        muscle,
        proportions,
        ethnic,
        race_size: size,
        skin_color,
        eye_color,
        eye_glow,
        pupil,
        skin_pattern: pattern,
        pattern_strength,
        pattern_color: rgb_to_hex(accent_rgb),
        hair: hair_mesh,
        hair_color,
        brows: match brow {
            None => catalog.brows.first().map(|b| b.id.clone()),
            Some(m) => m.clone(),
        },
    }
}

/// What [`race_parts`] picks.
#[derive(Clone, Debug, PartialEq)]
pub struct RaceParts {
    pub beard: String,
    pub stubble: f64,
    pub horns: String,
    pub horn_size: f64,
    pub horn_color: Option<String>,
    pub tusks: f64,
    pub tail: String,
    pub tail_length: f64,
}

/// Random add-ons for a member of a race (or a mix): beard, horns, tusks and tail, from the
/// race's chances and ranges.
pub fn race_parts(race: RaceId, race2: Option<RaceId>, mix: f64, body: &HumanParams, r: &mut dyn Random) -> RaceParts {
    let a = race.style();
    let b = race2.map_or(a, |r2| r2.style());
    let t = if race2.is_some() { clamp01(mix) } else { 0.0 };
    let side = |r: &mut dyn Random| -> &'static RaceStyle {
        if r.next() < t {
            b
        } else {
            a
        }
    };
    let range = |k: [f64; 2], r: &mut dyn Random| lerp(k[0], k[1], r.next());
    let female = body.gender < 0.5;
    let bs = side(r);
    let beard_name = if r.next() < bs.beard_chance[usize::from(female)] { weighted(&bs.beard_styles, r).clone() } else { "none".into() };
    let beard = if data().beard_styles.contains(&beard_name) { beard_name.clone() } else { "none".to_string() };
    let u = r.next();
    let stubble = if beard_name == "stubble" {
        0.5 + u * 0.4
    } else if beard == "short" || beard == "goatee" || beard == "mustache" {
        0.3 + u * 0.3
    } else if !female && beard == "none" && u < 0.3 {
        0.25 + u * 1.5
    } else {
        0.0
    };
    let hs = side(r);
    let horns = weighted(&hs.horns, r).clone();
    let ts = side(r);
    let tusks = if r.next() < ts.tusk_chance { range(ts.tusks, r) } else { 0.0 };
    let tl = side(r);
    let tail = weighted(&tl.tail, r).clone();
    let horn_size = if horns == "none" { 0.7 } else { range(hs.horn_size, r) };
    let horn_color = if horns == "none" { None } else { Some(rgb_to_hex(*weighted(&hs.horn_colors, r))) };
    let tail_length = if tail == "none" { 0.8 } else { range(tl.tail_length, r) };
    RaceParts { beard, stubble, horns, horn_size, horn_color, tusks, tail, tail_length }
}

/// A random robot look (shape options, palette, light strength).
pub fn random_robot_look(r: &mut dyn Random) -> RobotLook {
    let d = data();
    let palette = &pick(r, &d.robot_palettes).unwrap_or(&d.robot_palettes[0]).look;
    let head = pick(r, &d.robot_heads).cloned().unwrap_or_default();
    let ears = pick(r, &d.robot_ears).cloned().unwrap_or_default();
    let plating = pick(r, &d.robot_plating).cloned().unwrap_or_default();
    let thickness = 0.2 + r.next() * 0.7;
    let core = r.next() < 0.6;
    let glow_strength = 0.4 + r.next() * 0.6;
    RobotLook {
        head,
        ears,
        plating,
        thickness,
        core,
        paint: palette.paint.clone(),
        trim: palette.trim.clone(),
        frame: palette.frame.clone(),
        metal: palette.metal.clone(),
        glow: palette.glow.clone(),
        glow_strength,
        finish: palette.finish.clone(),
    }
    .sanitized()
}

/// A random skeleton look (palette, wear, lost bones, lights).
pub fn random_skeletal_look(r: &mut dyn Random) -> SkeletalLook {
    let d = data();
    let palette = &pick(r, &d.skeletal_palettes).unwrap_or(&d.skeletal_palettes[0]).look;
    let robust = 0.2 + r.next() * 0.6;
    let wear = 0.15 + r.next() * 0.6;
    let missing = if r.next() < 0.5 { 0.0 } else { r.next() * 0.7 };
    let jaw = r.next() < 0.9;
    let eyes = r.next() < 0.75;
    let heart = r.next() < 0.2;
    let glow_strength = 0.4 + r.next() * 0.6;
    let mut look = SkeletalLook { robust, wear, missing, jaw, eyes, heart, glow_strength, ..SkeletalLook::default() };
    look.apply_palette(palette);
    look.sanitized()
}

/// Options of [`random_config`].
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RandomOptions {
    /// Also pick a random outfit preset (default true). False keeps the current outfit.
    pub outfit: Option<bool>,
    /// Also pick a random animation (default false).
    pub animation: bool,
    /// Restrict gender: "female", "male" (default: any).
    pub gender: Option<Gender>,
    /// Race of the new character (default: the base's race and mix).
    pub race: Option<RaceChoiceOption>,
    /// Make a robot (true), a human (false), or keep the base's kind (none).
    pub robot: Option<bool>,
    /// Make a skeleton (true), not one (false), or keep the base's kind (none).
    pub skeletal: Option<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gender {
    Female,
    Male,
}

/// A race for [`RandomOptions::race`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RaceChoiceOption {
    /// One of the catalog's races, at random.
    Any,
    Race(RaceId),
}

// Hairstyles that read as typical for either gender; the rest are picked for women only.
fn short_hair(id: &str) -> bool {
    id.contains("short") || id.contains("afro")
}

/// A random adult character based on `base` (its animation and, if asked, outfit are kept).
pub fn random_config(catalog: &CharacterCatalog, base: &CharacterConfig, options: &RandomOptions, r: &mut dyn Random) -> CharacterConfig {
    let d = data();
    let mid = |spread: f64, r: &mut dyn Random| 0.5 + (r.next() - 0.5) * spread;
    let mut skeletal =
        catalog.skeletal.is_some() && options.skeletal.unwrap_or(if options.robot == Some(true) { false } else { base.skeletal });
    let mut robot = catalog.robot.is_some() && !skeletal && options.robot.unwrap_or(base.robot);
    if catalog.people == Some(false) && !robot && !skeletal {
        if catalog.robot.is_some() && (catalog.skeletal.is_none() || r.next() < 0.5) {
            robot = true;
        } else {
            skeletal = catalog.skeletal.is_some();
        }
    }
    let female = match options.gender {
        Some(Gender::Female) => true,
        Some(Gender::Male) => false,
        None => r.next() < 0.5,
    };
    let eth = [r.next(), r.next() * 0.6, r.next() * 0.6];
    const ORDERS: [[usize; 3]; 3] = [[0, 1, 2], [1, 0, 2], [2, 1, 0]];
    let order = pick(r, &ORDERS).copied().unwrap_or(ORDERS[0]);
    let mut body = base.body;
    body.gender = if female { r.next() * 0.15 } else { 1.0 - r.next() * 0.15 };
    body.age_years = js_round(ADULT_MIN_AGE + r.next() * 55f64.min(MAX_AGE - ADULT_MIN_AGE));
    body.muscle = mid(0.9, r);
    body.weight = mid(0.9, r);
    body.height = mid(0.9, r);
    body.proportions = mid(0.8, r);
    body.cup_size = mid(0.9, r);
    body.firmness = mid(0.9, r);
    body.african = eth[order[0]];
    body.asian = eth[order[1]];
    body.caucasian = eth[order[2]];
    let mut details = IndexMap::new();
    for dc in &catalog.details {
        if r.next() < 0.15 {
            details.insert(dc.id.clone(), (r.next() - if dc.min < 0.0 { 0.5 } else { 0.0 }) * 0.8);
        }
    }
    let mut shape = IndexMap::new();
    for s in &actors_human::tables().shape_sliders {
        if r.next() < 0.5 {
            shape.insert(s.id.clone(), js_round((r.next() - 0.5) * 80.0) / 100.0);
        }
    }
    let hair_pool: Vec<&Choice> =
        catalog.hair.iter().filter(|h| !d.procedural_hair.contains_key(&h.id) && (female || short_hair(&h.id))).collect();
    let old = body.age_years > 60.0 && r.next() < 0.7;
    let gender = if female { "female" } else { "male" };
    let presets: Vec<_> = catalog.outfits.iter().filter(|o| o.gender.as_deref().is_none_or(|g| g == gender)).collect();
    let outfit_preset = if options.outfit == Some(false) {
        None
    } else if presets.is_empty() {
        pick(r, &catalog.outfits)
    } else {
        pick(r, &presets).copied()
    };
    let outfit = outfit_preset.map_or_else(|| base.outfit.clone(), |p| outfit_garments(p, &body));
    let mut garment_colors = IndexMap::new();
    if outfit_preset.is_some() {
        for g in &outfit {
            if r.next() < 0.5 {
                garment_colors.insert(g.clone(), pick(r, &catalog.garment_colors).map_or_else(|| "#808080".to_string(), |c| c.id.clone()));
            }
        }
    }
    let wanted = match options.race {
        Some(RaceChoiceOption::Any) => pick(r, &catalog.races).map_or(base.race, |c| c.id),
        Some(RaceChoiceOption::Race(id)) => id,
        None => base.race,
    };
    let race = if catalog.offers_race(wanted) || catalog.races.is_empty() { wanted } else { catalog.races[0].id };
    let race2 = if options.race.is_some() { None } else { base.race2 };
    let is_human = race == RaceId::Human && race2.is_none();
    let look = (!is_human).then(|| random_race_look(catalog, race, race2, base.race_mix, &body, r));
    if let Some(l) = &look {
        body.height = l.height;
        body.weight = l.weight;
        body.muscle = l.muscle;
        body.proportions = l.proportions;
        [body.african, body.asian, body.caucasian] = l.ethnic;
    }
    let eyes = pick(r, &catalog.eyes).map_or_else(|| base.eyes.clone(), |e| e.id.clone());
    let hair = if !female && r.next() < 0.12 { None } else { pick(r, &hair_pool).map(|h| h.id.clone()) };
    let hair_color = if old {
        Some("#9a968f".to_string())
    } else if r.next() < 0.4 {
        None
    } else {
        pick(r, &catalog.hair_colors).map(|c| c.id.clone())
    };
    let brows = pick(r, &catalog.brows).map_or_else(|| base.brows.clone(), |b| Some(b.id.clone()));
    let parts = race_parts(race, race2, base.race_mix, &body, r);
    let seed = r.next();
    let animation = if options.animation {
        let own: Vec<_> = catalog.animations.iter().filter(|a| a.library.is_empty()).collect();
        pick(r, &own).map_or_else(|| base.animation.clone(), |a| Some(a.id.clone()))
    } else {
        base.animation.clone()
    };
    let robot_look = if robot { random_robot_look(r) } else { base.robot_look.clone() };
    let skeletal_look = if skeletal { random_skeletal_look(r) } else { base.skeletal_look.clone() };
    let mut c = CharacterConfig {
        race,
        race2,
        race_size: look.as_ref().map_or(0.5, |l| l.race_size),
        body,
        details,
        shape,
        eyes,
        hair,
        hair_color,
        brows,
        skin_color: look.as_ref().and_then(|l| l.skin_color.clone()),
        eye_color: look.as_ref().map(|l| l.eye_color.clone()),
        eye_glow: look.as_ref().map_or(0.0, |l| l.eye_glow),
        pupil: look.as_ref().map_or_else(|| "round".into(), |l| l.pupil.clone()),
        skin_pattern: look.as_ref().map_or_else(|| "none".into(), |l| l.skin_pattern.clone()),
        pattern_strength: look.as_ref().map_or(base.pattern_strength, |l| l.pattern_strength),
        pattern_color: look.as_ref().map(|l| l.pattern_color.clone()),
        seed,
        beard: parts.beard,
        stubble: parts.stubble,
        horns: parts.horns,
        horn_size: parts.horn_size,
        horn_color: parts.horn_color,
        tusks: parts.tusks,
        tail: parts.tail,
        tail_length: parts.tail_length,
        outfit,
        garment_colors: match outfit_preset {
            Some(p) => {
                let mut m = p.colors.clone().unwrap_or_default();
                m.extend(garment_colors);
                m
            }
            None => base.garment_colors.clone(),
        },
        animation,
        robot,
        robot_look,
        skeletal,
        skeletal_look,
        ..base.clone()
    };
    if let Some(l) = look {
        c.hair = l.hair;
        c.hair_color = Some(l.hair_color);
        c.brows = l.brows;
    }
    fit_config(catalog, &c)
}
