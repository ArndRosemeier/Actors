//! Compares the Rust runtime with reference results of the TypeScript runtime.
//!
//! The references are written by `rust/golden/dump.ts` for the cases in `rust/golden/cases.json`:
//!
//! ```text
//! npx tsx rust/golden/dump.ts apps/viewer/public/packs <golden dir>
//! ACTORS_PACKS=apps/viewer/public/packs ACTORS_GOLDEN=<golden dir> cargo test --manifest-path rust/Cargo.toml
//! ```
//!
//! Without both variables the test is skipped (it needs the generated packs).

use actors_core::lod::{lod_bone_map, lod_levels, merge_meshes};
use actors_core::{pose_world, ActorRuntime, DirSource, InPlace, Pose, RetargetOptions, Retargeter, ShapeOptions, Weights};
use indexmap::IndexMap;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    name: String,
    pack: String,
    weights: IndexMap<String, f64>,
    #[serde(default)]
    options: Option<ShapeOptions>,
    #[serde(default)]
    fit: Option<Vec<String>>,
    #[serde(default)]
    load: Vec<String>,
    #[serde(default)]
    skins: Vec<String>,
    #[serde(default)]
    clips: IndexMap<String, Vec<f64>>,
    #[serde(default)]
    surface_delta: Option<IndexMap<String, f64>>,
    #[serde(default)]
    merge: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct Entry {
    file: String,
    length: usize,
}

struct Golden {
    dir: PathBuf,
    index: HashMap<String, Entry>,
    failures: Vec<String>,
    checked: usize,
}

impl Golden {
    fn open(dir: PathBuf) -> Self {
        let index = serde_json::from_slice(&std::fs::read(dir.join("index.json")).expect("golden index")).unwrap();
        Self { dir, index, failures: Vec::new(), checked: 0 }
    }

    fn get(&self, name: &str) -> Vec<f32> {
        let e = self.index.get(name).unwrap_or_else(|| panic!("golden has no {name}"));
        let bytes = std::fs::read(self.dir.join(&e.file)).unwrap();
        let v: Vec<f32> = bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
        assert_eq!(v.len(), e.length);
        v
    }

    /// Element-wise comparison: |a - b| <= tol * max(1, |b|).
    fn close<T: Copy + Into<f64>>(&mut self, name: &str, actual: &[T], tol: f64) {
        let expected = self.get(name);
        self.checked += 1;
        if actual.len() != expected.len() {
            self.failures.push(format!("{name}: length {} != {}", actual.len(), expected.len()));
            return;
        }
        let mut worst = (0.0f64, 0usize);
        for (i, (a, b)) in actual.iter().zip(&expected).enumerate() {
            let (a, b) = ((*a).into(), *b as f64);
            let err = (a - b).abs() / b.abs().max(1.0);
            if err > worst.0 || err.is_nan() {
                worst = (err, i);
            }
        }
        if worst.0 > tol || worst.0.is_nan() {
            let i = worst.1;
            self.failures.push(format!("{name}: worst error {:.3e} at {i} ({} vs {})", worst.0, actual[i].into(), expected[i]));
        }
    }

    /// Quaternions (4 per entry) equal up to sign.
    fn quats(&mut self, name: &str, actual: &[f32], tol: f64) {
        let expected = self.get(name);
        self.checked += 1;
        if actual.len() != expected.len() {
            self.failures.push(format!("{name}: length {} != {}", actual.len(), expected.len()));
            return;
        }
        for (i, (a, b)) in actual.chunks_exact(4).zip(expected.chunks_exact(4)).enumerate() {
            let d: f64 = a.iter().zip(b).map(|(x, y)| *x as f64 * *y as f64).sum();
            if 1.0 - d.abs() > tol {
                self.failures.push(format!("{name}: quaternion {i} differs ({a:?} vs {b:?})"));
                return;
            }
        }
    }

