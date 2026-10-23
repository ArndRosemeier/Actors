import type { MeshDef, ProxyDef } from "@actors/core";
import { BlobWriter } from "./blob";

/** Two intersecting luminous orbits, fitted to the head through the standard proxy format. */
export function orbitalHalo(blob: BlobWriter, positions: number[], headVertices: number[]): { mesh: MeshDef; proxy: ProxyDef } {
  if (headVertices.length < 3) throw new Error("Orbital halo needs head surface vertices");
  const extremes = [0, 1, 2].map((axis) => {
    let lo = headVertices[0], hi = lo;
    for (const v of headVertices) {
      if (positions[v * 3 + axis] < positions[lo * 3 + axis]) lo = v;
      if (positions[v * 3 + axis] > positions[hi * 3 + axis]) hi = v;
    }
    return [lo, hi, positions[hi * 3 + axis] - positions[lo * 3 + axis]] as [number, number, number];
  });
  const center = extremes.map(([lo, hi], axis) => (positions[lo * 3 + axis] + positions[hi * 3 + axis]) / 2);
  // Symmetric anchors average facial morphs; all come from head-weighted vertices.
  const anchors = [extremes[0][0], extremes[0][1], extremes[1][1]];
  const origin = [0, 1, 2].map((axis) => anchors.reduce((sum, v) => sum + positions[v * 3 + axis], 0) / 3);
  const refs: number[] = [], weights: number[] = [], offsets: number[] = [], uv: number[] = [], indices: number[] = [];
  const segments = 96, sides = 8;
  for (let ring = 0; ring < 2; ring++) {
    const start = offsets.length / 3;
    const tilt = ring ? -0.65 : 0.4;
    const rx = extremes[0][2] * (ring ? 0.94 : 1.12);
    const ry = extremes[1][2] * (ring ? 0.87 : 1.02);
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * Math.PI * 2;
      for (let j = 0; j <= sides; j++) {
        const b = j / sides * Math.PI * 2;
        const tube = 0.009;
        const x = (rx + tube * Math.cos(b)) * Math.cos(a);
        const y = (ry + tube * Math.cos(b)) * Math.sin(a);
        const z = tube * Math.sin(b);
        const p = [center[0] + x, center[1] + y * Math.cos(tilt) - z * Math.sin(tilt) + 0.035, center[2] + y * Math.sin(tilt) + z * Math.cos(tilt) - 0.045];
        refs.push(...anchors);
        weights.push(1 / 3, 1 / 3, 1 / 3);
        offsets.push(...p.map((v, axis) => v - origin[axis]));
        uv.push(i / segments, j / sides);
        if (i < segments && j < sides) {
          const k = start + i * (sides + 1) + j;
          indices.push(k, k + 1, k + sides + 2, k, k + sides + 2, k + sides + 1);
        }
      }
    }
  }
  const name = "future-halo";
  const vertexCount = offsets.length / 3;
  return {
    proxy: { name, vertexCount, refs: blob.add("u32", refs), weights: blob.add("f32", weights), offsets: blob.add("f32", offsets), scaleRefs: [extremes[0], extremes[1], extremes[2]] },
    mesh: {
      name, source: { kind: "proxy", proxy: name }, role: "garment", optional: true,
      baseIndex: blob.add("u32", Array.from({ length: vertexCount }, (_, i) => i)),
      uv: blob.add("f32", uv), indices: blob.add("u32", indices),
      material: { kind: "cloth", color: [0.65, 0.8, 1], roughness: 0.3 },
      tags: ["fabric:screen"],
    },
  };
}
