//! Compares the race add-ons (horns, tusks, tails, beards, leaves, crest) with @actors/human on
//! the cases in `rust/golden/parts-cases.json`.
//!
//! ```text
//! npx tsx rust/golden/dump-parts.ts apps/viewer/public/packs <golden dir>
//! ACTORS_PACKS=apps/viewer/public/packs ACTORS_GOLDEN=<golden dir> cargo test -p actors-human --test parts
//! ```
//! Skipped without both variables.

use actors_core::{ActorRuntime, DirSource};
use actors_human::{Human, HumanParams, PartsConfig, RaceSettings};
use serde::Deserialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    name: String,
    #[serde(default)]
    params: serde_json::Map<String, Value>,
    #[serde(default)]
    race: Option<RaceSettings>,
    parts: serde_json::Map<String, Value>,
}

fn env_dir(var: &str) -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var_os(var)?);
    let p = if p.is_absolute() { p } else { Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").join(p) };
    assert!(p.is_dir(), "{var} names a missing folder: {}", p.display());
    Some(p)
}

fn config(v: &serde_json::Map<String, Value>) -> PartsConfig {
    let d = PartsConfig::default();
    let f = |k: &str, x: f64| v.get(k).and_then(Value::as_f64).unwrap_or(x);
    let s = |k: &str, x: &str| v.get(k).and_then(Value::as_str).unwrap_or(x).to_string();
    PartsConfig {
        seed: f("seed", d.seed),
        scale: 1.0,
        horns: s("horns", &d.horns),
        horn_size: f("hornSize", d.horn_size),
        horn_color: v.get("hornColor").map_or(d.horn_color, |c| serde_json::from_value(c.clone()).unwrap()),
        tusks: f("tusks", d.tusks),
        tail: s("tail", &d.tail),
        tail_length: f("tailLength", d.tail_length),
        beard: s("beard", &d.beard),
        hair: s("hair", &d.hair),
        costume: v.get("costume").map(|c| serde_json::from_value(c.clone()).unwrap()),
    }
}

fn floats(what: &str, a: &[f32], e: &Value, tol: f64, failures: &mut Vec<String>) {
    let e: Vec<f64> = serde_json::from_value(e.clone()).unwrap();
    if a.len() != e.len() {
        failures.push(format!("{what}: {} values, expected {}", a.len(), e.len()));
        return;
    }
    let bad: Vec<usize> = (0..a.len()).filter(|&i| (a[i] as f64 - e[i]).abs() > tol).collect();
    if let Some(&i) = bad.first() {
        failures.push(format!("{what}: {} of {} differ, first at {i}: {} vs {}", bad.len(), a.len(), a[i], e[i]));
    }
}

#[test]
fn matches_typescript_parts() {
    let (Some(packs), Some(golden)) = (env_dir("ACTORS_PACKS"), env_dir("ACTORS_GOLDEN")) else {
        eprintln!("skipped: set ACTORS_PACKS and ACTORS_GOLDEN (see rust/golden/dump-parts.ts)");
        return;
    };
    let mut rt = ActorRuntime::load(DirSource::new(&packs), "human/manifest.json").unwrap();
    rt.load_meshes(["body", "eyes"]).unwrap();
    let cases: Vec<Case> =
        serde_json::from_slice(&std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../golden/parts-cases.json")).unwrap())
            .unwrap();
    let results: Vec<Value> = serde_json::from_slice(&std::fs::read(golden.join("parts.json")).unwrap()).unwrap();
    let mut failures = Vec::new();
    let mut count = 0;
    for (c, r) in cases.iter().zip(&results) {
        assert_eq!(r["name"], c.name.as_str());
        let mut h = Human::for_runtime(&rt).unwrap();
        let mut p = serde_json::to_value(h.params).unwrap();
        for (k, v) in &c.params {
            p[k] = v.clone();
        }
        h.params = serde_json::from_value::<HumanParams>(p).unwrap();
        if let Some(race) = c.race {
            h.race = race;
        }
        let shape = h.evaluate(&mut rt, Some(&["body", "eyes"])).unwrap();
        let parts = h.parts(&mut rt, &shape, &config(&c.parts)).unwrap();
        let expected = r["parts"].as_array().unwrap();
        let n = &c.name;
        let names: Vec<&str> = parts.iter().map(|p| p.name.as_str()).collect();
        let enames: Vec<&str> = expected.iter().map(|p| p["name"].as_str().unwrap()).collect();
        if names != enames {
            failures.push(format!("{n}: parts {names:?}, expected {enames:?}"));
            continue;
        }
        for (p, e) in parts.iter().zip(expected) {
            count += 1;
            let w = format!("{n}/{}", p.name);
            if serde_json::to_value(p.kind).unwrap() != e["kind"] {
                failures.push(format!("{w}: kind {:?} != {}", p.kind, e["kind"]));
            }
            let ints = |a: Vec<u64>, k: &str, failures: &mut Vec<String>| {
                let ev: Vec<u64> = serde_json::from_value(e[k].clone()).unwrap();
                if a != ev {
                    let first = a.iter().zip(&ev).position(|(x, y)| x != y);
                    failures.push(format!("{w}: {k} differ ({} vs {} values, first at {first:?})", a.len(), ev.len()));
                }
            };
            ints(p.indices.iter().map(|&x| x as u64).collect(), "indices", &mut failures);
            ints(p.joints.iter().map(|&x| x as u64).collect(), "joints", &mut failures);
            ints(p.anchors.iter().map(|&x| x as u64).collect(), "anchors", &mut failures);
            floats(&format!("{w} positions"), &p.positions, &e["positions"], 2e-5, &mut failures);
            floats(&format!("{w} normals"), &p.normals, &e["normals"], 2e-4, &mut failures);
            floats(&format!("{w} uvs"), &p.uvs, &e["uvs"], 2e-5, &mut failures);
            floats(&format!("{w} shade"), &p.shade, &e["shade"], 1e-5, &mut failures);
            floats(&format!("{w} weights"), &p.weights, &e["weights"], 1e-5, &mut failures);
            let eb = e["bones"].as_array().unwrap();
            if eb.len() != p.bones.len()
                || p.bones.iter().zip(eb).any(|(b, x)| {
                    b.name != x["name"].as_str().unwrap()
                        || b.parent != x["parent"].as_str().unwrap()
                        || (0..3).any(|k| (b.head[k] as f64 - x["head"][k].as_f64().unwrap()).abs() > 2e-5)
                })
            {
                failures.push(format!("{w}: bones {:?} != {eb:?}", p.bones));
            }
            let ec: Option<[f64; 3]> = serde_json::from_value(e["color"].clone()).unwrap();
            if p.color.map(|c| c.map(|x| (x * 1e4).round())) != ec.map(|c| c.map(|x| (x as f32 * 1e4).round())) {
                failures.push(format!("{w}: color {:?} != {ec:?}", p.color));
            }
        }
    }
    eprintln!("{} cases, {count} parts checked, {} differences", cases.len(), failures.len());
    assert!(failures.is_empty(), "differences from @actors/human:\n{}", failures.join("\n"));
}
