//! Race shaping: extra target weights, typical features, bone proportions, head scale, ear tips
//! and overall scale, for one race or a blend of two.

use crate::data::data;
use crate::modifiers::add;
use crate::races::{bone_in_group, max_head_scale, RaceId, RaceStyle};
use actors_core::{BoneScale, ShapeOptions, TipDeform, Weights};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Which race a body has: one race, or two blended (half-elves, half-orcs...).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RaceSettings {
    pub race: RaceId,
    /// Second race for mixed heritage.
    pub race2: Option<RaceId>,
    /// 0..1 share of race2.
    pub mix: f64,
    /// 0..1 position in the race's size range (0.5 = typical).
    pub size: f64,
    /// 0 = grown up .. 1 = a child of about five.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub youth: Option<f64>,
}

impl Default for RaceSettings {
    fn default() -> Self {
        Self { race: RaceId::Human, race2: None, mix: 0.0, size: 0.5, youth: None }
    }
}

fn clamp(v: f64, a: f64, b: f64) -> f64 {
    if v.is_finite() {
        v.clamp(a, b)
    } else {
        a
    }
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

impl RaceSettings {
    pub fn sanitized(&self) -> Self {
        let race2 = self.race2.filter(|r| *r != self.race);
        let youth = clamp(self.youth.unwrap_or(0.0), 0.0, 1.0);
        Self {
            race: self.race,
            race2,
            mix: if race2.is_some() { clamp(self.mix, 0.0, 1.0) } else { 0.0 },
            size: clamp(self.size, 0.0, 1.0),
            youth: (youth > 0.0).then_some(youth),
        }
    }

    fn youth_value(&self) -> f64 {
        self.sanitized().youth.unwrap_or(0.0)
    }

    /// The two styles and the blend weight of the second.
    fn styles(&self) -> (&'static RaceStyle, &'static RaceStyle, f64) {
        let s = self.sanitized();
        let a = s.race.style();
        match s.race2 {
            Some(b) => (a, b.style(), s.mix),
            None => (a, a, 0.0),
        }
    }
}

const PAIRS: [(&str, &str); 5] = [("decr", "incr"), ("down", "up"), ("in", "out"), ("backward", "forward"), ("concave", "convex")];

/// Adds a bare target weight ("%" = both sides).
fn add_bare(out: &mut Weights, name: &str, w: f64) {
    if w == 0.0 {
        return;
    }
    if name.contains('%') {
        for s in ["l", "r"] {
            add(out, &name.replacen('%', s, 1), w);
        }
    } else {
        add(out, name, w);
    }
}

fn feature_weights(features: &IndexMap<String, f64>, out: &mut Weights, male: f64) {
    for (key, &v) in features {
        if v == 0.0 || v.is_nan() {
            continue;
        }
        if key == "earPoint" {
            if v > 0.0 {
                add_bare(out, "%-ear-shape-pointed", v.min(1.0));
            } else {
                add_bare(out, "%-ear-shape-round", -v);
            }
            continue;
        }
        if key == "headRound" {
            add_bare(out, if v > 0.0 { "head-round" } else { "head-rectangular" }, v.abs() * 0.8);
            continue;
        }
        if key == "chest" && male > 0.5 {
            add_bare(out, &format!("torso-muscle-pectoral-{}", if v < 0.0 { "decr" } else { "incr" }), (v * male).abs());
        }
        for (base, pair, gain) in data().feature_targets.get(key).map(Vec::as_slice).unwrap_or_default() {
            let s = v * gain;
            if s == 0.0 {
                continue;
            }
            let (neg, pos) = PAIRS[*pair];
            add_bare(out, &format!("{base}-{}", if s < 0.0 { neg } else { pos }), s.abs());
        }
    }
}

/// Opposing pairs (…-decr and …-incr both present) collapse into their net effect.
fn net_pairs(map: &mut Weights) {
    for (neg, pos) in PAIRS {
        let snapshot: Vec<(String, f64)> = map.iter().map(|(k, v)| (k.clone(), *v)).collect();
        for (name, w) in snapshot {
            let suffix = format!("-{neg}");
            if !name.ends_with(&suffix) || !map.contains_key(&name) {
                continue;
            }
            let other = format!("{}{pos}", &name[..name.len() - neg.len()]);
            let Some(&wo) = map.get(&other) else { continue };
            map.shift_remove(&name);
            map.shift_remove(&other);
            if wo > w {
                map.insert(other, wo - w);
            } else if w > wo {
                map.insert(name, w - wo);
            }
        }
    }
}

/// Race shaping as bare MakeHuman target names (before resolving them against a pack).
pub fn race_bare_target_weights(race: &RaceSettings, gender: f64) -> Weights {
    let (a, b, mix) = race.styles();
    let mut out = Weights::new();
    for (n, w) in &a.targets {
        add_bare(&mut out, n, w * (1.0 - mix));
    }
    if mix != 0.0 {
        for (n, w) in &b.targets {
            add_bare(&mut out, n, w * mix);
        }
    }
    let mut features: IndexMap<String, f64> = IndexMap::new();
    for k in a.face.keys().chain(b.face.keys()).chain(a.body.keys()).chain(b.body.keys()) {
        if !features.contains_key(k) {
            features.insert(k.clone(), lerp(a.feature(k), b.feature(k), mix));
        }
    }
    let y = race.youth_value();
    // The face turns young early; the build follows the size.
    if y != 0.0 {
        let youth = &data().youth;
        for (k, v) in &youth.face {
            *features.entry(k.clone()).or_insert(0.0) += v * (1.5 * y).min(1.0);
        }
        for (k, v) in &youth.body {
            *features.entry(k.clone()).or_insert(0.0) += v * y;
        }
    }
    feature_weights(&features, &mut out, gender);
    net_pairs(&mut out);
    out
}

/// Maps bare target names ("l-ear-wing-incr") to a pack's names ("ears/l-ear-wing-incr").
#[derive(Clone, Debug, Default)]
pub struct TargetResolver {
    map: HashMap<String, String>,
}

impl TargetResolver {
    pub fn new<'a>(names: impl IntoIterator<Item = &'a str>) -> Self {
        let mut map = HashMap::new();
        for n in names {
            let base = n.rsplit('/').next().unwrap_or(n);
            if !n.starts_with("macro/") && !map.contains_key(base) {
                map.insert(base.to_string(), n.to_string());
            }
        }
        Self { map }
    }

    pub fn resolve(&self, bare: &str) -> Option<&str> {
        self.map.get(bare).map(String::as_str)
    }
}

