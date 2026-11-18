import { type Vec3, closestOnTriangle } from "./geometry";

/** A worn garment's surface as an outer garment sees it: positions on the neutral body (local vertex indices) and its inflate. */
export interface Shell {
  pos: ArrayLike<number>;
  tris: [number, number, number][];
  /** Meters along the normal the runtime adds (`inflate` of the mesh). */
  inflate: number;
}

export interface NestOptions {
  /** Gap (meters, inflates included) every vertex keeps outside each inner shell. */
  margin?: number;
  /** Inner surfaces further than this are not looked at. */
  reach?: number;
  /** Share of the distance to the closest inner point that must lie along its normal (else the vertex is beside the shell, not over it). */
  slant?: number;
  /** Smoothing passes over the pushes, so the surface stays smooth where the closest inner point jumps. */
  smooth?: number;
}

const cell = 0.03;

/** Triangles of a shell binned in a grid (cells of `cell` meters). */
function bin(shell: Shell) {
  const grid = new Map<string, number[]>();
  const pt = (i: number): Vec3 => [shell.pos[i * 3], shell.pos[i * 3 + 1], shell.pos[i * 3 + 2]];
  shell.tris.forEach((t, ti) => {
    const ps = t.map(pt);
    const lo = [0, 1, 2].map((c) => Math.floor(Math.min(...ps.map((p) => p[c])) / cell));
    const hi = [0, 1, 2].map((c) => Math.floor(Math.max(...ps.map((p) => p[c])) / cell));
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          const k = `${x},${y},${z}`;
          (grid.get(k) ?? grid.set(k, []).get(k)!).push(ti);
        }
  });
  return { grid, pt };
}

/**
 * Layered garments are cut from the same body and given a few millimetres of room each, but a sleeve of
 * the shirt is fuller than the jacket's, a shoulder rides high, a hem ends beyond another: wherever an inner
 * garment's surface lies outside the outer one's, it shows through in jagged patches. A crowd mesh (one
 * material, no layer offsets) has only this geometry to go by. Returns, per vertex of the outer garment,
 * the move (meters, xyz, along its normal) that puts it `margin` outside every shell in `inner`.
 */
export function nestMoves(
  pos: ArrayLike<number>,
  tris: [number, number, number][],
  inflate: number,
  inner: Shell[],
  { margin = 0.004, reach = 0.04, slant = 0.7, smooth = 4 }: NestOptions = {},
): Float32Array {
  const n = pos.length / 3;
  // Vertex normals of the outer garment: the direction it is pushed in.
  const normals = new Float32Array(n * 3);
  for (const [a, b, c] of tris) {
    const p = (i: number) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const pa = p(a), pb = p(b), pc = p(c);
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], w = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const f = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) normals[v * 3 + k] += f[k];
  }
  for (let v = 0; v < n; v++) {
    const l = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) normals[v * 3 + k] /= l;
  }
  const need = new Float32Array(n);
  for (const shell of inner) {
    const { grid, pt } = bin(shell);
    const R = Math.ceil(reach / cell);
    for (let i = 0; i < n; i++) {
      const p: Vec3 = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      const [cx, cy, cz] = p.map((x) => Math.floor(x / cell));
      let best = { distance: Infinity, point: p, tri: -1 };
      for (let r = 0; r <= R && best.distance > (r - 1) * cell; r++)
        for (let dx = -r; dx <= r; dx++)
          for (let dy = -r; dy <= r; dy++)
            for (let dz = -r; dz <= r; dz++) {
              if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
              for (const ti of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
                const hit = closestOnTriangle(p, shell.tris[ti].map(pt) as [Vec3, Vec3, Vec3]);
                if (hit.distance < best.distance) best = { distance: hit.distance, point: hit.point, tri: ti };
              }
            }
      if (best.tri < 0 || best.distance > reach) continue;
      const [a, b, c] = shell.tris[best.tri].map(pt);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const f = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const fl = Math.hypot(f[0], f[1], f[2]) || 1;
      const nn = f.map((x) => x / fl);
      const along = (p[0] - best.point[0]) * nn[0] + (p[1] - best.point[1]) * nn[1] + (p[2] - best.point[2]) * nn[2];
      // Only where the inner surface is straight below or above the vertex: beside its edge (a hem, an opening) the
      // closest point says nothing about which side the vertex is on.
      if (Math.abs(along) < slant * best.distance) continue;
      // Height of the vertex over the inner surface, once both have their inflate.
      const over = along + inflate - shell.inflate;
      if (over >= margin) continue;
      // Along the vertex's own normal, which may lean off the inner one: the push still lifts it by the shortfall.
      const lean = Math.max(0.3, normals[i * 3] * nn[0] + normals[i * 3 + 1] * nn[1] + normals[i * 3 + 2] * nn[2]);
      need[i] = Math.max(need[i], (margin - over) / lean);
    }
  }
  const neighbours: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (const [a, b, c] of tris) for (const [u, v] of [[a, b], [b, c], [c, a]]) { neighbours[u].add(v); neighbours[v].add(u); }
  // Smooth the pushes, never below what a vertex needs itself.
  let push = need.slice();
  for (let pass = 0; pass < smooth; pass++) {
    const prev = push;
    push = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (const j of neighbours[i]) sum += prev[j];
      push[i] = Math.max(need[i], neighbours[i].size ? 0.5 * prev[i] + (0.5 * sum) / neighbours[i].size : prev[i]);
    }
  }
  const moves = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) moves[i * 3 + k] = normals[i * 3 + k] * push[i];
  return moves;
}