    /// Skin influences: same weights per vertex, same joints where the weight matters.
    fn skin(&mut self, name: &str, joints: &[u16], weights: &[f32]) {
        let ej = self.get(&format!("{name}:joints"));
        let ew = self.get(&format!("{name}:weights"));
        self.checked += 1;
        if joints.len() != ej.len() {
            self.failures.push(format!("{name}: length {} != {}", joints.len(), ej.len()));
            return;
        }
        let mut bad = 0;
        for v in 0..joints.len() / 4 {
            // Compare as joint -> weight maps, so ties in either order agree.
            let mut a: Vec<(u16, f32)> = (0..4).map(|k| (joints[v * 4 + k], weights[v * 4 + k])).filter(|e| e.1 > 1e-4).collect();
            let mut b: Vec<(u16, f32)> = (0..4).map(|k| (ej[v * 4 + k] as u16, ew[v * 4 + k])).filter(|e| e.1 > 1e-4).collect();
            a.sort_by_key(|e| e.0);
            b.sort_by_key(|e| e.0);
            let same = a.len() == b.len() && a.iter().zip(&b).all(|(x, y)| x.0 == y.0 && (x.1 - y.1).abs() < 1e-4);
            if !same {
                bad += 1;
            }
        }
        // Near-ties of the 4th and 5th influence can swap with rounding.
        if bad * 1000 > joints.len() / 4 {
            self.failures.push(format!("{name}: {bad} of {} vertices have other influences", joints.len() / 4));
        }
    }
}

fn env_dir(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from).filter(|p| p.exists())
}

