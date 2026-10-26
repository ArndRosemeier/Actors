/**
 * Chicken parameters: body proportions (bone scales), morphs and the plumage
 * (colours and feather patterns for the fur material), with presets for
 * common breeds. The base body is a brown laying hen (an ISA Brown type) of
 * about 0.42 m to the top of the comb; the other presets reshape and recolour it.
 */
import type { BoneScale, ShapeOptions } from "@actors/core";
import type { RGB } from "./breeds";

/** Body shape. Proportion values are factors around 1; morph values run 0..1 (comb and wattles -1..1). */
export interface ChickenShape {
  /** Overall size (1: a laying hen of about 0.42 m to the top of the comb, some 2 kg). */
  size: number;
  legs: number;
  neck: number;
  head: number;
  /** Tail feathers' length. */
  tail: number;
  /** Body girth (heavy breeds). */
  bulk: number;
  /** Soft, full feathering round the rear and thighs (Orpingtons, Cochins). */
  fluff: number;
  /** Comb: -1 low (rose or pea comb) .. 0 .. 1 tall (a Leghorn's single comb). */
  comb: number;
  /** Wattles: -1 small .. 0 .. 1 long. */
  wattles: number;
}

/**
 * Plumage colours and patterns. It has every field of the fur material's coat
 * (the dog markings stay 0), so it can be passed to `setFurCoat` as it is.
 */
export interface ChickenCoat {
  /** Body feathers. */
  base: RGB;
  /** Dark colour: feather lacing, bars, hackle stripes, a dark tail. */
  second: RGB;
  /** Hackle (neck) feathers. */
  tan: RGB;
  /** Light colour: fluff, feather shafts, white tips. */
  white: RGB;
  /** Beak colour. */
  nose: RGB;
  /** Comb, wattles and face. */
  comb: RGB;
  /** Shanks and toes. */
  legs: RGB;
  /** Iris colour. */
  iris: RGB;
  /** Feather size (1: about 1.5 cm on the body). */
  featherSize: number;
  /** Pale feather shafts. */
  shaft: number;
  /** Feather edges in the dark colour (laced breeds, Wyandotte). */
  lacing: number;
  /** Dark bars across every feather (cuckoo, Barred Plymouth Rock). */
  barring: number;
  /** Dark stripes down the hackle feathers (Light Sussex, Columbian). */
  hackleStripe: number;
  /** Tail in the dark colour. */
  tailDark: number;
  /** White feather tips (mottled, speckled breeds). */
  mottle: number;
  /** Lighter underside. */
  shade: number;
  /** Light fluff under the tail and round the vent. */
  fluffLight: number;
  /** White tips on the tail feathers. */
  tailWhite: number;
  /** Feather length in metres (the shells). */
  length: number;
  fluff: number;
  // Dog markings (unused on chickens).
  belly: number;
  saddle: number;
  mask: number;
  points: number;
  bib: number;
  socks: number;
  blaze: number;
  tailTip: number;
  spots: number;
  spotSize: number;
}

export interface ChickenParams {
  shape: ChickenShape;
  coat: ChickenCoat;
}

export const CHICKEN_DEFAULT_SHAPE: ChickenShape = { size: 1, legs: 1, neck: 1, head: 1, tail: 1, bulk: 1, fluff: 0, comb: 0, wattles: 0 };

