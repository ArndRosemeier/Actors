/**
 * Dog parameters: body proportions (bone scales), breed morphs (target
 * weights) and the coat (colours and pattern amounts for the fur material),
 * plus presets for some well-known breeds and wild canids.
 */

export type RGB = [number, number, number];

/** Body shape. Proportion values are factors around 1; morph values run 0..1. */
export interface DogShape {
  /** Overall size (1: a mid-sized dog, about 55 cm at the withers). */
  size: number;
  /** Leg length. */
  legs: number;
  /** Back length (withers to croup). */
  body: number;
  neck: number;
  /** Head size. */
  head: number;
  /** Torso girth (barrel). */
  bulk: number;
  /** Leg thickness (bone). */
  bone: number;
  /** Tail length. */
  tail: number;
  /** Ear size. */
  ears: number;
  /** Ears hang down (0: pricked). */
  earDrop: number;
  /** Ear tips fold forward (semi-prick, button ears). */
  earFold: number;
  /** Muzzle length: -1 very short (brachycephalic) .. 0 .. 1 long. */
  muzzle: number;
  muzzleBroad: number;
  muzzleDeep: number;
  /** Pronounced stop (step between forehead and muzzle). */
  stop: number;
  skullDome: number;
  chestDeep: number;
  bellyTuck: number;
  /** Tail curled up over the back. */
  tailCurl: number;
}

/** Coat colours and markings, read by the fur material. Amounts run 0..1. */
export interface DogCoat {
  /** Main colour. */
  base: RGB;
  /** Second colour: saddle, mask, spots. */
  second: RGB;
  /** Tan points (brows, cheeks, legs, under the tail). */
  tan: RGB;
  /** White markings. */
  white: RGB;
  saddle: number;
  mask: number;
  /** Tan points. */
  points: number;
  belly: number;
  bib: number;
  socks: number;
  blaze: number;
  tailTip: number;
  spots: number;
  /** Size of the spots (1: Dalmatian-sized). */
  spotSize: number;
  /** Lighter undercoat showing on the underside and inside the legs. */
  shade: number;
  /** Light mask: cream muzzle sides, cheeks and lower jaw (wolf colouring). */
  paleMask: number;
  /** Dark guard hair tips over a lighter undercoat (wolf grey, sable). */
  agouti: number;
  /** Lower legs in the tan colour (fawn legs of wolves and wolfdogs). */
  tanLegs: number;
  /** Fur length in meters (guard hair). */
  length: number;
  /** How much the fur stands off the body (0: sleek, 1: fluffy). */
  fluff: number;
}

export interface DogParams {
  shape: DogShape;
  coat: DogCoat;
}

export const DEFAULT_SHAPE: DogShape = {
  size: 1,
  legs: 1,
  body: 1,
  neck: 1,
  head: 1,
  bulk: 1,
  bone: 1,
  tail: 1,
  ears: 1,
  earDrop: 0,
  earFold: 0,
  muzzle: 0,
  muzzleBroad: 0,
  muzzleDeep: 0,
  stop: 0,
  skullDome: 0,
  chestDeep: 0,
  bellyTuck: 0,
  tailCurl: 0,
};

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export const DEFAULT_COAT: DogCoat = {
  base: hex("#a0703f"),
  second: hex("#2a1d14"),
  tan: hex("#c08a4e"),
  white: hex("#f1ece2"),
  saddle: 0,
  mask: 0,
  points: 0,
  belly: 0,
  bib: 0,
  socks: 0,
  blaze: 0,
  tailTip: 0,
  spots: 0,
  spotSize: 1,
  shade: 0.3,
  paleMask: 0,
  agouti: 0,
  tanLegs: 0,
  length: 0.012,
  fluff: 0.2,
};

/** Slider ranges for the shape values (for editors and sanitizing). */
export const SHAPE_RANGES: Record<keyof DogShape, [number, number]> = {
  size: [0.45, 1.6],
  legs: [0.45, 1.4],
  body: [0.8, 1.45],
  neck: [0.7, 1.4],
  head: [0.8, 1.35],
  bulk: [0.8, 1.45],
  bone: [0.75, 1.5],
  tail: [0.15, 1.4],
  ears: [0.6, 1.8],
  earDrop: [0, 1],
  earFold: [0, 1],
  muzzle: [-1, 1],
  muzzleBroad: [0, 1],
  muzzleDeep: [0, 1],
  stop: [0, 1],
  skullDome: [0, 1],
  chestDeep: [0, 1],
  bellyTuck: [0, 1],
  tailCurl: [0, 1],
};

export interface BreedPreset {
  name: string;
  shape: Partial<DogShape>;
  coat: Partial<DogCoat>;
}

