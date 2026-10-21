import type { FittedSkeleton } from "./skeleton";

/**
 * A skeleton pose: bone-local rotations (x, y, z, w per bone, parent-relative like the fitted
 * skeleton's `localRotations`) and the local position of the root-motion bone. Flat typed arrays,
 * so poses can be sampled, blended and copied every frame without allocating.
 */
export interface Pose {
  rotations: Float32Array;
  /** Local position of bone `rootIndex` (relative to its parent's head, in the parent's frame). */
  root: Float32Array;
  rootIndex: number;
}

export function createPose(boneCount: number, rootIndex = 0): Pose {
  const rotations = new Float32Array(boneCount * 4);
  for (let i = 0; i < boneCount; i++) rotations[i * 4 + 3] = 1;
  return { rotations, root: new Float32Array(3), rootIndex };
}

/** The skeleton's bind pose (`rootIndex`: the bone whose position the pose carries; default the first parentless child of a root, else 0). */
export function bindPose(skeleton: FittedSkeleton, out?: Pose, rootIndex = defaultRoot(skeleton)): Pose {
  const n = skeleton.names.length;
  const pose = out ?? createPose(n, rootIndex);
  skeleton.localRotations.forEach((q, i) => pose.rotations.set(q, i * 4));
  pose.rootIndex = rootIndex;
  pose.root.set(skeleton.localPositions[rootIndex]);
  return pose;
}

function defaultRoot(skeleton: FittedSkeleton): number {
  const i = skeleton.names.indexOf("pelvis");
  return i >= 0 ? i : 0;
}

export function copyPose(src: Pose, out: Pose): Pose {
  out.rotations.set(src.rotations);
  out.root.set(src.root);
  out.rootIndex = src.rootIndex;
  return out;
}

/**
 * out = a → b by t per bone (normalized lerp on the shorter arc; `mask` scales t per bone, the
 * root position follows t · mask[rootIndex]). `out` may be `a` or `b`.
 */
export function blendPoses(a: Pose, b: Pose, t: number, out: Pose, mask?: ArrayLike<number>): Pose {
  const A = a.rotations, B = b.rotations, O = out.rotations, n = A.length / 4;
  for (let i = 0; i < n; i++) {
    const k = mask ? t * mask[i] : t;
    const o = i * 4;
    if (k <= 0) {
      if (out !== a) { O[o] = A[o]; O[o + 1] = A[o + 1]; O[o + 2] = A[o + 2]; O[o + 3] = A[o + 3]; }
      continue;
    }
    const s = A[o] * B[o] + A[o + 1] * B[o + 1] + A[o + 2] * B[o + 2] + A[o + 3] * B[o + 3] < 0 ? -k : k;
    const x = A[o] * (1 - k) + B[o] * s, y = A[o + 1] * (1 - k) + B[o + 1] * s;
    const z = A[o + 2] * (1 - k) + B[o + 2] * s, w = A[o + 3] * (1 - k) + B[o + 3] * s;
    const l = Math.hypot(x, y, z, w) || 1;
    O[o] = x / l; O[o + 1] = y / l; O[o + 2] = z / l; O[o + 3] = w / l;
  }
  const kr = mask ? t * mask[a.rootIndex] : t;
  for (let c = 0; c < 3; c++) out.root[c] = a.root[c] + (b.root[c] - a.root[c]) * kr;
  out.rootIndex = a.rootIndex;
  return out;
}

/**
 * Weighted blend of any number of poses (e.g. idle, walk and run by speed): per bone a weighted
 * sum of rotations on one hemisphere, normalized (the usual normalized-lerp blend tree, which
 * stays smooth as weights move and never goes through angles). Weights need not sum to 1.
 *
 *   mixer.begin(); mixer.add(idle, 0.3).add(walk, 0.7, upperBodyMask); mixer.end(out);
 *
 * Bones no pose added weight to keep `fallback` (or what `out` held).
 */
export class PoseMixer {
  private readonly acc: Float64Array;
  private readonly wsum: Float64Array;
  private readonly root = new Float64Array(3);
  private rootW = 0;
  private rootIndex = 0;

  constructor(readonly boneCount: number) {
    this.acc = new Float64Array(boneCount * 4);
    this.wsum = new Float64Array(boneCount);
  }

