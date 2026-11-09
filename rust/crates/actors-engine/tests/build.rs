//! Builds characters from the real packs (skipped without ACTORS_PACKS, see rust/README.md).

use actors_engine::{BuildOptions, CharacterBuilder};
use actors_generator::{AllowOptions, RandomOptions};
use engine::anim::sample_joint_matrices;
use std::path::{Path, PathBuf};

fn packs() -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var_os("ACTORS_PACKS")?);
    let p = if p.is_absolute() { p } else { Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").join(p) };
    assert!(p.is_dir(), "ACTORS_PACKS names a missing folder: {}", p.display());
    Some(p)
}

#[test]
fn builds_random_characters() {
    let Some(packs) = packs() else {
        eprintln!("skipped: set ACTORS_PACKS");
        return;
    };
    let mut b = CharacterBuilder::load(&packs).unwrap();
    for (seed, allow) in [(1, None), (2, Some("fantasy")), (3, Some("city")), (4, Some("fantasy"))] {
        if let Some(a) = allow {
            b.allow(&AllowOptions::preset(a).unwrap());
        }
        let config = b.random(seed, &RandomOptions { race: Some(actors_generator::RaceChoiceOption::Any), ..Default::default() });
        let t0 = std::time::Instant::now();
        let c = b.build(&config, &BuildOptions::default()).unwrap();
        let m = &c.model;
        eprintln!(
            "seed {seed}: {} {:?}, {:.2} m, meshes {:?}, clips {:?}, {:?}",
            c.config.race.as_str(),
            c.config.race2,
            c.height,
            c.meshes,
            m.clip_names().collect::<Vec<_>>(),
            t0.elapsed()
        );
        assert_eq!(m.meshes.len(), c.meshes.len());
        assert!(c.height > 0.5 && c.height < 4.0, "height {}", c.height);
        assert!(m.find_clip("idle").is_some());
        // Children never get anatomy.
        if c.config.youth > 0.0 {
            assert!(!c.meshes.iter().any(|n| n.starts_with("genitals")));
        }
        for mesh in &m.meshes {
            assert_eq!(mesh.positions.len(), mesh.joints.len());
            assert!(mesh.indices.iter().all(|&i| (i as usize) < mesh.positions.len()));
        }
        // The bind pose skins to the shaped mesh: bind matrices are the identity.
        let n = m.skeleton.joint_names.len();
        let mut global = vec![glam::Mat4::IDENTITY; n];
        for i in 0..n {
            let (t, r, s) = m.bind_local[i];
            let local = glam::Mat4::from_scale_rotation_translation(s, r, t);
            global[i] = m.skeleton.parents[i].map_or(local, |p| global[p] * local);
            let skin = global[i] * m.skeleton.inverse_bind[i];
            assert!(skin.abs_diff_eq(glam::Mat4::IDENTITY, 1e-4), "bone {i} bind {skin:?}");
        }
        // Clip frames stay near the body (no exploding bones).
        let idle = m.clips.iter().position(|c| c.name == "idle").unwrap();
        for mat in sample_joint_matrices(m, idle, 0.5) {
            assert!(mat.is_finite());
            assert!(mat.w_axis.truncate().length() < 3.0 * c.height);
        }
    }
}

#[test]
fn children_are_built_without_anatomy() {
    let Some(packs) = packs() else { return };
    let mut b = CharacterBuilder::load(&packs).unwrap();
    let mut config = b.default_config();
    config.body.gender = 1.0;
    config.anatomy = true;
    config.youth = 0.7;
    let c = b.build(&config, &BuildOptions { clips: vec!["idle".into()], ..Default::default() }).unwrap();
    assert!(!c.config.anatomy);
    assert!(!c.meshes.iter().any(|n| n.starts_with("genitals")));
    // The adult version of the same body does get it, so the check above means something.
    config.youth = 0.0;
    let adult = b.build(&config, &BuildOptions { clips: vec!["idle".into()], ..Default::default() }).unwrap();
    assert!(adult.meshes.iter().any(|n| n == "genitals-male"));
    assert!(adult.height > c.height);
}

