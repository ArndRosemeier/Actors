import { ADULT_MIN_AGE, DEFAULT_PARAMS, EXPRESSIONS, type Human, type HumanParams, MAX_AGE } from "@actors/human";

/** One choice in a list: the id the API takes and a display label. */
export interface Choice {
  id: string;
  label: string;
}

export interface GarmentChoice extends Choice {
  /** Garments sharing a slot replace each other (e.g. the two skirts). */
  slot?: string;
  /** Hides the genital mesh/detail while worn. */
  coversAnatomy: boolean;
}

/** A named outfit. `female` items are only added for female-leaning bodies (gender < 0.5). */
export interface OutfitPreset extends Choice {
  garments: string[];
  female?: string[];
}

/** Everything a pack offers, as plain ids and labels (for UIs and random generation). */
export interface CharacterCatalog {
  animations: Choice[];
  garments: GarmentChoice[];
  outfits: OutfitPreset[];
  hair: Choice[];
  hairColors: Choice[];
  brows: Choice[];
  eyes: Choice[];
  expressions: Choice[];
  /** Detail sliders, grouped (e.g. "head", "torso"); values -1..1 or 0..1. */
  details: { id: string; label: string; group: string; min: number; max: number }[];
  /** Photographic skins are available. */
  photoSkin: boolean;
}

/** The whole look and motion of a character, serialisable as JSON. */
export interface CharacterConfig {
  body: HumanParams;
  /** Detail slider values by id (missing = 0). */
  details: Record<string, number>;
  /** "photo" follows gender, age and ethnicity; "procedural" uses `skinTone`. */
  skin: "photo" | "procedural";
  /** 0 = light .. 1 = dark, for the procedural skin. */
  skinTone: number;
  eyes: string;
  /** Hair mesh id, or null for none. */
  hair: string | null;
  /** sRGB hex, or null for the hairstyle's own colour. */
  hairColor: string | null;
  /** Eyebrow mesh id, "painted", or null for none. */
  brows: string | null;
  /** Garment ids that are worn; empty = nude. */
  outfit: string[];
  /** Genital mesh (male) / genital detail (female). Adults only. */
  anatomy: boolean;
  /** Clip name, or null for the bind pose. */
  animation: string | null;
  expression: string;
  expressionIntensity: number;
  blink: boolean;
  /** "high" = subdivided body, "low" = base mesh. */
  detail: "high" | "low";
}

export const PAINTED_BROWS = "painted";

export const OUTFITS: OutfitPreset[] = [
  { id: "nude", label: "Nude", garments: [] },
  { id: "underwear", label: "Underwear", garments: ["briefs"], female: ["bra"] },
  { id: "casual", label: "T-shirt and jeans", garments: ["briefs", "tshirt", "jeans", "socks"], female: ["bra"] },
  { id: "sporty", label: "T-shirt and shorts", garments: ["briefs", "tshirt", "shorts", "socks"], female: ["bra"] },
  { id: "layers", label: "Long sleeves and jeans", garments: ["briefs", "longsleeve", "jeans", "socks"], female: ["bra"] },
  { id: "long-skirt", label: "Long skirt", garments: ["briefs", "longsleeve", "skirt"], female: ["bra"] },
  { id: "mini-skirt", label: "Mini skirt", garments: ["briefs", "tshirt", "skirt-mini", "socks"], female: ["bra"] },
  { id: "skirt-and-bra", label: "Long skirt and bra", garments: ["briefs", "skirt"], female: ["bra"] },
];

export const HAIR_COLORS: Choice[] = [
  { id: "#1b1512", label: "Black" },
  { id: "#3b2417", label: "Dark brown" },
  { id: "#6a4528", label: "Brown" },
  { id: "#b38a55", label: "Blonde" },
  { id: "#e0c48f", label: "Light blonde" },
  { id: "#8a3a1c", label: "Red" },
  { id: "#9a968f", label: "Grey" },
];

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function buildCatalog(human: Human, irisPresets: string[]): CharacterCatalog {
  const m = human.runtime.manifest;
  const labels = human.extra.garmentLabels ?? {};
  const garments = m.meshes
    .filter((d) => d.role === "garment" && !d.internal)
    .map((d) => ({ id: d.name, label: labels[d.name] ?? d.name, slot: d.slot, coversAnatomy: !!d.tags?.includes("covers:anatomy") }));
  const have = new Set(garments.map((g) => g.id));
  const outfits = OUTFITS.filter((o) => o.garments.every((g) => have.has(g))).map((o) => ({ ...o, female: o.female?.filter((g) => have.has(g)) }));
  const choices = (r: Record<string, string> | undefined) => Object.entries(r ?? {}).map(([id, label]) => ({ id, label }));
  return {
    animations: (m.clips ?? []).map((c) => ({ id: c.name, label: cap(c.name) })),
    garments,
    outfits,
    hair: choices(human.extra.hairLabels),
    hairColors: HAIR_COLORS,
    brows: choices(human.extra.browLabels),
    eyes: irisPresets.map((id) => ({ id, label: cap(id) })),
    expressions: Object.keys(EXPRESSIONS).map((id) => ({ id, label: cap(id) })),
    details: human.modifiers.map((d) => ({ id: d.id, label: d.label, group: d.group, min: d.negative.length ? -1 : 0, max: 1 })),
    photoSkin: (human.extra.skins?.length ?? 0) > 0,
  };
}

