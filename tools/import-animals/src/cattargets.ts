/**
 * Cat shape morphs. They use the same target names as the dog's where the
 * meaning is the same (see @actors/animal), so one set of shape sliders drives
 * both; targets a species doesn't have are skipped.
 */
import { type Morph, type MorphInput, morph } from "./targets";

export function catMorphs(input: MorphInput): Morph[] {
  const { rig, weight } = input;
  const bone = (n: string) => rig.bones[rig.index.get(n)!];
  const out: Morph[] = [];
  const torso = (v: number) => weight(v, "Spine_1") + weight(v, "Spine_2") + weight(v, "Spine_2.001") + weight(v, "Stomach") + weight(v, "Hips") * 0.5;

  // Bulk: a wider, deeper barrel, neck and upper limbs (about the ribcage's centre line).
  const barrelY = bone("Spine_2").head[1] - 0.05;
  out.push(
    morph("bulk", "torso", input, (p, v) => {
      const t = Math.min(1, torso(v) + weight(v, "Spine_3") + weight(v, "Spine_4") * 0.6 + weight(v, "Hips") * 0.5 +
        ["Front_Leg_Shoulder", "Back_Leg_Pelvis", "Front_Leg_Upper", "Back_Leg_Upper"].reduce((a, b) => a + weight(v, `${b}_L`) + weight(v, `${b}_R`), 0) * 0.8);
      if (t <= 0) return p;
      return [p[0] * (1 + 0.25 * t), barrelY + (p[1] - barrelY) * (1 + 0.12 * t), p[2]];
    }),
  );
  return out;
}