export const CHICKEN_SHAPE_RANGES: Record<keyof ChickenShape, [number, number]> = {
  size: [0.5, 1.4],
  legs: [0.75, 1.3],
  neck: [0.8, 1.25],
  head: [0.85, 1.2],
  tail: [0.6, 1.5],
  bulk: [0.85, 1.6],
  fluff: [0, 1],
  comb: [-1, 1],
  wattles: [-1, 1],
};

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export const CHICKEN_DEFAULT_COAT: ChickenCoat = {
  base: hex("#8a4a1e"),
  second: hex("#4a2410"),
  tan: hex("#94501a"),
  white: hex("#d8c0a0"),
  nose: hex("#b88250"),
  comb: hex("#b3262a"),
  legs: hex("#c4a476"),
  iris: hex("#c87a22"),
  featherSize: 1,
  shaft: 0.45,
  lacing: 0,
  barring: 0,
  hackleStripe: 0.15,
  tailDark: 0.25,
  mottle: 0,
  shade: 0.3,
  fluffLight: 0.35,
  tailWhite: 0.5,
  belly: 0,
  length: 0.006,
  fluff: 0.12,
  saddle: 0,
  mask: 0,
  points: 0,
  bib: 0,
  socks: 0,
  blaze: 0,
  tailTip: 0,
  spots: 0,
  spotSize: 1,
};

export interface ChickenPreset {
  name: string;
  shape: Partial<ChickenShape>;
  coat: Partial<ChickenCoat>;
}

export const CHICKEN_PRESETS: Record<string, ChickenPreset> = {
  // The base body is modelled on this photo: a red-brown laying hen with golden hackles and a few white tail feathers.
  brown: { name: "Brown hen (ISA Brown)", shape: {}, coat: {} },
  leghorn: {
    name: "White Leghorn",
    shape: { size: 0.92, legs: 1.08, bulk: 0.9, tail: 1.2, comb: 1, wattles: 0.7 },
    coat: { base: hex("#e4e0d8"), second: hex("#b8b2a6"), tan: hex("#e8e4dc"), white: hex("#f2f0ea"), nose: hex("#d8b850"), legs: hex("#d8b03c"), comb: hex("#b8202a"), shaft: 0.1, hackleStripe: 0, tailDark: 0, shade: 0.1, fluffLight: 0.2, tailWhite: 0 },
  },
  australorp: {
    name: "Black Australorp",
    shape: { size: 1.05, bulk: 1.15, fluff: 0.3, comb: -0.2 },
    coat: { base: hex("#121212"), second: hex("#050505"), tan: hex("#141414"), white: hex("#2a2a2c"), nose: hex("#2c2826"), legs: hex("#2e2c30"), iris: hex("#3a2210"), shaft: 0.15, hackleStripe: 0, tailDark: 0.5, shade: 0, fluffLight: 0.1, tailWhite: 0 },
  },
  barredRock: {
    name: "Barred Plymouth Rock",
    shape: { size: 1.05, bulk: 1.12, comb: 0.1 },
    coat: { base: hex("#c8c6c0"), second: hex("#1c1c1e"), tan: hex("#c8c6c0"), white: hex("#e0dcd4"), nose: hex("#d0b060"), legs: hex("#d8b03c"), barring: 0.85, shaft: 0, hackleStripe: 0, tailDark: 0, shade: 0.05, fluffLight: 0.1, tailWhite: 0, featherSize: 1.1 },
  },
  sussex: {
    name: "Light Sussex",
    shape: { size: 1.05, bulk: 1.15, fluff: 0.2, comb: -0.1 },
    coat: { base: hex("#e6e2da"), second: hex("#141414"), tan: hex("#e6e2da"), white: hex("#f0ede6"), nose: hex("#d8c8a8"), legs: hex("#e4d0c0"), hackleStripe: 1, tailDark: 0.9, shaft: 0.05, shade: 0.05, fluffLight: 0.1, tailWhite: 0 },
  },
  buffOrpington: {
    name: "Buff Orpington",
    shape: { size: 1.12, legs: 0.9, bulk: 1.3, fluff: 1, comb: -0.3, wattles: -0.2, tail: 0.85 },
    coat: { base: hex("#b4783a"), second: hex("#8a5420"), tan: hex("#bc8042"), white: hex("#d8b07c"), nose: hex("#d8c0a0"), legs: hex("#e0ccc0"), shaft: 0.25, hackleStripe: 0, tailDark: 0.15, tailWhite: 0, length: 0.009, fluff: 0.3 },
  },
  wyandotte: {
    name: "Silver Laced Wyandotte",
    shape: { size: 1.02, bulk: 1.2, fluff: 0.5, comb: -0.85, wattles: -0.3 },
    coat: { base: hex("#e4e2dc"), second: hex("#141414"), tan: hex("#e4e2dc"), white: hex("#f0eee8"), nose: hex("#c8a860"), legs: hex("#d8b03c"), lacing: 1, hackleStripe: 0.8, tailDark: 0.85, shaft: 0, shade: 0.05, fluffLight: 0.1, tailWhite: 0, featherSize: 1.15 },
  },
  speckledSussex: {
    name: "Speckled Sussex",
    shape: { size: 1.05, bulk: 1.15, fluff: 0.2, comb: -0.1 },
    coat: { base: hex("#6a2c12"), second: hex("#141010"), tan: hex("#7a3816"), white: hex("#ece6dc"), nose: hex("#d8c8a8"), legs: hex("#e4d0c0"), mottle: 0.8, lacing: 0.35, hackleStripe: 0.4, tailDark: 0.6, shaft: 0.1, tailWhite: 0.3 },
  },
};

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

