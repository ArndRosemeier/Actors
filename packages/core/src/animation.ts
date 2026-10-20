import type { FittedSkeleton } from "./skeleton";
import { type Quat, type Vec3, mat3Apply, mat3Transpose, quatAxisAngle, quatMul } from "./math";

/**
 * A simple, rig-agnostic animation description: each key rotates a bone
 * around an axis given in model space *as it is in the bind pose*
 * (e.g. "swing the thigh forward around X"). Converting to bone-local
 * rotations happens against the fitted skeleton, so clips keep working for
 * any body shape. Meant for procedural/test motion; real mocap is retargeted.
 */
export interface AxisKey {
  t: number;
  deg: number;
}

export interface AxisTrack {
  bone: string;
  axis: Vec3;
  keys: AxisKey[];
}

export interface AxisClip {
  name: string;
  duration: number;
  tracks: AxisTrack[];
}

function sampleKeys(keys: AxisKey[], t: number): number {
  if (t <= keys[0].t) return keys[0].deg;
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1], b = keys[i];
      const u = (t - a.t) / (b.t - a.t);
      const s = u * u * (3 - 2 * u); // smoothstep easing between keys
      return a.deg + (b.deg - a.deg) * s;
    }
  }
  return keys[keys.length - 1].deg;
}

/** Bone-local rotations (bind rotation combined with the clip's deltas) for the bones the clip touches. */
export function sampleAxisClip(skeleton: FittedSkeleton, clip: AxisClip, time: number): Map<string, Quat> {
  const index = new Map(skeleton.names.map((n, i) => [n, i]));
  const deltas = new Map<number, Quat>();
  for (const track of clip.tracks) {
    const i = index.get(track.bone);
    if (i === undefined) continue;
    // Express the model-space axis in the bone's own bind frame.
    const localAxis = mat3Apply(mat3Transpose(skeleton.worldRotations[i]), track.axis);
    const q = quatAxisAngle(localAxis, (sampleKeys(track.keys, time) * Math.PI) / 180);
    deltas.set(i, deltas.has(i) ? quatMul(deltas.get(i)!, q) : q);
  }
  const out = new Map<string, Quat>();
  for (const [i, delta] of deltas) out.set(skeleton.names[i], quatMul(skeleton.localRotations[i], delta));
  return out;
}

/** Samples a clip at a fixed rate, for renderers that want keyframe tracks (e.g. glTF export). */
export function bakeAxisClip(skeleton: FittedSkeleton, clip: AxisClip, fps = 30) {
  const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(frames);
  const tracks = new Map<string, Float32Array>();
  for (let f = 0; f < frames; f++) {
    const t = (f / (frames - 1)) * clip.duration;
    times[f] = t;
    for (const [bone, q] of sampleAxisClip(skeleton, clip, t)) {
      if (!tracks.has(bone)) tracks.set(bone, new Float32Array(frames * 4));
      tracks.get(bone)!.set(q, f * 4);
    }
  }
  return { times, tracks };
}
