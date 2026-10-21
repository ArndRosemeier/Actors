/**
 * The quadruped rig: Mesh2Motion's CC0 "fox" skeleton (also used there for
 * dogs, cats, pandas and horses), read from its glTF animation file.
 *
 * glTF stores Blender bones as joint nodes (local +Y runs from head to tail)
 * but drops the tails. A bone's tail is its connected child's head (the child
 * whose offset lies on the parent's +Y axis); leaf bones get a short tail along
 * their own +Y. Rolls are recovered from the joint frames, so the fitted
 * skeleton has the same bone frames as the source rig.
 */
import { type Mat3, type Quat, type Vec3, boneRotationFromRoll, mat3Apply, mat3AxisAngle, mat3Mul, mat3Transpose, normalize } from "@actors/core";
import type { Gltf } from "../../import-makehuman/src/gltf";
import { restLocals, worldPose } from "../../import-makehuman/src/clips";

export interface RigBone {
  name: string;
  parent: number;
  head: Vec3;
  tail: Vec3;
  roll: number;
  /** glTF node of the joint. */
  node: number;
}

export interface Rig {
  bones: RigBone[];
  index: Map<string, number>;
}

function quatToMat3(q: Quat): Mat3 {
  const [x, y, z, w] = q;
  // Column-major (m[c * 3 + r]), like the rest of @actors/core.
  return new Float64Array([
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ]);
}

