/**
 * Deer parameters: body proportions (bone scales), morphs and the coat
 * (colours and markings for the fur material), with presets. The base body is
 * a sika hind; the other presets reshape and recolour it.
 */
import type { BoneScale, ShapeOptions } from "@actors/core";
import type { RGB } from "./breeds";

/** Body shape. Proportion values are factors around 1; morph values run 0..1. */
export interface DeerShape {
  /** Overall size (1: a sika hind, about 82 cm at the withers). */
  size: number;
  legs: number;
  /** Back length. */
  body: number;
  neck: number;
  head: number;
  ears: number;
  /** Barrel girth. */
  bulk: number;
  /** Leg thickness. */
  bone: number;
  tail: number;
  /** Heavier neck (red deer, winter coat). */
  neckThick: number;
  /** Deeper belly. */
  belly: number;
  /** Longer face in front of the eyes. */
  muzzle: number;
}

/**
 * Coat colours and markings. It has every field of the fur material's coat
 * (the dog markings stay 0), so it can be passed to `setFurCoat` as it is.
 */
export interface DeerCoat {
  /** Body colour. */
  base: RGB;
  /** Dark markings: dorsal stripe, rump border, tail. */
  second: RGB;
  /** Head, neck and lower legs (greyer than the body). */
  tan: RGB;
  /** Spots, rump patch, belly, throat. */
  white: RGB;
  dapple: number;
  /** Spot spacing (1: about 4 cm). */
  dappleSize: number;
  dorsal: number;
  rump: number;
  rumpBorder: number;
  headTone: number;
  eyeRing: number;
  innerEar: number;
  /** White metatarsal gland tufts. */
  glands: number;
  belly: number;
  /** Pale throat patch. */
  bib: number;
  /** Lighter underside and darker topline. */
  shade: number;
  /** Pale chin and band behind the nose. */
  paleMask: number;
  /** Lower legs in the tan colour. */
  tanLegs: number;
  agouti: number;
  /** Iris colour. */
  iris: RGB;
  /** Hair length in meters. */
  length: number;
  fluff: number;
  // Dog markings (unused on deer).
  saddle: number;
  mask: number;
  points: number;
  socks: number;
  blaze: number;
  tailTip: number;
  spots: number;
  spotSize: number;
}

export interface DeerParams {
  shape: DeerShape;
  coat: DeerCoat;
}

export const DEER_DEFAULT_SHAPE: DeerShape = { size: 1, legs: 1, body: 1, neck: 1, head: 1, ears: 1, bulk: 1, bone: 1, tail: 1, neckThick: 0, belly: 0, muzzle: 0 };

export const DEER_SHAPE_RANGES: Record<keyof DeerShape, [number, number]> = {
  size: [0.6, 1.6],
  legs: [0.8, 1.25],
  body: [0.85, 1.25],
  neck: [0.8, 1.25],
  head: [0.85, 1.2],
  ears: [0.7, 1.4],
  bulk: [0.85, 1.35],
  bone: [0.8, 1.3],
  tail: [0.2, 1.8],
  neckThick: [0, 1],
  belly: [0, 1],
  muzzle: [0, 1],
};

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export const DEER_DEFAULT_COAT: DeerCoat = {
  base: hex("#734a2e"),
  second: hex("#1a110b"),
  tan: hex("#7a6352"),
  white: hex("#dcd8d0"),
  dapple: 0,
  dappleSize: 1,
  dorsal: 0,
  rump: 0,
  rumpBorder: 0,
  headTone: 0,
  eyeRing: 0,
  innerEar: 0.6,
  glands: 0,
  belly: 0.4,
  bib: 0.3,
  shade: 0.2,
  paleMask: 0.5,
  tanLegs: 0.4,
  agouti: 0.1,
  iris: hex("#2a170c"),
  length: 0.007,
  fluff: 0.08,
  saddle: 0,
  mask: 0,
  points: 0,
  socks: 0,
  blaze: 0,
  tailTip: 0,
  spots: 0,
  spotSize: 1,
};

export interface DeerPreset {
  name: string;
  shape: Partial<DeerShape>;
  coat: Partial<DeerCoat>;
}

