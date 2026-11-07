//! Vertex normals.

/// A triangle list over render vertices plus the map from render vertices to shape vertices.
pub trait TriangleList {
    fn indices(&self) -> &[u32];
    fn map(&self) -> &[u32];
}

/// Smooth area-weighted vertex normals on shape vertices (before UV-seam splitting), so seams
/// don't show as lighting creases.
pub fn compute_normals<'a, T: TriangleList + 'a>(
    positions: &[f32],
    vertex_count: usize,
    lists: impl IntoIterator<Item = &'a T>,
    out: &mut Vec<f32>,
) {
    out.clear();
    out.resize(vertex_count * 3, 0.0);
    let p = |i: usize| positions[i] as f64;
    for list in lists {
        let (indices, map) = (list.indices(), list.map());
        for t in indices.chunks_exact(3) {
            let a = map[t[0] as usize] as usize * 3;
            let b = map[t[1] as usize] as usize * 3;
            let c = map[t[2] as usize] as usize * 3;
            let (abx, aby, abz) = (p(b) - p(a), p(b + 1) - p(a + 1), p(b + 2) - p(a + 2));
            let (acx, acy, acz) = (p(c) - p(a), p(c + 1) - p(a + 1), p(c + 2) - p(a + 2));
            let nx = aby * acz - abz * acy;
            let ny = abz * acx - abx * acz;
            let nz = abx * acy - aby * acx;
            for v in [a, b, c] {
                out[v] = (out[v] as f64 + nx) as f32;
                out[v + 1] = (out[v + 1] as f64 + ny) as f32;
                out[v + 2] = (out[v + 2] as f64 + nz) as f32;
            }
        }
    }
    normalize_all(out);
}

pub(crate) fn normalize_all(out: &mut [f32]) {
    for n in out.chunks_exact_mut(3) {
        let (x, y, z) = (n[0] as f64, n[1] as f64, n[2] as f64);
        let l = (x * x + y * y + z * z).sqrt();
        let l = if l == 0.0 { 1.0 } else { l };
        n[0] = (x / l) as f32;
        n[1] = (y / l) as f32;
        n[2] = (z / l) as f32;
    }
}

/// Hair-card normals bent toward the hair's outer surface, in place: each normal is turned to
/// face away from the head (a sphere around `centre`, a vertical cylinder below it) and blended
/// with that outward direction by `k`, so cards light as one mass. Renderers should not flip
/// these normals on back faces.
pub fn hair_shell_normals(positions: &[f32], normals: &mut [f32], centre: [f64; 3], k: f64) {
    for (p, n) in positions.chunks_exact(3).zip(normals.chunks_exact_mut(3)) {
        let mut rx = p[0] as f64 - centre[0];
        let mut ry = p[1] as f64 - centre[1];
        let mut rz = p[2] as f64 - centre[2];
        if ry < 0.0 {
            ry *= 0.15;
        }
        let rl = (rx * rx + ry * ry + rz * rz).sqrt();
        let rl = if rl == 0.0 { 1.0 } else { rl };
        rx /= rl;
        ry /= rl;
        rz /= rl;
        let (mut nx, mut ny, mut nz) = (n[0] as f64, n[1] as f64, n[2] as f64);
        if nx * rx + ny * ry + nz * rz < 0.0 {
            nx = -nx;
            ny = -ny;
            nz = -nz;
        }
        nx = nx * (1.0 - k) + rx * k;
        ny = ny * (1.0 - k) + ry * k;
        nz = nz * (1.0 - k) + rz * k;
        let l = (nx * nx + ny * ny + nz * nz).sqrt();
        let l = if l == 0.0 { 1.0 } else { l };
        n[0] = (nx / l) as f32;
        n[1] = (ny / l) as f32;
        n[2] = (nz / l) as f32;
    }
}
