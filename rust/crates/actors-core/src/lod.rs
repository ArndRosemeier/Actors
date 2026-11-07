//! Detail levels (LOD). Every level draws from the same [`ActorShape`], so morphs, garment
//! fitting and the skeleton carry over; a level only picks which meshes are drawn, with which
//! (reduced) triangles and which bones.

use crate::format::{ActorPackManifest, LodDef, MeshDef, SkeletonDef};
use crate::proxy::JointAcc;
use crate::runtime::{ActorShape, MeshData};

/// The pack's detail levels (a single full-detail level when it defines none).
pub fn lod_levels(manifest: &ActorPackManifest) -> Vec<LodDef> {
    match &manifest.lods {
        Some(l) if !l.is_empty() => l.clone(),
        _ => vec![LodDef { name: "Full".into(), distance: 0.0, bones: None, merge: false }],
    }
}

/// Whether a mesh is drawn at a detail level.
pub fn drawn_at(def: &MeshDef, level: usize) -> bool {
    def.lods.as_ref().is_none_or(|l| l.contains(&level))
}

/// The level to use at a camera distance (meters): the last level whose `distance` is reached.
pub fn lod_for_distance(lods: &[LodDef], distance: f32, bias: f32) -> usize {
    let mut level = 0;
    for (i, l) in lods.iter().enumerate() {
        if distance >= l.distance * bias {
            level = i;
        }
    }
    level
}

/// The triangle list of a mesh at a detail level (its closest simplified list at or below it).
pub fn lod_indices(mesh: &MeshData, level: usize) -> &[u32] {
    let mut best: &[u32] = &mesh.indices;
    let mut at = 0;
    for (l, indices) in &mesh.simplified {
        if *l <= level && *l > at {
            best = indices;
            at = *l;
        }
    }
    best
}

/// Per bone: the bone that drives it at a level (itself if kept, otherwise its closest kept
/// ancestor). `None` when the level keeps every bone.
pub fn lod_bone_map(skeleton: &SkeletonDef, lod: Option<&LodDef>) -> Option<Vec<u16>> {
    let keep = lod?.bones.as_ref()?;
    let mut map = vec![0u16; skeleton.bones.len()];
    for (i, b) in skeleton.bones.iter().enumerate() {
        map[i] = if b.parent < 0 || keep.contains(&b.name) { i as u16 } else { map[b.parent as usize] };
    }
    Some(map)
}

/// Moves skin influences to other bones (see [`lod_bone_map`]): merges duplicates, keeps the
/// top 4, renormalizes.
pub fn remap_skin(joints: &[u16], weights: &[f32], bone_map: &[u16]) -> (Vec<u16>, Vec<f32>) {
    let mut out_j = vec![0u16; joints.len()];
    let mut out_w = vec![0f32; weights.len()];
    let mut acc = JointAcc::default();
    for i in 0..joints.len() / 4 {
        acc.clear();
        for k in 0..4 {
            let w = weights[i * 4 + k];
            if w > 0.0 {
                let j = joints[i * 4 + k];
                acc.add(bone_map.get(j as usize).copied().unwrap_or(j), w as f64);
            }
        }
        acc.write_top4(false, &mut out_j[i * 4..i * 4 + 4], &mut out_w[i * 4..i * 4 + 4]);
    }
    (out_j, out_w)
}

/// A mesh cut down to the render vertices a triangle list uses. `vertices[i]` is the original
/// render vertex of vertex i; `map` still points at source vertices.
#[derive(Clone, Debug)]
pub struct CompactMesh {
    pub data: MeshData,
    pub vertices: Vec<u32>,
}

/// Standalone data for one mesh at a reduced triangle list: only the render vertices the
/// triangles use, skin moved to the level's bones.
pub fn compact_mesh(mesh: &MeshData, indices: &[u32], bone_map: Option<&[u16]>) -> CompactMesh {
    let mut remap = vec![u32::MAX; mesh.map.len()];
    let mut vertices = Vec::new();
    let out: Vec<u32> = indices
        .iter()
        .map(|&v| {
            let v = v as usize;
            if remap[v] == u32::MAX {
                remap[v] = vertices.len() as u32;
                vertices.push(v as u32);
            }
            remap[v]
        })
        .collect();
    fn pick<T: Copy>(src: &[T], vs: &[u32], size: usize) -> Vec<T> {
        vs.iter().flat_map(|&v| src[v as usize * size..v as usize * size + size].iter().copied()).collect()
    }
    let mut joints = mesh.joints.as_ref().map(|j| pick(j, &vertices, 4));
    let mut weights = mesh.weights.as_ref().map(|w| pick(w, &vertices, 4));
    if let (Some(j), Some(w), Some(map)) = (&joints, &weights, bone_map) {
        let (nj, nw) = remap_skin(j, w, map);
        joints = Some(nj);
        weights = Some(nw);
    }
    let data = MeshData {
        def: mesh.def.clone(),
        map: pick(&mesh.map, &vertices, 1),
        uv: pick(&mesh.uv, &vertices, 2),
        indices: out,
        joints,
        weights,
        hides_base_vertices: mesh.hides_base_vertices.clone(),
        clip: mesh.clip.as_ref().map(|c| pick(c, &vertices, 1)),
        stencil: mesh.stencil.clone(),
        dominant: mesh.dominant.clone(),
        simplified: Vec::new(),
        attributes: mesh
            .attributes
            .iter()
            .map(|(k, a)| (k.clone(), crate::runtime::Attribute { data: pick(&a.data, &vertices, a.size), size: a.size }))
            .collect(),
    };
    CompactMesh { data, vertices }
}

