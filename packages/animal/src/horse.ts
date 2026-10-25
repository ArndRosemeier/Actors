/**
 * Horse parameters: body proportions (bone scales), morphs and the coat
 * (colours and markings for the fur material), with presets for common coat
 * colours and types. The base body is a bay Thoroughbred-type gelding of about
 * 1.60 m at the withers; the other presets reshape and recolour it.
 */
import type { BoneScale, ShapeOptions } from "@actors/core";
import type { RGB } from "./breeds";

/** Body shape. Proportion values are factors around 1; morph values run 0..1. */
export interface HorseShape {
  /** Overall size (1: about 1.60 m at the withers). */
  size: number;
  legs: number;
  /** Back length. */
  body: number;
  neck: number;
  head: number;
  ears: number;
  /** Barrel girth. */
  bulk: number;
  /** Leg thickness (bone). */
  bone: number;
  /** Dock length. */
  tail: number;
  /** Heavier, arched neck (stallions, draught horses). */
  neckThick: number;
  /** Deeper, rounder belly (ponies, horses at grass). */
  belly: number;
  /** Dished face (Arabians). */
  dish: number;
}

/**
 * Coat colours and markings. It has every field of the fur material's coat
 * (the dog markings stay 0), so it can be passed to `setFurCoat` as it is.
 */
export interface HorseCoat {
  /** Body colour. */
  base: RGB;
  /** Points: the lower legs (black on bays and buckskins). */
  second: RGB;
  /** Mane and tail colour. */
  tan: RGB;
  /** White markings (face, socks) and the pale muzzle. */
  white: RGB;
  /** Mane and tail in their own colour (`tan`), 0: body colour. */
  maneTail: number;
  /** Lower legs in the points colour (`second`). */
  darkLegs: number;
  /** Dapples: rings of lighter coat (dapple greys, some bays). */
  dapples: number;
  /** White face marking: 0.3 a narrow strip, 0.5 a blaze with a snip, 1 a bald face. */
  blaze: number;
  /** White socks: 0.3 to the fetlock, 0.6 half way up the cannon, 0.9 stockings. */
  socks: number;
  /** Pale (mealy) muzzle and eyes. */
  paleMask: number;
  /** Dark muzzle. */
  mask: number;
  /** Lighter belly and flanks. */
  belly: number;
  /** Lighter underside and darker topline. */
  shade: number;
  /** Dark hair tips (sooty). */
  agouti: number;
  innerEar: number;
  /** Iris colour. */
  iris: RGB;
  /** Hair length in meters. */
  length: number;
  fluff: number;
  // Dog markings (unused on horses).
  saddle: number;
  points: number;
  bib: number;
  tailTip: number;
  spots: number;
  spotSize: number;
}

export interface HorseParams {
  shape: HorseShape;
  coat: HorseCoat;
}

export const HORSE_DEFAULT_SHAPE: HorseShape = { size: 1, legs: 1, body: 1, neck: 1, head: 1, ears: 1, bulk: 1, bone: 1, tail: 1, neckThick: 0, belly: 0, dish: 0 };

export const HORSE_SHAPE_RANGES: Record<keyof HorseShape, [number, number]> = {
  size: [0.55, 1.15],
  legs: [0.75, 1.15],
  body: [0.9, 1.15],
  neck: [0.85, 1.15],
  head: [0.85, 1.15],
  ears: [0.7, 1.4],
  bulk: [0.85, 1.6],
  bone: [0.85, 1.6],
  tail: [0.6, 1.3],
  neckThick: [0, 1],
  belly: [0, 1],
  dish: [0, 1],
};

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export const HORSE_DEFAULT_COAT: HorseCoat = {
  base: hex("#4a2a1b"),
  second: hex("#120d0b"),
  tan: hex("#100b09"),
  white: hex("#e4e0da"),
  maneTail: 1,
  darkLegs: 1,
  dapples: 0,
  blaze: 0,
  socks: 0,
  paleMask: 0,
  mask: 0.3,
  belly: 0,
  shade: 0,
  agouti: 0,
  innerEar: 0,
  iris: hex("#24140a"),
  length: 0.005,
  fluff: 0.05,
  saddle: 0,
  points: 0,
  bib: 0,
  tailTip: 0,
  spots: 0,
  spotSize: 1,
};

export interface HorsePreset {
  name: string;
  shape: Partial<HorseShape>;
  coat: Partial<HorseCoat>;
}

