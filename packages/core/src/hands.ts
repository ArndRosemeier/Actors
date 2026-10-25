import { mat3Apply, mat3Transpose, normalize, sub, type Vec3 } from "./math";
import type { FittedSkeleton } from "./skeleton";

/** One finger joint's curl: the bone, its bend axis in the bone's own frame, and the angle of a full fist (radians). */
export interface FingerCurl {
  bone: number;
  axis: Vec3;
  angle: number;
}

/** Fist angles per joint (degrees): base, middle, tip; the thumb folds less. */
const FIST: Record<string, [number, number, number]> = {
  index: [70, 95, 60],
  middle: [75, 95, 60],
  ring: [80, 95, 60],
  pinky: [85, 95, 60],
  thumb: [10, 35, 45],
};

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * How to close one hand (`side` "l" or "r") into a fist on a skeleton with game-engine finger bones
 * (`index_01_r` … `thumb_03_r`): each joint turns its tip toward the palm. The palm faces the side the
 * thumb sits on, seen from the knuckles. Empty when the skeleton has no such hand.
 */
export function fistCurls(s: FittedSkeleton, side: "l" | "r"): FingerCurl[] {
  const at = (name: string) => s.names.indexOf(`${name}_${side}`);
  const hand = at("hand"), index = at("index_01"), pinky = at("pinky_01"), thumb = at("thumb_01");
  if (hand < 0 || index < 0 || pinky < 0 || thumb < 0) return [];
  // The palm's normal: across the knuckles × along the hand, turned to the thumb's side.
  const across = sub(s.heads[index], s.heads[pinky]);
  const along = sub(s.heads[index], s.heads[hand]);
  let palm = normalize(cross(across, along));
  const knuckles: Vec3 = [(s.heads[index][0] + s.heads[pinky][0]) / 2, (s.heads[index][1] + s.heads[pinky][1]) / 2, (s.heads[index][2] + s.heads[pinky][2]) / 2];
  if (dot(palm, sub(s.tails[thumb], knuckles)) < 0) palm = [-palm[0], -palm[1], -palm[2]];
  const out: FingerCurl[] = [];
  for (const [finger, angles] of Object.entries(FIST)) {
    angles.forEach((deg, j) => {
      const bone = at(`${finger}_0${j + 1}`);
      if (bone < 0) return;
      const dir = normalize(sub(s.tails[bone], s.heads[bone]));
      // Turning the bone's direction toward the palm; the thumb folds across it.
      const axis = finger === "thumb" ? normalize(cross(dir, sub(knuckles, s.heads[bone]))) : normalize(cross(dir, palm));
      out.push({ bone, axis: normalize(mat3Apply(mat3Transpose(s.worldRotations[bone]), axis)), angle: (deg * Math.PI) / 180 });
    });
  }
  return out;
}
