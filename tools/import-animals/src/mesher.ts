/**
 * Turns a signed distance function into a closed quad mesh with Surface Nets
 * (one vertex per grid cell the surface crosses, one quad per crossed grid
 * edge), then projects the vertices onto the surface and relaxes them so the
 * quads are even.
 */
import type { Vec3 } from "@actors/core";

export interface QuadMesh {
  positions: Float64Array;
  /** 4 vertex indices per quad, counter-clockwise seen from outside. */
  quads: Uint32Array;
}

/**
 * `band` > 1 samples a grid `band` times coarser first and evaluates f at the
 * fine points only near the surface (where the coarse values are within two
 * coarse cells of it); elsewhere only the sign matters, and the coarse value
 * has the right one. Much faster for large bodies.
 */
export function surfaceNets(f: (p: Vec3) => number, min: Vec3, max: Vec3, cell: number, band = 1): QuadMesh {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const idx = (x: number, y: number, z: number) => (z * ny + y) * nx + x;
  const values = new Float32Array(nx * ny * nz);
  const p: Vec3 = [0, 0, 0];
  let coarse: ((x: number, y: number, z: number) => number) | null = null;
  if (band > 1) {
    const cx = Math.ceil((nx - 1) / band) + 1, cy = Math.ceil((ny - 1) / band) + 1, cz = Math.ceil((nz - 1) / band) + 1;
    const cv = new Float32Array(cx * cy * cz);
    for (let z = 0; z < cz; z++)
      for (let y = 0; y < cy; y++)
        for (let x = 0; x < cx; x++) {
          p[0] = min[0] + x * band * cell;
          p[1] = min[1] + y * band * cell;
          p[2] = min[2] + z * band * cell;
          cv[(z * cy + y) * cx + x] = f(p);
        }
    // The coarse value nearest to fine point (x, y, z) less how far that point may be from it.
    coarse = (x, y, z) => {
      const i = Math.round(x / band), j = Math.round(y / band), k = Math.round(z / band);
      return cv[(Math.min(k, cz - 1) * cy + Math.min(j, cy - 1)) * cx + Math.min(i, cx - 1)];
    };
  }
  const margin = band * cell * 1.8;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        if (coarse) {
          const c = coarse(x, y, z);
          if (Math.abs(c) > margin) {
            values[idx(x, y, z)] = c;
            continue;
          }
        }
        p[0] = min[0] + x * cell;
        p[1] = min[1] + y * cell;
        p[2] = min[2] + z * cell;
        values[idx(x, y, z)] = f(p);
      }

  // One vertex per cell with a sign change: the mean of the edge crossings.
  const cellVertex = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (x: number, y: number, z: number) => (z * (ny - 1) + y) * (nx - 1) + x;
  const pos: number[] = [];
  const corners = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const v = new Float32Array(8);
  for (let z = 0; z < nz - 1; z++)
    for (let y = 0; y < ny - 1; y++)
      for (let x = 0; x < nx - 1; x++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          v[c] = values[idx(x + corners[c][0], y + corners[c][1], z + corners[c][2])];
          if (v[c] < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of edges) {
          if (v[a] < 0 === v[b] < 0) continue;
          const t = v[a] / (v[a] - v[b]);
          sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t;
          sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t;
          sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t;
          n++;
        }
        cellVertex[cidx(x, y, z)] = pos.length / 3;
        pos.push(min[0] + (x + sx / n) * cell, min[1] + (y + sy / n) * cell, min[2] + (z + sz / n) * cell);
      }

  // A quad around every grid edge with a sign change, joining the 4 cells sharing that edge.
  const quads: number[] = [];
  for (let z = 1; z < nz - 1; z++)
    for (let y = 1; y < ny - 1; y++)
      for (let x = 1; x < nx - 1; x++) {
        const a = values[idx(x, y, z)];
        const ain = a < 0;
        // Edge along +x: cells (x, y-1..y, z-1..z).
        if (x < nx - 1 && ain !== values[idx(x + 1, y, z)] < 0) {
          const q = [cidx(x, y - 1, z - 1), cidx(x, y, z - 1), cidx(x, y, z), cidx(x, y - 1, z)].map((c) => cellVertex[c]);
          push(quads, q, !ain);
        }
        if (y < ny - 1 && ain !== values[idx(x, y + 1, z)] < 0) {
          const q = [cidx(x - 1, y, z - 1), cidx(x - 1, y, z), cidx(x, y, z), cidx(x, y, z - 1)].map((c) => cellVertex[c]);
          push(quads, q, !ain);
        }
        if (z < nz - 1 && ain !== values[idx(x, y, z + 1)] < 0) {
          const q = [cidx(x - 1, y - 1, z), cidx(x, y - 1, z), cidx(x, y, z), cidx(x - 1, y, z)].map((c) => cellVertex[c]);
          push(quads, q, !ain);
        }
      }
  return { positions: Float64Array.from(pos), quads: Uint32Array.from(quads) };
}

