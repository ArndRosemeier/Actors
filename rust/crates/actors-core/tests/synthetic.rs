//! Runtime tests on a small pack built in memory (no generated packs needed).

use actors_core::format::*;
use actors_core::subdivide::{catmull_clark, SubdivFace};
use actors_core::*;

/// A unit cube (8 vertices, 6 quads as triangle pairs), two bones up its middle, one morph
/// target that moves the top up, and a one-vertex "garment" proxy bound to the top face.
fn cube_pack() -> MemSource {
    let positions: [f32; 24] = [
        -0.5, 0.0, -0.5, 0.5, 0.0, -0.5, 0.5, 0.0, 0.5, -0.5, 0.0, 0.5, //
        -0.5, 1.0, -0.5, 0.5, 1.0, -0.5, 0.5, 1.0, 0.5, -0.5, 1.0, 0.5,
    ];
    // Quads, outward winding.
    let quads: [[u32; 4]; 6] = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
    let mut indices = Vec::new();
    for [a, b, c, d] in quads {
        // Render vertices = shape vertices here (no seams).
        indices.extend_from_slice(&[a, b, c, a, c, d]);
    }
    let map: Vec<u32> = (0..8).collect();
    let uv: Vec<f32> = (0..16).map(|i| (i % 3) as f32 * 0.25).collect();
    let joints: Vec<u16> = (0..8).flat_map(|v| [if v < 4 { 0 } else { 1 }, 0, 0, 0]).collect();
    let weights: Vec<f32> = (0..8).flat_map(|_| [1.0, 0.0, 0.0, 0.0]).collect();

    let mut blob = Vec::new();
    let put = |bytes: Vec<u8>, count: usize, ty: ScalarType, blob: &mut Vec<u8>| {
        while !blob.len().is_multiple_of(4) {
            blob.push(0);
        }
        let r = BufferRef { offset: blob.len(), count, ty };
        blob.extend(bytes);
        r
    };
    let f32b = |v: &[f32]| v.iter().flat_map(|x| x.to_le_bytes()).collect::<Vec<u8>>();
    let u32b = |v: &[u32]| v.iter().flat_map(|x| x.to_le_bytes()).collect::<Vec<u8>>();
    let base = put(f32b(&positions), 24, ScalarType::F32, &mut blob);
    let r_map = put(u32b(&map), 8, ScalarType::U32, &mut blob);
    let r_uv = put(f32b(&uv), 16, ScalarType::F32, &mut blob);
    let r_idx = put(u32b(&indices), indices.len(), ScalarType::U32, &mut blob);
    let r_j = put(joints.iter().flat_map(|x| x.to_le_bytes()).collect(), 32, ScalarType::U16, &mut blob);
    let r_w = put(f32b(&weights), 32, ScalarType::F32, &mut blob);
    let p_refs = put(u32b(&[4, 5, 6]), 3, ScalarType::U32, &mut blob);
    let p_w = put(f32b(&[0.25, 0.25, 0.5]), 3, ScalarType::F32, &mut blob);
    let p_off = put(f32b(&[0.0, 0.1, 0.0]), 3, ScalarType::F32, &mut blob);
    let g_map = put(u32b(&[0, 0, 0]), 3, ScalarType::U32, &mut blob);
    let g_uv = put(f32b(&[0.0; 6]), 6, ScalarType::F32, &mut blob);
    let g_idx = put(u32b(&[0, 1, 2]), 3, ScalarType::U32, &mut blob);

    let mesh = |name: &str, source: MeshSource, role: MeshRole, m: BufferRef, u: BufferRef, i: BufferRef| MeshDef {
        name: name.into(),
        source,
        role,
        base_index: Some(m),
        uv: Some(u),
        indices: Some(i),
        subdivide: None,
        internal: false,
        material: MaterialHint { kind: MaterialKind::Skin, color: None, roughness: None },
        optional: false,
        hides_base_vertices: None,
        stencil: None,
        clip: None,
        inflate: None,
        slot: None,
        textures: None,
        tags: vec![],
        blob: None,
        lods: None,
        lod_of: None,
        simplified: vec![],
        attributes: None,
    };
    let mut sub = mesh("body-sub", MeshSource::Base, MeshRole::Body, r_map, r_uv, r_idx);
    sub.base_index = None;
    sub.uv = None;
    sub.indices = None;
    sub.subdivide = Some(SubdivideDef { source: "body".into() });
    let manifest = ActorPackManifest {
        format: "actors-pack".into(),
        version: 1,
        id: "cube".into(),
        species: "test".into(),
        units: "meters".into(),
        source: PackSourceInfo { name: "test".into(), license: "CC0".into(), url: String::new() },
        blob: "base.bin".into(),
        vertex_count: 8,
        base_positions: base,
        garment_vertex_of: None,
        meshes: vec![
            mesh("body", MeshSource::Base, MeshRole::Body, r_map, r_uv, r_idx),
            sub,
            mesh("cap", MeshSource::Proxy { proxy: "cap".into() }, MeshRole::Garment, g_map, g_uv, g_idx),
        ],
        proxies: vec![ProxyDef {
            name: "cap".into(),
            vertex_count: 1,
            refs: p_refs,
            weights: p_w,
            offsets: p_off,
            scale_refs: [[0.0, 1.0, 1.0], [0.0, 4.0, 1.0], [0.0, 3.0, 1.0]],
            leg_blend: None,
            blob: None,
        }],
        skeleton: Some(SkeletonDef {
            name: "test".into(),
            bones: vec![
                BoneDef {
                    name: "pelvis".into(),
                    parent: -1,
                    head: JointRef { vertices: vec![0, 1, 2, 3] },
                    tail: JointRef { vertices: vec![0, 1, 2, 3, 4, 5, 6, 7] },
                    roll: 0.0,
                },
                BoneDef {
                    name: "spine".into(),
                    parent: 0,
                    head: JointRef { vertices: vec![0, 1, 2, 3, 4, 5, 6, 7] },
                    tail: JointRef { vertices: vec![4, 5, 6, 7] },
                    roll: 0.0,
                },
            ],
        }),
        skin: Some(SkinDef { joints: r_j, weights: r_w }),
        targets: vec![TargetRef { name: "taller".into(), group: "test".into(), file: "targets/taller.bin".into(), count: 4 }],
        clips: vec![],
        clip_libraries: vec![],
        lods: None,
        extra: Default::default(),
    };
    let target = MorphTarget::encode(&[4, 5, 6, 7], &[0.0, 0.5, 0.0, 0.0, 0.5, 0.0, 0.0, 0.5, 0.0, 0.0, 0.5, 0.0], 8);
    let mut src = MemSource::new();
    src.insert("cube/manifest.json", serde_json::to_vec(&manifest).unwrap());
    src.insert("cube/base.bin", blob);
    src.insert("cube/targets/taller.bin", target);
    src
}

