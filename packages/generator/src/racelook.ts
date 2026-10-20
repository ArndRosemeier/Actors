import { ADULT_MIN_AGE, type HumanParams, RACES, RACE_STYLES, raceScale, type RGB, type RaceId, type RaceStyle, type Weighted } from "@actors/human";
import type { CharacterCatalog, CharacterConfig } from "./catalog";

/**
 * Norgo's hair style names -> hair meshes in the pack, best match first.
 * null = no hair mesh (bald, shaved, or styles that come as add-ons later).
 */
export const HAIR_STYLE_MESHES: Record<string, (string | null)[]> = {
  short: ["hair-short02"],
  crop: ["hair-short03", "hair-short02"],
  tousled: ["hair-short03", "hair-bob02"],
  buzz: ["hair-short04"],
  slick: ["hair-short03"],
  shoulder: ["hair-bob01", "hair-bob02"],
  long: ["hair-long01"],
  ponytail: ["hair-ponytail01"],
  braid: ["hair-braid01"],
  braids: ["hair-braid01"],
  bun: ["hair-ponytail01"],
  topknot: ["hair-ponytail01"],
  dreadlocks: ["hair-afro01"],
  wild: ["hair-afro01", "hair-bob02"],
  undercut: ["hair-short04"],
  mohawk: ["hair-short04"],
  shaved: [null],
  bald: [null],
  tonsure: [null],
  leaves: [null],
  crest: [null],
};

/** Norgo's brow names -> eyebrow meshes (null = none). */
export const BROW_STYLE_MESHES: Record<string, (string | null)[]> = {
  normal: ["brows-eyebrow001"],
  thin: ["brows-eyebrow003"],
  arched: ["brows-eyebrow006"],
  thick: ["brows-eyebrow011", "brows-eyebrow009"],
  bushy: ["brows-eyebrow009"],
  unibrow: ["brows-eyebrow009"],
  scaled: [null],
  none: [null],
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** sRGB 0..1 -> "#rrggbb". */
export function rgbToHex(c: RGB): string {
  return `#${c.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function weighted<T>(list: Weighted<T>, r: () => number): T {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of list) if ((x -= w) <= 0) return v;
  return list[list.length - 1][0];
}

/**
 * A random look for a member of a fantasy race (or a mix of two): body ranges,
 * ethnic base shape, size, skin colour, eye colour, hair colour and style,
 * eyebrows. Discrete choices come from either parent race (by mix share),
 * numbers are blended. Gender and age are given (age stays adult).
 */
export function randomRaceLook(
  catalog: CharacterCatalog,
  race: RaceId,
  race2: RaceId | null,
  mix: number,
  body: Pick<HumanParams, "gender" | "ageYears">,
  r: () => number,
): Pick<CharacterConfig, "raceSize" | "skinColor" | "eyeColor" | "eyeGlow" | "pupil" | "skinPattern" | "patternStrength" | "patternColor" | "hair" | "hairColor" | "brows"> & {
  body: Partial<HumanParams>;
} {
  const A = RACE_STYLES[race];
  const B = race2 ? RACE_STYLES[race2] : A;
  const t = race2 ? clamp01(mix) : 0;
  // Discrete traits: inherited from one side.
  const side = (): RaceStyle => (r() < t ? B : A);
  const range = (key: "height" | "weight" | "muscle" | "proportions") => {
    const u = r();
    return lerp(lerp(A[key][0], A[key][1], u), lerp(B[key][0], B[key][1], u), t);
  };
  const female = body.gender < 0.5;
  // Height: a target in the race's adult height range (women ~7% shorter), turned into
  // MakeHuman's height slider for the race's size (standing height ≈ scale × (1.03–1.17 m + 1.08 m × slider), measured on the hm08 body).
  const size = r();
  const scale = raceScale({ race, race2, mix: t, size });
  const lore = RACES[race].heightM, lore2 = RACES[race2 ?? race].heightM;
  const target = lerp(lerp(lore[0], lore[1], r()), lerp(lore2[0], lore2[1], r()), t) * (female ? 0.93 : 1);
  const heightSlider = clamp01((target / scale - lerp(1.03, 1.17, body.gender)) / 1.08);
  const eth = weighted(side().ethnic, r);
  const jitter = (c: RGB, amount: number): RGB => c.map((v) => clamp01(v + (r() - 0.5) * amount)) as RGB;
  const skinRgb = jitter(weighted(side().skin, r), 0.05);
  const skin = race === "human" && (!race2 || t < 0.5) ? null : rgbToHex(skinRgb);
  // Pattern and its colour (a darker or lighter shade of the skin, or the race's palette).
  const patSide = side();
  const pattern = weighted(patSide.pattern, r);
  const accent = patSide.accent;
  const accentRgb: RGB =
    accent === "darker" ? (skinRgb.map((v) => v * 0.55) as RGB) : accent === "lighter" ? (skinRgb.map((v) => v + (1 - v) * 0.4) as RGB) : jitter(weighted(accent, r), 0.04);
  const eyes = rgbToHex(jitter(weighted(side().eyes, r), 0.04));
  // Hair colour, greying with age for races that grey.
  const hairSide = side();
  let hair = weighted(hairSide.hair, r);
  const age = Math.max(ADULT_MIN_AGE, body.ageYears);
  if (age > 50 && r() < hairSide.greying * clamp01((age - 50) / 25)) hair = [0.62 + r() * 0.25, 0.6 + r() * 0.25, 0.58 + r() * 0.25];
  const have = new Set(catalog.hair.map((h) => h.id));
  const style = weighted(female ? side().hairStylesFemale : side().hairStylesMale, r);
  const meshes = HAIR_STYLE_MESHES[style] ?? [];
  const hairMesh = meshes.length ? (meshes.find((m) => m === null || have.has(m)) ?? null) : (catalog.hair[0]?.id ?? null);
  const browIds = new Set(catalog.brows.map((b) => b.id));
  const brow = (BROW_STYLE_MESHES[weighted(side().browStyles, r)] ?? []).find((m) => m === null || browIds.has(m));
  return {
    body: {
      height: heightSlider,
      weight: range("weight"),
      muscle: range("muscle"),
      proportions: range("proportions"),
      african: eth[0],
      asian: eth[1],
      caucasian: eth[2],
    },
    raceSize: size,
    skinColor: skin,
    eyeColor: eyes,
    eyeGlow: lerp(lerp(A.eyeGlow[0], A.eyeGlow[1], r()), lerp(B.eyeGlow[0], B.eyeGlow[1], r()), t),
    pupil: weighted(side().pupil, r),
    skinPattern: pattern,
    patternStrength: lerp(patSide.patternStrength[0], patSide.patternStrength[1], r()),
    patternColor: rgbToHex(accentRgb),
    hair: hairMesh,
    hairColor: rgbToHex(jitter(hair, 0.04)),
    brows: brow === undefined ? (catalog.brows[0]?.id ?? null) : brow,
  };
}