function push(out: number[], q: number[], flip: boolean): void {
  if (q.some((i) => i < 0)) return;
  if (flip) out.push(q[0], q[1], q[2], q[3]);
  else out.push(q[0], q[3], q[2], q[1]);
}

/** Numerical gradient of f at p. */
export function gradient(f: (p: Vec3) => number, p: Vec3, h = 1e-4): Vec3 {
  const g: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const a = [...p] as Vec3, b = [...p] as Vec3;
    a[k] += h;
    b[k] -= h;
    g[k] = (f(a) - f(b)) / (2 * h);
  }
  return g;
}

/** Moves each vertex onto f = 0 along the gradient (a few Newton steps). */
export function project(f: (p: Vec3) => number, positions: Float64Array, steps = 3): void {
  const p: Vec3 = [0, 0, 0];
  for (let i = 0; i < positions.length; i += 3) {
    p[0] = positions[i];
    p[1] = positions[i + 1];
    p[2] = positions[i + 2];
    for (let s = 0; s < steps; s++) {
      const d = f(p);
      if (Math.abs(d) < 1e-6) break;
      const g = gradient(f, p);
      const gg = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
      if (gg < 1e-12) break;
      const k = Math.max(-0.01, Math.min(0.01, d / gg));
      p[0] -= g[0] * k;
      p[1] -= g[1] * k;
      p[2] -= g[2] * k;
    }
    positions[i] = p[0];
    positions[i + 1] = p[1];
    positions[i + 2] = p[2];
  }
}

/** Vertex neighbours from quads (or triangles with `stride` 3). */
export function neighbours(count: number, faces: Uint32Array, stride: number): number[][] {
  const sets = Array.from({ length: count }, () => new Set<number>());
  for (let f = 0; f < faces.length; f += stride)
    for (let k = 0; k < stride; k++) {
      const a = faces[f + k], b = faces[f + ((k + 1) % stride)];
      sets[a].add(b);
      sets[b].add(a);
    }
  return sets.map((s) => [...s]);
}

/** Tangential relaxation: each vertex moves toward its neighbours' centroid, then back onto the surface. */
export function relax(f: (p: Vec3) => number, positions: Float64Array, nb: number[][], iterations = 3, amount = 0.5): void {
  const n = positions.length / 3;
  const next = new Float64Array(positions.length);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const list = nb[i];
      if (!list.length) {
        next.set(positions.subarray(i * 3, i * 3 + 3), i * 3);
        continue;
      }
      let x = 0, y = 0, z = 0;
      for (const j of list) {
        x += positions[j * 3];
        y += positions[j * 3 + 1];
        z += positions[j * 3 + 2];
      }
      const m = list.length;
      next[i * 3] = positions[i * 3] + (x / m - positions[i * 3]) * amount;
      next[i * 3 + 1] = positions[i * 3 + 1] + (y / m - positions[i * 3 + 1]) * amount;
      next[i * 3 + 2] = positions[i * 3 + 2] + (z / m - positions[i * 3 + 2]) * amount;
    }
    positions.set(next);
    project(f, positions, 2);
  }
}
