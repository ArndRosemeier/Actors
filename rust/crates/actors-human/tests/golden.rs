//! Compares actors-human with @actors/human: target weights, shape options, face weights,
//! skins and deform plans for the cases in `rust/golden/human-cases.json`.
//!
//! ```text
//! npx tsx rust/golden/dump-human.ts apps/viewer/public/packs <golden dir>
//! ACTORS_PACKS=apps/viewer/public/packs ACTORS_GOLDEN=<golden dir> cargo test -p actors-human
//! ```
//! Skipped without both variables.

use actors_core::deform_recipe::{deform, BodyPart, DeformSpec};
use actors_core::{ActorPackManifest, Weights};
use actors_human::*;
use indexmap::IndexMap;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    name: String,
    #[serde(default)]
    params: serde_json::Map<String, Value>,
    #[serde(default)]
    modifiers: IndexMap<String, f64>,
    #[serde(default)]
    race: Option<RaceSettings>,
    #[serde(default)]
    shape: IndexMap<String, f64>,
    #[serde(default)]
    deform: Option<DeformSpec>,
    #[serde(default)]
    fit_scale: Option<f64>,
}

/// A folder named by an environment variable; a relative path is read from the repository root
/// (cargo runs tests in the crate folder). Panics when the variable names a missing folder, so a
/// typo can't skip the test unnoticed.
fn env_dir(var: &str) -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var_os(var)?);
    let p = if p.is_absolute() { p } else { Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").join(p) };
    assert!(p.is_dir(), "{var} names a missing folder: {}", p.display());
    Some(p)
}

fn near(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-9 * b.abs().max(1.0)
}

fn weights_match(what: &str, actual: &Weights, expected: &Value, failures: &mut Vec<String>) {
    let expected: Vec<(String, f64)> = serde_json::from_value(expected.clone()).unwrap();
    let exp: HashMap<&str, f64> = expected.iter().map(|(k, v)| (k.as_str(), *v)).collect();
    if actual.len() != exp.len() {
        let extra: Vec<_> = actual.keys().filter(|k| !exp.contains_key(k.as_str())).collect();
        let missing: Vec<_> = exp.keys().filter(|k| !actual.contains_key(**k)).collect();
        failures.push(format!("{what}: {} weights, expected {} (extra {extra:?}, missing {missing:?})", actual.len(), exp.len()));
        return;
    }
    for (k, v) in actual {
        match exp.get(k.as_str()) {
            Some(e) if near(*v, *e) => {}
            other => failures.push(format!("{what}: {k} = {v}, expected {other:?}")),
        }
    }
}

