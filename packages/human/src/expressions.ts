import { type HumanParams, sanitizeParams } from "./params";

/**
 * Facial expressions built from MakeHuman's 34 face units (CC0). Each unit
 * exists in an African, Asian and Caucasian variant; the variants are mixed
 * with the same ethnic weights as the body so expressions fit the face.
 * Unit values are 0..1.
 */
export type UnitWeights = Record<string, number>;

const both = (unit: string, w: number): UnitWeights => ({ [unit.replace("*", "left")]: w, [unit.replace("*", "right")]: w });

export const EXPRESSIONS: Record<string, UnitWeights> = {
  neutral: {},
  smile: { "mouth-corner-puller": 0.75, "mouth-upward-retraction": 0.25, ...both("eye-*-slit", 0.25) },
  laugh: { "mouth-corner-puller": 1, "mouth-open": 0.45, "mouth-upward-retraction": 0.35, ...both("eye-*-slit", 0.45), ...both("eyebrows-*-up", 0.2) },
  sad: { ...both("eyebrows-*-inner-up", 0.85), "mouth-depression": 0.6, ...both("eye-*-slit", 0.15) },
  angry: { ...both("eyebrows-*-down", 0.9), "mouth-compression": 0.5, "nose-compression": 0.35, ...both("nose-*-dilatation", 0.4) },
  surprise: { ...both("eyebrows-*-up", 0.9), ...both("eye-*-opened-up", 0.6), "mouth-open": 0.55 },
  fear: { ...both("eyebrows-*-inner-up", 0.7), ...both("eyebrows-*-up", 0.35), ...both("eye-*-opened-up", 0.6), "mouth-retraction": 0.5, "neck-platysma": 0.4 },
  disgust: { ...both("nose-*-elevation", 0.7), "mouth-upward-retraction": 0.5, ...both("eyebrows-*-down", 0.35), ...both("eye-*-slit", 0.3) },
  kiss: { "mouth-pursing": 0.8, "mouth-protusion": 0.5 },
};

export const BLINK: UnitWeights = both("eye-*-closure", 1);

const ETHNICITIES = ["african", "asian", "caucasian"] as const;

/** Target weights for a set of face units, mixed by the character's ethnic weights. */
export function expressionTargetWeights(units: UnitWeights, params: HumanParams, scale = 1, available?: Set<string>): Map<string, number> {
  const p = sanitizeParams(params);
  const out = new Map<string, number>();
  for (const [unit, w] of Object.entries(units)) {
    for (const eth of ETHNICITIES) {
      const name = `expression/${eth}/${unit}`;
      if (available && !available.has(name)) continue;
      const v = w * scale * p[eth];
      if (Math.abs(v) > 1e-5) out.set(name, (out.get(name) ?? 0) + v);
    }
  }
  return out;
}
