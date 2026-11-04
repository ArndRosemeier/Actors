/**
 * Shape sliders: a short list of plain-language sliders ("Shoulders", "Waist", "Jaw", "Body fat")
 * on top of MakeHuman's 234 technical modifiers. Each drives several modifiers at once with
 * weights chosen so the body changes the way the word suggests (broad shoulders widen the
 * shoulder line and the V of the back, not just one scale). Values are -1..1 and add to the raw
 * modifier values, which stay available unchanged. Plus body types: named starting points
 * (athletic, curvy, stocky, ...) that set the macro sliders and shape sliders together.
 *
 * Adults only in spirit: no shape touches genitals or breasts (cup size stays a macro slider,
 * which children never get).
 */
import type { HumanParams } from "./params";

export interface ShapeSlider {
  id: string;
  label: string;
  group: "Body" | "Face";
  /** Words for the two ends, for tooltips. */
  low: string;
  high: string;
  /** Modifier id -> weight (the modifier moves by weight x slider value). */
  drives: Record<string, number>;
}

export const SHAPE_SLIDERS: ShapeSlider[] = [
  // Body
  { id: "fat", label: "Body fat", group: "Body", low: "lean", high: "soft", drives: {
    "arms/upperarm-fat-decr-incr": 0.7, "arms/lowerarm-fat-decr-incr": 0.5, "legs/upperleg-fat-decr-incr": 0.7, "legs/lowerleg-fat-decr-incr": 0.4,
    "stomach/stomach-tone-decr-incr": -0.6, "neck/neck-double-decr-incr": 0.4, "head/head-fat-decr-incr": 0.35, "cheek/cheek-volume-decr-incr": 0.35, "buttocks/buttocks-volume-decr-incr": 0.3,
  } },
  { id: "fitness", label: "Fitness", group: "Body", low: "untrained", high: "defined", drives: {
    "arms/upperarm-muscle-decr-incr": 0.6, "arms/lowerarm-muscle-decr-incr": 0.5, "arms/upperarm-shoulder-muscle-decr-incr": 0.5, "legs/upperleg-muscle-decr-incr": 0.6, "legs/lowerleg-muscle-decr-incr": 0.5,
    "torso/torso-muscle-pectoral-decr-incr": 0.5, "torso/torso-muscle-dorsi-decr-incr": 0.5, "stomach/stomach-tone-decr-incr": 0.6, "pelvis/pelvis-tone-decr-incr": 0.4,
  } },
  { id: "shoulders", label: "Shoulders", group: "Body", low: "narrow", high: "broad", drives: {
    "torso/measure-shoulder-dist-decr-incr": 0.8, "torso/torso-vshape-decr-incr": 0.4, "arms/upperarm-shoulder-muscle-decr-incr": 0.25,
  } },
  { id: "chest", label: "Chest", group: "Body", low: "flat", high: "deep", drives: {
    "torso/torso-scale-depth-decr-incr": 0.5, "torso/measure-frontchest-dist-decr-incr": 0.4, "torso/torso-muscle-pectoral-decr-incr": 0.3,
  } },
  { id: "waist", label: "Waist", group: "Body", low: "narrow", high: "thick", drives: {
    "torso/measure-waist-circ-decr-incr": 0.9, "torso/measure-underbust-circ-decr-incr": 0.3,
  } },
  { id: "belly", label: "Belly", group: "Body", low: "flat", high: "round", drives: {
    "stomach/stomach-tone-decr-incr": -0.5, "stomach/stomach-pregnant-decr-incr": 0.35, "torso/measure-waist-circ-decr-incr": 0.3,
  } },
  { id: "hips", label: "Hips", group: "Body", low: "narrow", high: "wide", drives: {
    "torso/measure-hips-circ-decr-incr": 0.7, "hip/hip-scale-horiz-decr-incr": 0.5, "legs/measure-thigh-circ-decr-incr": 0.2,
  } },
  { id: "bottom", label: "Bottom", group: "Body", low: "flat", high: "full", drives: {
    "buttocks/buttocks-volume-decr-incr": 0.9, "hip/hip-scale-depth-decr-incr": 0.3,
  } },
  { id: "legs", label: "Leg length", group: "Body", low: "short", high: "long", drives: {
    "legs/upperlegs-height-decr-incr": 0.6, "legs/lowerlegs-height-decr-incr": 0.6,
  } },
  { id: "thighs", label: "Thighs", group: "Body", low: "slim", high: "strong", drives: {
    "legs/measure-thigh-circ-decr-incr": 0.8, "legs/upperleg-scale-horiz-decr-incr": 0.3, "legs/measure-calf-circ-decr-incr": 0.3,
  } },
  { id: "arms", label: "Arms", group: "Body", low: "thin", high: "thick", drives: {
    "arms/measure-upperarm-circ-decr-incr": 0.8, "arms/lowerarm-scale-horiz-decr-incr": 0.4, "hands/measure-wrist-circ-decr-incr": 0.3,
  } },
  { id: "neck", label: "Neck", group: "Body", low: "slender", high: "thick", drives: {
    "neck/measure-neck-circ-decr-incr": 0.8, "neck/neck-scale-horiz-decr-incr": 0.3,
  } },
  { id: "head", label: "Head size", group: "Body", low: "small", high: "large", drives: {
    "head/head-scale-horiz-decr-incr": 0.5, "head/head-scale-vert-decr-incr": 0.5, "head/head-scale-depth-decr-incr": 0.5,
  } },
  // Face
  { id: "faceWidth", label: "Face width", group: "Face", low: "narrow", high: "wide", drives: {
    "head/head-scale-horiz-decr-incr": 0.4, "cheek/cheek-bones-decr-incr": 0.3, "chin/chin-width-decr-incr": 0.4,
  } },
  { id: "fullness", label: "Fullness", group: "Face", low: "gaunt", high: "full", drives: {
    "cheek/cheek-volume-decr-incr": 0.7, "cheek/cheek-inner-decr-incr": 0.4, "head/head-fat-decr-incr": 0.4, "neck/neck-double-decr-incr": 0.25,
  } },
  { id: "jaw", label: "Jaw", group: "Face", low: "soft", high: "strong", drives: {
    "chin/chin-bones-decr-incr": 0.6, "chin/chin-width-decr-incr": 0.4, "chin/chin-prominent-decr-incr": 0.3, "chin/chin-height-decr-incr": 0.2,
  } },
  { id: "cheekbones", label: "Cheekbones", group: "Face", low: "flat", high: "high", drives: {
    "cheek/cheek-bones-decr-incr": 0.8, "cheek/cheek-trans-down-up": 0.3,
  } },
  { id: "brow", label: "Brow", group: "Face", low: "smooth", high: "heavy", drives: {
    "forehead/forehead-trans-backward-forward": 0.5, "eyebrows/eyebrows-trans-backward-forward": 0.6, "eyebrows/eyebrows-trans-down-up": -0.25,
  } },
  { id: "eyes", label: "Eye size", group: "Face", low: "small", high: "large", drives: {
    "eyes/eye-scale-decr-incr": 0.8,
  } },
  { id: "nose", label: "Nose size", group: "Face", low: "small", high: "large", drives: {
    "nose/nose-scale-horiz-decr-incr": 0.5, "nose/nose-scale-vert-decr-incr": 0.5, "nose/nose-scale-depth-decr-incr": 0.5,
  } },
  { id: "noseWidth", label: "Nose width", group: "Face", low: "narrow", high: "wide", drives: {
    "nose/nose-scale-horiz-decr-incr": 0.5, "nose/nose-nostrils-width-decr-incr": 0.5, "nose/nose-flaring-decr-incr": 0.3,
  } },
  { id: "lips", label: "Lips", group: "Face", low: "thin", high: "full", drives: {
    "mouth/mouth-upperlip-volume-decr-incr": 0.7, "mouth/mouth-lowerlip-volume-decr-incr": 0.8,
  } },
  { id: "mouthWidth", label: "Mouth width", group: "Face", low: "narrow", high: "wide", drives: {
    "mouth/mouth-scale-horiz-decr-incr": 0.8,
  } },
  { id: "chin", label: "Chin", group: "Face", low: "receding", high: "prominent", drives: {
    "chin/chin-prominent-decr-incr": 0.7, "chin/chin-prognathism-decr-incr": 0.3,
  } },
];