#[test]
fn matches_typescript_human() {
    let (Some(packs), Some(golden)) = (env_dir("ACTORS_PACKS"), env_dir("ACTORS_GOLDEN")) else {
        eprintln!("skipped: set ACTORS_PACKS and ACTORS_GOLDEN (see rust/golden/dump-human.ts)");
        return;
    };
    let manifest: ActorPackManifest = serde_json::from_slice(&std::fs::read(packs.join("human/manifest.json")).unwrap()).unwrap();
    let pack = HumanPack::new(&manifest).unwrap();
    let cases: Vec<Case> =
        serde_json::from_slice(&std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../golden/human-cases.json")).unwrap())
            .unwrap();
    let results: Vec<Value> = serde_json::from_slice(&std::fs::read(golden.join("human.json")).unwrap()).unwrap();
    let known: HashMap<String, f64> =
        pack.extra.modifiers.iter().map(|m| (m.id.clone(), if m.negative.is_empty() { 0.0 } else { -1.0 })).collect();
    let mut failures = Vec::new();
    for (c, r) in cases.iter().zip(&results) {
        assert_eq!(r["name"], c.name.as_str());
        let mut h = Human::new(pack.clone());
        let mut p = serde_json::to_value(h.params).unwrap();
        for (k, v) in &c.params {
            p[k] = v.clone();
        }
        h.params = serde_json::from_value(p).unwrap();
        h.modifier_values = shape_modifiers(&c.shape, &c.modifiers, Some(&known));
        if let Some(race) = c.race {
            h.race = race;
        }
        h.deform = c.deform.as_ref().map(deform);
        h.fit_scale = c.fit_scale.unwrap_or(1.0);
        let n = &c.name;

        let mods: IndexMap<String, f64> = serde_json::from_value(r["modifierValues"].clone()).unwrap();
        if mods.len() != h.modifier_values.len() || mods.iter().any(|(k, v)| !h.modifier_values.get(k).is_some_and(|x| near(*x, *v))) {
            failures.push(format!("{n}: modifier values {:?} != {mods:?}", h.modifier_values));
        }
        weights_match(&format!("{n} weights"), &h.target_weights().unwrap(), &r["weights"], &mut failures);

        let o = h.shape_options();
        let eo = &r["shapeOptions"];
        let ebones: HashMap<String, Value> = serde_json::from_value(eo["bones"].clone()).unwrap();
        if ebones.len() != o.bones.len() {
            failures.push(format!("{n}: {} bone scales, expected {}", o.bones.len(), ebones.len()));
        }
        for (b, s) in &o.bones {
            let e = &ebones.get(b).cloned().unwrap_or(Value::Null);
            let (el, eg) = (e["len"].as_f64().unwrap_or(1.0), e["girth"].as_f64().unwrap_or(1.0));
            if !near(s.len(), el) || !near(s.girth(), eg) {
                failures.push(format!("{n}: bone {b} {s:?}, expected {e}"));
            }
        }
        let etips = eo["tips"].as_array().unwrap();
        if etips.len() != o.tips.len() {
            failures.push(format!("{n}: {} tips, expected {}", o.tips.len(), etips.len()));
        }
        for (t, e) in o.tips.iter().zip(etips) {
            let dir: [f64; 3] = serde_json::from_value(e["direction"].clone()).unwrap();
            if t.mask != e["mask"].as_str().unwrap()
                || !near(t.amount, e["amount"].as_f64().unwrap())
                || (0..3).any(|k| !near(t.direction[k], dir[k]))
            {
                failures.push(format!("{n}: tip {t:?}, expected {e}"));
            }
        }
        if !near(o.scale.unwrap_or(1.0), eo["scale"].as_f64().unwrap_or(1.0)) {
            failures.push(format!("{n}: scale {:?}, expected {}", o.scale, eo["scale"]));
        }
        if !near(h.face_scale(), r["faceScale"].as_f64().unwrap()) {
            failures.push(format!("{n}: face scale {} != {}", h.face_scale(), r["faceScale"]));
        }
        weights_match(&format!("{n} smile"), &h.face_weights(expression("smile").unwrap(), 1.0), &r["smile"], &mut failures);
        weights_match(&format!("{n} blink"), &h.face_weights(blink(), 0.5), &r["blink"], &mut failures);

        let skins: Vec<(String, f64)> = r["skins"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| (s["file"].as_str().unwrap().to_string(), s["weight"].as_f64().unwrap()))
            .collect();
        let mine = h.skin_textures(4);
        if mine.len() != skins.len() || mine.iter().zip(&skins).any(|(a, b)| a.0 != b.0 || !near(a.1, b.1)) {
            failures.push(format!("{n}: skins {mine:?} != {skins:?}"));
        }
        let tone: Option<[f64; 3]> = serde_json::from_value(r["tone"].clone()).unwrap();
        if tone.map(|t| t.map(|x| (x * 1e9).round())) != h.skin_texture_tone(4).map(|t| t.map(|x| (x * 1e9).round())) {
            failures.push(format!("{n}: tone {:?} != {tone:?}", h.skin_texture_tone(4)));
        }
        let wr: [f64; 3] = serde_json::from_value(r["wrinkles"].clone()).unwrap();
        let mw = wrinkle_weights(expression("laugh").unwrap(), h.params.age_years);
        if (0..3).any(|k| !near(mw[k], wr[k])) {
            failures.push(format!("{n}: wrinkles {mw:?} != {wr:?}"));
        }
        if let (Some(d), Some(e)) = (&h.deform, r["deform"].as_object()) {
            let parts = &e["parts"];
            for (p, key) in [(BodyPart::Leg, "leg"), (BodyPart::Head, "head"), (BodyPart::Horn, "horn")] {
                let s = d.part(p);
                if !near(s.len, parts[key]["len"].as_f64().unwrap()) || !near(s.girth, parts[key]["girth"].as_f64().unwrap()) {
                    failures.push(format!("{n}: deform {key} {s:?} != {}", parts[key]));
                }
            }
            let skin = &e["skin"];
            if !near(d.skin.scars, skin["scars"].as_f64().unwrap())
                || !near(d.scale, e["scale"].as_f64().unwrap())
                || !near(d.gait.rate, e["gait"]["rate"].as_f64().unwrap())
            {
                failures.push(format!("{n}: deform plan {d:?} != {e:?}"));
            }
        }
    }
    eprintln!("{} human cases checked, {} differences", cases.len(), failures.len());
    assert!(failures.is_empty(), "differences from @actors/human:\n{}", failures.join("\n"));
}
