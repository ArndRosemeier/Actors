import { type HumanParams, sanitizeParams } from "./params";

/** One photographic skin texture (MakeHuman's age x gender x ethnicity set). */
export interface SkinTextureDef {
  age: "young" | "middleage" | "old";
  gender: "female" | "male";
  ethnicity: "african" | "asian" | "caucasian";
  /** Pack-relative file (body UV layout). */
  file: string;
  /** Mean sRGB colour of the skin (for recolouring it to a non-human tone). */
  tone?: [number, number, number];
}

/** Ages the three texture groups represent (years); weights are linear in between. */
const AGE_ANCHORS: [SkinTextureDef["age"], number][] = [
  ["young", 25],
  ["middleage", 50],
  ["old", 80],
];

function ageWeights(years: number): Record<SkinTextureDef["age"], number> {
  const out = { young: 0, middleage: 0, old: 0 };
  if (years <= AGE_ANCHORS[0][1]) out.young = 1;
  else if (years >= AGE_ANCHORS[2][1]) out.old = 1;
  else
    for (let i = 0; i < 2; i++) {
      const [a, ya] = AGE_ANCHORS[i], [b, yb] = AGE_ANCHORS[i + 1];
      if (years <= yb) {
        const t = (years - ya) / (yb - ya);
        out[a] = 1 - t;
        out[b] = t;
        break;
      }
    }
  return out;
}

/**
 * How much each skin texture contributes for the given body: gender, age and
 * ethnicity blended the same way as the shape. Returns at most `max` textures
 * (the strongest ones), with weights summing to 1.
 */
export function skinTextureWeights(skins: SkinTextureDef[], params: HumanParams, max = 4): { file: string; weight: number }[] {
  const p = sanitizeParams(params);
  const age = ageWeights(p.ageYears);
  const gender = { female: 1 - p.gender, male: p.gender };
  const eth = { african: p.african, asian: p.asian, caucasian: p.caucasian };
  const all = skins
    .map((s) => ({ file: s.file, weight: age[s.age] * gender[s.gender] * eth[s.ethnicity] }))
    .filter((s) => s.weight > 1e-4)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max);
  const sum = all.reduce((s, x) => s + x.weight, 0) || 1;
  return all.map((x) => ({ file: x.file, weight: x.weight / sum }));
}
