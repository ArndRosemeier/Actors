import { type Pose, PoseMixer, createPose, poseWorld } from "./pose";
import { type Clip, type RetargetOptions, Retargeter } from "./retarget";
import type { FittedSkeleton } from "./skeleton";

/** What a looping gait clip does on one skeleton. */
export interface GaitMeasure {
  /** Loop length (s). */
  duration: number;
  /** Ground covered per loop (skeleton units, usually m). */
  stride: number;
  /** Natural ground speed (stride / duration). */
  speed: number;
  /** Normalized loop time (0..1) at which the left foot is furthest ahead of the hips (its heel strike). */
  strike: number;
}

export interface GaitBones {
  /** The foot whose strike sets the phase (default "foot_l"). */
  foot?: string;
  /** The hips (default "pelvis"). */
  hips?: string;
}

/**
 * Measures a looping gait clip on a skeleton: stride and speed from its root motion (in-place
 * loops: from how fast a planted foot moves back under the hips), and when the left foot strikes
 * (furthest ahead of the hips along the direction of travel; clips that do not travel use +Z,
 * the skeleton's forward).
 */
export function measureGait(skeleton: FittedSkeleton, clip: Clip, bones: GaitBones = {}, samples = 64): GaitMeasure {
  const r = new Retargeter(skeleton, clip, { inPlace: "drift" });
  const [tx, , tz] = new Retargeter(skeleton, clip).travel();
  const travel = Math.hypot(tx, tz);
  const duration = r.duration;
  const dir = travel > 1e-3 ? [tx / travel, tz / travel] : [0, 1];
  const footName = bones.foot ?? "foot_l";
  const feet = [footName, footName.replace(/_l$/, "_r").replace(/_L$/, "_R").replace(/Left/, "Right")].map((b) => skeleton.names.indexOf(b));
  const hips = skeleton.names.indexOf(bones.hips ?? "pelvis");
  let strike = 0, stride = travel;
  if (feet[0] >= 0 && hips >= 0 && duration > 0) {
    const n = skeleton.names.length;
    const pose = createPose(n), rot = new Float64Array(n * 4), heads = new Float64Array(n * 3);
    // Per sample and foot: how far ahead of the hips, and how high.
    // (Toes too: a runner stands on the ball of the foot while the ankle already rises.)
    const toes = feet.map((f) => (f >= 0 ? Array.from(skeleton.parents).indexOf(f) : -1));
    const ahead = feet.map(() => new Float64Array(samples)), high = feet.map(() => new Float64Array(samples)), toeHigh = feet.map(() => new Float64Array(samples));
    for (let s = 0; s < samples; s++) {
      r.sampleInto((s / samples) * duration, pose);
      poseWorld(skeleton, pose, rot, heads);
      feet.forEach((f, k) => {
        if (f < 0) return;
        ahead[k][s] = (heads[f * 3] - heads[hips * 3]) * dir[0] + (heads[f * 3 + 2] - heads[hips * 3 + 2]) * dir[1];
        high[k][s] = heads[f * 3 + 1];
        toeHigh[k][s] = toes[k] >= 0 ? heads[toes[k] * 3 + 1] : Infinity;
      });
    }
    let best = -Infinity;
    for (let s = 0; s < samples; s++) if (ahead[0][s] > best) { best = ahead[0][s]; strike = s / samples; }
    if (travel <= 1e-3) {
      // An in-place loop: the ground speed is how fast a planted foot slides back under the hips
      // (a foot whose ankle or toes are within 2 cm of their lowest counts as planted).
      const dt = duration / samples;
      let sum = 0, cnt = 0;
      feet.forEach((f, k) => {
        if (f < 0) return;
        const lo = Math.min(...high[k]), toeLo = Math.min(...toeHigh[k]);
        for (let s = 0; s < samples; s++) {
          if (high[k][s] > lo + 0.02 && toeHigh[k][s] > toeLo + 0.02) continue;
          const v = -(ahead[k][(s + 1) % samples] - ahead[k][(s + samples - 1) % samples]) / (2 * dt);
          if (v > 0) { sum += v; cnt++; }
        }
      });
      stride = cnt ? (sum / cnt) * duration : 0;
    }
  }
  return { duration, stride, speed: duration > 0 ? stride / duration : 0, strike };
}

