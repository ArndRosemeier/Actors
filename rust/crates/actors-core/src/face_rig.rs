//! Face rig: every face unit (brow raiser, lid closure, mouth corner puller ...) as its own
//! morph target, so a face can be animated by changing a few dozen weights per frame. Port of
//! `buildFaceRig` in `packages/core/src/faceRig.ts`, keeping the deltas sparse per vertex space
//! (the base mesh, each stencil mesh, each face proxy) instead of packing them into a texture.
//!
//! Works locally: a unit's targets move a few hundred vertices, so only those, the normals around
//! them and the stencil rows that read them are computed. The results match
//! [`ActorRuntime::surface_delta`] for the unit's targets alone.

use crate::runtime::{ActorRuntime, ActorShape, MeshData, Weights};
use crate::{Error, Result};
use indexmap::IndexMap;
use std::collections::HashSet;

/// The base mesh's vertex space (see [`crate::runtime::face_space`]).
pub const BASE_SPACE: &str = "";

/// Smallest delta kept (metres; normal deltas are unitless).
const EPS_POSITION: f32 = 2e-6;
const EPS_NORMAL: f32 = 2e-4;

/// What one unit does to one vertex space: the vertices it moves or whose normal it turns, with
/// their position and normal deltas (3 floats per vertex).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct UnitDelta {
    pub vertices: Vec<u32>,
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
}

/// The face rig of a shape.
#[derive(Clone, Debug, Default)]
pub struct FaceRig {
    /// Unit names, in order.
    pub units: Vec<String>,
    /// Per vertex space ([`BASE_SPACE`], a stencil mesh's name or "proxy:" and a proxy's name):
    /// each unit's deltas there (None where it moves nothing).
    pub spaces: IndexMap<String, Vec<Option<UnitDelta>>>,
}

/// Triangles around each vertex of a vertex space.
struct Topology {
    tris: Vec<u32>,
    ptr: Vec<u32>,
    list: Vec<u32>,
}

fn topology<'a>(count: usize, lists: impl IntoIterator<Item = (&'a [u32], &'a [u32])>) -> Topology {
    let mut tris = Vec::new();
    for (indices, map) in lists {
        tris.extend(indices.iter().map(|&i| map[i as usize]));
    }
    let mut ptr = vec![0u32; count + 1];
    for &t in &tris {
        ptr[t as usize + 1] += 1;
    }
    for v in 0..count {
        ptr[v + 1] += ptr[v];
    }
    let mut fill = ptr[..count].to_vec();
    let mut list = vec![0u32; tris.len()];
    for (i, &t) in tris.iter().enumerate() {
        list[fill[t as usize] as usize] = (i / 3) as u32;
        fill[t as usize] += 1;
    }
    Topology { tris, ptr, list }
}

/// A stencil as rows of weighted base vertices, and its transpose (the rows reading each base vertex).
struct Reads {
    row_ptr: Vec<u32>,
    cols: Vec<u32>,
    weights: Vec<f32>,
    by_base_ptr: Vec<u32>,
    by_base_rows: Vec<u32>,
}

impl Reads {
    fn new(rows: usize, row_ptr: Vec<u32>, cols: Vec<u32>, weights: Vec<f32>, base_count: usize) -> Self {
        let mut ptr = vec![0u32; base_count + 1];
        for &c in &cols {
            ptr[c as usize + 1] += 1;
        }
        for v in 0..base_count {
            ptr[v + 1] += ptr[v];
        }
        let mut fill = ptr[..base_count].to_vec();
        let mut by_rows = vec![0u32; cols.len()];
        for r in 0..rows {
            for k in row_ptr[r] as usize..row_ptr[r + 1] as usize {
                let c = cols[k] as usize;
                by_rows[fill[c] as usize] = r as u32;
                fill[c] += 1;
            }
        }
        Self { row_ptr, cols, weights, by_base_ptr: ptr, by_base_rows: by_rows }
    }
}

/// Smooth normal of vertex v (area-weighted face normals, normalized).
fn vertex_normal(p: &[f32], t: &Topology, v: usize) -> [f32; 3] {
    let (mut x, mut y, mut z) = (0f64, 0f64, 0f64);
    for k in t.ptr[v] as usize..t.ptr[v + 1] as usize {
        let f = t.list[k] as usize * 3;
        let (ia, ib, ic) = (t.tris[f] as usize, t.tris[f + 1] as usize, t.tris[f + 2] as usize);
        let q = |i: usize, c: usize| p[i * 3 + c] as f64;
        let (abx, aby, abz) = (q(ib, 0) - q(ia, 0), q(ib, 1) - q(ia, 1), q(ib, 2) - q(ia, 2));
        let (acx, acy, acz) = (q(ic, 0) - q(ia, 0), q(ic, 1) - q(ia, 1), q(ic, 2) - q(ia, 2));
        let (nx, ny, nz) = (aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx);
        // A triangle counts once per corner at v (as in compute_normals).
        let m = [ia, ib, ic].iter().filter(|&&c| c == v).count() as f64;
        x += nx * m;
        y += ny * m;
        z += nz * m;
    }
    let l = (x * x + y * y + z * z).sqrt();
    let l = if l == 0.0 { 1.0 } else { l };
    [(x / l) as f32, (y / l) as f32, (z / l) as f32]
}

