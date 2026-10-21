/**
 * Deer morphs: shape changes that bone proportions can't express. Used by the
 * presets (red deer: heavier neck and longer face; roe: short face, slim).
 */
import type { Vec3 } from "@actors/core";
import { type Morph, type MorphInput, morph } from "./targets";

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function deerMorphs(input: MorphInput): Morph[] {
  const { weight, rig } = input;
  const bone = (n: string) => rig.bones[rig.index.get(n)!];
  const sum = (v: number, names: string[]) => names.reduce((a, b) => a + weight(v, b), 0);
  const sides = (names: string[]) => names.flatMap((n) => [`${n}.L`, `${n}.R`]);
  const out: Morph[] = [];

  // Bulk: a wider, deeper barrel and heavier upper limbs (about the ribcage's centre line).
  const barrelY = 0.63;
  const upperLimbs = sides(["FrontShoulder", "FrontUpperLeg", "BackShoulder", "BackLeg"]);
  out.push(
    morph("bulk", "torso", input, (p, v) => {
      const t = Math.min(1, sum(v, ["Back", "Torso", "Torso2", "Torso3"]) + weight(v, "Neck1") * 0.6 + sum(v, upperLimbs) * 0.7);
      if (t <= 0) return p;
      return [p[0] * (1 + 0.22 * t), barrelY + (p[1] - barrelY) * (1 + 0.1 * t), p[2]];
    }),
  );

  // Belly: a deeper, rounder underline between the elbows and the flank.
  out.push(
    morph("belly", "torso", input, (p, v) => {
      const t = Math.min(1, sum(v, ["Back", "Torso", "Torso2"])) * smoothstep(0.3, 0.14, p[2]) * smoothstep(-0.2, -0.05, p[2]) * smoothstep(0.58, 0.45, p[1]);
      return [p[0] * (1 + 0.1 * t), p[1] - 0.045 * t, p[2]];
    }),
  );

  // Neck: thicker all the way to the throat (red deer, winter coat).
  const n1 = bone("Neck1").head, hd = bone("Head").head;
  out.push(
    morph("neck-thick", "neck", input, (p, v) => {
      const t = Math.min(1, sum(v, ["Neck1", "Neck2", "Neck3"]) + weight(v, "Torso3") * 0.4);
      if (t <= 0) return p;
      // Closest point on the neck's axis.
      const ax: Vec3 = [hd[0] - n1[0], hd[1] - n1[1], hd[2] - n1[2]];
      const L2 = ax[0] ** 2 + ax[1] ** 2 + ax[2] ** 2;
      const s = Math.max(0, Math.min(1, ((p[0] - n1[0]) * ax[0] + (p[1] - n1[1]) * ax[1] + (p[2] - n1[2]) * ax[2]) / L2));
      const c: Vec3 = [n1[0] + ax[0] * s, n1[1] + ax[1] * s, n1[2] + ax[2] * s];
      const k = 0.25 * t * smoothstep(1, 0.75, s);
      return [p[0] + (p[0] - c[0]) * k, p[1] + (p[1] - c[1]) * k, p[2] + (p[2] - c[2]) * k];
    }),
  );

  // Face: longer in front of the eyes (eyes, skull and ears stay).
  const eyeZ = input.eyeCenter[2];
  const tipZ = input.noseTip[2];
  out.push(
    morph("muzzle-long", "head", input, (p, v) => {
      const h = Math.min(1, weight(v, "Head") * 1.2);
      if (h <= 0) return p;
      const along = Math.max(0, p[2] - eyeZ + 0.01);
      const t = smoothstep(eyeZ - 0.01, eyeZ + 0.03, p[2]) * h;
      // Along the face (which slopes down to the nose).
      const dz = 0.3 * along * t, dy = -0.3 * along * t * ((input.eyeCenter[1] - input.noseTip[1]) / (tipZ - eyeZ));
      return [p[0], p[1] + dy, p[2] + dz];
    }),
  );
  return out;
}
