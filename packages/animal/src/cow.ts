/**
 * Cow parameters: body proportions (bone scales), morphs and the coat
 * (colours and markings for the fur material), with presets for common
 * breeds. The base body is a Braunvieh (Swiss Brown) cow of about 1.40 m at
 * the withers; the other presets reshape and recolour it.
 */
import type { BoneScale, ShapeOptions } from "@actors/core";
import type { RGB } from "./breeds";

/** Body shape. Proportion values are factors around 1; morph values run 0..1 (udder -1..1). */
export interface CowShape {
  /** Overall size (1: about 1.40 m at the withers). */
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
  tail: number;
  /** Thick, deep neck (bulls, beef breeds). */
  neckThick: number;
  /** Fuller quarters and loin (beef breeds). */
  muscle: number;
  /** Dished face (Jersey). */
  dish: number;
  /** Udder: -1 small (heifers, beef cows) .. 0 .. 1 large (a dairy cow in milk). */
  udder: number;
  /** Horn size: 0 polled or dehorned .. 1 full horns. */
  horns: number;
  /** Long horns sweeping out and up (Highland cattle). */
  hornsLong: number;
}

/**
 * Coat colours and markings. It has every field of the fur material's coat
 * (the dog markings stay 0), so it can be passed to `setFurCoat` as it is.
 */
export interface CowCoat {
  /** Body colour. */
  base: RGB;
  /** Dark colour: the darker head of some breeds. */
  second: RGB;
  /** Switch (tail hair) colour. */
  tan: RGB;
  /** White markings and the pale ring round the muzzle. */
  white: RGB;
  /** Nose plate colour (slate on brown and black cattle, pink on white-faced breeds). */
  nose: RGB;
  /** Switch in its own colour (`tan`), 0: body colour. */
  maneTail: number;
  /** Lower legs in the dark colour. */
  darkLegs: number;
  /** Unused on cows (horse dapples). */
  dapples: number;
  /** White face: 0.3 a blaze .. 1 the whole head (Hereford, Simmental). */
  blaze: number;
  /** White lower legs: 0.3 to the fetlock .. 0.9 above the knee. */
  socks: number;
  /** Pale (mealy) ring round the nose plate and round the eyes. */
  paleMask: number;
  /** Dark muzzle. */
  mask: number;
  /** White underside. */
  belly: number;
  /** White dewlap and brisket. */
  bib: number;
  /** White switch. */
  tailTip: number;
  /** Lighter underside and darker topline. */
  shade: number;
  /** Dark hair tips. */
  agouti: number;
  innerEar: number;
  /** White patches (piebald): 0 none .. 1 mostly white. */
  pied: number;
  /** Patch size (1: Holstein-sized). */
  piedSize: number;
  /** Pink udder skin. */
  udderSkin: number;
  /** Darker head (Jersey). */
  darkHead: number;
  /** Iris colour. */
  iris: RGB;
  /** Hair length in meters. */
  length: number;
  fluff: number;
  // Dog markings (unused on cows).
  saddle: number;
  points: number;
  spots: number;
  spotSize: number;
}

export interface CowParams {
  shape: CowShape;
  coat: CowCoat;
}

export const COW_DEFAULT_SHAPE: CowShape = {
  size: 1, legs: 1, body: 1, neck: 1, head: 1, ears: 1, bulk: 1, bone: 1, tail: 1,
  neckThick: 0, muscle: 0, dish: 0, udder: 0, horns: 1, hornsLong: 0,
};

export const COW_SHAPE_RANGES: Record<keyof CowShape, [number, number]> = {
  size: [0.7, 1.15],
  legs: [0.75, 1.15],
  body: [0.9, 1.15],
  neck: [0.85, 1.2],
  head: [0.85, 1.15],
  ears: [0.7, 1.3],
  bulk: [0.85, 1.6],
  bone: [0.85, 1.4],
  tail: [0.7, 1.2],
  neckThick: [0, 1],
  muscle: [0, 1],
  dish: [0, 1],
  udder: [-1, 1],
  horns: [0, 1],
  hornsLong: [0, 1],
};

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export const COW_DEFAULT_COAT: CowCoat = {
  base: hex("#635343"), // grey-brown; the lighter #84745f read near white in daylight
  second: hex("#3a2c22"),
  tan: hex("#5a3e2a"),
  white: hex("#e6ded0"),
  nose: hex("#2b2726"),
  maneTail: 0.7,
  darkLegs: 0,
  dapples: 0,
  blaze: 0,
  socks: 0,
  paleMask: 0.8,
  mask: 0,
  belly: 0,
  bib: 0,
  tailTip: 0,
  shade: 0.35,
  agouti: 0,
  innerEar: 0.55,
  pied: 0,
  piedSize: 1,
  udderSkin: 1,
  darkHead: 0,
  iris: hex("#2a1a10"),
  length: 0.009,
  fluff: 0.1,
  saddle: 0,
  points: 0,
  spots: 0,
  spotSize: 1,
};

export interface CowPreset {
  name: string;
  shape: Partial<CowShape>;
  coat: Partial<CowCoat>;
}

