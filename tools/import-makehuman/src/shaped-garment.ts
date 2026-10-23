import type { ProxyDef } from "@actors/core";
import { BlobWriter } from "./blob";
import type { GarmentContext, GarmentSpec } from "./garments";

/** A sculpted helper surface: retain each vertex's morph and skin binding. */
export function shapedGarment(blob: BlobWriter, vertices: number[], spec: GarmentSpec, ctx: GarmentContext): { proxy: ProxyDef; positions: number[] } {
  if (!vertices.length || !spec.offset) throw new Error(`No shaped surface for ${spec.name}`);
  const p = ctx.positions;
  const refs: number[] = [], weights: number[] = [], offsets: number[] = [], positions: number[] = [];
  for (const v of vertices) {
    const offset = spec.offset({ x: p[v * 3], y: p[v * 3 + 1], z: p[v * 3 + 2], bone: ctx.dominantBone(v) }, ctx);
    refs.push(v, v, v);
    weights.push(1, 0, 0);
    offsets.push(...offset);
    positions.push(...offset.map((d, axis) => p[v * 3 + axis] + d));
  }
  const scaleRefs = [0, 1, 2].map((axis) => {
    let lo = vertices[0], hi = lo;
    for (const v of vertices) {
      if (p[v * 3 + axis] < p[lo * 3 + axis]) lo = v;
      if (p[v * 3 + axis] > p[hi * 3 + axis]) hi = v;
    }
    return [lo, hi, p[hi * 3 + axis] - p[lo * 3 + axis]];
  }) as ProxyDef["scaleRefs"];
  return { positions, proxy: { name: spec.name, vertexCount: vertices.length, refs: blob.add("u32", refs), weights: blob.add("f32", weights), offsets: blob.add("f32", offsets), scaleRefs } };
}
