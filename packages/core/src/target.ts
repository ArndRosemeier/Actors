import { TARGET_FLAG_DENSE, TARGET_MAGIC } from "./format";

/**
 * A morph target: sparse per-vertex position deltas, quantized to int16.
 * delta(vertex) = deltas[i] * scale.
 */
export interface MorphTarget {
  /** Vertex indices, or null when the target covers vertices 0..count-1 densely. */
  indices: Uint32Array | null;
  deltas: Int16Array;
  scale: number;
  count: number;
}

/** Binary layout: u32 magic, u32 version, u32 count, u32 flags, f32 scale, [u32 indices], i16 deltas[count*3]. */
export function decodeTarget(buffer: ArrayBuffer): MorphTarget {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== TARGET_MAGIC) throw new Error("Not an actor morph target");
  const version = view.getUint32(4, true);
  if (version !== 1) throw new Error(`Unsupported target version ${version}`);
  const count = view.getUint32(8, true);
  const flags = view.getUint32(12, true);
  const scale = view.getFloat32(16, true);
  let offset = 20;
  let indices: Uint32Array | null = null;
  if (!(flags & TARGET_FLAG_DENSE)) {
    indices = new Uint32Array(buffer, offset, count);
    offset += count * 4;
  }
  const deltas = new Int16Array(buffer, offset, count * 3);
  return { indices, deltas, scale, count };
}

/** Inverse of decodeTarget, used by importers. Picks dense storage when it is smaller. */
export function encodeTarget(
  indices: ArrayLike<number>,
  deltas: ArrayLike<number>,
  vertexCount: number,
): ArrayBuffer {
  const count = indices.length;
  let maxAbs = 0;
  for (let i = 0; i < deltas.length; i++) maxAbs = Math.max(maxAbs, Math.abs(deltas[i]));
  const scale = maxAbs > 0 ? maxAbs / 32767 : 1;

  // Dense when the target touches most vertices: saves the index array.
  const dense = count > vertexCount * 0.6;
  const n = dense ? vertexCount : count;
  const bytes = 20 + (dense ? 0 : n * 4) + n * 6;
  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);
  view.setUint32(0, TARGET_MAGIC, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, n, true);
  view.setUint32(12, dense ? TARGET_FLAG_DENSE : 0, true);
  view.setFloat32(16, scale, true);
  let offset = 20;
  if (!dense) {
    new Uint32Array(buffer, offset, n).set(indices);
    offset += n * 4;
  }
  const out = new Int16Array(buffer, offset, n * 3);
  for (let i = 0; i < count; i++) {
    const slot = dense ? indices[i] : i;
    for (let c = 0; c < 3; c++) out[slot * 3 + c] = Math.round(deltas[i * 3 + c] / scale);
  }
  return buffer;
}

/** Adds weight * target to positions, in place. */
export function applyTarget(positions: Float32Array, target: MorphTarget, weight: number): void {
  const { indices, deltas, count } = target;
  const k = weight * target.scale;
  if (indices) {
    for (let i = 0; i < count; i++) {
      const v = indices[i] * 3;
      const d = i * 3;
      positions[v] += deltas[d] * k;
      positions[v + 1] += deltas[d + 1] * k;
      positions[v + 2] += deltas[d + 2] * k;
    }
  } else {
    const n = count * 3;
    for (let i = 0; i < n; i++) positions[i] += deltas[i] * k;
  }
}
