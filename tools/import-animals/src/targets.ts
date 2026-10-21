/**
 * Breed morphs: deformations of the base dog that bone proportions can't
 * express (ear carriage, muzzle breadth, stop, chest depth, belly tuck, tail
 * curl). Each is computed from the base vertices and stored as an ordinary
 * morph target. Skeleton joints are vertices too (see import.ts), so ears and
 * tails that change carriage carry their bones along.
 */
import { type Vec3, normalize } from "@actors/core";
import type { Rig } from "./rig";

export interface MorphInput {
  positions: Float32Array;
  rig: Rig;
  /** Bone weight of vertex v for a bone (0..1). */
  weight(v: number, bone: string): number;
  /** Rigid vertices (eyes) move with this point instead of their own position. */
  anchor: (v: number) => Vec3 | null;
  stop: Vec3;
  noseTip: Vec3;
  eyeCenter: Vec3;
}

export interface Morph {
  name: string;
  group: string;
  deltas: Float32Array;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Rotates p about the axis through `origin` (Rodrigues). */
function rotateAbout(p: Vec3, origin: Vec3, axis: Vec3, angle: number): Vec3 {
  const k = normalize(axis);
  const v = sub(p, origin);
  const c = Math.cos(angle), s = Math.sin(angle);
  const kxv: Vec3 = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  const kv = dot(k, v);
  return [0, 1, 2].map((i) => origin[i] + v[i] * c + kxv[i] * s + k[i] * kv * (1 - c)) as Vec3;
}

/** Builds a morph from a per-point deformation; rigid vertices follow their anchor. */
function morph(name: string, group: string, input: MorphInput, deform: (p: Vec3, v: number) => Vec3): Morph {
  const P = input.positions;
  const n = P.length / 3;
  const deltas = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const a = input.anchor(v);
    const p: Vec3 = a ?? [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    const q = deform(p, v);
    deltas[v * 3] = q[0] - p[0];
    deltas[v * 3 + 1] = q[1] - p[1];
    deltas[v * 3 + 2] = q[2] - p[2];
  }
  return { name, group, deltas };
}

export function dogMorphs(input: MorphInput): Morph[] {
  const { rig, weight, stop, noseTip } = input;
  const bone = (n: string) => rig.bones[rig.index.get(n)!];
  const out: Morph[] = [];

  // --- Ears ---
  const earMorph = (name: string, fold: (side: 1 | -1) => { at: number; axis: Vec3; angle: number; shift?: Vec3; twist?: number }, amount = 1) =>
    out.push(
      morph(name, "ears", input, (p, v) => {
        {
          // The side the vertex is on (weights can leak a little across the skull).
          const side = p[0] >= 0 ? 1 : -1;
          const s = side > 0 ? "L" : "R";
          const w = weight(v, `Ear_${s}`) + weight(v, `Ear_Tip_${s}`);
          if (w <= 0) return p;
          const base = bone(`Ear_${s}`).head, tip = bone(`Ear_Tip_${s}`).tail;
          const axis = sub(tip, base);
          const len = Math.hypot(...axis);
          const t = dot(sub(p, base), axis) / (len * len);
          const f = fold(side);
          // Bend smoothly over a short stretch around the fold line, then carry the rest rigidly.
          const hinge: Vec3 = [base[0] + axis[0] * f.at, base[1] + axis[1] * f.at, base[2] + axis[2] * f.at];
          const k = smoothstep(f.at - 0.12, f.at + 0.12, t);
          // Twist about the ear's own axis first (a hanging flap lies flat against the cheek), then bend.
          const twisted = f.twist ? rotateAbout(p, base, axis, f.twist * amount * smoothstep(-0.1, 0.3, t)) : p;
          const q = rotateAbout(twisted, hinge, f.axis, f.angle * amount * k);
          // Hanging ears also move out, so the flap clears the skull and cheek.
          const sh = f.shift ?? [0, 0, 0];
          for (let c = 0; c < 3; c++) q[c] += sh[c] * amount * k;
          // The flap moves rigidly; only its root (where the weights fade into the head) blends.
          const m = smoothstep(0.12, 0.45, w) * smoothstep(-0.08, 0.08, t);
          return [p[0] + (q[0] - p[0]) * m, p[1] + (q[1] - p[1]) * m, p[2] + (q[2] - p[2]) * m];
        }
        return p;
      }),
    );
  // Drop ears: the whole flap hangs down beside the cheek.
  // Rotations this large can't be blended linearly, so each has an in-between target at half the angle
  // (the "-half" ones; see @actors/animal dogTargetWeights).
  earMorph("ears-drop", (side) => ({ at: 0.12, axis: [0, -0.1 * side, side], angle: -2.8, shift: [0.03 * side, 0.002, 0.008], twist: 1.35 * side }));
  earMorph("ears-drop-half", (side) => ({ at: 0.12, axis: [0, -0.1 * side, side], angle: -2.8, shift: [0.03 * side, 0.002, 0.008], twist: 1.35 * side }), 0.5);
  // Folded tips (button / semi-prick ears): the upper half folds forward.
  earMorph("ears-fold", (side) => ({ at: 0.5, axis: [side, 0, -0.2 * side], angle: 1.9 * side }));
  earMorph("ears-fold-half", (side) => ({ at: 0.5, axis: [side, 0, -0.2 * side], angle: 1.9 * side }), 0.5);

  // --- Head ---
  const head = (v: number) => weight(v, "Head") + weight(v, "Nose") + weight(v, "Chin") + weight(v, "Chin_Tip") + weight(v, "Head.tip") + weight(v, "Spine_4") * 0.5;
  const muzzleAxis = normalize(sub(noseTip, stop));
  const muzzleT = (p: Vec3) => dot(sub(p, stop), muzzleAxis) / Math.hypot(...sub(noseTip, stop));
  // Muzzle length: everything in front of the stop is scaled along the muzzle (eyes and skull stay).
  const softPlus = (x: number, k: number) => (x > k ? x : x < -k ? 0 : (x + k) ** 2 / (4 * k));
  for (const [name, factor] of [["muzzle-short", 0.42], ["muzzle-long", 1.5]] as const)
    out.push(
      morph(name, "head", input, (p, v) => {
        const h = Math.min(1, head(v) * 1.2);
        if (h <= 0) return p;
        const along = softPlus(dot(sub(p, stop), muzzleAxis) + 0.004, 0.012);
        const d = (factor - 1) * along * h;
        return [p[0] + muzzleAxis[0] * d, p[1] + muzzleAxis[1] * d, p[2] + muzzleAxis[2] * d];
      }),
    );
  out.push(
    morph("muzzle-broad", "head", input, (p, v) => {
      const t = smoothstep(-0.25, 0.25, muzzleT(p)) * Math.min(1, head(v));
      return [p[0] * (1 + 0.38 * t), p[1], p[2]];
    }),
  );
  out.push(
    morph("muzzle-deep", "head", input, (p, v) => {
      const t = smoothstep(-0.25, 0.3, muzzleT(p)) * Math.min(1, head(v));
      // Deeper toward the bottom: lips and jaw drop, the bridge stays.
      const below = Math.max(0, stop[1] + 0.01 - p[1]);
      return [p[0], p[1] - below * 0.45 * t, p[2]];
    }),
  );
  const forehead: Vec3 = [0, stop[1] + 0.035, stop[2] - 0.03];
  out.push(
    morph("stop", "head", input, (p, v) => {
      const g = Math.exp(-((p[0] / 0.05) ** 2 + ((p[1] - forehead[1]) / 0.04) ** 2 + ((p[2] - forehead[2]) / 0.045) ** 2)) * Math.min(1, head(v));
      return [p[0], p[1] + 0.016 * g, p[2] + 0.008 * g];
    }),
  );
  const crown: Vec3 = [0, stop[1] + 0.05, stop[2] - 0.08];
  out.push(
    morph("skull-dome", "head", input, (p, v) => {
      const g = Math.exp(-((p[0] / 0.06) ** 2 + ((p[1] - crown[1]) / 0.05) ** 2 + ((p[2] - crown[2]) / 0.07) ** 2)) * Math.min(1, head(v));
      return [p[0] * (1 + 0.15 * g), p[1] + 0.02 * g, p[2]];
    }),
  );

  // --- Torso ---
  const torso = (v: number) => weight(v, "Spine_1") + weight(v, "Spine_2") + weight(v, "Spine_2.001") + weight(v, "Stomach") + weight(v, "Hips") * 0.5;
  const withers = bone("Spine_2.001").head, loin = bone("Spine_1").head;
  out.push(
    morph("chest-deep", "torso", input, (p, v) => {
      // Ribcage floor drops; strongest at the brisket, fading behind the ribs.
      const zf = smoothstep(-0.12, 0.05, p[2]) * smoothstep(0.42, 0.3, p[2]);
      const below = smoothstep(withers[1] - 0.05, withers[1] - 0.25, p[1]);
      const t = Math.min(1, torso(v) + weight(v, "Front_Leg_Shoulder_L") * 0.3 + weight(v, "Front_Leg_Shoulder_R") * 0.3) * zf * below;
      return [p[0] * (1 + 0.06 * t), p[1] - 0.05 * t, p[2]];
    }),
  );
  out.push(
    morph("belly-tuck", "torso", input, (p, v) => {
      const zf = smoothstep(0.08, -0.08, p[2]) * smoothstep(-0.42, -0.25, p[2]);
      const below = smoothstep(loin[1] - 0.03, loin[1] - 0.12, p[1]);
      const t = Math.min(1, torso(v)) * zf * below;
      return [p[0] * (1 - 0.1 * t), p[1] + 0.06 * t, p[2]];
    }),
  );

  // Bulk: a wider, deeper barrel, neck and upper limbs (about the ribcage's centre line, not the spine).
  const barrelY = bone("Spine_2").head[1] - 0.1;
  out.push(
    morph("bulk", "torso", input, (p, v) => {
      const t = Math.min(1, torso(v) + weight(v, "Spine_3") + weight(v, "Spine_4") * 0.6 + weight(v, "Hips") * 0.5 +
        ["Front_Leg_Shoulder", "Back_Leg_Pelvis", "Front_Leg_Upper", "Back_Leg_Upper"].reduce((a, b) => a + weight(v, `${b}_L`) + weight(v, `${b}_R`), 0) * 0.8);
      if (t <= 0) return p;
      return [p[0] * (1 + 0.25 * t), barrelY + (p[1] - barrelY) * (1 + 0.12 * t), p[2]];
    }),
  );

  // --- Tail: curled up over the back (spitz breeds) ---
  // The tail is treated as straight from its base; it is wound onto an arc that bends
  // upward (rotation about +x turns a backward heading up), each vertex keeping its
  // offset from the centre line in the rotated frame.
  const chain = ["Tail_Base", "Tail_Mid", "Tail_Mid.001", "Tail_End", "Tail_Tip"].map(bone);
  const B = chain[0].head, E = chain[chain.length - 1].tail;
  const total = Math.hypot(...sub(E, B));
  const h0 = normalize(sub(E, B));
  const toCentre = rotateAbout(h0, [0, 0, 0], [1, 0, 0], Math.PI / 2);
  for (const [name, turn] of [["tail-curl", 3.6], ["tail-curl-half", 1.8]] as const) {
    // `turn`: radians over the whole tail.
    const r = total / turn;
    const centre: Vec3 = [B[0] + toCentre[0] * r, B[1] + toCentre[1] * r, B[2] + toCentre[2] * r];
    out.push(
      morph(name, "tail", input, (p, v) => {
        let w = 0;
        for (const b of chain) w += weight(v, b.name);
        if (w <= 0) return p;
        const s = Math.max(0, Math.min(total, dot(sub(p, B), h0)));
        const onLine: Vec3 = [B[0] + h0[0] * s, B[1] + h0[1] * s, B[2] + h0[2] * s];
        const alpha = (turn * s) / total;
        const arc = rotateAbout(B, centre, [1, 0, 0], alpha);
        const off = rotateAbout(sub(p, onLine), [0, 0, 0], [1, 0, 0], alpha);
        const q: Vec3 = [arc[0] + off[0], arc[1] + off[1], arc[2] + off[2]];
        const m = Math.min(1, w * 1.2);
        return [p[0] + (q[0] - p[0]) * m, p[1] + (q[1] - p[1]) * m, p[2] + (q[2] - p[2]) * m];
      }),
    );
  }
  return out;
}

/** Closest point on a polyline and the direction of its segment there. */
function closestOnPolyline(p: Vec3, pts: Vec3[]): { point: Vec3; dir: Vec3 } {
  let best = Infinity, point: Vec3 = pts[0], dir: Vec3 = [0, 0, 1];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], ab = sub(pts[i + 1], a);
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1e-12)));
    const q: Vec3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    const d = Math.hypot(...sub(p, q));
    if (d < best) {
      best = d;
      point = q;
      dir = normalize(ab);
    }
  }
  return { point, dir };
}