export const COW_PRESETS: Record<string, CowPreset> = {
  // The base body is modelled on this photo: a light brown alpine cow, dehorned, with a pale ring round the muzzle.
  braunvieh: { name: "Braunvieh (Swiss Brown)", shape: { horns: 0 }, coat: {} },
  holstein: {
    name: "Holstein (black and white)",
    shape: { size: 1.04, legs: 1.04, bulk: 0.95, udder: 0.9, horns: 0 },
    coat: { base: hex("#141211"), second: hex("#0c0b0a"), tan: hex("#141211"), white: hex("#ebe8e2"), nose: hex("#3a2c2a"), pied: 0.5, socks: 0.45, belly: 0.9, tailTip: 1, blaze: 0.35, paleMask: 0, shade: 0, innerEar: 0.2 },
  },
  fleckvieh: {
    name: "Simmental (Fleckvieh)",
    shape: { bulk: 1.12, muscle: 0.3, neckThick: 0.2, udder: 0.3, horns: 0.85 },
    coat: { base: hex("#9a5426"), tan: hex("#e8e0d2"), white: hex("#ece6da"), nose: hex("#c99a8c"), pied: 0.38, piedSize: 0.8, blaze: 1, socks: 0.55, belly: 1, bib: 0.6, tailTip: 1, maneTail: 0, paleMask: 0, shade: 0.1 },
  },
  hereford: {
    name: "Hereford (polled)",
    shape: { size: 0.97, legs: 0.9, bulk: 1.3, muscle: 0.55, neckThick: 0.4, udder: -0.7, horns: 0 },
    coat: { base: hex("#6c2a12"), tan: hex("#e8e0d2"), white: hex("#ece6da"), nose: hex("#c8968a"), blaze: 1, bib: 1, belly: 0.85, socks: 0.35, tailTip: 1, maneTail: 0, paleMask: 0, shade: 0.1, length: 0.012, fluff: 0.25 },
  },
  angus: {
    name: "Aberdeen Angus",
    shape: { size: 0.95, legs: 0.88, bulk: 1.3, muscle: 0.6, neckThick: 0.35, udder: -0.7, horns: 0, ears: 0.9 },
    coat: { base: hex("#100e0e"), second: hex("#0a0909"), tan: hex("#100e0e"), white: hex("#2a2624"), nose: hex("#1c1919"), paleMask: 0, shade: 0, innerEar: 0.15, length: 0.01 },
  },
  jersey: {
    name: "Jersey",
    shape: { size: 0.86, legs: 0.97, bulk: 0.92, head: 0.94, dish: 0.9, udder: 0.6, horns: 0.6 },
    coat: { base: hex("#9a6a3c"), second: hex("#3a2618"), tan: hex("#2a1c14"), white: hex("#e8dccb"), nose: hex("#1e1a19"), darkHead: 0.55, paleMask: 1, shade: 0.4, agouti: 0.15, maneTail: 1 },
  },
  highland: {
    name: "Highland",
    shape: { size: 0.88, legs: 0.84, bulk: 1.2, bone: 1.1, udder: -0.4, horns: 1, hornsLong: 1, ears: 0.9 },
    coat: { base: hex("#a2501e"), tan: hex("#8a4018"), white: hex("#d8b890"), nose: hex("#2a2120"), paleMask: 0.2, shade: 0.15, maneTail: 1, length: 0.07, fluff: 0.55, agouti: 0.1 },
  },
  charolais: {
    name: "Charolais",
    shape: { size: 1.03, bulk: 1.35, muscle: 1, neckThick: 0.45, bone: 1.15, udder: -0.5, horns: 0.55 },
    coat: { base: hex("#d6ccb4"), second: hex("#a89c84"), tan: hex("#d6ccb4"), white: hex("#ebe5d8"), nose: hex("#d0a898"), paleMask: 0.3, shade: 0.15, innerEar: 0.3 },
  },
};

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

export function sanitizeCowShape(s: Partial<CowShape>): CowShape {
  const out = { ...COW_DEFAULT_SHAPE };
  for (const key of Object.keys(COW_DEFAULT_SHAPE) as (keyof CowShape)[]) {
    const v = s[key];
    if (v !== undefined) out[key] = clamp(v, ...COW_SHAPE_RANGES[key]);
  }
  return out;
}

export function cowParams(id: string): CowParams {
  const p = COW_PRESETS[id];
  if (!p) throw new Error(`Unknown cow preset ${id}`);
  return { shape: sanitizeCowShape(p.shape), coat: { ...COW_DEFAULT_COAT, ...p.coat } };
}

/** Morph weights for a shape (target name -> weight). */
export function cowTargetWeights(shape: CowShape): Map<string, number> {
  const s = sanitizeCowShape(shape);
  const w = new Map<string, number>();
  const set = (name: string, v: number) => {
    if (Math.abs(v) > 1e-4) w.set(name, v);
  };
  // "bulk" adds 20 %; below 1 it runs backwards (slimmer).
  set("bulk", (s.bulk - 1) / 0.2);
  set("muscle", s.muscle);
  set("neck-thick", s.neckThick);
  set("dish", s.dish);
  set("udder-large", Math.max(0, s.udder));
  set("udder-small", Math.max(0, -s.udder));
  // The horns shrink into the poll as `horns` goes to 0; the long sweep scales with them.
  set("horns-none", 1 - s.horns);
  set("horns-long", s.hornsLong * s.horns);
  return w;
}

const each = (names: string[]) => names.flatMap((n) => [`${n}_l`, `${n}_r`]);

/** Bone proportions and overall size for a shape (the horse rig's bone names). */
export function cowShapeOptions(shape: CowShape, boneNames?: string[]): ShapeOptions {
  const s = sanitizeCowShape(shape);
  const bones: Record<string, BoneScale> = {};
  const put = (names: string[], scale: BoneScale) => {
    for (const n of names) bones[n] = { len: (bones[n]?.len ?? 1) * (scale.len ?? 1), girth: (bones[n]?.girth ?? 1) * (scale.girth ?? 1) };
  };
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