/// One part of a [`MergedMesh`].
#[derive(Clone, Debug)]
pub struct MergedPart {
    pub data: CompactMesh,
    pub offset: usize,
    pub count: usize,
}

/// Several meshes merged into one (a crowd actor's body and garments: one draw call).
#[derive(Clone, Debug)]
pub struct MergedMesh {
    pub parts: Vec<MergedPart>,
    pub vertex_count: usize,
    pub uv: Vec<f32>,
    pub indices: Vec<u32>,
    pub joints: Option<Vec<u16>>,
    pub weights: Option<Vec<f32>>,
    /// Per vertex: index into `parts`.
    pub part: Vec<u16>,
    /// Per vertex hem cut (1 for parts without one), when any part has one.
    pub clip: Option<Vec<f32>>,
}

/// Merges meshes, each with its own triangle list (default: its full list), into one vertex
/// and index buffer, skins moved to `bone_map`'s bones. Fill positions with [`fill_merged`].
pub fn merge_meshes(list: &[(&MeshData, Option<&[u32]>)], bone_map: Option<&[u16]>) -> MergedMesh {
    let parts: Vec<CompactMesh> = list.iter().map(|(d, ix)| compact_mesh(d, ix.unwrap_or(&d.indices), bone_map)).collect();
    let vertex_count: usize = parts.iter().map(|p| p.data.map.len()).sum();
    let skinned = parts.iter().all(|p| p.data.joints.is_some() && p.data.weights.is_some());
    let any_clip = parts.iter().any(|p| p.data.clip.is_some());
    let mut m = MergedMesh {
        parts: Vec::with_capacity(parts.len()),
        vertex_count,
        uv: Vec::with_capacity(vertex_count * 2),
        indices: Vec::new(),
        joints: skinned.then(|| Vec::with_capacity(vertex_count * 4)),
        weights: skinned.then(|| Vec::with_capacity(vertex_count * 4)),
        part: Vec::with_capacity(vertex_count),
        clip: any_clip.then(|| Vec::with_capacity(vertex_count)),
    };
    let mut offset = 0;
    for (k, p) in parts.into_iter().enumerate() {
        let count = p.data.map.len();
        m.uv.extend_from_slice(&p.data.uv);
        if let (Some(j), Some(w)) = (&mut m.joints, &mut m.weights) {
            j.extend_from_slice(p.data.joints.as_deref().unwrap_or_default());
            w.extend_from_slice(p.data.weights.as_deref().unwrap_or_default());
        }
        m.part.extend(std::iter::repeat_n(k as u16, count));
        if let Some(c) = &mut m.clip {
            match &p.data.clip {
                Some(pc) => c.extend_from_slice(pc),
                None => c.extend(std::iter::repeat_n(1.0, count)),
            }
        }
        m.indices.extend(p.data.indices.iter().map(|&i| i + offset as u32));
        m.parts.push(MergedPart { data: p, offset, count });
        offset += count;
    }
    m
}

/// Writes a shape's positions and normals into a merged mesh's vertex buffers (garments pushed
/// out by their `inflate`). Parts whose source the shape lacks are left as they are.
pub fn fill_merged(merged: &MergedMesh, shape: &ActorShape, positions: &mut [f32], normals: &mut [f32]) {
    for part in &merged.parts {
        let data = &part.data.data;
        let Some((sp, sn)) = shape.source_of(data) else { continue };
        let inflate = data.def.inflate.unwrap_or(0.0);
        for (i, &v) in data.map.iter().enumerate() {
            let (s, d) = (v as usize * 3, (part.offset + i) * 3);
            for c in 0..3 {
                positions[d + c] = sp[s + c] + sn[s + c] * inflate;
                normals[d + c] = sn[s + c];
            }
        }
    }
}
