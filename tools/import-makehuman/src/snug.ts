import { type Vec3, closestOnTriangle } from "./geometry";

export interface SnugOptions {
  /** Share of the gap beyond `clearance` that is kept (0.5 halves it). */
  keep: number;
  /** Gap left alone (meters): the garment never comes closer to the skin than this through snugging. */
  clearance?: number;
  /** Gaps beyond this (meters) only move by as much as a gap of this size does, so a pointed toe stays pointed. */
  reach?: number;
  /** Below-the-skin directions (soles) keep their depth when the direction's downward share exceeds this; only their sideways gap shrinks. */
  soleDown?: number;
  /** Near the garment's open edges (the shoe's opening) moves fade out over this distance (meters), so it keeps room to move; 0: no fade. */
  edge?: number;
  /** Smoothing passes over the moves (mesh neighbours), so the surface stays smooth where the closest skin point jumps. */
  smooth?: number;
}

/**
 * Pulls a fitted garment closer to the skin: every garment vertex outside the skin moves towards its
 * closest skin point so that the part of its gap beyond `clearance` shrinks to `keep` of itself.
 * Soles (garment below the skin) keep their thickness, so the shoe still stands where it did, but a sole
 * rim standing out sideways comes in. Openings keep their gap (see `edge`), as the ankle needs it to move.
 * Returns the move per garment vertex (meters, xyz), to add to the fitted positions.
 *
 * Used for MakeHuman shoes, which are modelled loose (sneakers stand about 14 mm off each side of the foot).
 */
export function snugMoves(
  garment: ArrayLike<number>,
  garmentFaces: number[][],
  skin: ArrayLike<number>,
  skinTris: [number, number, number][],
  { keep, clearance = 0.004, reach = 0.04, soleDown = 0.6, edge = 0.04, smooth = 3 }: SnugOptions,
): Float32Array {
  const n = garment.length / 3;
  const moves = new Float32Array(n * 3);
  /** How far each vertex may move: what its own gap allows (0 for soles and vertices in the skin). */
  const limit = new Float32Array(n);
  const cell = 0.03;
  const pt = (a: ArrayLike<number>, i: number): Vec3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
  const grid = new Map<string, number[]>();
  skinTris.forEach((t, ti) => {
    const ps = t.map((v) => pt(skin, v));
    const lo = [0, 1, 2].map((c) => Math.floor(Math.min(...ps.map((p) => p[c])) / cell));
    const hi = [0, 1, 2].map((c) => Math.floor(Math.max(...ps.map((p) => p[c])) / cell));
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          const k = `${x},${y},${z}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k)!.push(ti);
        }
  });
  // Distance to the nearest open-edge vertex (an edge used by one face only), for the fade near openings.
  const edgeUse = new Map<string, number>();
  for (const f of garmentFaces)
    f.forEach((a, j) => {
      const b = f[(j + 1) % f.length];
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
    });
  const rim: number[] = [];
  for (const [k, uses] of edgeUse) if (uses === 1) rim.push(...k.split("_").map(Number));
  const rimVerts = [...new Set(rim)];
  const fade = (i: number) => {
    if (!edge) return 1;
    let d = Infinity;
    for (const r of rimVerts) d = Math.min(d, Math.hypot(garment[i * 3] - garment[r * 3], garment[i * 3 + 1] - garment[r * 3 + 1], garment[i * 3 + 2] - garment[r * 3 + 2]));
    const t = Math.min(1, d / edge);
    return t * t * (3 - 2 * t);
  };
  const shrink = (d: number) => {
    if (d <= clearance) return d;
    const far = Math.min(d, reach);
    return d - (far - clearance) * (1 - keep);
  };
  for (let i = 0; i < n; i++) {
    const p = pt(garment, i);
    let best = { distance: Infinity, point: p, tri: -1 };
    const [cx, cy, cz] = p.map((v) => Math.floor(v / cell));
    // Search shells of cells outwards until nothing closer can remain; well past `reach`, so vertices
    // further out (a long pointed toe) still move with the rest.
    const R = Math.ceil((3 * reach) / cell) + 1;
    for (let r = 0; r <= R && best.distance > (r - 1) * cell; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
            for (const ti of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              const t = skinTris[ti];
              const hit = closestOnTriangle(p, t.map((v) => pt(skin, v)) as [Vec3, Vec3, Vec3]);
              if (hit.distance < best.distance) best = { distance: hit.distance, point: hit.point, tri: ti };
            }
          }
    if (best.tri < 0 || best.distance < 1e-6) continue;
    const [a, b, c] = skinTris[best.tri].map((v) => pt(skin, v));
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const dir = [0, 1, 2].map((k) => (p[k] - best.point[k]) / best.distance);
    // Inside the skin (or on its far side): leave it, the skin under the garment is hidden anyway.
    if (dir[0] * normal[0] + dir[1] * normal[1] + dir[2] * normal[2] <= 0) continue;
    // Soles: only the sideways part of the gap.
    const gap = -dir[1] > soleDown ? [dir[0] * best.distance, 0, dir[2] * best.distance] : dir.map((x) => x * best.distance);
    const d = Math.hypot(gap[0], gap[1], gap[2]);
    if (d <= clearance) continue;
    const f = fade(i);
    const by = (d - shrink(d)) * f;
    limit[i] = (d - clearance) * f;
    for (let k = 0; k < 3; k++) moves[i * 3 + k] = (-gap[k] / d) * by;
  }
  if (smooth > 0) {
    const neighbours: Set<number>[] = Array.from({ length: n }, () => new Set());
    for (const f of garmentFaces)
      f.forEach((v, j) => {
        const next = f[(j + 1) % f.length];
        neighbours[v].add(next);
        neighbours[next].add(v);
      });
    for (let pass = 0; pass < smooth; pass++) {
      const prev = moves.slice();
      for (let i = 0; i < n; i++) {
        if (!neighbours[i].size) continue;
        for (let k = 0; k < 3; k++) {
          let sum = 0;
          for (const j of neighbours[i]) sum += prev[j * 3 + k];
          moves[i * 3 + k] = 0.5 * prev[i * 3 + k] + (0.5 * sum) / neighbours[i].size;
        }
      }
    }
    // Smoothing must not carry a vertex further than its own gap allows (into the skin).
    for (let i = 0; i < n; i++) {
      const len = Math.hypot(moves[i * 3], moves[i * 3 + 1], moves[i * 3 + 2]);
      if (len > limit[i]) for (let k = 0; k < 3; k++) moves[i * 3 + k] *= len > 0 ? limit[i] / len : 0;
    }
  }
  return moves;
}
