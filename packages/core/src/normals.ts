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

/**
 * Hair-card normals bent toward the hair's outer surface, in place: each normal is turned to face
 * away from the head (a sphere around `centre`, a vertical cylinder below it for hanging hair) and
 * blended with that outward direction by `k`. Cards then light as one cohesive mass instead of as
 * separate strands, each lit by its own angle. Renderers should not flip these normals on back
 * faces (see the hair materials in @actors/three).
 */
export function hairShellNormals(positions: Float32Array, normals: Float32Array, vertexCount: number, centre: readonly [number, number, number], k = 0.65): void {
  for (let i = 0; i < vertexCount; i++) {
    const o = i * 3;
    let rx = positions[o] - centre[0], ry = positions[o + 1] - centre[1], rz = positions[o + 2] - centre[2];
    if (ry < 0) ry *= 0.15;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl;
    ry /= rl;
    rz /= rl;
    let nx = normals[o], ny = normals[o + 1], nz = normals[o + 2];
    if (nx * rx + ny * ry + nz * rz < 0) (nx = -nx), (ny = -ny), (nz = -nz);
    nx = nx * (1 - k) + rx * k;
    ny = ny * (1 - k) + ry * k;
    nz = nz * (1 - k) + rz * k;
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[o] = nx / l;
    normals[o + 1] = ny / l;
    normals[o + 2] = nz / l;
  }
}