export const HORSE_PRESETS: Record<string, HorsePreset> = {
  // The base body is modelled on this photo: a bay gelding with a narrow strip down the face.
  bay: { name: "Bay", shape: {}, coat: { blaze: 0.34 } },
  chestnut: {
    name: "Chestnut (blaze, socks)",
    shape: {},
    coat: { base: hex("#6a2c12"), tan: hex("#5e2510"), maneTail: 0.6, darkLegs: 0, blaze: 0.5, socks: 0.35, mask: 0 },
  },
  black: { name: "Black", shape: { neckThick: 0.2 }, coat: { base: hex("#0f0c0b"), second: hex("#0b0908"), tan: hex("#090707"), mask: 0, agouti: 0 } },
  grey: {
    name: "Dapple grey",
    shape: { dish: 0.25 },
    coat: { base: hex("#77777a"), second: hex("#3a3a3e"), tan: hex("#d0cfcc"), white: hex("#e8e7e4"), maneTail: 0.7, darkLegs: 0.55, dapples: 0.85, mask: 0.6 },
  },
  palomino: {
    name: "Palomino",
    shape: { bulk: 1.05 },
    coat: { base: hex("#b48a4c"), tan: hex("#ece4d2"), maneTail: 1, darkLegs: 0, blaze: 0.35, socks: 0.25, mask: 0, paleMask: 0 },
  },
  buckskin: {
    name: "Buckskin",
    shape: { bulk: 1.08, neckThick: 0.25 },
    coat: { base: hex("#a07a48"), second: hex("#15100c"), tan: hex("#120d0a"), maneTail: 1, darkLegs: 1, mask: 0.5 },
  },
  arabian: {
    name: "Arabian (grey)",
    shape: { size: 0.93, body: 0.95, neck: 1.04, head: 0.92, ears: 0.9, bulk: 0.95, bone: 0.92, tail: 1.1, dish: 1 },
    coat: { base: hex("#c9c7c2"), second: hex("#5c5a58"), tan: hex("#e2e0dc"), white: hex("#ecebe8"), maneTail: 0.8, darkLegs: 0.2, mask: 0.8 },
  },
  draught: {
    name: "Draught horse (bay roan)",
    shape: { size: 1.08, legs: 0.95, body: 1.05, neck: 0.95, head: 1.1, bulk: 1.5, bone: 1.55, neckThick: 1, belly: 0.4 },
    coat: { base: hex("#5a3424"), blaze: 0.55, socks: 0.6, agouti: 0.15 },
  },
  pony: {
    name: "Pony (chestnut)",
    shape: { size: 0.72, legs: 0.85, body: 0.95, neck: 0.92, head: 1.08, ears: 0.85, bulk: 1.25, bone: 1.15, neckThick: 0.5, belly: 0.8 },
    coat: { base: hex("#7a3818"), tan: hex("#c8a878"), maneTail: 0.85, darkLegs: 0, blaze: 0.3, mask: 0.2, length: 0.008, fluff: 0.15 },
  },
};

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

export function sanitizeHorseShape(s: Partial<HorseShape>): HorseShape {
  const out = { ...HORSE_DEFAULT_SHAPE };
  for (const key of Object.keys(HORSE_DEFAULT_SHAPE) as (keyof HorseShape)[]) {
    const v = s[key];
    if (v !== undefined) out[key] = clamp(v, ...HORSE_SHAPE_RANGES[key]);
  }
  return out;
}

export function horseParams(id: string): HorseParams {
  const p = HORSE_PRESETS[id];
  if (!p) throw new Error(`Unknown horse preset ${id}`);
  return { shape: sanitizeHorseShape(p.shape), coat: { ...HORSE_DEFAULT_COAT, ...p.coat } };
}

/** Morph weights for a shape (target name -> weight). */
export function horseTargetWeights(shape: HorseShape): Map<string, number> {
  const s = sanitizeHorseShape(shape);
  const w = new Map<string, number>();
  const set = (name: string, v: number) => {
    if (Math.abs(v) > 1e-4) w.set(name, v);
  };
  // "bulk" adds 20 %; below 1 it runs backwards (slimmer).
  set("bulk", (s.bulk - 1) / 0.2);
  set("belly", s.belly);
  set("neck-thick", s.neckThick);
  set("dish", s.dish);
  return w;
}

const each = (names: string[]) => names.flatMap((n) => [`${n}_l`, `${n}_r`]);

/** Bone proportions and overall size for a shape. */
export function horseShapeOptions(shape: HorseShape, boneNames?: string[]): ShapeOptions {
  const s = sanitizeHorseShape(shape);
  const bones: Record<string, BoneScale> = {};
  const put = (names: string[], scale: BoneScale) => {
    for (const n of names) bones[n] = { len: (bones[n]?.len ?? 1) * (scale.len ?? 1), girth: (bones[n]?.girth ?? 1) * (scale.girth ?? 1) };
  };
  // Leg length lives in the forearm, gaskin and cannons most; the upper bones follow a little.
  put(each(["front_leg_upper", "back_leg_lower"]), { len: s.legs ** 1.2, girth: s.bone });
  put(each(["front_leg_lower", "back_leg_ankle"]), { len: s.legs ** 1.3, girth: s.bone });
  put(each(["front_humerus", "back_leg_upper"]), { len: s.legs ** 0.6, girth: s.bone });
  put(each(["front_leg_ankle", "front_leg_foot", "back_leg_foot", "back_leg_toe"]), { len: s.legs ** 0.5, girth: s.bone });
  put(["spine_1", "spine_2"], { len: s.body });
  put(["spine_4", "spine_5", "spine_6"], { len: s.neck });
  put(["head", "nose", "head_leaf", "mouth", "mouth_tip"], { len: s.head, girth: s.head });
  put(each(["ear_1", "ear_2", "ear_leaf"]), { len: s.ears, girth: Math.sqrt(s.ears) });
  put(["tail_1", "tail_2", "tail_3", "tail_4", "tail_leaf"], { len: s.tail, girth: s.tail ** 0.3 });
  if (boneNames) {
    const known = new Set(boneNames);
    for (const n of Object.keys(bones)) if (!known.has(n)) delete bones[n];
  }
  return { bones, scale: s.size };
}
