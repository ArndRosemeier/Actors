import type { Quat, Vec3 } from "@actors/core";

/** Minimal binary glTF reader: node hierarchy, float accessors and animations. */
export interface GltfNode {
  name: string;
  children: number[];
  translation: Vec3;
  rotation: Quat;
}

export interface GltfChannel {
  node: number;
  path: "translation" | "rotation" | "scale" | "weights";
  times: Float32Array;
  values: Float32Array;
  interpolation: "LINEAR" | "STEP" | "CUBICSPLINE";
}

export interface GltfAnimation {
  name: string;
  duration: number;
  channels: GltfChannel[];
}

export interface Gltf {
  nodes: GltfNode[];
  parents: Int32Array;
  joints: number[];
  animations: GltfAnimation[];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function parseGlb(buf: Buffer): Gltf {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("Not a GLB file");
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const binStart = 20 + jsonLen + 8;
  const bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));

  const accessor = (i: number): Float32Array => {
    const a = json.accessors[i];
    if (a.componentType !== 5126) throw new Error(`Accessor ${i}: only float data is supported`);
    const view = json.bufferViews[a.bufferView];
    const n = COMPONENTS[a.type];
    const stride = view.byteStride ? view.byteStride / 4 : n;
    const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const src = new Float32Array(bin.buffer, bin.byteOffset + offset, (a.count - 1) * stride + n);
    const out = new Float32Array(a.count * n);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = src[k * stride + c];
    return out;
  };

  const nodes: GltfNode[] = json.nodes.map((n: any) => {
    if (n.matrix) throw new Error(`Node ${n.name}: matrix transforms are not supported`);
    if (n.scale && n.scale.some((s: number) => Math.abs(s - 1) > 1e-3)) throw new Error(`Node ${n.name}: scaled nodes are not supported`);
    return { name: n.name ?? "", children: n.children ?? [], translation: n.translation ?? [0, 0, 0], rotation: n.rotation ?? [0, 0, 0, 1] };
  });
  const parents = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => n.children.forEach((c) => (parents[c] = i)));

  const animations: GltfAnimation[] = (json.animations ?? []).map((a: any) => {
    const channels: GltfChannel[] = a.channels.map((c: any) => {
      const s = a.samplers[c.sampler];
      return { node: c.target.node, path: c.target.path, times: accessor(s.input), values: accessor(s.output), interpolation: s.interpolation ?? "LINEAR" };
    });
    return { name: a.name, duration: Math.max(0, ...channels.map((c) => c.times[c.times.length - 1])), channels };
  });

  return { nodes, parents, joints: json.skins?.[0]?.joints ?? [], animations };
}

/** Samples a vec3/quat channel at time t (clamped). */
export function sampleChannel(ch: GltfChannel, t: number): number[] {
  const n = ch.path === "rotation" ? 4 : 3;
  const width = ch.interpolation === "CUBICSPLINE" ? 3 * n : n;
  const valueAt = (k: number) => Array.from(ch.values.subarray(k * width + (ch.interpolation === "CUBICSPLINE" ? n : 0), k * width + (ch.interpolation === "CUBICSPLINE" ? 2 * n : n)));
  const { times } = ch;
  if (t <= times[0]) return valueAt(0);
  if (t >= times[times.length - 1]) return valueAt(times.length - 1);
  let lo = 0, hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const a = valueAt(lo);
  if (ch.interpolation === "STEP") return a;
  const b = valueAt(hi);
  const u = (t - times[lo]) / (times[hi] - times[lo]);
  if (n === 3) return a.map((x, c) => x + (b[c] - x) * u);
  // Quaternion nlerp along the short way (keys are dense, so this matches slerp closely).
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot < 0 ? -1 : 1;
  const q = a.map((x, c) => x * (1 - u) + s * b[c] * u);
  const l = Math.hypot(...q);
  return q.map((x) => x / l);
}