/**
 * Squirrel morphs: bulk (a rounder, heavier body, e.g. fox squirrels), a
 * fuller tail plume, and puffed cheeks (pouches, as in chipmunks).
 */
export function squirrelMorphs(input: MorphInput): Morph[] {
  const { rig, weight } = input;
  const bone = (n: string) => rig.bones[rig.index.get(n)!];
  const out: Morph[] = [];
  const sides = (names: string[]) => (v: number) => names.reduce((a, b) => a + weight(v, `${b}_L`) + weight(v, `${b}_R`), 0);

  const barrelY = bone("Spine_2").head[1] - 0.03;
  const limbs = sides(["Front_Leg_Shoulder", "Back_Leg_Pelvis", "Front_Leg_Upper", "Back_Leg_Upper"]);
  out.push(
    morph("bulk", "torso", input, (p, v) => {
      const t = Math.min(1, weight(v, "Spine_1") + weight(v, "Spine_2") + weight(v, "Spine_2.001") + weight(v, "Stomach") + weight(v, "Hips") + weight(v, "Spine_3") + weight(v, "Spine_4") * 0.5 + limbs(v) * 0.8);
      if (t <= 0) return p;
      return [p[0] * (1 + 0.25 * t), barrelY + (p[1] - barrelY) * (1 + 0.12 * t), p[2]];
    }),
  );

  const tailNames = ["Tail_Base", "Tail_Mid", "Tail_Mid.001", "Tail_End", "Tail_Tip"];
  const tailLine = [...tailNames.map((n) => bone(n).head), bone("Tail_Tip").tail];
  out.push(
    morph("tail-plume", "tail", input, (p, v) => {
      const w = Math.min(1, tailNames.reduce((a, n) => a + weight(v, n), 0) * 1.2);
      if (w <= 0) return p;
      const { point } = closestOnPolyline(p, tailLine);
      // The plume grows wider from the root (which stays thin) to the middle.
      const t = smoothstep(0, 0.35, Math.hypot(...sub(point, tailLine[0])) / 0.1);
      const k = 1 + 0.5 * w * t;
      return [point[0] + (p[0] - point[0]) * (0.8 + 0.2 * k), point[1] + (p[1] - point[1]) * k, point[2] + (p[2] - point[2]) * k];
    }),
  );

  // Cheek pouches: the cheeks swell out and down.
  const eye = input.eyeCenter;
  out.push(
    morph("cheeks", "head", input, (p, v) => {
      const head = Math.min(1, weight(v, "Head") + weight(v, "Nose") + weight(v, "Chin"));
      if (head <= 0) return p;
      const s = p[0] >= 0 ? 1 : -1;
      const c: Vec3 = [eye[0] * s * 0.85, eye[1] - 0.014, eye[2] + 0.004];
      const g = Math.exp(-(((p[0] - c[0]) / 0.012) ** 2 + ((p[1] - c[1]) / 0.011) ** 2 + ((p[2] - c[2]) / 0.016) ** 2)) * head;
      return [p[0] + 0.007 * s * g, p[1] - 0.003 * g, p[2]];
    }),
  );
  return out;
}