#[test]
fn matches_typescript_runtime() {
    let (Some(packs), Some(golden)) = (env_dir("ACTORS_PACKS"), env_dir("ACTORS_GOLDEN")) else {
        eprintln!("skipped: set ACTORS_PACKS and ACTORS_GOLDEN (see rust/golden/dump.ts)");
        return;
    };
    let cases_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../golden/cases.json");
    let cases: Vec<Case> = serde_json::from_slice(&std::fs::read(cases_path).unwrap()).unwrap();
    let mut failures = Vec::new();
    for c in cases {
        let mut g = Golden::open(golden.join(&c.name));
        let mut rt = ActorRuntime::load(DirSource::new(&packs), &format!("{}/manifest.json", c.pack)).unwrap();
        rt.load_meshes(&c.load).unwrap();
        let weights: Weights = c.weights.clone();
        let fit: Option<Vec<&str>> = c.fit.as_ref().map(|f| f.iter().map(String::as_str).collect());
        let t0 = std::time::Instant::now();
        let shape = rt.evaluate(&weights, c.options.as_ref(), fit.as_deref()).unwrap();
        eprintln!("{}: evaluate took {:?}", c.name, t0.elapsed());

        g.close("positions", &shape.positions, 1e-5);
        g.close("normals", &shape.normals, 1e-4);
        for (name, s) in &shape.proxies {
            g.close(&format!("proxy:{name}:positions"), &s.positions, 1e-5);
            g.close(&format!("proxy:{name}:normals"), &s.normals, 1e-4);
        }
        assert_eq!(
            shape.proxies.len(),
            g.index.keys().filter(|k| k.starts_with("proxy:") && k.ends_with(":positions")).count(),
            "{}: proxies",
            c.name
        );
        for (name, s) in &shape.meshes {
            g.close(&format!("mesh:{name}:positions"), &s.positions, 1e-5);
            g.close(&format!("mesh:{name}:normals"), &s.normals, 1e-4);
        }
        let sk = shape.skeleton.as_ref().unwrap();
        let flat3 = |v: &[[f64; 3]]| v.iter().flatten().copied().collect::<Vec<f64>>();
        g.close("skeleton:heads", &flat3(&sk.heads), 1e-5);
        g.close("skeleton:tails", &flat3(&sk.tails), 1e-5);
        g.close("skeleton:localPositions", &flat3(&sk.local_positions), 1e-5);
        let lr: Vec<f32> = sk.local_rotations.iter().flatten().map(|&x| x as f32).collect();
        g.quats("skeleton:localRotations", &lr, 1e-6);
        let wr: Vec<f64> = sk.world_rotations.iter().flatten().copied().collect();
        g.close("skeleton:worldRotations", &wr, 1e-5);

        for name in &c.skins {
            let m = rt.mesh(name).unwrap();
            g.close(&format!("skin:{name}:map"), &m.map.iter().map(|&x| x as f64).collect::<Vec<_>>(), 0.0);
            g.close(&format!("skin:{name}:indices"), &m.indices.iter().map(|&x| x as f64).collect::<Vec<_>>(), 0.0);
            g.close(&format!("skin:{name}:uv"), &m.uv, 1e-6);
            g.skin(&format!("skin:{name}"), m.joints.as_ref().unwrap(), m.weights.as_ref().unwrap());
        }

        for (clip, times) in &c.clips {
            let clip_data = rt.load_clip(clip).unwrap();
            for (mode, tag) in [(InPlace::Off, "false"), (InPlace::On, "true"), (InPlace::Drift, "drift")] {
                let opts = RetargetOptions { in_place: mode, ..Default::default() };
                let mut r = Retargeter::new(sk, clip_data.clone(), &opts).unwrap();
                let mut pose = Pose::new(sk.len(), 0);
                for t in times {
                    r.sample_into(*t, &mut pose);
                    let key = format!("clip:{clip}:{tag}:{}", js_number(*t));
                    g.quats(&format!("{key}:rotations"), &pose.rotations, 1e-6);
                    let root = [pose.root[0], pose.root[1], pose.root[2], pose.root_index as f32];
                    g.close(&format!("{key}:root"), &root, 1e-5);
                    let (mut rot, mut heads) = (vec![0.0; sk.len() * 4], vec![0.0; sk.len() * 3]);
                    pose_world(sk, &pose, &mut rot, &mut heads);
                    g.close(&format!("{key}:worldHeads"), &heads, 1e-5);
                }
                if mode == InPlace::Off {
                    g.close(&format!("clip:{clip}:travel"), &r.travel(), 1e-5);
                }
            }
        }

        if let Some(extra) = &c.surface_delta {
            rt.ensure_targets(extra.keys()).unwrap();
            let d = rt.surface_delta(&shape, extra, None).unwrap();
            g.close("delta:positions", &d.positions, 1e-5);
            g.close("delta:normals", &d.normals, 2e-4);
            for (name, s) in &d.meshes {
                g.close(&format!("delta:{name}:positions"), &s.positions, 1e-5);
                g.close(&format!("delta:{name}:normals"), &s.normals, 2e-4);
            }
        }

        if let Some(names) = &c.merge {
            let lods = lod_levels(rt.manifest());
            let map = lod_bone_map(rt.manifest().skeleton.as_ref().unwrap(), lods.last());
            let list: Vec<_> = names.iter().map(|n| (rt.mesh(n).unwrap(), None)).collect();
            let merged = merge_meshes(&list, map.as_deref());
            g.close("merge:indices", &merged.indices.iter().map(|&x| x as f64).collect::<Vec<_>>(), 0.0);
            g.close("merge:part", &merged.part.iter().map(|&x| x as f64).collect::<Vec<_>>(), 0.0);
            g.skin("merge", merged.joints.as_ref().unwrap(), merged.weights.as_ref().unwrap());
        }

        g.quats("bind:rotations", &Pose::bind(sk, None).rotations, 1e-6);
        eprintln!("{}: {} arrays checked, {} differ", c.name, g.checked, g.failures.len());
        failures.extend(g.failures.into_iter().map(|f| format!("{}: {f}", c.name)));
    }
    assert!(failures.is_empty(), "differences from the TypeScript runtime:\n{}", failures.join("\n"));
}

/// How JavaScript prints a number in a template string (enough for the case times).
fn js_number(t: f64) -> String {
    if t.fract() == 0.0 {
        format!("{}", t as i64)
    } else {
        format!("{t}")
    }
}