/** Breeds and wild canids; values not given stay at the defaults. */
export const BREEDS: Record<string, BreedPreset> = {
  // The base body is modelled on this breed; the preset only sets its size and coat.
  wolfdog: {
    name: "Czechoslovakian Wolfdog",
    shape: { size: 1.05 },
    coat: { base: hex("#7f7260"), second: hex("#4a4034"), tan: hex("#ad8a5e"), white: hex("#dccfb4"), saddle: 0.45, belly: 1, bib: 1, shade: 0.8, paleMask: 0.8, agouti: 0.8, tanLegs: 0.8, length: 0.014, fluff: 0.5 },
  },
  labrador: {
    name: "Labrador Retriever",
    shape: { size: 1.02, legs: 0.95, bulk: 1.15, bone: 1.15, head: 1.05, earDrop: 1, ears: 1.05, muzzleBroad: 0.6, muzzleDeep: 0.5, stop: 0.6, chestDeep: 0.4, bellyTuck: 0.1, tail: 0.9 },
    coat: { base: hex("#d9b27a"), shade: 0.25, length: 0.007, fluff: 0.05 },
  },
  germanShepherd: {
    name: "German Shepherd",
    shape: { size: 1.08, legs: 1, body: 1.1, neck: 1.05, ears: 1.35, muzzle: 0.25, chestDeep: 0.6, bellyTuck: 0.4, tail: 1.05 },
    coat: { base: hex("#b67a3d"), second: hex("#1c1714"), saddle: 0.85, mask: 0.8, shade: 0.35, length: 0.014, fluff: 0.3 },
  },
  husky: {
    name: "Siberian Husky",
    shape: { size: 0.98, ears: 1.05, muzzle: 0, muzzleBroad: 0.2, chestDeep: 0.3, bellyTuck: 0.2, tailCurl: 0.45, bulk: 1.05 },
    coat: { base: hex("#e9e6e0"), second: hex("#4a4744"), saddle: 1, mask: 0, belly: 1, bib: 1, socks: 0.9, blaze: 0.4, shade: 0.2, length: 0.02, fluff: 0.7, white: hex("#f4f3f0") },
  },
  dachshund: {
    name: "Dachshund",
    shape: { size: 0.7, legs: 0.45, body: 1.45, bulk: 1.1, bone: 1.2, head: 1.08, earDrop: 1, ears: 1.25, muzzle: 0.35, chestDeep: 1, bellyTuck: 0.3, tail: 0.9 },
    coat: { base: hex("#8a4a22"), shade: 0.15, length: 0.005, fluff: 0 },
  },
  greyhound: {
    name: "Greyhound",
    shape: { size: 1.1, legs: 1.3, body: 1.08, neck: 1.25, bulk: 0.85, bone: 0.8, head: 0.92, earFold: 1, ears: 0.8, muzzle: 0.75, chestDeep: 1, bellyTuck: 1, tail: 1.3 },
    coat: { base: hex("#7d7a78"), white: hex("#efeeea"), bib: 0.4, socks: 0.4, shade: 0.1, length: 0.003, fluff: 0 },
  },
  beagle: {
    name: "Beagle",
    shape: { size: 0.72, legs: 0.9, bulk: 1.1, bone: 1.1, head: 1.12, earDrop: 1, ears: 1.3, muzzle: -0.1, muzzleDeep: 0.6, stop: 0.6, skullDome: 0.5, chestDeep: 0.3, tail: 0.85 },
    coat: { base: hex("#a86a32"), second: hex("#1e1916"), white: hex("#f3efe6"), saddle: 0.9, belly: 1, bib: 1, socks: 1, blaze: 0.8, tailTip: 1, shade: 0.1, length: 0.006, fluff: 0.05 },
  },
  borderCollie: {
    name: "Border Collie",
    shape: { size: 0.92, legs: 1, body: 1.05, earFold: 0.7, ears: 1.05, muzzle: 0.1, chestDeep: 0.4, bellyTuck: 0.4, tail: 1.1 },
    coat: { base: hex("#191716"), white: hex("#f3f1ec"), tan: hex("#b07a40"), belly: 1, bib: 1, socks: 0.8, blaze: 1, tailTip: 1, shade: 0, length: 0.022, fluff: 0.55 },
  },
  rottweiler: {
    name: "Rottweiler",
    shape: { size: 1.1, legs: 0.95, bulk: 1.3, bone: 1.35, head: 1.15, earFold: 1, earDrop: 0.5, ears: 0.8, muzzle: -0.25, muzzleBroad: 0.8, muzzleDeep: 0.7, stop: 0.9, skullDome: 0.4, chestDeep: 0.6, tail: 0.25 },
    coat: { base: hex("#171413"), tan: hex("#8b4a22"), points: 1, shade: 0, length: 0.005, fluff: 0 },
  },
  corgi: {
    name: "Pembroke Welsh Corgi",
    shape: { size: 0.78, legs: 0.5, body: 1.25, bulk: 1.15, bone: 1.15, ears: 1.45, muzzle: 0, chestDeep: 0.8, tail: 0.18 },
    coat: { base: hex("#c77c38"), white: hex("#f5f1e8"), belly: 1, bib: 1, socks: 1, blaze: 0.7, shade: 0.2, length: 0.014, fluff: 0.5 },
  },
  dalmatian: {
    name: "Dalmatian",
    shape: { size: 1.05, legs: 1.05, bulk: 1, earDrop: 1, ears: 0.95, muzzle: 0.15, stop: 0.5, chestDeep: 0.5, bellyTuck: 0.5, tail: 1.1 },
    coat: { base: hex("#f2efe8"), second: hex("#141212"), spots: 1, spotSize: 1, shade: 0, length: 0.004, fluff: 0 },
  },
  greatDane: {
    name: "Great Dane",
    shape: { size: 1.55, legs: 1.15, neck: 1.2, bulk: 1, bone: 1.2, head: 1.1, earDrop: 1, ears: 0.9, muzzle: 0.3, muzzleDeep: 1, muzzleBroad: 0.4, stop: 1, chestDeep: 0.7, bellyTuck: 0.6, tail: 1.05 },
    coat: { base: hex("#c49655"), second: hex("#1a1614"), mask: 1, shade: 0.1, length: 0.004, fluff: 0 },
  },
  shiba: {
    name: "Shiba Inu",
    shape: { size: 0.72, legs: 0.95, ears: 0.95, muzzle: -0.15, muzzleBroad: 0.3, stop: 0.4, chestDeep: 0.3, bellyTuck: 0.2, tailCurl: 1, bulk: 1.05 },
    coat: { base: hex("#c26a2b"), white: hex("#f4ead8"), belly: 1, bib: 1, socks: 0.3, shade: 0.35, length: 0.012, fluff: 0.5 },
  },
  wolf: {
    name: "Grey Wolf",
    shape: { size: 1.2, legs: 1.1, body: 1.05, bone: 1.1, head: 1.08, ears: 1.05, muzzle: 0.35, muzzleBroad: 0.2, chestDeep: 0.4, bellyTuck: 0.5, tail: 1.05 },
    coat: { base: hex("#9a8d7d"), second: hex("#3a342f"), white: hex("#e7e1d6"), saddle: 0.7, belly: 0.9, bib: 0.6, shade: 0.6, length: 0.022, fluff: 0.6 },
  },
  fox: {
    name: "Red Fox",
    shape: { size: 0.68, legs: 0.95, body: 1.05, bulk: 0.88, bone: 0.8, head: 0.95, ears: 1.45, muzzle: 0.6, chestDeep: 0.2, bellyTuck: 0.4, tail: 1.35 },
    coat: { base: hex("#c25a1c"), second: hex("#1d1512"), white: hex("#f2ece4"), belly: 1, bib: 1, socks: 1, tailTip: 1, shade: 0.3, length: 0.016, fluff: 0.6 },
  },
};

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

