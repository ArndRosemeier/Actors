import type { ClipDef } from "./format";
import { type Quat, type Vec3, normalize, quatConjugate, quatFromMat3, quatMul } from "./math";
import type { FittedSkeleton } from "./skeleton";
import { type Pose, createPose } from "./pose";

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

const Q0 = new Float64Array(4);

/** out = slerp(a, b, t) (b flipped to a's hemisphere). */
function slerpInto(out: Float64Array, ax: number, ay: number, az: number, aw: number, bx: number, by: number, bz: number, bw: number, t: number): void {
  let cos = ax * bx + ay * by + az * bz + aw * bw;
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
  const x = ax * k0 + bx * k1, y = ay * k0 + by * k1, z = az * k0 + bz * k1, w = aw * k0 + bw * k1;
  const l = Math.hypot(x, y, z, w) || 1;
  out[0] = x / l; out[1] = y / l; out[2] = z / l; out[3] = w / l;
}

/** out[o..o+3] = a · b. */
function mulInto(out: Float32Array | Float64Array, o: number, ax: number, ay: number, az: number, aw: number, bx: number, by: number, bz: number, bw: number): void {
  out[o] = aw * bx + ax * bw + ay * bz - az * by;
  out[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** out = q · v · q⁻¹ (q unit). */
function rotateInto(out: Float32Array, qx: number, qy: number, qz: number, qw: number, vx: number, vy: number, vz: number): void {
  // t = 2 q.xyz × v; v' = v + w t + q.xyz × t
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
}

export interface RetargetPose {
  /** Bone-local rotation per skeleton bone. */
  rotations: Quat[];
  /** Local position of the root-motion bone. */
  rootPosition: Vec3;
  rootIndex: number;
}

/**
 * Bones whose rest direction is turned onto the clip's before the motion is applied.
 * Limb bones run along the limb in every rig, so matching directions matches the
 * anatomy (e.g. a T-pose source onto an A-pose target). Torso, neck, head and
 * clavicle bones are placed differently per rig (a clavicle may start at the
 * sternum or the spine, a pelvis bone may point up or tilt back), so aligning
 * them would tilt the pelvis and lift the shoulders; they only get the clip's
 * change since its rest pose. Quadruped legs (the animal rig's Front_/Back_Leg
 * bones below the shoulder blade and pelvis) count as limbs too.
 */
export const LIMB_BONES =
  /^((upperarm|lowerarm|hand|thigh|calf|foot|ball)_[lr]|(index|middle|ring|pinky|thumb)_0[1-3]_[lr]|(Front|Back)_Leg_(Upper|Lower|Ankle|Foot|Foot_1)_[LR])$/;

export interface RetargetOptions {
  /**
   * Keep the root bone over its rest spot: true drops the horizontal root motion entirely,
   * "drift" only the steady travel over the loop (the hips keep their sway).
   */
  inPlace?: boolean | "drift";
  /** Bones whose rest direction is turned onto the clip's (default: LIMB_BONES). */
  align?: (bone: string) => boolean;
}

/** Plays a retargetable clip on a fitted skeleton. Rebuild when the skeleton is re-fitted. */
export class Retargeter {
  private readonly track: Int32Array; // skeleton bone -> clip track index, or -1
  private readonly worldRef: Quat[];
  private readonly bindWorld: Quat[];
  private readonly rootIndex: number;
  private readonly hipHeight: number;
  readonly duration: number;
  private readonly scratch: Float64Array;

  constructor(
    private readonly skeleton: FittedSkeleton,
    private readonly clip: Clip,
    private readonly options: RetargetOptions = {},
  ) {
    const { names } = skeleton;
    const def = clip.def;
    this.track = new Int32Array(names.length).fill(-1);
    def.bones.forEach((b, k) => {
      const i = names.indexOf(b);
      if (i >= 0) this.track[i] = k;
    });
    this.bindWorld = skeleton.worldRotations.map((m) => quatFromMat3(m));
    // Reference pose: each animated limb bone turned (shortest arc) to the clip's reference direction.
    const align = options.align ?? ((b: string) => LIMB_BONES.test(b));
    this.worldRef = names.map((name, i) => {
      const k = this.track[i];
      if (k < 0 || !align(name)) return this.bindWorld[i];
      const boneDir = rotate(this.bindWorld[i], [0, 1, 0]);
      const ref = normalize([def.refDirs[k * 3], def.refDirs[k * 3 + 1], def.refDirs[k * 3 + 2]]);
      return quatMul(quatFromTo(boneDir, ref), this.bindWorld[i]);
    });
    this.rootIndex = names.indexOf(def.rootBone);
    const root = skeleton.parents[this.rootIndex] >= 0 ? skeleton.heads[skeleton.parents[this.rootIndex]] : [0, 0, 0];
    this.hipHeight = Math.max(0.1, skeleton.heads[this.rootIndex][1] - root[1]);
    this.duration = (def.frameCount - 1) / def.fps;
    this.scratch = new Float64Array(names.length * 4);
  }

  private frameRoot(frame: number): Vec3 {
    const stride = this.clip.def.bones.length * 4 + 3;
    const o = frame * stride + this.clip.def.bones.length * 4;
    const d = this.clip.data;
    return [d[o], d[o + 1], d[o + 2]];
  }

  sample(time: number): RetargetPose {
    const pose = createPose(this.skeleton.names.length, this.rootIndex);
    this.sampleInto(time, pose);
    const rotations: Quat[] = this.skeleton.names.map((_, i) => {
      const r = pose.rotations;
      return [r[i * 4], r[i * 4 + 1], r[i * 4 + 2], r[i * 4 + 3]];
    });
    return { rotations, rootPosition: [pose.root[0], pose.root[1], pose.root[2]], rootIndex: this.rootIndex };
  }

  /** Root-motion bone's offset from its bind head over the whole clip (last frame less first), in the skeleton's units. */
  travel(): Vec3 {
    const a = this.frameRoot(0), b = this.frameRoot(this.clip.def.frameCount - 1);
    return [(b[0] - a[0]) * this.hipHeight, (b[1] - a[1]) * this.hipHeight, (b[2] - a[2]) * this.hipHeight];
  }

  /**
   * Same as `sample`, into a pose buffer without allocating (for playing many characters every
   * frame). `out` needs one slot per skeleton bone; `out.rootIndex` is set.
   */
  sampleInto(time: number, out: Pose): Pose {
    const { def } = this.clip;
    const { parents, localRotations, heads } = this.skeleton;
    const n = parents.length;
    const last = def.frameCount - 1;
    let t = time * def.fps;
    t = def.loop && last > 0 ? ((t % last) + last) % last : Math.min(Math.max(t, 0), last);
    const f0 = Math.floor(t), f1 = Math.min(f0 + 1, last), u = t - f0;
    const W = this.scratch, R = out.rotations, d = this.clip.data;
    const stride = def.bones.length * 4 + 3;
    for (let i = 0; i < n; i++) {
      const p = parents[i], k = this.track[i], o = i * 4;
      if (k >= 0) {
        // Clip delta (slerp between frames), then onto the reference pose: world = delta · ref.
        const a = f0 * stride + k * 4, b = f1 * stride + k * 4;
        slerpInto(Q0, d[a], d[a + 1], d[a + 2], d[a + 3], d[b], d[b + 1], d[b + 2], d[b + 3], u);
        const r = this.worldRef[i];
        mulInto(W, o, Q0[0], Q0[1], Q0[2], Q0[3], r[0], r[1], r[2], r[3]);
      } else if (p >= 0) {
        // Not animated: keep the bind relationship to the parent.
        const l = localRotations[i], po = p * 4;
        mulInto(W, o, W[po], W[po + 1], W[po + 2], W[po + 3], l[0], l[1], l[2], l[3]);
      } else {
        const r = this.bindWorld[i];
        W[o] = r[0]; W[o + 1] = r[1]; W[o + 2] = r[2]; W[o + 3] = r[3];
      }
      if (p >= 0) {
        const po = p * 4;
        mulInto(R, o, -W[po], -W[po + 1], -W[po + 2], W[po + 3], W[o], W[o + 1], W[o + 2], W[o + 3]);
      } else {
        R[o] = W[o]; R[o + 1] = W[o + 1]; R[o + 2] = W[o + 2]; R[o + 3] = W[o + 3];
      }
    }

    const ri = this.rootIndex, hh = this.hipHeight;
    const ra = f0 * stride + def.bones.length * 4, rb = f1 * stride + def.bones.length * 4;
    let rx = (d[ra] + (d[rb] - d[ra]) * u) * hh;
    const ry = (d[ra + 1] + (d[rb + 1] - d[ra + 1]) * u) * hh;
    let rz = (d[ra + 2] + (d[rb + 2] - d[ra + 2]) * u) * hh;
    const mode = this.options.inPlace;
    if (mode === "drift") {
      // Take out the steady travel over the loop, keep the sway around it.
      const end = last * stride + def.bones.length * 4;
      const k = t / Math.max(1, last);
      rx -= (d[end] - d[0 * stride + def.bones.length * 4]) * hh * k;
      rz -= (d[end + 2] - d[def.bones.length * 4 + 2]) * hh * k;
    } else if (mode) rx = rz = 0;
    out.rootIndex = ri;
    const pi = parents[ri];
    if (pi < 0) {
      out.root[0] = heads[ri][0] + rx; out.root[1] = heads[ri][1] + ry; out.root[2] = heads[ri][2] + rz;
    } else {
      // Head relative to the parent, in the parent's (posed) frame.
      const po = pi * 4;
      rotateInto(out.root, -W[po], -W[po + 1], -W[po + 2], W[po + 3], heads[ri][0] + rx - heads[pi][0], heads[ri][1] + ry - heads[pi][1], heads[ri][2] + rz - heads[pi][2]);
    }
    return out;
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
