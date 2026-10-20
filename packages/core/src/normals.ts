/**
 * Smooth vertex normals computed on shape vertices (before UV-seam splitting),
 * so seams don't show as lighting creases.
 */
export function computeNormals(
  positions: Float32Array,
  vertexCount: number,
  triangleLists: Iterable<{ indices: Uint32Array; map: Uint32Array }>,
  out?: Float32Array,
): Float32Array {
  const normals = out ?? new Float32Array(vertexCount * 3);
  normals.fill(0);
  for (const { indices, map } of triangleLists) {
    for (let t = 0; t < indices.length; t += 3) {
      const a = map[indices[t]] * 3, b = map[indices[t + 1]] * 3, c = map[indices[t + 2]] * 3;
      const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1], abz = positions[b + 2] - positions[a + 2];
      const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1], acz = positions[c + 2] - positions[a + 2];
      // Area-weighted face normal.
      const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
      for (const v of [a, b, c]) {
        normals[v] += nx;
        normals[v + 1] += ny;
        normals[v + 2] += nz;
      }
    }
  }
  for (let i = 0; i < vertexCount; i++) {
    const x = normals[i * 3], y = normals[i * 3 + 1], z = normals[i * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    normals[i * 3] = x / l;
    normals[i * 3 + 1] = y / l;
    normals[i * 3 + 2] = z / l;
  }
  return normals;
}
