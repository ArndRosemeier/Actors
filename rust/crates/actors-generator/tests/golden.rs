//! Compares actors-generator with @actors/generator: the catalog of the human pack, the default
//! config, seeded random characters, allow and theme filters, outfit rules and height fits, for
//! the cases in `rust/golden/generator-cases.json`.
//!
//! ```text
//! npx tsx rust/golden/dump-generator.ts apps/viewer/public/packs <golden dir>
//! ACTORS_PACKS=apps/viewer/public/packs ACTORS_GOLDEN=<golden dir> cargo test -p actors-generator
//! ```
//! Skipped without both variables.

use actors_core::{ActorRuntime, DirSource};
use actors_generator::*;
use actors_human::{HumanPack, RaceId};
use indexmap::IndexMap;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// A folder named by an environment variable; a relative path is read from the repository root
/// (cargo runs tests in the crate folder). Panics when the variable names a missing folder.
fn env_dir(var: &str) -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var_os(var)?);
    let p = if p.is_absolute() { p } else { Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").join(p) };
    assert!(p.is_dir(), "{var} names a missing folder: {}", p.display());
    Some(p)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaseOptions {
    gender: Option<String>,
    #[serde(default)]
    animation: bool,
    race: Option<String>,
    outfit: Option<bool>,
    robot: Option<bool>,
    skeletal: Option<bool>,
}

#[derive(Deserialize)]
struct RandomCase {
    name: String,
    seed: f64,
    options: CaseOptions,
    allow: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cases {
    random: Vec<RandomCase>,
    random_count: usize,
    allows: IndexMap<String, AllowOptions>,
    themes: IndexMap<String, ThemeFilter>,
    outfits: Vec<Vec<String>>,
    heights: Vec<(f64, Option<HeightRange>)>,
}

/// Differences between two JSON values (numbers within a relative 1e-9), as "path: a vs b".
fn diff(path: &str, a: &Value, b: &Value, out: &mut Vec<String>) {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            if (x - y).abs() > 1e-9 * y.abs().max(1.0) {
                out.push(format!("{path}: {x} vs {y}"));
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                out.push(format!("{path}: {} items vs {}", x.len(), y.len()));
            }
            for (i, (u, v)) in x.iter().zip(y).enumerate() {
                diff(&format!("{path}[{i}]"), u, v, out);
            }
        }
        (Value::Object(x), Value::Object(y)) => {
            for (k, v) in y {
                match x.get(k) {
                    Some(u) => diff(&format!("{path}.{k}"), u, v, out),
                    None => out.push(format!("{path}.{k}: missing (TS has {v})")),
                }
            }
            for k in x.keys().filter(|k| !y.contains_key(*k)) {
                out.push(format!("{path}.{k}: extra ({})", x[k]));
            }
        }
        _ if a == b => {}
        _ => out.push(format!("{path}: {a} vs {b}")),
    }
}

fn summary(c: &CharacterCatalog) -> Value {
    let ids = |l: Vec<String>| json!(l);
    json!({
        "races": c.races.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
        "garments": ids(c.garments.iter().map(|g| g.id.clone()).collect()),
        "outfits": c.outfits.iter().map(|o| json!({ "id": o.id, "female": o.female })).collect::<Vec<_>>(),
        "hair": ids(c.hair.iter().map(|h| h.id.clone()).collect()),
        "robot": c.robot.is_some(),
        "skeletal": c.skeletal.is_some(),
        "people": c.people,
        "height": c.height,
    })
}