const col = (m: Mat3, c: number): Vec3 => [m[c * 3], m[c * 3 + 1], m[c * 3 + 2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// blender (x, y, z) = pack (x, -z, y); P maps blender vectors to pack vectors.
const PACK_FROM_BLENDER: Mat3 = new Float64Array([1, 0, 0, 0, 0, -1, 0, 1, 0]);

/** Roll (Blender convention) that gives a bone along `dir` (pack space) the frame `rot` (pack space, columns = bone axes). */
export function rollFromFrame(rot: Mat3): number {
  const want = mat3Mul(mat3Transpose(PACK_FROM_BLENDER), rot); // blender-space frame
  const dir = normalize(col(want, 1));
  const base = boneRotationFromRoll(dir, 0);
  const x0 = col(base, 0), x1 = col(want, 0);
  return Math.atan2(dot(cross(x0, x1), dir), dot(x0, x1));
}

/** Reads the rig from a glTF whose first skin is the quadruped skeleton. Bones named in `skip` (e.g. "root") are dropped; their children become roots. */
export function readRig(g: Gltf, skip: string[] = ["root"]): Rig {
  const rest = worldPose(g, restLocals(g));
  const joints = g.joints.filter((j) => !skip.includes(g.nodes[j].name));
  const jointSet = new Set(joints);
  const bones: RigBone[] = [];
  const index = new Map<string, number>();
  const nodeToBone = new Map<number, number>();
  for (const j of joints) {
    let p = g.parents[j];
    while (p >= 0 && !jointSet.has(p)) p = g.parents[p];
    const rot = quatToMat3(rest.rot[j]);
    const head = rest.pos[j] as Vec3;
    // Connected child: offset along the parent's +Y only.
    const node = g.nodes[j];
    let len = 0;
    for (const c of node.children) {
      if (!jointSet.has(c)) continue;
      const t = g.nodes[c].translation;
      if (t[1] > 1e-4 && Math.hypot(t[0], t[2]) < 1e-3 * Math.max(1, t[1])) len = Math.max(len, t[1]);
    }
    const parent = p >= 0 ? nodeToBone.get(p)! : -1;
    if (!len) len = parent >= 0 ? 0.6 * Math.hypot(...(bones[parent].tail.map((v, k) => v - bones[parent].head[k]) as Vec3)) : 0.1;
    const y = col(rot, 1);
    const tail: Vec3 = [head[0] + y[0] * len, head[1] + y[1] * len, head[2] + y[2] * len];
    nodeToBone.set(j, bones.length);
    index.set(node.name, bones.length);
    bones.push({ name: node.name, parent, head: [...head], tail, roll: rollFromFrame(rot), node: j });
  }
  return { bones, index };
}

/**
 * A resized copy of the rig: everything scaled by `scale`, then each named
 * bone's length multiplied by its factor. Children keep their offset from the
 * bone's head, stretched along the bone, so limbs and chains stay connected.
 */
export function resizeRig(rig: Rig, scale: number, lengths: Record<string, number> = {}): Rig {
  const bones = rig.bones.map((b) => ({ ...b, head: b.head.map((v) => v * scale) as Vec3, tail: b.tail.map((v) => v * scale) as Vec3 }));
  const out = bones.map((b) => ({ ...b, head: [...b.head] as Vec3, tail: [...b.tail] as Vec3 }));
  // Map of bone b: x -> newHead[b] + (I + (f - 1) d dᵀ)(x - head[b]).
  const mapPoint = (b: number, x: Vec3): Vec3 => {
    const f = lengths[bones[b].name] ?? 1;
    const h = bones[b].head;
    const d = normalize(bones[b].tail.map((v, k) => v - h[k]) as Vec3);
    const r: Vec3 = [x[0] - h[0], x[1] - h[1], x[2] - h[2]];
    const s = (f - 1) * dot(r, d);
    return [out[b].head[0] + r[0] + s * d[0], out[b].head[1] + r[1] + s * d[1], out[b].head[2] + r[2] + s * d[2]];
  };
  bones.forEach((b, i) => {
    if (b.parent >= 0) out[i].head = mapPoint(b.parent, b.head);
    out[i].tail = mapPoint(i, b.tail);
  });
  return { bones: out, index: rig.index };
}

/** World-space rest rotation of each rig bone as a matrix (columns = bone axes, pack space). */
export function boneFrame(b: RigBone): Mat3 {
  const dir = normalize(b.tail.map((v, k) => v - b.head[k]) as Vec3);
  const blenderDir: Vec3 = [dir[0], -dir[2], dir[1]];
  return mat3Mul(PACK_FROM_BLENDER, boneRotationFromRoll(normalize(blenderDir), b.roll));
}

/**
 * Re-poses the rig: turns bone `root` and everything below it by `angle`
 * (radians) about `axis` through the bone's head. Rolls follow, so each bone
 * keeps its frame relative to the turned chain.
 */
export function turnChain(rig: Rig, root: string, axis: Vec3, angle: number): void {
  const r = rig.index.get(root);
  if (r === undefined) throw new Error(`No bone ${root}`);
  const inChain = (i: number): boolean => i === r || (rig.bones[i].parent >= 0 && inChain(rig.bones[i].parent));
  const pivot = [...rig.bones[r].head] as Vec3;
  const m = mat3AxisAngle(normalize(axis), angle);
  const turn = (p: Vec3): Vec3 => {
    const q = mat3Apply(m, [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]]);
    return [q[0] + pivot[0], q[1] + pivot[1], q[2] + pivot[2]];
  };
  rig.bones.forEach((b, i) => {
    if (!inChain(i)) return;
    const frame = mat3Mul(m, boneFrame(b));
    b.head = turn(b.head);
    b.tail = turn(b.tail);
    b.roll = rollFromFrame(frame);
  });
}

/** Moves bone `root` and everything below it by `offset`. */
export function shiftChain(rig: Rig, root: string, offset: Vec3): void {
  const r = rig.index.get(root);
  if (r === undefined) throw new Error(`No bone ${root}`);
  const inChain = (i: number): boolean => i === r || (rig.bones[i].parent >= 0 && inChain(rig.bones[i].parent));
  rig.bones.forEach((b, i) => {
    if (!inChain(i)) return;
    b.head = [b.head[0] + offset[0], b.head[1] + offset[1], b.head[2] + offset[2]];
    b.tail = [b.tail[0] + offset[0], b.tail[1] + offset[1], b.tail[2] + offset[2]];
  });
}