struct Space<'a> {
    name: String,
    count: usize,
    topo: Topology,
    positions: &'a [f32],
    normals: &'a [f32],
    reads: Option<Reads>,
}

fn lists<'a>(meshes: impl IntoIterator<Item = &'a MeshData>) -> Vec<(&'a [u32], &'a [u32])> {
    meshes.into_iter().map(|m| (&m.indices[..], &m.map[..])).collect()
}

/// Builds a face rig on top of `shape`: `units` are pairs of a unit name and its pack target
/// weights. `spaces`: the vertex spaces to include besides the base mesh (stencil mesh names and
/// "proxy:" names); None: every stencil mesh of the shape and every face proxy. All weighted
/// targets must be loaded.
pub fn build_face_rig(
    rt: &ActorRuntime,
    shape: &ActorShape,
    units: &[(String, Weights)],
    spaces: Option<&HashSet<String>>,
) -> Result<FaceRig> {
    let base_count = shape.positions.len() / 3;
    let base_meshes = rt.meshes().iter().filter(|m| m.def.source == crate::format::MeshSource::Base && m.stencil.is_none());
    let mut all = vec![Space {
        name: BASE_SPACE.into(),
        count: base_count,
        topo: topology(base_count, lists(base_meshes)),
        positions: &shape.positions,
        normals: &shape.normals,
        reads: None,
    }];
    for m in rt.meshes() {
        let (Some(st), Some(cur)) = (&m.stencil, shape.meshes.get(&m.def.name)) else { continue };
        if spaces.is_some_and(|s| !s.contains(&m.def.name)) {
            continue;
        }
        all.push(Space {
            name: m.def.name.clone(),
            count: st.rows,
            topo: topology(st.rows, lists([m])),
            positions: &cur.positions,
            normals: &cur.normals,
            reads: Some(Reads::new(st.rows, st.row_ptr.clone(), st.cols.clone(), st.weights.clone(), base_count)),
        });
    }
    // Proxies on the face (teeth, tongue, brows): each vertex is a weighted sum of three base vertices.
    for (name, binding) in rt.proxies() {
        let space = format!("proxy:{name}");
        let Some(cur) = shape.proxies.get(name) else { continue };
        let users = rt.meshes().iter().filter(|m| m.def.source.proxy() == Some(name.as_str()));
        let wanted = match spaces {
            Some(s) => s.contains(&space),
            None => users.clone().any(|m| crate::runtime::follows_face(&m.def)),
        };
        if !wanted {
            continue;
        }
        let n = binding.def.vertex_count;
        let row_ptr = (0..=n as u32).map(|i| i * 3).collect();
        all.push(Space {
            name: space,
            count: n,
            topo: topology(n, lists(users)),
            positions: &cur.positions,
            normals: &cur.normals,
            reads: Some(Reads::new(n, row_ptr, binding.refs.clone(), binding.weights.clone(), base_count)),
        });
    }

    // Scratch per space: positions with one unit applied (restored after each unit), its position
    // deltas, and marks (the unit that last moved / touched a vertex).
    let mut scratch: Vec<Vec<f32>> = all.iter().map(|s| s.positions.to_vec()).collect();
    let mut delta: Vec<Vec<f32>> = all.iter().map(|s| vec![0.0; s.count * 3]).collect();
    let mut moved_by: Vec<Vec<i32>> = all.iter().map(|s| vec![-1; s.count]).collect();
    let mut touched_by: Vec<Vec<i32>> = all.iter().map(|s| vec![-1; s.count]).collect();
    let mut out: IndexMap<String, Vec<Option<UnitDelta>>> = all.iter().map(|s| (s.name.clone(), vec![None; units.len()])).collect();
    let small = |a: &[f32], o: usize, eps: f32| a[o].abs() <= eps && a[o + 1].abs() <= eps && a[o + 2].abs() <= eps;

    for (u, (_, weights)) in units.iter().enumerate() {
        let ui = u as i32;
        // Base vertices moved by the unit's targets.
        let mut base_moved: Vec<u32> = Vec::new();
        {
            let (d_b, m_b) = (&mut delta[0], &mut moved_by[0]);
            for (name, &w) in weights {
                if w == 0.0 || !w.is_finite() {
                    continue;
                }
                let t = rt.target(name).ok_or_else(|| Error::NotLoaded(format!("target {name}")))?;
                let k = w * t.scale as f64;
                for i in 0..t.count {
                    let v = t.indices.as_ref().map_or(i, |ix| ix[i] as usize);
                    if m_b[v] != ui {
                        m_b[v] = ui;
                        d_b[v * 3..v * 3 + 3].fill(0.0);
                        base_moved.push(v as u32);
                    }
                    for c in 0..3 {
                        d_b[v * 3 + c] = (d_b[v * 3 + c] as f64 + t.deltas[i * 3 + c] as f64 * k) as f32;
                    }
                }
            }
        }
        for si in 0..all.len() {
            let sp = &all[si];
            // Vertices of this space the unit moves, with their position deltas.
            let moved: Vec<u32> = match &sp.reads {
                None => base_moved.clone(),
                Some(st) => {
                    let mut moved = Vec::new();
                    // Stencil spaces come after the base (si >= 1).
                    let (d_head, d_tail) = delta.split_at_mut(si);
                    let (m_head, m_tail) = moved_by.split_at_mut(si);
                    let (base_d, base_m, rows_d, mv) = (&d_head[0], &m_head[0], &mut d_tail[0], &mut m_tail[0]);
                    for &v in &base_moved {
                        for k in st.by_base_ptr[v as usize] as usize..st.by_base_ptr[v as usize + 1] as usize {
                            let r = st.by_base_rows[k] as usize;
                            if mv[r] == ui {
                                continue;
                            }
                            mv[r] = ui;
                            moved.push(r as u32);
                            let (mut x, mut y, mut z) = (0f64, 0f64, 0f64);
                            for j in st.row_ptr[r] as usize..st.row_ptr[r + 1] as usize {
                                let b = st.cols[j] as usize;
                                if base_m[b] != ui {
                                    continue;
                                }
                                let w = st.weights[j] as f64;
                                x += base_d[b * 3] as f64 * w;
                                y += base_d[b * 3 + 1] as f64 * w;
                                z += base_d[b * 3 + 2] as f64 * w;
                            }
                            rows_d[r * 3] = x as f32;
                            rows_d[r * 3 + 1] = y as f32;
                            rows_d[r * 3 + 2] = z as f32;
                        }
                    }
                    moved
                }
            };
            if moved.is_empty() {
                continue;
            }
            let (p, d, mv, tc) = (&mut scratch[si], &delta[si], &moved_by[si], &mut touched_by[si]);
            for &v in &moved {
                let v = v as usize * 3;
                for c in 0..3 {
                    p[v + c] += d[v + c];
                }
            }
            // Vertices whose normal changes: the moved ones and their triangle neighbours.
            let mut res = UnitDelta::default();
            let mut keep = |v: usize, n: [f32; 3]| {
                let is_moved = mv[v] == ui;
                if n.iter().all(|c| c.abs() <= EPS_NORMAL) && (!is_moved || small(d, v * 3, EPS_POSITION)) {
                    return;
                }
                res.vertices.push(v as u32);
                if is_moved {
                    res.positions.extend_from_slice(&d[v * 3..v * 3 + 3]);
                } else {
                    res.positions.extend_from_slice(&[0.0; 3]);
                }
                res.normals.extend_from_slice(&n);
            };
            for &v in &moved {
                let v = v as usize;
                for k in sp.topo.ptr[v] as usize..sp.topo.ptr[v + 1] as usize {
                    let f = sp.topo.list[k] as usize * 3;
                    for c in 0..3 {
                        let x = sp.topo.tris[f + c] as usize;
                        if tc[x] == ui {
                            continue;
                        }
                        tc[x] = ui;
                        let n = vertex_normal(p, &sp.topo, x);
                        keep(x, [n[0] - sp.normals[x * 3], n[1] - sp.normals[x * 3 + 1], n[2] - sp.normals[x * 3 + 2]]);
                    }
                }
            }
            // A moved vertex outside every triangle still moves.
            for &v in &moved {
                if tc[v as usize] != ui {
                    keep(v as usize, [0.0; 3]);
                }
            }
            for &v in &moved {
                let v = v as usize * 3;
                p[v..v + 3].copy_from_slice(&sp.positions[v..v + 3]);
            }
            out[si][u] = Some(res);
        }
    }
    Ok(FaceRig { units: units.iter().map(|(n, _)| n.clone()).collect(), spaces: out })
}