#[test]
fn characters_stand_on_the_ground() {
    let Some(packs) = packs() else { return };
    let mut b = CharacterBuilder::load(&packs).unwrap();
    let c = b.build(&b.default_config(), &BuildOptions { clips: vec!["idle".into()], ..Default::default() }).unwrap();
    let low = c.model.meshes.iter().flat_map(|m| m.positions.iter().map(|p| p.y)).fold(f32::MAX, f32::min);
    assert!(low.abs() < 0.01, "lowest point at {low} m, expected the ground");
}

#[test]
fn race_patterns_and_eyes_are_baked() {
    let Some(packs) = packs() else { return };
    let mut b = CharacterBuilder::load(&packs).unwrap();
    let mut config = b.default_config();
    config.skin_pattern = "veins".into();
    config.pattern_strength = 1.0;
    config.eye_glow = 1.0;
    config.pupil = "slit".into();
    config.eye_color = Some("#40c040".into());
    let c = b.build(&config, &BuildOptions { clips: vec!["idle".into()], ..Default::default() }).unwrap();
    let mesh = |n: &str| &c.model.meshes[c.meshes.iter().position(|m| m == n).unwrap()];
    let body = mesh(&c.meshes[0]);
    assert_eq!(body.albedo.as_ref().map(|a| a.width), Some(1024), "patterned skin");
    assert!(body.maps.emissive.is_some(), "veins glow");
    assert!(mesh("eyes").maps.emissive.is_some(), "eyes glow");
    // Without a pattern the photo skin stays as it is.
    let plain = b.build(&b.default_config(), &BuildOptions { clips: vec!["idle".into()], ..Default::default() }).unwrap();
    assert!(plain.model.meshes[0].maps.emissive.is_none());
}

#[test]
fn stubble_is_painted_on_the_face() {
    let Some(packs) = packs() else { return };
    let mut b = CharacterBuilder::load(&packs).unwrap();
    let opts = BuildOptions { clips: vec!["idle".into()], ..Default::default() };
    let mut config = b.default_config();
    config.body.gender = 1.0;
    config.stubble = 1.0;
    let light = b.build(&config, &opts).unwrap();
    config.beard = "short".into();
    let painted = b.build(&config, &opts).unwrap();
    let (a, p) = (light.model.meshes[0].albedo.as_ref().unwrap(), painted.model.meshes[0].albedo.as_ref().unwrap());
    assert_eq!(a.width, 1024, "baked skin");
    assert!(light.model.meshes[0].maps.emissive.is_none());
    // The painted short beard is darker than plain stubble, on the face only.
    let (mut changed, mut darker) = (0usize, 0usize);
    for (x, y) in a.rgba.as_chunks::<4>().0.iter().zip(p.rgba.as_chunks::<4>().0) {
        if x != y {
            changed += 1;
            darker += usize::from(y[0] as u32 + y[1] as u32 + y[2] as u32 + 6 < x[0] as u32 + x[1] as u32 + x[2] as u32);
        }
    }
    let total = a.rgba.len() / 4;
    assert!(changed > 1000 && changed < total / 10, "{changed} of {total} texels changed");
    assert!(darker * 2 > changed, "{darker} of {changed} darker");
}