export function sanitizeChickenShape(s: Partial<ChickenShape>): ChickenShape {
  const out = { ...CHICKEN_DEFAULT_SHAPE };
  for (const key of Object.keys(CHICKEN_DEFAULT_SHAPE) as (keyof ChickenShape)[]) {
    const v = s[key];
    if (v !== undefined) out[key] = clamp(v, ...CHICKEN_SHAPE_RANGES[key]);
  }
  return out;
}

export function chickenParams(id: string): ChickenParams {
  const p = CHICKEN_PRESETS[id];
  if (!p) throw new Error(`Unknown chicken preset ${id}`);
  return { shape: sanitizeChickenShape(p.shape), coat: { ...CHICKEN_DEFAULT_COAT, ...p.coat } };
}

/** Morph weights for a shape (target name -> weight). */
export function chickenTargetWeights(shape: ChickenShape): Map<string, number> {
  const s = sanitizeChickenShape(shape);
  const w = new Map<string, number>();
  const set = (name: string, v: number) => {
    if (Math.abs(v) > 1e-4) w.set(name, v);
  };
  // "bulk" adds 18 %; below 1 it runs backwards (slimmer).
  set("bulk", (s.bulk - 1) / 0.18);
  set("fluff", s.fluff);
  set("comb-large", Math.max(0, s.comb));
  set("comb-small", Math.max(0, -s.comb));
  set("wattles-large", Math.max(0, s.wattles));
  set("wattles-small", Math.max(0, -s.wattles));
  return w;
}

const each = (names: string[]) => names.flatMap((n) => [`${n}_L`, `${n}_R`]);

/** Bone proportions and overall size for a shape (the bird rig's bone names). */
export function chickenShapeOptions(shape: ChickenShape, boneNames?: string[]): ShapeOptions {
  const s = sanitizeChickenShape(shape);
  const bones: Record<string, BoneScale> = {};
  const put = (names: string[], scale: BoneScale) => {
    for (const n of names) bones[n] = { len: (bones[n]?.len ?? 1) * (scale.len ?? 1), girth: (bones[n]?.girth ?? 1) * (scale.girth ?? 1) };
  };
  // Leg length lives in the bare shank and the drumstick.
  put(each(["AnkleLeg"]), { len: s.legs ** 1.3 });
  put(each(["LowerLeg"]), { len: s.legs ** 0.7 });
  put(["spine_2", "spine_3"], { len: s.neck });
  put(["head", "mouth_upper", "mouth_upper_tip", "mouth_lower", "mouth_lower_tip"], { len: s.head, girth: s.head });
  put(["tail_1", "tail_2", "tail_3", "tail_tip"], { len: s.tail, girth: s.tail ** 0.5 });
  if (boneNames) {
    const known = new Set(boneNames);
    for (const n of Object.keys(bones)) if (!known.has(n)) delete bones[n];
  }
  return { bones, scale: s.size };
}