export const DEER_PRESETS: Record<string, DeerPreset> = {
  // The base body is modelled on this photo: a sika hind in her spotted summer coat.
  sika: {
    name: "Sika deer (hind)",
    shape: {},
    coat: { dapple: 1, dorsal: 0.6, rump: 1, rumpBorder: 1, headTone: 0.85, eyeRing: 0.2, innerEar: 0.85, glands: 1, belly: 0, bib: 0.06, shade: 0.55, paleMask: 0.25, tanLegs: 0.75 },
  },
  fallow: {
    name: "Fallow deer (doe)",
    shape: { size: 1.05, body: 1.05, bulk: 1.05, tail: 1.5, muzzle: 0.2 },
    coat: { base: hex("#7a4420"), tan: hex("#6e4a30"), dapple: 1, dappleSize: 1.15, dorsal: 1, rump: 1, rumpBorder: 1, headTone: 0.3, belly: 0.75, bib: 0.3, paleMask: 0.4, tanLegs: 0.3, glands: 0 },
  },
  chital: {
    name: "Chital (axis deer)",
    shape: { size: 1.08, legs: 1.04, tail: 1.4, muzzle: 0.15 },
    coat: { base: hex("#7c3f18"), tan: hex("#6c4c34"), dapple: 1, dappleSize: 0.85, dorsal: 0.9, rump: 0.5, rumpBorder: 0.3, headTone: 0.45, belly: 0.8, bib: 1, eyeRing: 0.4, paleMask: 0.7, tanLegs: 0.3, glands: 0 },
  },
  red: {
    name: "Red deer (hind)",
    shape: { size: 1.4, legs: 1.03, neck: 1.08, head: 1.06, bulk: 1.1, bone: 1.1, tail: 0.75, neckThick: 0.45, muzzle: 0.7 },
    coat: { base: hex("#6a4028"), tan: hex("#5e4a3c"), white: hex("#d9c7a8"), rump: 0.85, rumpBorder: 0.25, headTone: 0.55, belly: 0.25, bib: 0.1, paleMask: 0.35, tanLegs: 0.5, agouti: 0.25, length: 0.009 },
  },
  roe: {
    name: "Roe deer (doe)",
    shape: { size: 0.85, legs: 1.02, body: 0.93, neck: 0.95, head: 0.95, ears: 1.12, bulk: 0.95, bone: 0.9, tail: 0.2 },
    coat: { base: hex("#7a3a1a"), tan: hex("#6a4632"), rump: 1, headTone: 0.35, belly: 0.3, bib: 0.15, paleMask: 1, eyeRing: 0.3, tanLegs: 0.3, glands: 0 },
  },
  whitetail: {
    name: "White-tailed deer (doe)",
    shape: { size: 1.1, legs: 1.03, tail: 1.6, muzzle: 0.35, ears: 1.1 },
    coat: { base: hex("#7b5536"), tan: hex("#6e5440"), white: hex("#ece8e2"), rump: 0.6, headTone: 0.4, eyeRing: 1, belly: 1, bib: 1, paleMask: 1, innerEar: 0.9, tanLegs: 0.2, agouti: 0.2 },
  },
};

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

export function sanitizeDeerShape(s: Partial<DeerShape>): DeerShape {
  const out = { ...DEER_DEFAULT_SHAPE };
  for (const key of Object.keys(DEER_DEFAULT_SHAPE) as (keyof DeerShape)[]) {
    const v = s[key];
    if (v !== undefined) out[key] = clamp(v, ...DEER_SHAPE_RANGES[key]);
  }
  return out;
}

export function deerParams(id: string): DeerParams {
  const p = DEER_PRESETS[id];
  if (!p) throw new Error(`Unknown deer preset ${id}`);
  return { shape: sanitizeDeerShape(p.shape), coat: { ...DEER_DEFAULT_COAT, ...p.coat } };
}

/** Morph weights for a shape (target name -> weight). */
export function deerTargetWeights(shape: DeerShape): Map<string, number> {
  const s = sanitizeDeerShape(shape);
  const w = new Map<string, number>();
  const set = (name: string, v: number) => {
    if (Math.abs(v) > 1e-4) w.set(name, v);
  };
  // "bulk" adds 22 %; below 1 it runs backwards (slimmer).
  set("bulk", (s.bulk - 1) / 0.22);
  set("belly", s.belly);
  set("neck-thick", s.neckThick);
  set("muzzle-long", s.muzzle);
  return w;
}

const SIDES = ["L", "R"];
const each = (names: string[]) => names.flatMap((n) => SIDES.map((x) => `${n}.${x}`));

/** Bone proportions and overall size for a shape. */
export function deerShapeOptions(shape: DeerShape, boneNames?: string[]): ShapeOptions {
  const s = sanitizeDeerShape(shape);
  const bones: Record<string, BoneScale> = {};
  const put = (names: string[], scale: BoneScale) => {
    for (const n of names) bones[n] = { len: (bones[n]?.len ?? 1) * (scale.len ?? 1), girth: (bones[n]?.girth ?? 1) * (scale.girth ?? 1) };
  };
  // Leg length lives in the long bones (cannons and forearm most); upper bones follow a little.
  put(each(["FrontLowerLeg", "BackLowerLeg"]), { len: s.legs ** 1.3, girth: s.bone });
  put(each(["FrontUpperLeg", "BackUpperLeg"]), { len: s.legs, girth: s.bone });
  put(each(["BackLeg"]), { len: s.legs ** 0.6, girth: s.bone });
  put(each(["IKFrontLeg", "IKBackLeg", "FF", "FFB"]), { girth: s.bone });
  put(["Torso", "Torso2"], { len: s.body });
  put(["Neck1", "Neck2", "Neck3"], { len: s.neck });
  put(["Head"], { len: s.head, girth: s.head });
  put(each(["Ear1", "Ear2", "Ear3", "Ear4"]), { len: s.ears, girth: Math.sqrt(s.ears) });
  put(["Tail1", "Tail2", "Tail3"], { len: s.tail, girth: s.tail ** 0.3 });
  if (boneNames) {
    const known = new Set(boneNames);
    for (const n of Object.keys(bones)) if (!known.has(n)) delete bones[n];
  }
  return { bones, scale: s.size };
}

/** A mix of two deer (t = 0: a, 1: b). */
export function mixDeerParams(a: DeerParams, b: DeerParams, t: number): DeerParams {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const shape = { ...a.shape };
  for (const k of Object.keys(shape) as (keyof DeerShape)[]) shape[k] = lerp(a.shape[k], b.shape[k]);
  const coat = { ...a.coat };
  for (const k of Object.keys(coat) as (keyof DeerCoat)[]) {
    const x = a.coat[k], y = b.coat[k];
    (coat as Record<string, unknown>)[k] = Array.isArray(x) ? (x.map((v, i) => lerp(v, (y as RGB)[i])) as RGB) : lerp(x, y as number);
  }
  return { shape, coat };
}