#[test]
fn animated_faces_are_morph_targets() {
    let Some(packs) = packs() else { return };
    let mut b = CharacterBuilder::load(&packs).unwrap();
    let opts = BuildOptions { clips: vec!["idle".into()], ..Default::default() };
    let mut config = b.default_config();
    config.face_animation = true;
    config.expression = "smile".into();
    let c = b.build(&config, &opts).unwrap();
    let face = c.face.as_ref().expect("a face");
    assert_eq!(c.model.morph_targets, face.units);
    assert!(face.units.len() > 20 && face.units.len() <= engine::anim::MAX_MORPH_TARGETS);
    let mesh = |n: &str| &c.model.meshes[c.meshes.iter().position(|m| m == n).unwrap()];
    // The body moves with every unit; lashes and brows follow the lids and brows.
    assert_eq!(mesh(&c.meshes[0]).morphs.len(), face.units.len());
    assert!(!mesh("eyelashes").morphs.is_empty());
    assert!(face.expression[face.unit("mouth-corner-puller").unwrap()] > 0.0, "smile as resting weights");
    // The engine takes it, and a driver blinks over the expression.
    engine::anim::Animator::new(std::sync::Arc::new(c.model.clone())).unwrap();
    let mut driver = actors_engine::FaceDriver::new(face, Default::default());
    let lid = face.unit("eye-left-closure").unwrap();
    let closed = (0..400).map(|_| driver.update(1.0 / 60.0)[lid]).fold(0.0f32, f32::max);
    assert!(closed > 0.5, "blinks: {closed}");
    // Without face animation the expression is baked and there are no morphs.
    config.face_animation = false;
    let baked = b.build(&config, &opts).unwrap();
    assert!(baked.face.is_none() && baked.model.morph_targets.is_empty());
}

#[test]
fn race_add_ons_are_built() {
    let Some(packs) = packs() else { return };
    let mut b = CharacterBuilder::load(&packs).unwrap();
    let mut config = b.default_config();
    config.horns = "ram".into();
    config.horn_size = 0.8;
    config.tusks = 0.6;
    config.beard = "full".into();
    config.tail = "reptile".into();
    config.tail_length = 0.7;
    let plain = b.build(&b.default_config(), &BuildOptions { clips: vec!["idle".into()], ..Default::default() }).unwrap();
    let c = b.build(&config, &BuildOptions { clips: vec!["idle".into()], ..Default::default() }).unwrap();
    // Beard, horns, tusks and tail are four more meshes, the tail six more bones.
    assert_eq!(c.model.meshes.len(), plain.model.meshes.len() + 4);
    let joints = c.model.skeleton.joint_names.len();
    assert_eq!(joints, plain.model.skeleton.joint_names.len() + 6);
    assert!(c.model.skeleton.joint_names.iter().any(|n| n == "tail_06"));
    assert!(c.model.clips.iter().all(|clip| clip.channels.len() == joints));
    // The tail sways: its bones have rotation tracks that move.
    let tip = c.model.skeleton.joint_names.iter().position(|n| n == "tail_06").unwrap();
    for clip in &c.model.clips {
        let track = clip.channels[tip].rotation.as_ref().expect("tail sway track");
        let (first, mid) = (track.values[0], track.values[track.values.len() / 4]);
        assert!(first.angle_between(mid) > 0.02, "tail moves in {}", clip.name);
    }
    assert!(c.model.meshes.iter().flat_map(|m| m.joints.iter()).flatten().all(|&j| (j as usize) < joints));
}

