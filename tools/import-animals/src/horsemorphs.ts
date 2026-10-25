/**
 * Horse morphs: shape changes that bone proportions can't express. Used by the
 * presets (draught horses: heavy barrel and crest; ponies: round belly;
 * Arabians: a dished face). Tack vertices carry the skin weights of the body
 * under them, so the saddle and girth follow the barrel.
 */
import type { Vec3 } from "@actors/core";
import { type Morph, type MorphInput, morph } from "./targets";

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function horseMorphs(input: MorphInput): Morph[] {
  const { weight, rig } = input;
  const bone = (n: string) => rig.bones[rig.index.get(n)!];
  const sum = (v: number, names: string[]) => names.reduce((a, b) => a + weight(v, b), 0);
  const sides = (names: string[]) => names.flatMap((n) => [`${n}_l`, `${n}_r`]);
  const out: Morph[] = [];
  const trunkBones = ["hips", "spine_1", "spine_2", "spine_3", "ribcage_middle", "ribcage_front", "saddle"];

  // Bulk: a wider, deeper barrel and heavier upper limbs (about the barrel's centre line).
  const barrelY = bone("spine_2").head[1] - 0.05;
  const upperLimbs = sides(["front_scapula", "front_humerus", "back_leg_pelvis", "back_leg_upper"]);
  out.push(
    morph("bulk", "torso", input, (p, v) => {
      const t = Math.min(1, sum(v, trunkBones) + weight(v, "spine_4") * 0.6 + sum(v, upperLimbs) * 0.7);
      if (t <= 0) return p;
      return [p[0] * (1 + 0.2 * t), barrelY + (p[1] - barrelY) * (1 + 0.06 * t), p[2]];
    }),
  );

  // Belly: a deeper, rounder underline between the girth and the flank.
  const girthZ = bone("ribcage_middle").head[2], flankZ = bone("spine_1").head[2] - 0.1;
  out.push(
    morph("belly", "torso", input, (p, v) => {
      const t = Math.min(1, sum(v, trunkBones)) * smoothstep(girthZ + 0.15, girthZ, p[2]) * smoothstep(flankZ - 0.1, flankZ + 0.1, p[2]) * smoothstep(barrelY - 0.05, barrelY - 0.25, p[1]);
      return [p[0] * (1 + 0.08 * t), p[1] - 0.07 * t, p[2]];
    }),
  );

  // Crest: a thicker, arched neck (stallions, draught horses), mostly along the top.
  const n0 = bone("spine_4").head, hd = bone("head").head;
  out.push(
    morph("neck-thick", "neck", input, (p, v) => {
      const t = Math.min(1, sum(v, ["spine_4", "spine_5", "spine_6"]) + weight(v, "spine_3") * 0.3);
      if (t <= 0) return p;
      const ax: Vec3 = [hd[0] - n0[0], hd[1] - n0[1], hd[2] - n0[2]];
      const L2 = ax[0] ** 2 + ax[1] ** 2 + ax[2] ** 2;
      const s = Math.max(0, Math.min(1, ((p[0] - n0[0]) * ax[0] + (p[1] - n0[1]) * ax[1] + (p[2] - n0[2]) * ax[2]) / L2));
      const c: Vec3 = [n0[0] + ax[0] * s, n0[1] + ax[1] * s, n0[2] + ax[2] * s];
      // Wider all round, and the crest rises most in the middle of the neck.
      const k = 0.2 * t * smoothstep(1, 0.8, s);
      const lift = 0.05 * t * Math.sin(Math.PI * s) * smoothstep(c[1] - 0.02, c[1] + 0.1, p[1]);
      return [p[0] + (p[0] - c[0]) * k, p[1] + (p[1] - c[1]) * k + lift, p[2] + (p[2] - c[2]) * k];
    }),
  );

  // Dished face: the profile hollows between the eyes and the nostrils (Arabian), the muzzle a little finer.
  const eye = input.eyeCenter, tip = input.noseTip;
  out.push(
    morph("dish", "head", input, (p, v) => {
      const h = Math.min(1, weight(v, "head") + weight(v, "nose") + weight(v, "head_leaf"));
      if (h <= 0) return p;
      const dy = tip[1] - eye[1], dz = tip[2] - eye[2];
      const L = Math.hypot(dy, dz);
      const s = ((p[1] - eye[1]) * dy + (p[2] - eye[2]) * dz) / (L * L);
      // Front of the face only (the side facing forward-up from the axis eye -> tip).
      const fwd = ((p[1] - eye[1]) * dz - (p[2] - eye[2]) * dy) / L;
      const dip = 0.022 * h * Math.sin(Math.PI * Math.max(0, Math.min(1, s / 0.85))) * smoothstep(-0.02, 0.04, fwd);
      // Move against the outward direction of the profile (perpendicular to the axis, towards the jaw).
      return [p[0] * (1 - 0.06 * h * smoothstep(0.4, 1, s)), p[1] - (dz / L) * dip, p[2] + (dy / L) * dip];
    }),
  );
  return out;
}