  begin(): this {
    this.acc.fill(0);
    this.wsum.fill(0);
    this.root.fill(0);
    this.rootW = 0;
    return this;
  }

  add(pose: Pose, weight: number, mask?: ArrayLike<number>): this {
    if (weight <= 0) return this;
    const R = pose.rotations, A = this.acc, n = this.boneCount;
    for (let i = 0; i < n; i++) {
      const w = mask ? weight * mask[i] : weight;
      if (w <= 0) continue;
      const o = i * 4;
      // Onto the hemisphere of what is already there (q and -q are the same rotation).
      const s = A[o] * R[o] + A[o + 1] * R[o + 1] + A[o + 2] * R[o + 2] + A[o + 3] * R[o + 3] < 0 ? -w : w;
      A[o] += R[o] * s; A[o + 1] += R[o + 1] * s; A[o + 2] += R[o + 2] * s; A[o + 3] += R[o + 3] * s;
      this.wsum[i] += w;
    }
    const wr = mask ? weight * mask[pose.rootIndex] : weight;
    if (wr > 0) {
      for (let c = 0; c < 3; c++) this.root[c] += pose.root[c] * wr;
      this.rootW += wr;
      this.rootIndex = pose.rootIndex;
    }
    return this;
  }

  /** Total weight added on bone i (0: no pose touched it). */
  weight(i: number): number {
    return this.wsum[i];
  }

  end(out: Pose, fallback?: Pose): Pose {
    const A = this.acc, O = out.rotations;
    for (let i = 0; i < this.boneCount; i++) {
      const o = i * 4;
      const l = Math.hypot(A[o], A[o + 1], A[o + 2], A[o + 3]);
      if (this.wsum[i] <= 0 || l < 1e-9) {
        if (fallback) { O[o] = fallback.rotations[o]; O[o + 1] = fallback.rotations[o + 1]; O[o + 2] = fallback.rotations[o + 2]; O[o + 3] = fallback.rotations[o + 3]; }
        continue;
      }
      O[o] = A[o] / l; O[o + 1] = A[o + 1] / l; O[o + 2] = A[o + 2] / l; O[o + 3] = A[o + 3] / l;
    }
    if (this.rootW > 0) {
      for (let c = 0; c < 3; c++) out.root[c] = this.root[c] / this.rootW;
      out.rootIndex = this.rootIndex;
    } else if (fallback) {
      out.root.set(fallback.root);
      out.rootIndex = fallback.rootIndex;
    }
    return out;
  }
}

/**
 * Forward kinematics: model-space rotation (x, y, z, w per bone) and head position (x, y, z per
 * bone) of every bone in a pose. Bones other than the root-motion bone keep their bind offsets.
 */
export function poseWorld(skeleton: FittedSkeleton, pose: Pose, rotations: Float32Array | Float64Array, heads: Float32Array | Float64Array): void {
  const { parents, localPositions } = skeleton;
  const R = pose.rotations;
  for (let i = 0; i < parents.length; i++) {
    const p = parents[i], o = i * 4, h = i * 3;
    const lp = i === pose.rootIndex ? pose.root : localPositions[i];
    if (p < 0) {
      rotations[o] = R[o]; rotations[o + 1] = R[o + 1]; rotations[o + 2] = R[o + 2]; rotations[o + 3] = R[o + 3];
      heads[h] = lp[0]; heads[h + 1] = lp[1]; heads[h + 2] = lp[2];
      continue;
    }
    const po = p * 4, ph = p * 3;
    const ax = rotations[po], ay = rotations[po + 1], az = rotations[po + 2], aw = rotations[po + 3];
    const bx = R[o], by = R[o + 1], bz = R[o + 2], bw = R[o + 3];
    rotations[o] = aw * bx + ax * bw + ay * bz - az * by;
    rotations[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
    rotations[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
    rotations[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
    // head = parent head + parent rotation · local offset
    const vx = lp[0], vy = lp[1], vz = lp[2];
    const tx = 2 * (ay * vz - az * vy), ty = 2 * (az * vx - ax * vz), tz = 2 * (ax * vy - ay * vx);
    heads[h] = heads[ph] + vx + aw * tx + (ay * tz - az * ty);
    heads[h + 1] = heads[ph + 1] + vy + aw * ty + (az * tx - ax * tz);
    heads[h + 2] = heads[ph + 2] + vz + aw * tz + (ax * ty - ay * tx);
  }
}