/** Garment ids of an outfit preset for a body. */
export function outfitGarments(preset: OutfitPreset, body: Pick<HumanParams, "gender">): string[] {
  return [...preset.garments, ...(body.gender < 0.5 ? (preset.female ?? []) : [])];
}

export function defaultConfig(catalog: CharacterCatalog): CharacterConfig {
  return {
    body: { ...DEFAULT_PARAMS },
    details: {},
    skin: catalog.photoSkin ? "photo" : "procedural",
    skinTone: 0.3,
    eyes: catalog.eyes[0]?.id ?? "brown",
    hair: null,
    hairColor: null,
    brows: catalog.brows[0]?.id ?? PAINTED_BROWS,
    outfit: [],
    anatomy: true,
    animation: catalog.animations.some((a) => a.id === "idle") ? "idle" : null,
    expression: "neutral",
    expressionIntensity: 0.8,
    blink: true,
    detail: "high",
  };
}

export interface RandomOptions {
  /** Random source in [0, 1); pass a seeded one for reproducible characters. */
  random?: () => number;
  /** Also pick a random outfit preset (default true). Set false to keep the current outfit. */
  outfit?: boolean;
  /** Also pick a random animation (default false). */
  animation?: boolean;
  /** Restrict gender: "female", "male" or "any" (default). */
  gender?: "female" | "male" | "any";
}

/** Seeded PRNG (mulberry32) for `randomConfig`. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hairstyles that read as typical for either gender; the rest are picked for anyone.
const SHORT_HAIR = /short|afro/;

/** A random adult character based on `base` (its animation and, if asked, outfit are kept). */
export function randomConfig(catalog: CharacterCatalog, base: CharacterConfig, options: RandomOptions = {}): CharacterConfig {
  const r = options.random ?? Math.random;
  const pick = <T>(list: T[]): T | undefined => list[Math.floor(r() * list.length)];
  const mid = (spread: number) => 0.5 + (r() - 0.5) * spread;
  const female = options.gender === "female" ? true : options.gender === "male" ? false : r() < 0.5;
  const eth = [r(), r() * 0.6, r() * 0.6];
  const order = pick([[0, 1, 2], [1, 0, 2], [2, 1, 0]])!;
  const body: HumanParams = {
    ...base.body,
    gender: female ? r() * 0.15 : 1 - r() * 0.15,
    ageYears: Math.round(ADULT_MIN_AGE + r() * Math.min(55, MAX_AGE - ADULT_MIN_AGE)),
    muscle: mid(0.9),
    weight: mid(0.9),
    height: mid(0.9),
    proportions: mid(0.8),
    cupSize: mid(0.9),
    firmness: mid(0.9),
    african: eth[order[0]],
    asian: eth[order[1]],
    caucasian: eth[order[2]],
  };
  const details: Record<string, number> = {};
  for (const d of catalog.details) if (r() < 0.15) details[d.id] = (r() - (d.min < 0 ? 0.5 : 0)) * 0.8;
  const hairPool = catalog.hair.filter((h) => female || SHORT_HAIR.test(h.id));
  const old = body.ageYears > 60 && r() < 0.7;
  const outfitPreset = options.outfit === false ? undefined : pick(catalog.outfits);
  return {
    ...base,
    body,
    details,
    eyes: pick(catalog.eyes)?.id ?? base.eyes,
    hair: !female && r() < 0.12 ? null : (pick(hairPool)?.id ?? null),
    hairColor: old ? "#9a968f" : r() < 0.4 ? null : (pick(catalog.hairColors)?.id ?? null),
    brows: pick(catalog.brows)?.id ?? base.brows,
    outfit: outfitPreset ? outfitGarments(outfitPreset, body) : base.outfit,
    animation: options.animation ? (pick(catalog.animations)?.id ?? base.animation) : base.animation,
  };
}