#[test]
fn evaluates_a_pack() {
    let mut rt = ActorRuntime::load(cube_pack(), "cube/manifest.json").unwrap();
    assert_eq!(rt.meshes().len(), 3);
    let sub = rt.mesh("body-sub").unwrap();
    // One Catmull-Clark level of a cube: 8 + 12 + 6 vertices, 24 quads.
    assert_eq!(sub.stencil.as_ref().unwrap().rows, 26);
    assert_eq!(sub.indices.len(), 24 * 6);

    let mut weights = Weights::new();
    weights.insert("taller".into(), 1.0);
    let shape = rt.evaluate(&weights, None, None).unwrap();
    // The top moved up by 0.5 (quantized to int16).
    assert!((shape.positions[4 * 3 + 1] - 1.5).abs() < 1e-4);
    // Top normals point up and out.
    assert!(shape.normals[4 * 3 + 1] > 0.5);
    let sk = shape.skeleton.as_ref().unwrap();
    assert!((sk.heads[1][1] - 0.75).abs() < 1e-5);
    assert!((sk.tails[1][1] - 1.5).abs() < 1e-5);
    // The proxy follows the top face, its offset scaled by the cube's new height (1.5).
    let cap = &shape.proxies["cap"].positions;
    assert!((cap[1] - (1.5 + 0.1 * 1.5)).abs() < 1e-4, "{cap:?}");
    assert!(shape.meshes.contains_key("body-sub"));

    // Fitting only the body skips the garment and the subdivided mesh.
    let shape = rt.evaluate(&weights, None, Some(&["body"])).unwrap();
    assert!(shape.proxies.is_empty() && shape.meshes.is_empty());

    // Bone scales: doubling the spine's length pushes the top further up.
    let mut options = ShapeOptions::default();
    options.bones.insert("spine".into(), BoneScale { len: Some(2.0), girth: None });
    let scaled = rt.evaluate(&weights, Some(&options), None).unwrap();
    assert!(scaled.positions[4 * 3 + 1] > 1.9, "{}", scaled.positions[4 * 3 + 1]);

    assert!(matches!(rt.evaluate_loaded(&[("nope".to_string(), 1.0)].into_iter().collect(), None, None), Err(Error::NotLoaded(_))));
    assert!(rt.ensure_targets(["nope"]).is_err());
}