/**
 * The raw modifier values for shape slider values, added to `details` (the raw sliders) and
 * clamped to each modifier's range. Unknown ids are ignored; `known` limits the result to
 * modifiers the pack has (and gives their lower bound: -1 for two-sided ones, 0 for one-sided).
 */
export function shapeModifiers(shape: Record<string, number>, details: Record<string, number> = {}, known?: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...details };
  for (const s of SHAPE_SLIDERS) {
    const v = shape[s.id];
    if (!v || !Number.isFinite(v)) continue;
    const k = Math.max(-1, Math.min(1, v));
    for (const [id, w] of Object.entries(s.drives)) {
      if (known && !known.has(id)) continue;
      out[id] = (out[id] ?? 0) + w * k;
    }
  }
  for (const id of Object.keys(out)) {
    const min = known?.get(id) ?? -1;
    out[id] = Math.max(min, Math.min(1, out[id]));
  }
  return out;
}

/** A named starting point: macro sliders and shape sliders together. */
export interface BodyType {
  id: string;
  label: string;
  /** Macro sliders it sets (others keep their value: gender, age and ethnicity stay). */
  body: Partial<Pick<HumanParams, "muscle" | "weight" | "height" | "proportions">>;
  shape: Record<string, number>;
}

export const BODY_TYPES: BodyType[] = [
  { id: "average", label: "Average", body: { muscle: 0.5, weight: 0.5, proportions: 0.5 }, shape: {} },
  { id: "slim", label: "Slim", body: { muscle: 0.4, weight: 0.3, proportions: 0.6 }, shape: { fat: -0.4, waist: -0.3, arms: -0.3, thighs: -0.3, neck: -0.2, fullness: -0.3 } },
  { id: "athletic", label: "Athletic", body: { muscle: 0.75, weight: 0.45, proportions: 0.6 }, shape: { fat: -0.4, fitness: 0.7, shoulders: 0.3, waist: -0.2, thighs: 0.2 } },
  { id: "muscular", label: "Muscular", body: { muscle: 0.85, weight: 0.6, proportions: 0.55 }, shape: { fitness: 0.7, shoulders: 0.5, chest: 0.4, arms: 0.3, neck: 0.4, waist: -0.1, thighs: 0.15, jaw: 0.3 } },
  { id: "curvy", label: "Curvy", body: { muscle: 0.4, weight: 0.6, proportions: 0.5 }, shape: { hips: 0.6, bottom: 0.6, thighs: 0.4, waist: -0.2, fat: 0.2, fullness: 0.2 } },
  { id: "hourglass", label: "Hourglass", body: { muscle: 0.45, weight: 0.5, proportions: 0.6 }, shape: { hips: 0.5, bottom: 0.4, waist: -0.6, shoulders: 0.2 } },
  { id: "pear", label: "Pear", body: { muscle: 0.45, weight: 0.55, proportions: 0.5 }, shape: { hips: 0.7, thighs: 0.6, bottom: 0.4, shoulders: -0.4 } },
  { id: "inverted", label: "Inverted triangle", body: { muscle: 0.6, weight: 0.5, proportions: 0.55 }, shape: { shoulders: 0.7, chest: 0.4, hips: -0.4, thighs: -0.2 } },
  { id: "stocky", label: "Stocky", body: { muscle: 0.65, weight: 0.65, height: 0.3, proportions: 0.35 }, shape: { shoulders: 0.4, waist: 0.4, neck: 0.5, legs: -0.4, arms: 0.3, faceWidth: 0.4, jaw: 0.3 } },
  { id: "heavy", label: "Heavy", body: { muscle: 0.45, weight: 0.9, proportions: 0.4 }, shape: { fat: 0.7, belly: 0.6, waist: 0.4, neck: 0.4, fullness: 0.6 } },
  { id: "lanky", label: "Tall and lanky", body: { muscle: 0.35, weight: 0.3, height: 0.85, proportions: 0.7 }, shape: { fat: -0.3, legs: 0.3, arms: -0.4, neck: -0.2, shoulders: -0.2, fullness: -0.3 } },
  { id: "petite", label: "Petite", body: { muscle: 0.4, weight: 0.4, height: 0.15, proportions: 0.6 }, shape: { shoulders: -0.3, head: -0.1, hips: -0.1, arms: -0.2 } },
];
