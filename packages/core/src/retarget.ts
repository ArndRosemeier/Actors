import type { ClipDef } from "./format";
import { type Quat, type Vec3, normalize, quatConjugate, quatFromMat3, quatMul } from "./math";
import type { FittedSkeleton } from "./skeleton";

export interface Clip {
  def: ClipDef;
  data: Float32Array;
}

function rotate(q: Quat, v: Vec3): Vec3 {
  const p = quatMul(quatMul(q, [v[0], v[1], v[2], 0]), quatConjugate(q));
  return [p[0], p[1], p[2]];
}

/** Shortest-arc rotation taking unit vector a onto unit vector b. */
export function quatFromTo(a: Vec3, b: Vec3): Quat {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.999999) {
    const axis = Math.abs(a[0]) < 0.9 ? normalize([0, -a[2], a[1]]) : normalize([a[2], 0, -a[0]]);
    return [axis[0], axis[1], axis[2], 0];
  }
  const c: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const q: Quat = [c[0], c[1], c[2], 1 + d];
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

function slerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  let k0 = 1 - t, k1 = t;
  if (cos < 0.9995) {
    const th = Math.acos(cos), s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s;
    k1 = Math.sin(t * th) / s;
  }
  const q: Quat = [a[0] * k0 + bx * k1, a[1] * k0 + by * k1, a[2] * k0 + bz * k1, a[3] * k0 + bw * k1];
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export interface RetargetPose {
  /** Bone-local rotation per skeleton bone. */
  rotations: Quat[];
  /** Local position of the root-motion bone. */
  rootPosition: Vec3;
  rootIndex: number;
}

/** Plays a retargetable clip on a fitted skeleton. Rebuild when the skeleton is re-fitted. */
export class Retargeter {
  private readonly track: Int32Array; // skeleton bone -> clip track index, or -1
  private readonly worldRef: Quat[];
  private readonly bindWorld: Quat[];
  private readonly rootIndex: number;
  private readonly hipHeight: number;
  readonly duration: number;

  constructor(
    private readonly skeleton: FittedSkeleton,
    private readonly clip: Clip,
    private readonly options: { inPlace?: boolean } = {},
  ) {
    const { names } = skeleton;
    const def = clip.def;
    this.track = new Int32Array(names.length).fill(-1);
    def.bones.forEach((b, k) => {
      const i = names.indexOf(b);
      if (i >= 0) this.track[i] = k;
    });
    this.bindWorld = skeleton.worldRotations.map((m) => quatFromMat3(m));
    // Reference pose: each animated bone turned (shortest arc) to the clip's reference direction.
    this.worldRef = names.map((_, i) => {
      const k = this.track[i];
      if (k < 0) return this.bindWorld[i];
      const boneDir = rotate(this.bindWorld[i], [0, 1, 0]);
      const ref = normalize([def.refDirs[k * 3], def.refDirs[k * 3 + 1], def.refDirs[k * 3 + 2]]);
      return quatMul(quatFromTo(boneDir, ref), this.bindWorld[i]);
    });
    this.rootIndex = names.indexOf(def.rootBone);
    const root = skeleton.parents[this.rootIndex] >= 0 ? skeleton.heads[skeleton.parents[this.rootIndex]] : [0, 0, 0];
    this.hipHeight = Math.max(0.1, skeleton.heads[this.rootIndex][1] - root[1]);
    this.duration = (def.frameCount - 1) / def.fps;
  }

  private frameQuat(frame: number, k: number): Quat {
    const stride = this.clip.def.bones.length * 4 + 3;
    const o = frame * stride + k * 4;
    const d = this.clip.data;
    return [d[o], d[o + 1], d[o + 2], d[o + 3]];
  }

  private frameRoot(frame: number): Vec3 {
    const stride = this.clip.def.bones.length * 4 + 3;
    const o = frame * stride + this.clip.def.bones.length * 4;
    const d = this.clip.data;
    return [d[o], d[o + 1], d[o + 2]];
  }

  sample(time: number): RetargetPose {
    const { def } = this.clip;
    const { names, parents, localRotations, heads } = this.skeleton;
    let t = time * def.fps;
    t = def.loop ? ((t % (def.frameCount - 1)) + (def.frameCount - 1)) % (def.frameCount - 1) : Math.min(Math.max(t, 0), def.frameCount - 1);
    const f0 = Math.floor(t), f1 = Math.min(f0 + 1, def.frameCount - 1), u = t - f0;

    const world: Quat[] = [];
    const rotations: Quat[] = [];
    names.forEach((_, i) => {
      const p = parents[i];
      const k = this.track[i];
      let w: Quat;
      if (k >= 0) {
        const delta = slerp(this.frameQuat(f0, k), this.frameQuat(f1, k), u);
        w = quatMul(delta, this.worldRef[i]);
      } else {
        // Not animated: keep the bind relationship to the parent.
        w = p >= 0 ? quatMul(world[p], localRotations[i]) : this.bindWorld[i];
      }
      world.push(w);
      rotations.push(p >= 0 ? quatMul(quatConjugate(world[p]), w) : w);
    });

    const a = this.frameRoot(f0), b = this.frameRoot(f1);
    const r: Vec3 = [0, 1, 2].map((c) => (a[c] + (b[c] - a[c]) * u) * this.hipHeight) as Vec3;
    if (this.options.inPlace) r[0] = r[2] = 0;
    const ri = this.rootIndex;
    const pi = parents[ri];
    const headWorld: Vec3 = [heads[ri][0] + r[0], heads[ri][1] + r[1], heads[ri][2] + r[2]];
    const rel: Vec3 = pi >= 0 ? [headWorld[0] - heads[pi][0], headWorld[1] - heads[pi][1], headWorld[2] - heads[pi][2]] : headWorld;
    const rootPosition = pi >= 0 ? rotate(quatConjugate(world[pi]), rel) : rel;
    return { rotations, rootPosition, rootIndex: ri };
  }

  /** Samples at a fixed rate for keyframe-based renderers / glTF export. */
  bake(fps = 30) {
    const frames = Math.max(2, Math.round(this.duration * fps) + 1);
    const times = new Float32Array(frames);
    const rotations = this.skeleton.names.map(() => new Float32Array(frames * 4));
    const rootPositions = new Float32Array(frames * 3);
    for (let f = 0; f < frames; f++) {
      const t = (f / (frames - 1)) * this.duration;
      times[f] = t;
      const pose = this.sample(t);
      pose.rotations.forEach((q, i) => rotations[i].set(q, f * 4));
      rootPositions.set(pose.rootPosition, f * 3);
    }
    return { times, rotations, rootPositions, rootBone: this.skeleton.names[this.rootIndex] };
  }
}

export { slerp as quatSlerp };