#[test]
fn costumes_are_built_and_capes_swing() {
    let Some(packs) = packs() else { return };
    let mut b = CharacterBuilder::load(&packs).unwrap();
    let mut config = b.default_config();
    config.hair = b.catalog().hair.first().map(|h| h.id.clone());
    let c = &mut config.costume;
    c.cape = "classic".into();
    c.collar = "standing".into();
    c.mask = "cowl".into();
    c.belt = "utility".into();
    c.emblem = "shield".into();
    c.symbol = "bolt".into();
    let clips = BuildOptions { clips: vec!["idle".into(), "walk".into(), "sprint".into()], ..Default::default() };
    let plain = b.build(&b.default_config(), &clips).unwrap();
    let t = std::time::Instant::now();
    let hero = b.build(&config, &clips).unwrap();
    eprintln!("costumed build: {:?}", t.elapsed());
    for part in ["cape", "cape-lining", "mask", "belt", "buckle", "emblem", "emblem-rim"] {
        assert!(hero.meshes.iter().any(|m| m == part), "{part} is drawn");
    }
    // The cowl covers the hair.
    assert!(config.hair.as_ref().is_none_or(|h| !hero.meshes.contains(h)));
    let joints = hero.model.skeleton.joint_names.len();
    assert_eq!(joints, plain.model.skeleton.joint_names.len() + 15);
    let rig = hero.cape.as_ref().expect("cape rig");
    assert_eq!(rig.chains.len(), 3);
    let name = |n: &str| hero.model.skeleton.joint_names.iter().position(|x| x == n).unwrap();
    let (hem, pelvis) = (name("cape_c_5"), name("pelvis"));
    let at = |clip: usize, time: f32, j: usize| {
        let m = sample_joint_matrices(&hero.model, clip, time)[j] * hero.model.skeleton.inverse_bind[j].inverse();
        m.w_axis.truncate()
    };
    let mut swing = Vec::new();
    for (ci, clip) in hero.model.clips.iter().enumerate() {
        let n = 24;
        let pts: Vec<_> = (0..=n).map(|i| at(ci, clip.duration * i as f32 / n as f32, hem)).collect();
        let pel: Vec<_> = (0..=n).map(|i| at(ci, clip.duration * i as f32 / n as f32, pelvis)).collect();
        if std::env::var_os("CAPE_DEBUG").is_some() {
            for (h, p) in pts.iter().zip(&pel) {
                eprintln!("  hem {:.2} {:.2} {:.2}  pelvis {:.2} {:.2} {:.2}", h.x, h.y, h.z, p.x, p.y, p.z);
            }
        }
        let range = pts.iter().map(|p| p.distance(pts[0])).fold(0.0f32, f32::max);
        let behind = pts.iter().zip(&pel).map(|(h, p)| p.z - h.z).fold(f32::INFINITY, f32::min);
        let lift = pts.iter().zip(&pel).map(|(h, p)| h.y - p.y).sum::<f32>() / pts.len() as f32;
        eprintln!("{}: hem moves {range:.3} m, stays {behind:.3} m behind the hips, {lift:.3} m above them", clip.name);
        // The loop closes: the hem is where it started.
        assert!(pts[0].distance(pts[n]) < 0.03, "{} loops", clip.name);
        assert!(behind > 0.02, "the cape stays behind the body in {}", clip.name);
        swing.push((range, lift));
    }
    // It swings more in a sprint than standing, and the wind lifts it.
    assert!(swing[2].0 > swing[0].0);
    assert!(swing[2].1 > swing[0].1 + 0.05);
}

#[test]
fn robots_are_built_and_stand_on_their_soles() {
    let Some(packs) = packs() else {
        eprintln!("skipped: set ACTORS_PACKS");
        return;
    };
    let mut b = CharacterBuilder::load(&packs).unwrap();
    assert!(b.catalog().robot.is_some(), "robots are offered");
    let mut config = b.default_config();
    config.robot = true;
    config.robot_look.head = "optics".into();
    config.robot_look.glow = "#ff4020".into();
    let c = b.build(&config, &BuildOptions::default()).unwrap();
    assert_eq!(c.meshes, ["robot-frame", "robot-plate", "robot-trim", "robot-joint", "robot-glow"]);
    let low = c.model.meshes.iter().flat_map(|m| m.positions.iter()).fold(f32::MAX, |l, p| l.min(p.y));
    assert!(low.abs() < 1e-3, "soles at {low}");
    assert!(c.face.is_none() && c.model.find_clip("walk").is_some());
    // Lights glow in the look's colour, red here.
    let glow = c.model.meshes.last().unwrap();
    let e = glow.maps.emissive.as_ref().expect("an emissive map");
    assert!(e.rgba[0] > 200 && e.rgba[2] < 120, "glow {:?}", &e.rgba[..4]);
    // Humans still don't turn into robots on their own.
    let human = b.random(7, &RandomOptions::default());
    assert!(!human.robot);
}