/** A gait in a locomotion blend: full weight between `from` and `to` (m/s; both default to the clip's own speed). */
export interface GaitClip {
  clip: Clip;
  from?: number;
  to?: number;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Speed-driven locomotion: walk → jog → sprint (or any set of looping gaits) blended by ground
 * speed, all in step. The caller keeps one phase (0..1, 0 = left heel strike) and advances it by
 * distance travelled / `stride(weights)`, so feet never slide whatever the speed; each clip plays
 * at the phase from its own measured strike, so blended clips put their feet down together.
 *
 *   const w = loco.weights(speed);
 *   phase = (phase + speed * dt / loco.stride(w)) % 1;
 *   loco.sample(phase, w, pose);
 */
export class Locomotion {
  readonly gaits: { retargeter: Retargeter; measure: GaitMeasure; from: number; to: number }[];
  private readonly mixer: PoseMixer;
  private readonly tmp: Pose;

  constructor(
    readonly skeleton: FittedSkeleton,
    clips: GaitClip[],
    options: { inPlace?: RetargetOptions["inPlace"]; bones?: GaitBones } = {},
  ) {
    this.gaits = clips
      .map((g) => {
        const measure = measureGait(skeleton, g.clip, options.bones);
        const from = g.from ?? measure.speed;
        return { retargeter: new Retargeter(skeleton, g.clip, { inPlace: options.inPlace ?? "drift" }), measure, from, to: Math.max(from, g.to ?? measure.speed) };
      })
      .sort((a, b) => a.from - b.from);
    this.mixer = new PoseMixer(skeleton.names.length);
    this.tmp = createPose(skeleton.names.length);
  }

  /** Weight of each gait (in `gaits` order) at a ground speed; they sum to 1. */
  weights(speed: number, out = new Float32Array(this.gaits.length)): Float32Array {
    const g = this.gaits;
    out.fill(0);
    if (!g.length) return out;
    if (speed <= g[0].to) { out[0] = 1; return out; }
    for (let i = 0; i < g.length - 1; i++) {
      if (speed <= g[i].to) { out[i] = 1; return out; }
      if (speed < g[i + 1].from) {
        const t = smooth((speed - g[i].to) / Math.max(1e-6, g[i + 1].from - g[i].to));
        out[i] = 1 - t;
        out[i + 1] = t;
        return out;
      }
    }
    out[g.length - 1] = 1;
    return out;
  }

  /** Ground covered per cycle by the blend (skeleton units). */
  stride(weights: ArrayLike<number>): number {
    let s = 0, w = 0;
    this.gaits.forEach((g, i) => { s += g.measure.stride * weights[i]; w += weights[i]; });
    return w > 0 ? s / w : this.gaits[0]?.measure.stride ?? 1;
  }

  /** Natural speed of the blend (what a phase advanced by real time would give). */
  speed(weights: ArrayLike<number>): number {
    let s = 0, w = 0;
    this.gaits.forEach((g, i) => { s += g.measure.speed * weights[i]; w += weights[i]; });
    return w > 0 ? s / w : 0;
  }

  /** The blended pose at a phase (0 = left heel strike). */
  sample(phase: number, weights: ArrayLike<number>, out: Pose): Pose {
    this.mixer.begin();
    this.gaits.forEach((g, i) => {
      const w = weights[i];
      if (w <= 0.001) return;
      const u = (((phase + g.measure.strike) % 1) + 1) % 1;
      g.retargeter.sampleInto(u * g.measure.duration, this.tmp);
      this.mixer.add(this.tmp, w);
    });
    return this.mixer.end(out);
  }
}
