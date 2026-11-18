/**
 * The scalp under a crowd figure's hair. The crowd level draws hair with far fewer triangles, and
 * the cards that are left leave holes through which the scalp's skin shows as brown specks in grey
 * hair (seen from behind). Body vertices with hair just above them are drawn in the hair's colour
 * instead: where a hole is, it shows hair, and where the hair is really bare (the face) nothing
 * changes. Pure arrays in, indices out (no three.js), so it is tested alone.
 */

/** Closest a hair vertex may be above a scalp vertex, and how far above (metres). */
export const SCALP_REACH = 0.05;
const SCALP_CLEAR = -0.004;
/** Cosine of the widest angle between the surface normal and the way to the hair. */
const SCALP_ANGLE = 0.1;
/** The scalp is within this distance of the highest hair vertex (metres): body below it is never painted. */
const SCALP_DEPTH = 0.16;

/**
 * The vertices (indices into the merged buffers) of `body` ranges that have a vertex of a `hair`
 * range within `SCALP_REACH` above them, measured along their normal.
 */
export function scalpVertices(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  body: { offset: number; count: number }[],
  hair: { offset: number; count: number }[],
): Uint32Array {
  const cell = SCALP_REACH;
  const grid = new Map<number, number[]>();
  const key = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
  let top = -Infinity;
  for (const { offset, count } of hair) {
    for (let i = offset; i < offset + count; i++) {
      const p = i * 3;
      if (positions[p + 1] > top) top = positions[p + 1];
      const k = key(Math.floor(positions[p] / cell), Math.floor(positions[p + 1] / cell), Math.floor(positions[p + 2] / cell));
      const list = grid.get(k);
      if (list) list.push(i);
      else grid.set(k, [i]);
    }
  }
  const out: number[] = [];
  if (!grid.size) return new Uint32Array(0);
  for (const { offset, count } of body) {
    for (let i = offset; i < offset + count; i++) {
      const p = i * 3;
      const x = positions[p], y = positions[p + 1], z = positions[p + 2];
      if (y < top - SCALP_DEPTH) continue;
      const nx = normals[p], ny = normals[p + 1], nz = normals[p + 2];
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      let covered = false;
      for (let a = -1; a <= 1 && !covered; a++) for (let b = -1; b <= 1 && !covered; b++) for (let c = -1; c <= 1 && !covered; c++) {
        const list = grid.get(key(cx + a, cy + b, cz + c));
        if (!list) continue;
        for (const h of list) {
          const dx = positions[h * 3] - x, dy = positions[h * 3 + 1] - y, dz = positions[h * 3 + 2] - z;
          const along = dx * nx + dy * ny + dz * nz;
          if (along < SCALP_CLEAR) continue;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > SCALP_REACH * SCALP_REACH || along < SCALP_ANGLE * Math.sqrt(d2)) continue;
          covered = true;
          break;
        }
      }
      if (covered) out.push(i);
    }
  }
  return Uint32Array.from(out);
}
