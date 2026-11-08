//! The face rig (each face unit as a sparse morph) against `ActorRuntime::surface_delta`, which
//! the golden test already compares with @actors/core.
//!
//! ```text
//! ACTORS_PACKS=apps/viewer/public/packs cargo test -p actors-human --test face_rig
//! ```
//! Skipped without the variable.

use actors_core::runtime::{face_space, follows_face};
use actors_core::{ActorRuntime, DirSource};
use actors_human::{Human, UnitWeights};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

fn packs() -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var_os("ACTORS_PACKS")?);
    let p = if p.is_absolute() { p } else { Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").join(p) };
    assert!(p.is_dir(), "ACTORS_PACKS names a missing folder: {}", p.display());
    Some(p)
}

/// Every face unit at once, to load their targets before timing the rig.
fn rt_units(human: &Human) -> UnitWeights {
    human.pack.face_units().iter().map(|u| (u.clone(), 1.0)).collect()
}

#[test]
fn face_rig_matches_surface_deltas() {
    let Some(packs) = packs() else { return };
    let mut rt = ActorRuntime::load(DirSource::new(&packs), "human/manifest.json").unwrap();
    let mut human = Human::for_runtime(&rt).unwrap();
    human.params.gender = 0.8;
    let names: Vec<String> = rt
        .manifest()
        .meshes
        .iter()
        .filter(|m| m.name == "body" || m.name == "eyes" || m.name == "eyelashes" || m.name == "teeth" || m.name.starts_with("brows"))
        .map(|m| m.name.clone())
        .collect();
    rt.load_meshes(&names).unwrap();
    let shape = human.evaluate(&mut rt, None).unwrap();
    let one: UnitWeights = rt_units(&human);
    rt.ensure_targets(human.face_weights(&one, 1.0).keys()).unwrap();
    let t0 = std::time::Instant::now();
    let rig = human.face_rig(&mut rt, &shape).unwrap();
    eprintln!("face rig: {} units, {:?}", rig.units.len(), t0.elapsed());
    assert!(rig.units.len() > 20, "{} units", rig.units.len());
    let only: HashSet<String> = rt.meshes().iter().filter(|m| follows_face(&m.def)).map(|m| m.def.name.clone()).collect();
    // Space name -> a mesh name whose surface_delta entry holds it.
    let mesh_of =
        |space: &str| rt.meshes().iter().find(|m| face_space(m) == space && only.contains(&m.def.name)).map(|m| m.def.name.clone());
    let mut checked = 0;
    for (u, unit) in rig.units.iter().enumerate().step_by(5) {
        let one: UnitWeights = [(unit.clone(), 1.0)].into_iter().collect();
        let full = rt.surface_delta(&shape, &human.face_weights(&one, 1.0), Some(&only)).unwrap();
        for (space, units) in &rig.spaces {
            let (fp, fnrm) = if space.is_empty() {
                (&full.positions, &full.normals)
            } else {
                let s = &full.meshes[&mesh_of(space).unwrap()];
                (&s.positions, &s.normals)
            };
            let count = fp.len() / 3;
            // Proxies: the rig moves them with their three base vertices; a refit also rescales
            // their offsets when the unit moves the proxy's scale references (the jaw for the
            // teeth, up to about a centimetre), which the rig leaves out, as in @actors/core.
            if space.starts_with("proxy:") {
                continue;
            }
            let tol = 2e-5;
            let mut seen = vec![false; count];
            if let Some(d) = &units[u] {
                for (k, &v) in d.vertices.iter().enumerate() {
                    let v = v as usize;
                    seen[v] = true;
                    for c in 0..3 {
                        assert!(
                            (d.positions[k * 3 + c] - fp[v * 3 + c]).abs() < tol,
                            "{unit} {space:?} v{v} position {} vs {}",
                            d.positions[k * 3 + c],
                            fp[v * 3 + c]
                        );
                        assert!((d.normals[k * 3 + c] - fnrm[v * 3 + c]).abs() < 2e-3, "{unit} {space:?} v{v} normal");
                    }
                    checked += 1;
                }
            }
            // Whatever the rig leaves out doesn't move.
            for v in (0..count).filter(|&v| !seen[v]) {
                for c in 0..3 {
                    assert!(fp[v * 3 + c].abs() < 1e-5, "{unit} {space:?} v{v} moves but is not in the rig");
                    assert!(fnrm[v * 3 + c].abs() < 2e-3, "{unit} {space:?} v{v} turns but is not in the rig");
                }
            }
        }
    }
    assert!(checked > 1000, "{checked} vertices checked");
}