#[test]
fn matches_typescript_generator() {
    let (Some(packs), Some(golden)) = (env_dir("ACTORS_PACKS"), env_dir("ACTORS_GOLDEN")) else {
        eprintln!("skipped: set ACTORS_PACKS and ACTORS_GOLDEN (see rust/golden/dump-generator.ts)");
        return;
    };
    let expected: Value = serde_json::from_slice(&std::fs::read(golden.join("generator.json")).unwrap()).unwrap();
    let cases: Cases =
        serde_json::from_slice(&std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../golden/generator-cases.json")).unwrap())
            .unwrap();
    let rt = ActorRuntime::load(DirSource::new(&packs), "human/manifest.json").unwrap();
    let pack = HumanPack::new(rt.manifest()).unwrap();
    let catalog = build_catalog(rt.manifest(), &pack, rt.clip_defs(), None);
    let base = default_config(&catalog);
    let mut failures = Vec::new();
    diff("catalog", &serde_json::to_value(&catalog).unwrap(), &expected["catalog"], &mut failures);
    diff("default", &serde_json::to_value(&base).unwrap(), &expected["default"], &mut failures);

    let mut allows: IndexMap<String, AllowOptions> =
        tables().allow_presets.iter().map(|(k, v)| (k.clone(), v.clone())).chain(cases.allows.clone()).collect();
    allows.sort_by_cached_key(|k, _| (!tables().allow_presets.contains_key(k), cases.allows.get_index_of(k)));
    let mut random = Vec::new();
    let mut prev = base.clone();
    for i in 0..cases.random_count {
        let c = &cases.random[i % cases.random.len()];
        let cat = c.allow.as_ref().map_or_else(|| catalog.clone(), |a| allow_catalog(&catalog, &allows[a]));
        let options = RandomOptions {
            outfit: c.options.outfit,
            animation: c.options.animation,
            gender: c.options.gender.as_deref().map(|g| if g == "female" { Gender::Female } else { Gender::Male }),
            race: c.options.race.as_deref().map(|r| {
                if r == "any" {
                    RaceChoiceOption::Any
                } else {
                    RaceChoiceOption::Race(RaceId::parse(r).unwrap())
                }
            }),
            robot: c.options.robot,
            skeletal: c.options.skeletal,
        };
        prev = random_config(&cat, &prev, &options, &mut SeededRandom::new(c.seed * 1000.0 + i as f64));
        let before = failures.len();
        diff(&format!("random[{i}:{}]", c.name), &serde_json::to_value(&prev).unwrap(), &expected["random"][i]["config"], &mut failures);
        if failures.len() > before {
            // Later configs build on this one: carry on from the TypeScript config.
            prev = serde_json::from_value(expected["random"][i]["config"].clone()).unwrap();
        }
        random.push(prev.clone());
    }

    for (k, a) in &allows {
        let cat = allow_catalog(&catalog, a);
        diff(&format!("allowed.{k}"), &summary(&cat), &expected["allowed"][k], &mut failures);
        let fitted: Vec<Value> = random.iter().map(|c| serde_json::to_value(fit_config(&cat, c)).unwrap()).collect();
        diff(&format!("fitted.{k}"), &json!(fitted), &expected["fitted"][k], &mut failures);
    }
    for (k, f) in &cases.themes {
        diff(&format!("themed.{k}"), &summary(&filter_catalog(&catalog, f)), &expected["themed"][k], &mut failures);
    }
    for (i, o) in cases.outfits.iter().enumerate() {
        let resolved = resolve_outfit(&catalog, o);
        let got = json!({ "resolved": resolved, "concealed": concealed_garments(&catalog, &resolved) });
        diff(&format!("outfits[{i}]"), &got, &expected["outfits"][i], &mut failures);
    }
    for (i, (h, r)) in cases.heights.iter().enumerate() {
        diff(&format!("heights[{i}]"), &json!(height_fit(*h, r.as_ref())), &expected["heights"][i], &mut failures);
    }

    // A config survives a JSON round trip, and the TypeScript JSON reads back unchanged.
    for c in &random {
        let back: CharacterConfig = serde_json::from_value(serde_json::to_value(c).unwrap()).unwrap();
        assert_eq!(&back, c);
    }
    eprintln!(
        "generator: catalog, default, {} random configs, {} allow and {} theme filters; {} differences",
        random.len(),
        allows.len(),
        cases.themes.len(),
        failures.len()
    );
    failures.truncate(40);
    assert!(failures.is_empty(), "differences from @actors/generator:\n{}", failures.join("\n"));
}