export function sanitizeShape(s: Partial<DogShape>): DogShape {
  const out = { ...DEFAULT_SHAPE };
  for (const key of Object.keys(DEFAULT_SHAPE) as (keyof DogShape)[]) {
    const v = s[key];
    if (v !== undefined) out[key] = clamp(v, ...SHAPE_RANGES[key]);
  }
  return out;
}

/** Params for a breed preset (defaults for everything it leaves out). */
export function breedParams(id: string): DogParams {
  const b = BREEDS[id];
  if (!b) throw new Error(`Unknown breed ${id}`);
  return { shape: sanitizeShape(b.shape), coat: { ...DEFAULT_COAT, ...b.coat } };
}

/** A mix of two parameter sets (t = 0: a, 1: b); colours mix too, which is close enough for crosses. */
export function mixParams(a: DogParams, b: DogParams, t: number): DogParams {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const shape = { ...a.shape };
  for (const k of Object.keys(shape) as (keyof DogShape)[]) shape[k] = lerp(a.shape[k], b.shape[k]);
  const coat = { ...a.coat };
  for (const k of Object.keys(coat) as (keyof DogCoat)[]) {
    const x = a.coat[k], y = b.coat[k];
    (coat as Record<string, unknown>)[k] = Array.isArray(x) ? (x.map((v, i) => lerp(v, (y as RGB)[i])) as RGB) : lerp(x, y as number);
  }
  return { shape, coat };
}