#[test]
fn rejects_bad_data() {
    let src = cube_pack();
    let mut bad = src.clone();
    bad.insert("cube/base.bin", vec![0u8; 16]);
    assert!(ActorRuntime::load(bad, "cube/manifest.json").is_err());
    assert!(MorphTarget::decode(&[1, 2, 3]).is_err());
}

#[test]
fn target_round_trip() {
    let t = MorphTarget::decode(&MorphTarget::encode(&[2, 5], &[0.1, -0.2, 0.3, 0.0, 0.0, 1.0], 100)).unwrap();
    assert_eq!(t.indices.as_deref(), Some(&[2, 5][..]));
    let mut p = vec![0.0f32; 300];
    t.apply(&mut p, 2.0);
    assert!((p[6] - 0.2).abs() < 1e-4 && (p[7] + 0.4).abs() < 1e-4 && (p[17] - 2.0).abs() < 1e-4);
    // Dense when most vertices move.
    let dense = MorphTarget::decode(&MorphTarget::encode(&[0, 1], &[1.0; 6], 2)).unwrap();
    assert!(dense.indices.is_none());
}

#[test]
fn subdivision_weights_sum_to_one() {
    let faces = vec![
        SubdivFace { v: vec![0, 1, 2, 3], uv: vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]] },
        SubdivFace { v: vec![1, 4, 5, 2], uv: vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]] },
    ];
    let s = catmull_clark(&faces);
    assert_eq!(s.vertex_count, 6 + 7 + 2);
    for r in 0..s.vertex_count {
        let sum: f64 = s.weights[s.row_ptr[r] as usize..s.row_ptr[r + 1] as usize].iter().sum();
        assert!((sum - 1.0).abs() < 1e-9, "row {r}: {sum}");
    }
}

#[test]
fn pose_mixing() {
    let mut a = Pose::new(2, 0);
    let mut b = Pose::new(2, 0);
    // b: bone 0 turned 90° about Y, stored on the far hemisphere.
    let h = std::f32::consts::FRAC_1_SQRT_2;
    b.rotations[..4].copy_from_slice(&[0.0, -h, 0.0, -h]);
    b.root = [1.0, 0.0, 0.0];
    let mut out = Pose::new(2, 0);
    blend_poses(&a, &b, 0.5, &mut out, None);
    // Halfway: 45° about Y.
    let q = out.rotation(0);
    assert!((q[1] - (std::f32::consts::PI / 8.0).sin()).abs() < 1e-3, "{q:?}");
    assert!((out.root[0] - 0.5).abs() < 1e-6);

    let mut mixer = PoseMixer::new(2);
    mixer.begin().add(&a, 1.0, None).add(&b, 1.0, Some(&[1.0, 0.0]));
    a.rotations[4..].copy_from_slice(&[0.0, 0.0, 1.0, 0.0]);
    mixer.end(&mut out, Some(&a));
    assert!((out.rotation(0)[1] - (std::f32::consts::PI / 8.0).sin()).abs() < 1e-3);
    assert_eq!(mixer.weight(1), 1.0);
}
