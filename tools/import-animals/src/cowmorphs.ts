/**
 * Cow morphs: shape changes that bone proportions can't express. Used by the
 * presets: a heavier barrel (beef breeds), muscled quarters (Charolais), a
 * thicker neck, a dished face (Jersey), the udder's size, and the horns (none,
 * the short base horns, or the long sweeping horns of Highland cattle). Horn
 * vertices are found through `input.pieces` (the horn meshes).
 */
import { type Vec3, normalize } from "@actors/core";
import type { CowBody } from "./cow";
import { type Morph, type MorphInput, morph } from "./targets";

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** Nearest point on a polyline: parameter t (0 root .. 1 tip, by length) and the tangent there. */
function onPolyline(p: Vec3, pts: Vec3[]): { t: number; at: Vec3; tangent: Vec3 } {
  const lengths = pts.slice(1).map((q, i) => len(sub(q, pts[i])));
  const total = lengths.reduce((a, b) => a + b, 0);
  let best = Infinity, bt = 0, at: Vec3 = pts[0], tangent: Vec3 = [1, 0, 0], run = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], ab = sub(pts[i + 1], a);
    const s = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1e-12)));
    const q = add(a, scale(ab, s));
    const d = len(sub(p, q));
    if (d < best) {
      best = d;
      bt = (run + s * lengths[i]) / total;
      at = q;
      tangent = normalize(ab);
    }
    run += lengths[i];
  }
  return { t: bt, at, tangent };
}

/** Point and tangent at parameter t (by length) along a polyline. */
function atParam(pts: Vec3[], t: number): { at: Vec3; tangent: Vec3 } {
  const lengths = pts.slice(1).map((q, i) => len(sub(q, pts[i])));
  let left = t * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const s = Math.min(1, left / lengths[i]);
      return { at: add(pts[i], scale(sub(pts[i + 1], pts[i]), s)), tangent: normalize(sub(pts[i + 1], pts[i])) };
    }
    left -= lengths[i];
  }
  return { at: pts[pts.length - 1], tangent: [1, 0, 0] };
}

/** Rotates v by the shortest arc taking unit vector a to unit vector b. */
function turn(v: Vec3, a: Vec3, b: Vec3): Vec3 {
  const k = cross(a, b);
  const s = len(k), c = dot(a, b);
  if (s < 1e-9) return v;
  const u = scale(k, 1 / s);
  const kv = cross(u, v);
  const ud = dot(u, v);
  return [0, 1, 2].map((i) => v[i] * c + kv[i] * s + u[i] * ud * (1 - c)) as Vec3;
}

/** Long horns of Highland cattle: out to the sides, sweeping forward and up (left side; mirrored for the right). */
function longHorn(root: Vec3, s: number): Vec3[] {
  return [root, add(root, [0.12 * s, 0.0, 0.0]), add(root, [0.27 * s, 0.03, 0.04]), add(root, [0.4 * s, 0.1, 0.1]), add(root, [0.47 * s, 0.22, 0.13]), add(root, [0.47 * s, 0.33, 0.11])];
}