/// Race shaping as target weights of a pack (unknown targets are skipped).
pub fn race_target_weights(race: &RaceSettings, resolve: &TargetResolver, gender: f64, out: &mut Weights) {
    for (bare, w) in race_bare_target_weights(race, gender) {
        if let Some(name) = resolve.resolve(&bare) {
            add(out, name, w);
        }
    }
}

/// Overall scale of a race at its `size`.
pub fn race_scale(race: &RaceSettings) -> f64 {
    let s = race.sanitized();
    let (a, b, mix) = s.styles();
    lerp(lerp(a.scale[0], a.scale[1], s.size), lerp(b.scale[0], b.scale[1], s.size), mix) * lerp(1.0, data().youth.scale, s.youth_value())
}

/// Head scale relative to the body: the race's (capped), and a child's bigger head on top.
pub fn race_head_scale(race: &RaceSettings) -> f64 {
    let (a, b, mix) = race.styles();
    max_head_scale().min(lerp(a.head_scale, b.head_scale, mix)) * lerp(1.0, data().youth.head, race.youth_value())
}

fn scale_bones(bones: &mut HashMap<String, BoneScale>, group: &str, names: &[String], len: f64, girth: f64) {
    for name in names {
        if bone_in_group(group, name) {
            let b = bones.entry(name.clone()).or_insert(BoneScale { len: Some(1.0), girth: Some(1.0) });
            *b = BoneScale { len: Some(b.len() * len), girth: Some(b.girth() * girth) };
        }
    }
}

/// The race's proportion passes: bone scales, head scale, pointed ear tips and overall scale.
pub fn race_shape_options(race: &RaceSettings, bone_names: &[String], resolve: &TargetResolver) -> ShapeOptions {
    let (a, b, mix) = race.styles();
    let mut bones = HashMap::new();
    let mut groups: Vec<&String> = a.bones.keys().collect();
    groups.extend(b.bones.keys().filter(|k| !a.bones.contains_key(*k)));
    for g in groups {
        let (sa, sb) = (a.bones.get(g).copied().unwrap_or_default(), b.bones.get(g).copied().unwrap_or_default());
        scale_bones(&mut bones, g, bone_names, lerp(sa.len(), sb.len(), mix), lerp(sa.girth(), sb.girth(), mix));
    }
    let y = race.youth_value();
    if y != 0.0 {
        for (g, sc) in &data().youth.bones {
            scale_bones(&mut bones, g, bone_names, lerp(1.0, sc.len(), y), lerp(1.0, sc.girth(), y));
        }
    }
    let head = race_head_scale(race);
    if (head - 1.0).abs() > 1e-4 && bone_names.iter().any(|n| n == "head") {
        let h = bones.entry("head".to_string()).or_insert(BoneScale { len: Some(1.0), girth: Some(1.0) });
        *h = BoneScale { len: Some(h.len() * head), girth: Some(h.girth() * head) };
    }
    // Ear tips: stronger on races with pointed ears.
    let ear_point = lerp(a.feature_face("earPoint"), b.feature_face("earPoint"), mix);
    let tip = lerp(a.ear_tip, b.ear_tip, mix).max(0.0) * clamp(ear_point, 0.0, 1.3) + (ear_point - 0.6).max(0.0) * 0.8;
    let side = lerp(a.ear_sideways, b.ear_sideways, mix);
    let mut tips = Vec::new();
    if tip > 0.01 {
        let masks = &data().ear_masks;
        for (s, bare) in [(1.0, &masks.l), (-1.0, &masks.r)] {
            // Up and back for elves, out to the side for goblins (+Z is forward).
            if let Some(mask) = resolve.resolve(bare) {
                tips.push(TipDeform {
                    mask: mask.to_string(),
                    amount: 0.05 * tip,
                    direction: [s * (0.25 + 0.75 * side), 1.0 - 0.75 * side, -(0.55 - 0.35 * side)],
                });
            }
        }
    }
    ShapeOptions { bones, tips, scale: Some(race_scale(race)) }
}

impl RaceStyle {
    fn feature_face(&self, key: &str) -> f64 {
        self.face.get(key).copied().unwrap_or(0.0)
    }
}
