//! One level of Catmull-Clark subdivision, precomputed as a sparse linear "stencil": every new
//! vertex is a fixed weighted sum of original vertices, so subdivided positions = stencil x
//! morphed base positions and follow every morph exactly.

use crate::error::{Error, Result};
use indexmap::{IndexMap, IndexSet};

/// A sparse linear map (CSR): row r = sum over k in row_ptr[r]..row_ptr[r+1] of weights[k] * input[cols[k]].
#[derive(Clone, Debug, PartialEq)]
pub struct Stencil {
    pub rows: usize,
    pub row_ptr: Vec<u32>,
    pub cols: Vec<u32>,
    pub weights: Vec<f32>,
}

impl Stencil {
    /// Positions of a stencil mesh: out[r] = sum_k w_k * base[col_k] (3 floats per vertex).
    pub fn apply(&self, base: &[f32], out: &mut Vec<f32>) {
        out.resize(self.rows * 3, 0.0);
        for r in 0..self.rows {
            let (mut x, mut y, mut z) = (0.0f64, 0.0f64, 0.0f64);
            for k in self.row_ptr[r] as usize..self.row_ptr[r + 1] as usize {
                let c = self.cols[k] as usize * 3;
                let w = self.weights[k] as f64;
                x += base[c] as f64 * w;
                y += base[c + 1] as f64 * w;
                z += base[c + 2] as f64 * w;
            }
            out[r * 3] = x as f32;
            out[r * 3 + 1] = y as f32;
            out[r * 3 + 2] = z as f32;
        }
    }

    /// Per row: the column with the largest weight.
    pub fn dominant_columns(&self) -> Vec<u32> {
        (0..self.rows)
            .map(|r| {
                let (a, b) = (self.row_ptr[r] as usize, self.row_ptr[r + 1] as usize);
                let mut best = a;
                for k in a..b {
                    if self.weights[k] > self.weights[best] {
                        best = k;
                    }
                }
                self.cols.get(best).copied().unwrap_or(0)
            })
            .collect()
    }
}

/// A polygon of the input mesh: original vertex indices and per-corner UVs.
#[derive(Clone, Debug)]
pub struct SubdivFace {
    pub v: Vec<u32>,
    pub uv: Vec<[f64; 2]>,
}

#[derive(Clone, Debug)]
pub struct Subdivided {
    pub row_ptr: Vec<u32>,
    pub cols: Vec<u32>,
    pub weights: Vec<f64>,
    pub vertex_count: usize,
    pub quads: Vec<SubdivFace>,
}

type Combo = IndexMap<u32, f64>;

fn add_vertex(c: &mut Combo, v: u32, w: f64) {
    *c.entry(v).or_insert(0.0) += w;
}

fn add_combo(c: &mut Combo, src: &Combo, w: f64) {
    for (&k, &v) in src {
        *c.entry(k).or_insert(0.0) += v * w;
    }
}

fn edge_key(a: u32, b: u32) -> (u32, u32) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}