export function cowMorphs(input: MorphInput, body: CowBody): Morph[] {
  const { weight, rig } = input;
  const { cow } = body;
  const bone = (n: string) => rig.bones[rig.index.get(n)!];
  const sum = (v: number, names: string[]) => names.reduce((a, b) => a + weight(v, b), 0);
  const sides = (names: string[]) => names.flatMap((n) => [`${n}_l`, `${n}_r`]);
  const out: Morph[] = [];
  const trunkBones = ["hips", "spine_1", "spine_2", "spine_3", "ribcage_middle", "ribcage_front"];
  const hornRanges = (input.pieces ?? []).filter((p) => p.name.startsWith("horn"));
  const isHorn = (v: number) => hornRanges.some((r) => v >= r.first && v < r.first + r.count);
  const udderMask = (p: Vec3) => {
    const d = sub(p, cow.udder);
    return smoothstep(1.25, 0.8, Math.hypot(d[0] / 0.17, Math.max(0, d[1]) / 0.16, d[2] / 0.22)) * smoothstep(0.86, 0.74, p[1]);
  };

  // Bulk: a wider, deeper barrel and heavier upper limbs (about the barrel's centre line).
  const barrelY = bone("spine_2").head[1] - 0.2;
  const upperLimbs = sides(["front_scapula", "front_humerus", "back_leg_pelvis", "back_leg_upper"]);
  out.push(
    morph("bulk", "torso", input, (p, v) => {
      if (isHorn(v)) return p;
      const t = Math.min(1, sum(v, trunkBones) + weight(v, "spine_4") * 0.6 + sum(v, upperLimbs) * 0.7) * (1 - udderMask(p));
      if (t <= 0) return p;
      return [p[0] * (1 + 0.2 * t), barrelY + (p[1] - barrelY) * (1 + 0.05 * t), p[2]];
    }),
  );

  // Muscle: rounder, fuller quarters and a broader loin (beef breeds, Charolais).
  const hip = bone("back_leg_upper_l").head;
  out.push(
    morph("muscle", "torso", input, (p, v) => {
      if (isHorn(v)) return p;
      const thigh = Math.min(1, sum(v, sides(["back_leg_upper", "back_leg_pelvis"])) + weight(v, "hips") * 0.6);
      const back = smoothstep(-0.2, 0.2, p[2] - hip[2] + 0.4) * smoothstep(1.1, 1.3, p[1]) * Math.min(1, sum(v, ["hips", "spine_1", "spine_2"]));
      const t = Math.max(thigh * smoothstep(0.55, 0.8, p[1]), back) * (1 - udderMask(p));
      if (t <= 0) return p;
      // Out to the sides and back at the buttocks.
      return [p[0] * (1 + 0.16 * t), p[1] + 0.01 * t, p[2] - 0.035 * t * smoothstep(-0.6, -0.85, p[2])];
    }),
  );

  // A thick, deep neck (bulls, beef breeds).
  const n0 = bone("spine_4").head, hd = bone("head").head;
  out.push(
    morph("neck-thick", "neck", input, (p, v) => {
      if (isHorn(v)) return p;
      const t = Math.min(1, sum(v, ["spine_4", "spine_5", "spine_6"]) + weight(v, "spine_3") * 0.3);
      if (t <= 0) return p;
      const ax = sub(hd, n0);
      const s = Math.max(0, Math.min(1, dot(sub(p, n0), ax) / dot(ax, ax)));
      const c = add(n0, scale(ax, s));
      const k = 0.18 * t * smoothstep(1, 0.75, s);
      const lift = 0.03 * t * Math.sin(Math.PI * s) * smoothstep(c[1] - 0.02, c[1] + 0.1, p[1]);
      return [p[0] + (p[0] - c[0]) * k, p[1] + (p[1] - c[1]) * k + lift, p[2] + (p[2] - c[2]) * k];
    }),
  );

  // Dished face: the profile hollows between the eyes and the muzzle (Jersey).
  const eye = input.eyeCenter, tip = input.noseTip;
  out.push(
    morph("dish", "head", input, (p, v) => {
      if (isHorn(v)) return p;
      const h = Math.min(1, weight(v, "head") + weight(v, "nose") + weight(v, "head_leaf"));
      if (h <= 0) return p;
      const dy = tip[1] - eye[1], dz = tip[2] - eye[2];
      const L = Math.hypot(dy, dz);
      const s = ((p[1] - eye[1]) * dy + (p[2] - eye[2]) * dz) / (L * L);
      const fwd = ((p[1] - eye[1]) * dz - (p[2] - eye[2]) * dy) / L;
      const dip = 0.02 * h * Math.sin(Math.PI * Math.max(0, Math.min(1, s / 0.8))) * smoothstep(-0.03, 0.03, fwd);
      return [p[0] * (1 - 0.05 * h * smoothstep(0.4, 1, s)), p[1] - (dz / L) * dip, p[2] + (dy / L) * dip];
    }),
  );

  // Udder: larger and lower (a cow in milk), or small and tucked up (heifers, beef cows).
  const top: Vec3 = [0, cow.udder[1] + 0.12, cow.udder[2] - 0.03];
  out.push(
    morph("udder-large", "torso", input, (p, v) => {
      if (isHorn(v)) return p;
      const m = udderMask(p);
      if (m <= 0) return p;
      const q: Vec3 = [top[0] + (p[0] - top[0]) * 1.3, top[1] + (p[1] - top[1]) * 1.45, top[2] + (p[2] - top[2]) * 1.25];
      return [p[0] + (q[0] - p[0]) * m, p[1] + (q[1] - p[1]) * m, p[2] + (q[2] - p[2]) * m];
    }),
  );
  out.push(
    morph("udder-small", "torso", input, (p, v) => {
      if (isHorn(v)) return p;
      const m = udderMask(p);
      if (m <= 0) return p;
      const q: Vec3 = [top[0] + (p[0] - top[0]) * 0.6, top[1] + (p[1] - top[1]) * 0.35 + 0.02, top[2] + (p[2] - top[2]) * 0.75];
      return [p[0] + (q[0] - p[0]) * m, p[1] + (q[1] - p[1]) * m, p[2] + (q[2] - p[2]) * m];
    }),
  );

  // Horns: shrink into the poll (polled and dehorned cattle), or sweep out long (Highland).
  const hornOf = (p: Vec3) => (p[0] >= 0 ? 0 : 1);
  out.push(
    morph("horns-none", "horns", input, (p, v) => {
      if (!isHorn(v)) return p;
      const root = cow.horns[hornOf(p)][0];
      // Into the skull a little below the root.
      const sink = add(root, [-0.03 * Math.sign(p[0]), -0.025, 0]);
      return add(sink, scale(sub(p, root), 0.05));
    }),
  );
  out.push(
    morph("horns-long", "horns", input, (p, v) => {
      if (!isHorn(v)) return p;
      const k = hornOf(p);
      const short = cow.horns[k];
      const long = longHorn(short[0], k === 0 ? 1 : -1);
      const { t, at, tangent } = onPolyline(p, short);
      const target = atParam(long, t);
      // Same cross-section, turned to the long horn's direction and a little thicker at the base.
      const off = turn(sub(p, at), tangent, target.tangent);
      return add(target.at, scale(off, 1.25 - 0.25 * t));
    }),
  );
  return out;
}
