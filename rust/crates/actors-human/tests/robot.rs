//! Compares the robot parts (plates, frame, joints, head, lights) with @actors/human on the cases
//! in `rust/golden/robot-cases.json`.
//!
//! ```text
//! npx tsx rust/golden/dump-robot.ts apps/viewer/public/packs <golden dir>
//! ACTORS_PACKS=apps/viewer/public/packs ACTORS_GOLDEN=<golden dir> cargo test -p actors-human --test robot
//! ```
//! Skipped without both variables. The TypeScript builder keeps some values in 32-bit arrays and
//! this port computes in 64-bit, so a few normals differ in the fourth decimal.

use actors_core::{ActorRuntime, DirSource};
use actors_human::{build_robot, robot_body, Human, HumanParams, RobotConfig};
use serde::Deserialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
struct Case {
    name: String,
    #[serde(default)]
    params: serde_json::Map<String, Value>,
    robot: serde_json::Map<String, Value>,
}

fn env_dir(var: &str) -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var_os(var)?);
    let p = if p.is_absolute() { p } else { Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").join(p) };
    assert!(p.is_dir(), "{var} names a missing folder: {}", p.display());
    Some(p)
}

fn config(v: &serde_json::Map<String, Value>) -> RobotConfig {
    let d = RobotConfig::default();
    let s = |k: &str, x: &str| v.get(k).and_then(Value::as_str).unwrap_or(x).to_string();
    RobotConfig {
        head: s("head", &d.head),
        ears: s("ears", &d.ears),
        plating: s("plating", &d.plating),
        thickness: v.get("thickness").and_then(Value::as_f64).unwrap_or(d.thickness),
        core: v.get("core").and_then(Value::as_bool).unwrap_or(d.core),
    }
}

/// Values further apart than `tol`, as a failure line (None when all agree).
fn floats(what: &str, a: &[f32], e: &Value, tol: f64) -> Option<String> {
    let e: Vec<f64> = serde_json::from_value(e.clone()).unwrap();
    if a.len() != e.len() {
        return Some(format!("{what}: {} values, expected {}", a.len(), e.len()));
    }
    let bad: Vec<usize> = (0..a.len()).filter(|&i| (a[i] as f64 - e[i]).abs() > tol).collect();
    bad.first().map(|&i| format!("{what}: {} of {} differ, first at {i}: {} vs {}", bad.len(), a.len(), a[i], e[i]))
}

#[test]
fn matches_typescript_robots() {
    let (Some(packs), Some(golden)) = (env_dir("ACTORS_PACKS"), env_dir("ACTORS_GOLDEN")) else {
        eprintln!("skipped: set ACTORS_PACKS and ACTORS_GOLDEN (see rust/golden/dump-robot.ts)");
        return;
    };
    let mut rt = ActorRuntime::load(DirSource::new(&packs), "human/manifest.json").unwrap();
    rt.load_meshes(["body", "eyes"]).unwrap();
    let cases: Vec<Case> =
        serde_json::from_slice(&std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../golden/robot-cases.json")).unwrap())
            .unwrap();
    let results: Vec<Value> = serde_json::from_slice(&std::fs::read(golden.join("robot.json")).unwrap()).unwrap();
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
        let shape = h.evaluate(&mut rt, Some(&["body", "eyes"])).unwrap();
        let body = robot_body(&shape, rt.meshes()).expect("a skinned body with eyes");
        let built = build_robot(&body, &config(&c.robot));
        let n = &c.name;
        let lift = r["lift"].as_f64().unwrap();
        if (built.lift - lift).abs() > 1e-4 {
            failures.push(format!("{n}: lift {} vs {lift}", built.lift));
        }
        let expected = r["parts"].as_array().unwrap();
        let names: Vec<&str> = built.parts.iter().map(|p| p.name.as_str()).collect();
        let enames: Vec<&str> = expected.iter().map(|p| p["name"].as_str().unwrap()).collect();
        if names != enames {
            failures.push(format!("{n}: parts {names:?}, expected {enames:?}"));
            continue;
        }
        for (p, e) in built.parts.iter().zip(expected) {
            count += 1;
            let w = format!("{n}/{}", p.name);
            if serde_json::to_value(p.kind).unwrap() != e["kind"] {
                failures.push(format!("{w}: kind {:?} != {}", p.kind, e["kind"]));
            }
            for (k, a) in [
                ("indices", p.indices.iter().map(|&x| x as u64).collect::<Vec<_>>()),
                ("joints", p.joints.iter().map(|&x| x as u64).collect()),
            ] {
                let ev: Vec<u64> = serde_json::from_value(e[k].clone()).unwrap();
                if a != ev {
                    let first = a.iter().zip(&ev).position(|(x, y)| x != y);
                    failures.push(format!("{w}: {k} differ ({} vs {} values, first at {first:?})", a.len(), ev.len()));
                }
            }
            failures.extend(floats(&format!("{w} positions"), &p.positions, &e["positions"], 2e-5));
            failures.extend(floats(&format!("{w} normals"), &p.normals, &e["normals"], 1e-3));
            failures.extend(floats(&format!("{w} uvs"), &p.uvs, &e["uvs"], 2e-5));
            failures.extend(floats(&format!("{w} shade"), &p.shade, &e["shade"], 1e-5));
            failures.extend(floats(&format!("{w} weights"), &p.weights, &e["weights"], 1e-5));
        }
    }
    eprintln!("{} cases, {count} parts checked, {} differences", cases.len(), failures.len());
    assert!(failures.is_empty(), "differences from @actors/human:\n{}", failures.join("\n"));
}

/// Every part kind is built on a plain body and the robot stands on its soles.
#[test]
fn builds_every_part_kind() {
    let Some(packs) = env_dir("ACTORS_PACKS") else {
        eprintln!("skipped: set ACTORS_PACKS");
        return;
    };
    let mut rt = ActorRuntime::load(DirSource::new(&packs), "human/manifest.json").unwrap();
    rt.load_meshes(["body", "eyes"]).unwrap();
    let h = Human::for_runtime(&rt).unwrap();
    let shape = h.evaluate(&mut rt, Some(&["body", "eyes"])).unwrap();
    let body = robot_body(&shape, rt.meshes()).unwrap();
    let built = build_robot(&body, &RobotConfig::default());
    let names: Vec<&str> = built.parts.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(names, ["robot-frame", "robot-plate", "robot-trim", "robot-joint", "robot-visor", "robot-glow"]);
    assert!(built.lift > 0.0 && built.lift < 0.05, "soles {}", built.lift);
    for p in &built.parts {
        assert!(p.indices.iter().all(|&i| (i as usize) < p.positions.len() / 3), "{}", p.name);
        assert!(p.positions.iter().all(|x| x.is_finite()), "{}", p.name);
    }
}