/// One Catmull-Clark level of a polygon mesh, as a stencil plus the new quads.
pub fn catmull_clark(faces: &[SubdivFace]) -> Subdivided {
    let mut edge_faces: IndexMap<(u32, u32), Vec<usize>> = IndexMap::new();
    let mut vert_faces: IndexMap<u32, Vec<usize>> = IndexMap::new();
    let mut vert_edges: IndexMap<u32, IndexSet<(u32, u32)>> = IndexMap::new();
    for (fi, f) in faces.iter().enumerate() {
        for (i, &v) in f.v.iter().enumerate() {
            let w = f.v[(i + 1) % f.v.len()];
            let k = edge_key(v, w);
            edge_faces.entry(k).or_default().push(fi);
            vert_faces.entry(v).or_default().push(fi);
            for x in [v, w] {
                vert_edges.entry(x).or_default().insert(k);
            }
        }
    }

    let face_point: Vec<Combo> = faces
        .iter()
        .map(|f| {
            let mut c = Combo::new();
            for &v in &f.v {
                add_vertex(&mut c, v, 1.0 / f.v.len() as f64);
            }
            c
        })
        .collect();

    let mut edge_point: IndexMap<(u32, u32), Combo> = IndexMap::with_capacity(edge_faces.len());
    let mut boundary: std::collections::HashSet<u32> = Default::default();
    for (&(a, b), fs) in &edge_faces {
        let mut c = Combo::new();
        if fs.len() == 2 {
            add_vertex(&mut c, a, 0.25);
            add_vertex(&mut c, b, 0.25);
            add_combo(&mut c, &face_point[fs[0]], 0.25);
            add_combo(&mut c, &face_point[fs[1]], 0.25);
        } else {
            add_vertex(&mut c, a, 0.5);
            add_vertex(&mut c, b, 0.5);
            boundary.insert(a);
            boundary.insert(b);
        }
        edge_point.insert((a, b), c);
    }

    let mut vertex_point: IndexMap<u32, Combo> = IndexMap::with_capacity(vert_edges.len());
    for (&v, edges) in &vert_edges {
        let mut c = Combo::new();
        if boundary.contains(&v) {
            // Boundary rule: (prev + 6v + next) / 8 along the boundary edges.
            add_vertex(&mut c, v, 6.0 / 8.0);
            for &(a, b) in edges.iter().filter(|k| edge_faces[*k].len() == 1).take(2) {
                add_vertex(&mut c, if a == v { b } else { a }, 1.0 / 8.0);
            }
        } else {
            let n = edges.len() as f64;
            let fs = &vert_faces[&v];
            for &fi in fs {
                add_combo(&mut c, &face_point[fi], 1.0 / (fs.len() as f64 * n));
            }
            for &(a, b) in edges {
                add_vertex(&mut c, a, 2.0 / (n * n) / 2.0);
                add_vertex(&mut c, b, 2.0 / (n * n) / 2.0);
            }
            add_vertex(&mut c, v, (n - 3.0) / n);
        }
        vertex_point.insert(v, c);
    }

    // Number the new vertices and emit the stencil.
    let mut v_index: std::collections::HashMap<u32, u32> = Default::default();
    let mut e_index: std::collections::HashMap<(u32, u32), u32> = Default::default();
    let mut rows: Vec<&Combo> = Vec::with_capacity(vertex_point.len() + edge_point.len() + face_point.len());
    for (&v, c) in &vertex_point {
        v_index.insert(v, rows.len() as u32);
        rows.push(c);
    }
    for (&k, c) in &edge_point {
        e_index.insert(k, rows.len() as u32);
        rows.push(c);
    }
    let f_index: Vec<u32> = face_point
        .iter()
        .map(|c| {
            rows.push(c);
            rows.len() as u32 - 1
        })
        .collect();

    let mut row_ptr = vec![0u32];
    let mut cols = Vec::new();
    let mut weights = Vec::new();
    for c in &rows {
        for (&k, &w) in c.iter() {
            if w.abs() < 1e-7 {
                continue;
            }
            cols.push(k);
            weights.push(w);
        }
        row_ptr.push(cols.len() as u32);
    }

    let mut quads = Vec::with_capacity(faces.len() * 4);
    for (fi, f) in faces.iter().enumerate() {
        let n = f.v.len();
        let mut fuv = [0.0, 0.0];
        for uv in &f.uv {
            fuv[0] += uv[0] / n as f64;
            fuv[1] += uv[1] / n as f64;
        }
        let mid = |i: usize| {
            let (a, b) = (f.uv[i], f.uv[(i + 1) % n]);
            [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]
        };
        for i in 0..n {
            let prev = (i + n - 1) % n;
            quads.push(SubdivFace {
                v: vec![v_index[&f.v[i]], e_index[&edge_key(f.v[i], f.v[(i + 1) % n])], f_index[fi], e_index[&edge_key(f.v[prev], f.v[i])]],
                uv: vec![f.uv[i], mid(i), fuv, mid(prev)],
            });
        }
    }

    Subdivided { row_ptr, cols, weights, vertex_count: rows.len(), quads }
}

/// A subdivided render mesh: vertices split at UV seams over the stencil's rows.
#[derive(Clone, Debug)]
pub struct SubdividedMesh {
    pub map: Vec<u32>,
    pub uv: Vec<f32>,
    pub indices: Vec<u32>,
    pub stencil: Stencil,
}

/// One Catmull-Clark level of a render mesh whose triangles come in quad pairs
/// (a, b, c), (a, c, d). Done at load time instead of shipping the result.
pub fn subdivide_quad_mesh(map: &[u32], uv: &[f32], indices: &[u32]) -> Result<SubdividedMesh> {
    let mut faces = Vec::with_capacity(indices.len() / 6);
    for t in indices.chunks_exact(6) {
        let [a, b, c, a2, c2, d] = [t[0], t[1], t[2], t[3], t[4], t[5]];
        if a != a2 || c != c2 {
            return Err(Error::format("subdivide: triangles are not quad pairs"));
        }
        let corners = [a, b, c, d];
        faces.push(SubdivFace {
            v: corners.iter().map(|&i| map[i as usize]).collect(),
            uv: corners.iter().map(|&i| [uv[i as usize * 2] as f64, uv[i as usize * 2 + 1] as f64]).collect(),
        });
    }
    let sub = catmull_clark(&faces);
    // Same corner (vertex + UV to 5 decimals) -> same render vertex.
    let mut key: std::collections::HashMap<(u32, i64, i64), u32> = Default::default();
    let mut out_map = Vec::new();
    let mut out_uv = Vec::new();
    let mut out_idx = Vec::with_capacity(sub.quads.len() * 6);
    for q in &sub.quads {
        let mut ids = [0u32; 4];
        for (i, &v) in q.v.iter().enumerate() {
            let k = (v, (q.uv[i][0] * 1e5).round() as i64, (q.uv[i][1] * 1e5).round() as i64);
            ids[i] = *key.entry(k).or_insert_with(|| {
                out_map.push(v);
                out_uv.push(q.uv[i][0] as f32);
                out_uv.push(q.uv[i][1] as f32);
                out_map.len() as u32 - 1
            });
        }
        out_idx.extend_from_slice(&[ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]]);
    }
    Ok(SubdividedMesh {
        map: out_map,
        uv: out_uv,
        indices: out_idx,
        stencil: Stencil {
            rows: sub.vertex_count,
            row_ptr: sub.row_ptr,
            cols: sub.cols,
            weights: sub.weights.iter().map(|&w| w as f32).collect(),
        },
    })
}
