import type { ProxyDef } from "./format";

export interface ProxyBinding {
  def: ProxyDef;
  refs: Uint32Array;
  weights: Float32Array;
  offsets: Float32Array;
}

/** Positions a proxy (garment, body part) on the current body shape. */
export function fitProxy(binding: ProxyBinding, positions: Float32Array, out?: Float32Array): Float32Array {
  const { def, refs, weights, offsets } = binding;
  const result = out ?? new Float32Array(def.vertexCount * 3);
  const scale = def.scaleRefs.map(([a, b, rest], axis) => {
    const d = Math.abs(positions[a * 3 + axis] - positions[b * 3 + axis]);
    return rest > 0 ? d / rest : 1;
  });
  for (let i = 0; i < def.vertexCount; i++) {
    const r0 = refs[i * 3] * 3, r1 = refs[i * 3 + 1] * 3, r2 = refs[i * 3 + 2] * 3;
    const w0 = weights[i * 3], w1 = weights[i * 3 + 1], w2 = weights[i * 3 + 2];
    for (let c = 0; c < 3; c++) {
      result[i * 3 + c] =
        w0 * positions[r0 + c] + w1 * positions[r1 + c] + w2 * positions[r2 + c] + offsets[i * 3 + c] * scale[c];
    }
  }
  return result;
}

/** Interpolates base skin weights onto proxy vertices (top 4 influences, renormalized). */
export function proxySkin(
  binding: ProxyBinding,
  baseJoints: Uint16Array,
  baseWeights: Float32Array,
  boneNames: string[] = [],
): { joints: Uint16Array; weights: Float32Array } {
  const blend = binding.def.legBlend;
  const index = (n: string) => boneNames.indexOf(n);
  const remap = new Map<number, number>();
  const pairs: [number, number][] = [];
  let hip = -1;
  if (blend) {
    for (const [from, to] of Object.entries(blend.remap)) if (index(from) >= 0 && index(to) >= 0) remap.set(index(from), index(to));
    for (const [a, b] of blend.pairs) if (index(a) >= 0 && index(b) >= 0) pairs.push([index(a), index(b)]);
    hip = index(blend.hip);
  }
  const n = binding.def.vertexCount;
  const joints = new Uint16Array(n * 4);
  const weights = new Float32Array(n * 4);
  const acc = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    acc.clear();
    for (let k = 0; k < 3; k++) {
      const v = binding.refs[i * 3 + k];
      const w = binding.weights[i * 3 + k];
      for (let j = 0; j < 4; j++) {
        const bw = baseWeights[v * 4 + j] * w;
        if (bw !== 0) acc.set(baseJoints[v * 4 + j], (acc.get(baseJoints[v * 4 + j]) ?? 0) + bw);
      }
    }
    if (blend) {
      for (const [from, to] of remap) {
        const w = acc.get(from);
        if (w) {
          acc.delete(from);
          acc.set(to, (acc.get(to) ?? 0) + w);
        }
      }
      for (const [a, b] of pairs) {
        const legs = (acc.get(a) ?? 0) + (acc.get(b) ?? 0);
        if (!legs) continue;
        const toHip = hip >= 0 ? legs * blend.hipShare : 0;
        acc.set(a, (legs - toHip) / 2);
        acc.set(b, (legs - toHip) / 2);
        if (hip >= 0) acc.set(hip, (acc.get(hip) ?? 0) + toHip);
      }
    }
    const top = [...acc.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
    top.forEach(([joint, w], j) => {
      joints[i * 4 + j] = joint;
      weights[i * 4 + j] = w / sum;
    });
  }
  return { joints, weights };
}
