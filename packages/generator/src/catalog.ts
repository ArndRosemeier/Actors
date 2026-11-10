import type { DeformSpec } from "@actors/core";
import { raceParts, randomRaceLook } from "./racelook";
import { FUTURE_OUTFITS } from "./future-outfits";
import { MEDIEVAL_OUTFITS } from "./medieval-outfits";
import { GARMENT_THEMES, HAIR_THEMES, RACE_THEMES } from "./themes";
import { ADULT_MIN_AGE, DEFAULT_PARAMS, DEFAULT_ROBOT, DEFAULT_SKELETAL, type SkeletalConfig, sanitizeSkeletal, ROBOT_EARS, ROBOT_HEADS, ROBOT_PLATING, type RobotConfig, EXPRESSIONS, type Human, type HumanParams, MAX_AGE, type BeardStyle, type HornStyle, type PupilShape, RACES, RACE_IDS, RACE_STYLES, type RaceId, SHAPE_SLIDERS, type SkinPattern, type TailStyle, type BeltStyle, type CapeStyle, type CollarStyle, type EmblemShape, type EmblemSymbol, type MaskStyle, BELT_STYLES, CAPE_STYLES, COLLAR_STYLES, EMBLEM_SHAPES, EMBLEM_SYMBOLS, MASK_STYLES } from "@actors/human";

/** One choice in a list: the id the API takes and a display label. */
export interface Choice {
  id: string;
  label: string;
  /** Author, pack and licence, for assets whose licence asks for credit (CC-BY). */
  credit?: string;
  /** Settings the option fits (see `THEMES` in themes.ts); absent = every setting. */
  themes?: string[];
}

export interface GarmentChoice extends Choice {
  /** Garments sharing a slot replace each other (e.g. the two skirts). */
  slot?: string;
  /**
   * Body layers the garment takes ("top", "bottom", "shoes", "hat", …).
   * Putting on a garment takes off the others that share one of its layers,
   * e.g. a dress (top + bottom) replaces both a T-shirt and jeans.
   */
  occupies: string[];
  /** UI group ("Tops", "Shoes", …). */
  category: string;
  /** Hides the genital mesh/detail while worn. */
  coversAnatomy: boolean;
  /** Hides the hair while worn (closed helmets, hoods). */
  hidesHair?: boolean;
  /** Credit line for CC-BY garments (anyone shipping a character wearing it must credit the author). */
  credit?: string;
  author?: string;
  /** Typical wearer, for random outfits; absent = anyone. */
  gender?: "female" | "male";
}

/** A named outfit. `female` items are only added for female-leaning bodies (gender < 0.5). */
export interface OutfitPreset extends Choice {
  /** Short design context shown alongside the preset. */
  description?: string;
  garments: string[];
  female?: string[];
  /** Typical wearer, for random outfits; absent = anyone. */
  gender?: "female" | "male";
  /** Garment colours (sRGB hex) the preset starts with; others keep their own colours. */
  colors?: Record<string, string>;
}

/** Everything a pack offers, as plain ids and labels (for UIs and random generation). */
export interface AnimationChoice extends Choice {
  /** Menu group, e.g. "Locomotion" or "Combat". */
  category: string;
  /** Made to loop (idles, walks); the rest are one-shots, which also repeat when played. */
  loop: boolean;
  /** "" for the pack's own clips, else the clip library's name (e.g. "cmu"). */
  library: string;
  description?: string;
}

/** Surface finish of a robot's plates. */
export type RobotFinish = "gloss" | "satin" | "metallic" | "matte";

/** Material settings per finish (plates and trim). */
export const ROBOT_FINISHES: Record<RobotFinish, { label: string; metalness: number; roughness: number; clearcoat: number; clearcoatRoughness: number }> = {
  gloss: { label: "Gloss paint", metalness: 0.15, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.06 },
  satin: { label: "Satin", metalness: 0.3, roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.3 },
  metallic: { label: "Polished metal", metalness: 1, roughness: 0.22, clearcoat: 0.3, clearcoatRoughness: 0.1 },
  matte: { label: "Matte", metalness: 0.05, roughness: 0.8, clearcoat: 0, clearcoatRoughness: 0.5 },
};

/** A robot's look: shape options (see `@actors/human` RobotConfig) plus colours and finish. */
export interface RobotLook extends RobotConfig {
  /** Main plate colour (sRGB hex). */
  paint: string;
  /** Second plate colour: shoulders, hands, pelvis, feet, ear pods, visor frame. */
  trim: string;
  /** Inner frame (the synthetic muscle in the gaps). */
  frame: string;
  /** Joint housings and bezels. */
  metal: string;
  /** Lights: visor, optics, joint rings, chest core. */
  glow: string;
  /** 0..1 light strength (0 = off). */
  glowStrength: number;
  finish: RobotFinish;
}

/** Colour schemes for robots. */
export const ROBOT_PALETTES: (Choice & { look: Pick<RobotLook, "paint" | "trim" | "frame" | "metal" | "glow" | "finish"> })[] = [
  { id: "arctic", label: "Arctic white", look: { paint: "#e9ecef", trim: "#2b2f36", frame: "#1d2026", metal: "#a7adb5", glow: "#4fd8ff", finish: "gloss" } },
  { id: "gunmetal", label: "Gunmetal", look: { paint: "#4a4f57", trim: "#1f2227", frame: "#15171b", metal: "#8d939b", glow: "#ff9a3c", finish: "satin" } },
  { id: "crimson", label: "Crimson", look: { paint: "#a3161d", trim: "#1b1c20", frame: "#141519", metal: "#b8bcc2", glow: "#ffe2b0", finish: "gloss" } },
  { id: "aurum", label: "Gold and black", look: { paint: "#c9a24a", trim: "#16171a", frame: "#101114", metal: "#d9c27a", glow: "#fff1c4", finish: "metallic" } },
  { id: "chrome", label: "Chrome", look: { paint: "#c8ccd2", trim: "#5e646d", frame: "#1a1c20", metal: "#e0e3e7", glow: "#6aa8ff", finish: "metallic" } },
  { id: "stealth", label: "Stealth", look: { paint: "#1b1d21", trim: "#2a2d33", frame: "#0e0f12", metal: "#3d4148", glow: "#ff2a3a", finish: "matte" } },
  { id: "field", label: "Field olive", look: { paint: "#5d6545", trim: "#3a3d33", frame: "#1c1e19", metal: "#7d8072", glow: "#ffc83c", finish: "matte" } },
  { id: "pearl", label: "Pearl and teal", look: { paint: "#f2efe9", trim: "#1f7a7a", frame: "#24282d", metal: "#c9ccd0", glow: "#58ffd6", finish: "gloss" } },
];

export const DEFAULT_ROBOT_LOOK: RobotLook = { ...DEFAULT_ROBOT, ...ROBOT_PALETTES[0].look, glowStrength: 0.7 };

const HEX = /^#[0-9a-f]{6}$/i;

/** A valid robot look (bad values fall back to the defaults). */
export function sanitizeRobotLook(look: Partial<RobotLook> | undefined): RobotLook {
  const l = { ...DEFAULT_ROBOT_LOOK, ...look };
  const color = (k: "paint" | "trim" | "frame" | "metal" | "glow") => (typeof l[k] === "string" && HEX.test(l[k]) ? l[k] : DEFAULT_ROBOT_LOOK[k]);
  return {
    head: ROBOT_HEADS.includes(l.head) ? l.head : DEFAULT_ROBOT.head,
    ears: ROBOT_EARS.includes(l.ears) ? l.ears : DEFAULT_ROBOT.ears,
    plating: ROBOT_PLATING.includes(l.plating) ? l.plating : DEFAULT_ROBOT.plating,
    thickness: Math.min(1, Math.max(0, Number.isFinite(l.thickness) ? l.thickness : DEFAULT_ROBOT.thickness)),
    core: !!l.core,
    paint: color("paint"),
    trim: color("trim"),
    frame: color("frame"),
    metal: color("metal"),
    glow: color("glow"),
    glowStrength: Math.min(1, Math.max(0, Number.isFinite(l.glowStrength) ? l.glowStrength : DEFAULT_ROBOT_LOOK.glowStrength)),
    finish: l.finish in ROBOT_FINISHES ? l.finish : DEFAULT_ROBOT_LOOK.finish,
  };
}

/** A random robot look (shape options, palette, light colour). */
export function randomRobotLook(r: () => number): RobotLook {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
  const palette = pick(ROBOT_PALETTES).look;
  return sanitizeRobotLook({
    ...palette,
    head: pick(ROBOT_HEADS),
    ears: pick(ROBOT_EARS),
    plating: pick(ROBOT_PLATING),
    thickness: 0.2 + r() * 0.7,
    core: r() < 0.6,
    glowStrength: 0.4 + r() * 0.6,
  });
}

/** Surface finish of a costume piece (a garment or a costume part). */
export type CostumeFinish = "cloth" | "satin" | "leather" | "rubber" | "gloss" | "metallic";

/** Material settings per costume finish. */
export const COSTUME_FINISHES: Record<CostumeFinish, { label: string; metalness: number; roughness: number; clearcoat: number; sheen: number }> = {
  cloth: { label: "Cloth", metalness: 0, roughness: 0.85, clearcoat: 0, sheen: 0.3 },
  satin: { label: "Satin (spandex)", metalness: 0, roughness: 0.42, clearcoat: 0.15, sheen: 0.8 },
  leather: { label: "Leather", metalness: 0, roughness: 0.55, clearcoat: 0.25, sheen: 0 },
  rubber: { label: "Rubber", metalness: 0, roughness: 0.32, clearcoat: 0.5, sheen: 0 },
  gloss: { label: "Gloss vinyl", metalness: 0.05, roughness: 0.14, clearcoat: 1, sheen: 0 },
  metallic: { label: "Metal", metalness: 1, roughness: 0.28, clearcoat: 0.3, sheen: 0 },
};

/**
 * How much of a garment texture's pattern stays when a costume finish dyes the garment (any
 * finish but "cloth"): prints and weaves fade to faint folds, so a spandex suit reads as one
 * colour. 0 is flat colour, 1 the whole pattern.
 */
export const COSTUME_DYED_PATTERN = 0.12;

/** Whether a costume finish dyes a recoloured garment one colour (see COSTUME_DYED_PATTERN). */
export function costumeDyesSolid(finish: string | undefined): boolean {
  return !!finish && finish !== "cloth" && finish in COSTUME_FINISHES;
}

/**
 * A hero costume on top of the outfit: a cape (with a collar), a mask, a belt and a chest emblem
 * (see `@actors/human` costume.ts), their colours (sRGB hex), and a finish for any piece: a
 * garment id or a costume part ("cape", "mask", "belt", "buckle", "emblem", "rim").
 */
export interface CostumeLook {
  cape: CapeStyle;
  collar: CollarStyle;
  capeColor: string;
  liningColor: string;
  mask: MaskStyle;
  maskColor: string;
  belt: BeltStyle;
  beltColor: string;
  buckleColor: string;
  emblem: EmblemShape;
  symbol: EmblemSymbol;
  /** 0..1 */
  emblemSize: number;
  emblemColor: string;
  symbolColor: string;
  rimColor: string;
  finishes: Record<string, CostumeFinish>;
}

export const DEFAULT_COSTUME: CostumeLook = {
  cape: "none", collar: "none", capeColor: "#c8202a", liningColor: "#f2c230",
  mask: "none", maskColor: "#1f2a6b",
  belt: "none", beltColor: "#f2c230", buckleColor: "#d8dde4",
  emblem: "none", symbol: "bolt", emblemSize: 0.5, emblemColor: "#c8202a", symbolColor: "#f2c230", rimColor: "#f2c230",
  finishes: {},
};

/** Finish of costume parts that have none set. */
export const COSTUME_PART_FINISH: Record<string, CostumeFinish> = { cape: "satin", "cape-lining": "satin", mask: "satin", belt: "leather", buckle: "metallic", emblem: "gloss", "emblem-rim": "metallic" };

/** A valid costume (bad values fall back to the defaults). */
export function sanitizeCostume(look: Partial<CostumeLook> | undefined): CostumeLook {
  const l = { ...DEFAULT_COSTUME, ...look };
  const d = DEFAULT_COSTUME;
  const color = (k: "capeColor" | "liningColor" | "maskColor" | "beltColor" | "buckleColor" | "emblemColor" | "symbolColor" | "rimColor") => (typeof l[k] === "string" && HEX.test(l[k]) ? l[k] : d[k]);
  const pick = <T>(list: readonly T[], v: T, dv: T) => (list.includes(v) ? v : dv);
  const finishes: Record<string, CostumeFinish> = {};
  for (const [k, v] of Object.entries(l.finishes ?? {})) if (typeof k === "string" && k.length < 64 && v in COSTUME_FINISHES) finishes[k] = v;
  return {
    cape: pick(CAPE_STYLES, l.cape, d.cape),
    collar: pick(COLLAR_STYLES, l.collar, d.collar),
    capeColor: color("capeColor"),
    liningColor: color("liningColor"),
    mask: pick(MASK_STYLES, l.mask, d.mask),
    maskColor: color("maskColor"),
    belt: pick(BELT_STYLES, l.belt, d.belt),
    beltColor: color("beltColor"),
    buckleColor: color("buckleColor"),
    emblem: pick(EMBLEM_SHAPES, l.emblem, d.emblem),
    symbol: pick(EMBLEM_SYMBOLS, l.symbol, d.symbol),
    emblemSize: Math.min(1, Math.max(0, Number.isFinite(l.emblemSize) ? l.emblemSize : d.emblemSize)),
    emblemColor: color("emblemColor"),
    symbolColor: color("symbolColor"),
    rimColor: color("rimColor"),
    finishes,
  };
}

/** A skeleton's look: shape options (see `@actors/human` SkeletalConfig) plus bone and light colours. */
export interface SkeletalLook extends Omit<SkeletalConfig, "seed"> {
  /** Bone colour (sRGB hex). */
  bone: string;
  /** Eye and heart light colour. */
  glow: string;
  /** 0..1 light strength. */
  glowStrength: number;
  /** 0..1 surface roughness (polished to dry and chalky). */
  dryness: number;
}

/** Bone colours and lights for skeletons. */
export const SKELETAL_PALETTES: (Choice & { look: Pick<SkeletalLook, "bone" | "glow" | "dryness"> & Partial<SkeletalLook> })[] = [
  { id: "ivory", label: "Old ivory", look: { bone: "#e3d6b8", glow: "#7fd8ff", dryness: 0.55 } },
  { id: "bleached", label: "Sun-bleached", look: { bone: "#f1ece0", glow: "#9ff2ff", dryness: 0.8 } },
  { id: "crypt", label: "Crypt", look: { bone: "#b9ab8a", glow: "#7dff8a", dryness: 0.6, wear: 0.6 } },
  { id: "bog", label: "Bog-stained", look: { bone: "#8a7552", glow: "#ffb347", dryness: 0.35, wear: 0.7 } },
  { id: "charred", label: "Charred", look: { bone: "#3d3530", glow: "#ff5a1f", dryness: 0.7, wear: 0.8 } },
  { id: "lich", label: "Lich", look: { bone: "#cfc8bb", glow: "#a77bff", dryness: 0.45, heart: true } },
  { id: "gilded", label: "Gilded", look: { bone: "#c9a24a", glow: "#fff1c4", dryness: 0.2, wear: 0.1 } },
];

const { seed: _seed, ...SKELETAL_SHAPE } = DEFAULT_SKELETAL;
export const DEFAULT_SKELETAL_LOOK: SkeletalLook = { ...SKELETAL_SHAPE, ...SKELETAL_PALETTES[0].look, glowStrength: 0.7 };

/** A valid skeleton look (bad values fall back to the defaults). */
export function sanitizeSkeletalLook(look: Partial<SkeletalLook> | undefined): SkeletalLook {
  const l = { ...DEFAULT_SKELETAL_LOOK, ...look };
  const { seed: _s, ...shape } = sanitizeSkeletal(l);
  const color = (k: "bone" | "glow") => (typeof l[k] === "string" && HEX.test(l[k]) ? l[k] : DEFAULT_SKELETAL_LOOK[k]);
  const unit = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d);
  return { ...shape, bone: color("bone"), glow: color("glow"), glowStrength: unit(l.glowStrength, DEFAULT_SKELETAL_LOOK.glowStrength), dryness: unit(l.dryness, DEFAULT_SKELETAL_LOOK.dryness) };
}

/** A random skeleton look (palette, wear, lost bones, lights). */
export function randomSkeletalLook(r: () => number): SkeletalLook {
  const palette = SKELETAL_PALETTES[Math.floor(r() * SKELETAL_PALETTES.length)].look;
  return sanitizeSkeletalLook({
    robust: 0.2 + r() * 0.6,
    wear: 0.15 + r() * 0.6,
    missing: r() < 0.5 ? 0 : r() * 0.7,
    jaw: r() < 0.9,
    eyes: r() < 0.75,
    heart: r() < 0.2,
    glowStrength: 0.4 + r() * 0.6,
    ...palette,
  });
}

export interface CharacterCatalog {
  /** Fantasy races (human first). */
  races: (Choice & { id: RaceId; description: string })[];
  animations: AnimationChoice[];
  /** Animation sources: "" = the pack's own clips, then each loaded clip library. */
  libraries: Choice[];
  garments: GarmentChoice[];
  outfits: OutfitPreset[];
  hair: Choice[];
  hairColors: Choice[];
  /** Suggested garment colours (sRGB hex ids); any other hex colour works too. */
  garmentColors: Choice[];
  brows: Choice[];
  eyes: Choice[];
  expressions: Choice[];
  /** Detail sliders, grouped (e.g. "head", "torso"); values -1..1 or 0..1. */
  details: { id: string; label: string; group: string; min: number; max: number }[];
  /** Photographic skins are available. */
  photoSkin: boolean;
  /** Robot options: head styles, ear styles, plating, finishes and colour schemes (absent: no robots offered). */
  robot?: { heads: Choice[]; ears: Choice[]; plating: Choice[]; finishes: Choice[]; palettes: (Choice & { look: Partial<RobotLook> })[] };
  /** Skeleton options: colour schemes (absent: no skeletons offered). */
  skeletal?: { palettes: (Choice & { look: Partial<SkeletalLook> })[] };
  /**
   * False when the game offers no living people, only robots or skeletons (see `AllowOptions.races`):
   * `races` then holds just the human body they are built on. Absent: people are offered.
   */
  people?: boolean;
  /** Standing height range in meters the character is kept in (see `AllowOptions.height`). Absent: any. */
  height?: { min?: number; max?: number };
}

/** The whole look and motion of a character, serialisable as JSON. */
export interface CharacterConfig {
  /** Race of the body (see `catalog.races`). */
  race: RaceId;
  /** Second race for mixed heritage (half-elf, half-orc...), or null. */
  race2: RaceId | null;
  /** 0..1 share of `race2`. */
  raceMix: number;
  /** 0..1 within the race's size range (0.5 = typical; giantkin are 1.6-1.9× human size). */
  raceSize: number;
  /**
   * A deformed body: a recipe (`giant`), a seed and a strength 0..1, laid over the race (see `deform` in @actors/core).
   * Optional; null or strength 0 changes nothing.
   */
  deform?: DeformSpec | null;
  /**
   * 0 = grown up .. 1 = a child of about five: child proportions on the adult body (smaller, a
   * bigger head and eyes, the youngest face). A child never shows anatomy, whatever `anatomy` says.
   */
  youth: number;
  body: HumanParams;
  /** Detail slider values by id (missing = 0). */
  details: Record<string, number>;
  /**
   * Shape slider values by id (-1..1, missing = 0; see SHAPE_SLIDERS in @actors/human): plain-language
   * sliders such as shoulders, waist or jaw that move several detail modifiers at once, added to `details`.
   */
  shape: Record<string, number>;
  /** "photo" follows gender, age and ethnicity; "procedural" uses `skinTone`. */
  skin: "photo" | "procedural";
  /** 0 = light .. 1 = dark, for the procedural skin. */
  skinTone: number;
  /**
   * Skin colour (sRGB hex) for non-human tones (an orc's green, an umbral's grey-violet), or null.
   * Replaces `skinTone` on the procedural skin and recolours the photo skin.
   */
  skinColor: string | null;
  eyes: string;
  /** Iris colour (sRGB hex) instead of the `eyes` preset's colour, or null. */
  eyeColor: string | null;
  /** 0..1 glowing iris (umbral, drakeborn). */
  eyeGlow: number;
  pupil: PupilShape;
  /** Race skin pattern drawn over the skin (scales, bark, veins...). */
  skinPattern: SkinPattern;
  /** 0..1 */
  patternStrength: number;
  /** Pattern colour (sRGB hex), or null for a darker shade of the skin. */
  patternColor: string | null;
  /** 0..1, varies procedural details (pattern layout). */
  seed: number;
  /** Hair mesh id, a generated style from PROCEDURAL_HAIR ("leaves", "crest"), or null for none. */
  hair: string | null;
  /** Generated beard (a hair mass with locks, or painted for short styles; "none" for none). */
  beard: BeardStyle;
  /** 0..1 painted stubble on the beard area (under a beard, or on its own). */
  stubble: number;
  horns: HornStyle;
  /** 0..1 */
  hornSize: number;
  /** Horn colour (sRGB hex), or null for ivory. */
  hornColor: string | null;
  /** 0..1, 0 = no tusks. */
  tusks: number;
  tail: TailStyle;
  /** 0..1 (1 ≈ 60% of the body height). */
  tailLength: number;
  /** sRGB hex, or null for the hairstyle's own colour. */
  hairColor: string | null;
  /** Eyebrow mesh id, "painted", or null for none. */
  brows: string | null;
  /** Garment ids that are worn; empty = nude. */
  outfit: string[];
  /** Garment colours by garment id (sRGB hex); missing = the garment's own colours. */
  garmentColors: Record<string, string>;
  /** Genital mesh (male) / genital detail (female). Adults only: off whenever `youth` > 0. */
  anatomy: boolean;
  /** Clip name, or null for the bind pose. */
  animation: string | null;
  expression: string;
  expressionIntensity: number;
  blink: boolean;
  /**
   * Face rig: every face unit as its own GPU morph, so expressions blend smoothly into each other
   * and faces can be animated unit by unit (`Character.setFaceUnits`). Costs a few MB of GPU
   * memory per character and a rig build in the worker per shape change; off by default.
   */
  faceRig: boolean;
  /**
   * A living face: natural blinks, eye saccades and glances, eyes that turn toward `gaze`, lids
   * that follow them, slow idle movement and lip-sync (`Character.say`). Eyes turn with or without
   * the face rig; lids, idle movement and lip-sync need `faceRig`. Off by default.
   */
  faceAnimation: boolean;
  /** Where a living face looks: straight ahead, or at the camera (`Character.camera`, else `lodCamera`). */
  gaze: "ahead" | "camera";
  /**
   * Expression wrinkles in the skin shader: forehead lines when the brows go up, frown lines
   * between them, crow's feet and smile folds; older faces keep some at rest. Follows the
   * expression and the face rig. A few texture reads per skin pixel while a wrinkle shows; off by default.
   */
  wrinkles: boolean;
  /**
   * Skin detail in the skin shader: blood flush on cheeks, nose, ears, knees, elbows and hands,
   * shadow under the eyes, a shinier T-zone, uneven roughness, speckle and finer pores. A few
   * shader instructions per skin pixel; on by default.
   */
  skinDetail: boolean;
  /** Wet or sweaty skin, 0 (dry) .. 1: glossier in patches and a little darker. */
  skinWetness: number;
  /**
   * Tucks what a garment covers in under it (skin at hems, a shirt at the waistband, socks in
   * shoes), so it doesn't poke through in poses. Only work when the outfit changes; on by default.
   */
  clothTuck: boolean;
  /**
   * Loose garments (skirts, dresses, robes, tunics) swing as the character moves and turns, and
   * settle when it stops. A spring per character and a few shader instructions; on by default.
   */
  clothMotion: boolean;
  /** "high" = subdivided body, "low" = base mesh. */
  detail: "high" | "low";
  /**
   * A robot instead of a human: same skeleton and clips, shaped by the same body and race
   * sliders, drawn with plates, frame and joints (`robotLook`) instead of skin, hair and clothes.
   */
  robot: boolean;
  robotLook: RobotLook;
  /**
   * A skeleton (undead) instead of a human: every bone generated from the body, on the same
   * rig and clips. Height, proportions, gender, age and race shape it (weight, muscle and
   * breasts don't: they are soft tissue). Garments stay wearable; skin and hair are hidden.
   * Ignored while `robot` is set.
   */
  skeletal: boolean;
  skeletalLook: SkeletalLook;
  /** A hero costume over the outfit: cape, mask, belt, chest emblem, finishes (none by default). */
  costume: CostumeLook;
}

export const PAINTED_BROWS = "painted";

/** Generated hairstyles listed in `catalog.hair` next to the pack's hair meshes. */
export const PROCEDURAL_HAIR: Record<string, string> = { leaves: "Leaves (sylvan)", crest: "Crest fins (drakeborn)" };
/** The race each generated hairstyle belongs to: a game without that race offers no such hair. */
export const PROCEDURAL_HAIR_RACE: Record<string, RaceId> = { leaves: "sylvan", crest: "drakeborn" };

export const OUTFITS: OutfitPreset[] = [
  ...FUTURE_OUTFITS,
  { id: "nude", label: "Nude", garments: [] },
  { id: "underwear", label: "Underwear", garments: ["briefs"], female: ["bra"] },
  { id: "casual", label: "T-shirt and jeans", garments: ["briefs", "tshirt", "jeans", "socks", "sneakers"], female: ["bra"] },
  { id: "sporty", label: "T-shirt and shorts", garments: ["briefs", "tshirt", "shorts", "socks", "sneakers"], female: ["bra"] },
  { id: "layers", label: "Long sleeves and jeans", garments: ["briefs", "longsleeve", "jeans", "socks", "ankle-boots"], female: ["bra"] },
  { id: "long-skirt", label: "Long skirt", garments: ["briefs", "longsleeve", "skirt", "ballet-flats"], female: ["bra"], gender: "female" },
  { id: "mini-skirt", label: "Mini skirt", garments: ["briefs", "tshirt", "skirt-mini", "socks", "sneakers"], female: ["bra"], gender: "female" },
  { id: "skirt-and-bra", label: "Long skirt and bra", garments: ["briefs", "skirt"], female: ["bra"], gender: "female" },
  { id: "polo", label: "Polo and chinos", garments: ["briefs", "polo", "wool-pants", "socks", "leather-shoes"], female: ["bra"] },
  { id: "cargo", label: "Sweater and cargo pants", garments: ["briefs", "fisherman-sweater", "cargo-pants", "socks", "work-boots"], female: ["bra"] },
  { id: "summer", label: "Tank top and denim shorts", garments: ["briefs", "tank-top", "denim-shorts", "t-bar-shoes"], female: ["bra"], gender: "female" },
  { id: "street", label: "Street casual", garments: ["briefs", "jacket-jeans", "sneakers", "newsboy-cap"], gender: "male" },
  { id: "casual-suit", label: "Casual set", garments: ["briefs", "tee-jeans-fitted", "canvas-sneakers"], female: ["bra"], gender: "female" },
  { id: "sport", label: "Sportswear", garments: ["briefs", "sportsuit", "sneakers"], female: ["bra"], gender: "female" },
  { id: "work", label: "Work overalls", garments: ["briefs", "worksuit", "work-boots"], gender: "male" },
  { id: "business", label: "Business suit", garments: ["briefs", "suit-tie", "socks", "black-shoes"], gender: "male", colors: { socks: "#1c1c1f" } },
  { id: "double-breasted", label: "Double-breasted suit", garments: ["briefs", "suit-double", "socks", "leather-shoes"], gender: "male", colors: { socks: "#1c1c1f" } },
  { id: "tuxedo", label: "Dinner jacket", garments: ["briefs", "suit-dinner", "socks", "black-shoes"], gender: "male", colors: { socks: "#1c1c1f" } },
  { id: "pantsuit", label: "Pantsuit", garments: ["briefs", "suit-female", "ankle-boots"], female: ["bra"], gender: "female" },
  { id: "evening", label: "Evening gown", garments: ["briefs", "gown", "gloves-long", "ballet-flats"], gender: "female" },
  { id: "shift-dress", label: "Shift dress", garments: ["briefs", "shift-dress", "stockings", "ballet-flats"], gender: "female" },
  { id: "halter-dress", label: "Halter dress", garments: ["briefs", "halter-midi", "t-bar-shoes"], gender: "female" },
  { id: "flapper", label: "Flapper dress", garments: ["briefs", "flapper-dress", "cloche-hat", "t-bar-shoes"], gender: "female" },
  { id: "kimono", label: "Kimono", garments: ["briefs", "kimono", "cloth-shoes"], gender: "female" },
  { id: "elegant-male", label: "Elegant", garments: ["briefs", "elegant-male", "socks", "black-shoes", "fedora"], gender: "male", colors: { socks: "#1c1c1f" } },
  { id: "monk", label: "Monk robe", garments: ["briefs", "monk-robe", "monk-hood"] },
  { id: "viking", label: "Viking", garments: ["briefs", "viking-tunic", "viking-pants", "viking-boots"], gender: "male" },
  { id: "antique", label: "Mycenaean tunic", garments: ["briefs", "tunic", "t-bar-shoes"] },
  ...MEDIEVAL_OUTFITS,
  // Fantasy
  { id: "warlord", label: "Dark warlord", garments: ["briefs", "viking-tunic", "viking-pants", "viking-boots", "gauntlet-gloves", "dark-horned-helmet"], gender: "male", colors: { "viking-tunic": "#2a2a2e", "gauntlet-gloves": "#1c1c1f" } },
  { id: "hoplite", label: "Hoplite", garments: ["briefs", "tunic", "cloth-shoes", "corinthian-helmet"], gender: "male", colors: { tunic: "#8c2a24" } },
  { id: "wizard", label: "Wizard", garments: ["briefs", "wizard-robe", "wizard-hat", "cloth-shoes"], colors: { "wizard-robe": "#2c3570", "wizard-hat": "#2c3570" } },
  { id: "witch", label: "Witch", garments: ["briefs", "medieval-dress", "witch-hat", "cuffed-boots"], gender: "female", colors: { "medieval-dress": "#2a2433", "cuffed-boots": "#1c1c1f" } },
  { id: "elven-gown", label: "Elven gown", garments: ["briefs", "elven-gown", "ballet-flats"], gender: "female" },
  { id: "priestess", label: "Priestess", garments: ["briefs", "priestess-robe", "cloth-shoes"], gender: "female" },
  { id: "goddess", label: "Goddess", garments: ["briefs", "goddess-dress", "t-bar-shoes"], gender: "female" },
  { id: "medieval", label: "Medieval dress", garments: ["briefs", "medieval-dress", "cloth-shoes"], gender: "female" },
  { id: "ranger", label: "Ranger", garments: ["briefs", "longsleeve", "wool-pants", "pirate-boots", "monk-hood", "gloves-short"], female: ["bra"], gender: "female", colors: { longsleeve: "#3f4a2c", "wool-pants": "#4a3426", "monk-hood": "#2f3b26" } },
  { id: "ninja", label: "Ninja", garments: ["briefs", "ninja"], gender: "female" },
  { id: "office", label: "Blouse and pencil skirt", garments: ["briefs", "blouse-pencil-skirt", "stockings", "black-shoes"], female: ["bra"], gender: "female" },
  { id: "party", label: "Camisole and mini skirt", garments: ["briefs", "camisole", "skirt-tiered-mini", "overknee-boots"], gender: "female" },
  { id: "lingerie", label: "Lingerie", garments: ["lace-thong", "underwear-top", "fishnet-stockings"], gender: "female" },
  { id: "biker", label: "Biker", garments: ["briefs", "jacket-jeans", "biker-boots", "mma-gloves", "sunglasses"], gender: "male" },
  { id: "weekend", label: "Striped shirt and jeans", garments: ["briefs", "striped-shirt-jeans", "socks", "trainers"], gender: "male" },
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

/** Suggested garment colours; the editor also offers a free colour picker. */
export const GARMENT_COLORS: Choice[] = [
  { id: "#1c1c1f", label: "Black" },
  { id: "#f1efe9", label: "White" },
  { id: "#8b8e93", label: "Grey" },
  { id: "#1f2a44", label: "Navy" },
  { id: "#3566a8", label: "Blue" },
  { id: "#93bde3", label: "Light blue" },
  { id: "#1f7a7a", label: "Teal" },
  { id: "#2f6b45", label: "Green" },
  { id: "#5f6838", label: "Olive" },
  { id: "#e3c44a", label: "Yellow" },
  { id: "#d9752b", label: "Orange" },
  { id: "#b3262e", label: "Red" },
  { id: "#5e1a2b", label: "Burgundy" },
  { id: "#e79bb6", label: "Pink" },
  { id: "#5d3b80", label: "Purple" },
  { id: "#d2bd98", label: "Beige" },
  { id: "#6b4a32", label: "Brown" },
];

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** `{ themes }` from a tag table, or nothing for an untagged id. */
const themed = (table: Record<string, string[]>, id: string) => (table[id] ? { themes: [...table[id]] } : {});

export const ROBOT_HEAD_LABELS: Record<string, string> = { visor: "Visor", optics: "Twin optics", mono: "Mono-eye", android: "Android face" };

export function buildCatalog(human: Human, irisPresets: string[]): CharacterCatalog {
  const m = human.runtime.manifest;
  const labels = human.extra.garmentLabels ?? {};
  const info = human.extra.garments ?? {};
  const garments = m.meshes
    .filter((d) => d.role === "garment" && !d.internal)
    .map((d): GarmentChoice => {
      const g = info[d.name] ?? {};
      return {
        id: d.name,
        label: g.label ?? labels[d.name] ?? d.name,
        slot: d.slot,
        occupies: g.occupies ?? [],
        category: g.category ?? "Clothes",
        coversAnatomy: !!d.tags?.includes("covers:anatomy"),
        hidesHair: !!d.tags?.includes("covers:hair"),
        ...(d.tags?.includes("license:CC-BY") && g.credit ? { credit: g.credit, author: g.author } : {}),
        ...(g.gender ? { gender: g.gender } : {}),
        ...themed(GARMENT_THEMES, d.name),
      };
    });
  const have = new Set(garments.map((g) => g.id));
  const outfits = OUTFITS.filter((o) => o.garments.every((g) => have.has(g))).map((o) => ({ ...o, female: o.female?.filter((g) => have.has(g)) }));
  const ccBy = new Set(m.meshes.filter((d) => d.tags?.includes("license:CC-BY")).map((d) => d.name));
  const choices = (r: Record<string, string> | undefined) => Object.entries(r ?? {}).map(([id, label]) => ({ id, label }));
  return {
    races: RACE_IDS.map((id) => ({ id, label: RACES[id].name, description: RACES[id].description, ...themed(RACE_THEMES, id) })),
    animations: human.runtime.clipDefs.map((c) => {
      const library = m.clipLibraries?.find((l) => c.file.startsWith(l.file.slice(0, l.file.lastIndexOf("/") + 1)))?.name ?? "";
      const label = library && c.description ? `${c.name.replace(/^\S+\s/, "")} · ${c.description}` : cap(c.name);
      return { id: c.name, label, category: c.category ?? "Other", loop: c.loop, library, description: c.description };
    }),
    libraries: [{ id: "", label: `Animations (${(m.clips ?? []).length})` }, ...(m.clipLibraries ?? []).map((l) => ({ id: l.name, label: `${l.name === "cmu" ? "CMU motion capture" : l.name} (${l.count})` }))],
    garments,
    outfits,
    hair: [
      ...choices(human.extra.hairLabels).map((h) => (ccBy.has(h.id) && human.extra.hairCredits?.[h.id] ? { ...h, credit: human.extra.hairCredits[h.id] } : h)),
      ...choices(PROCEDURAL_HAIR),
    ].map((h) => ({ ...h, ...themed(HAIR_THEMES, h.id) })),
    hairColors: HAIR_COLORS,
    garmentColors: GARMENT_COLORS,
    brows: choices(human.extra.browLabels),
    eyes: irisPresets.map((id) => ({ id, label: cap(id) })),
    expressions: Object.keys(EXPRESSIONS).map((id) => ({ id, label: cap(id) })),
    details: human.modifiers.map((d) => ({ id: d.id, label: d.label, group: d.group, min: d.negative.length ? -1 : 0, max: 1 })),
    photoSkin: (human.extra.skins?.length ?? 0) > 0,
    robot: {
      heads: ROBOT_HEADS.map((id) => ({ id, label: ROBOT_HEAD_LABELS[id] })),
      ears: ROBOT_EARS.map((id) => ({ id, label: cap(id) })),
      plating: ROBOT_PLATING.map((id) => ({ id, label: cap(id) })),
      finishes: Object.entries(ROBOT_FINISHES).map(([id, f]) => ({ id, label: f.label })),
      palettes: ROBOT_PALETTES,
    },
    skeletal: { palettes: SKELETAL_PALETTES },
  };
}

/**
 * A wearable outfit from a list of garment ids: unknown ids are dropped, and a
 * later garment takes off earlier ones it shares a slot or body layer with
 * (a dress replaces a T-shirt and jeans).
 */
export function resolveOutfit(catalog: Pick<CharacterCatalog, "garments">, outfit: string[]): string[] {
  const byId = new Map(catalog.garments.map((g) => [g.id, g]));
  const out: string[] = [];
  for (const id of outfit) {
    const g = byId.get(id);
    if (!g || out.includes(id)) continue;
    for (let i = out.length - 1; i >= 0; i--) {
      const prev = byId.get(out[i])!;
      if ((g.slot && prev.slot === g.slot) || g.occupies.some((l) => prev.occupies.includes(l))) out.splice(i, 1);
    }
    out.push(id);
  }
  return out;
}

/** Underwear layers an outer layer covers completely (a top covers the bra, a bottom the briefs). */
const UNDER_LAYERS: Record<string, string[]> = { top: ["bra"], bottom: ["briefs"] };

/**
 * Worn garments that need not be drawn because outer clothes cover them
 * completely (briefs under trousers, a bra under a top), so they can never
 * peek through.
 */
export function concealedGarments(catalog: Pick<CharacterCatalog, "garments">, outfit: string[]): string[] {
  const worn = catalog.garments.filter((g) => outfit.includes(g.id));
  const covered = new Set(worn.flatMap((g) => g.occupies.flatMap((l) => UNDER_LAYERS[l] ?? [])));
  return worn.filter((g) => g.occupies.length > 0 && g.occupies.every((l) => covered.has(l))).map((g) => g.id);
}

/** Garment ids of an outfit preset for a body. */
export function outfitGarments(preset: OutfitPreset, body: Pick<HumanParams, "gender">): string[] {
  return [...preset.garments, ...(body.gender < 0.5 ? (preset.female ?? []) : [])];
}

/**
 * `config` kept to what the catalog offers: a race it lists (else its first), robots and skeletons
 * only when it has them, and a robot or skeleton when it offers no living people.
 */
/**
 * The race-only features the catalog's races grow: horns, tails, tusks, glowing eyes, pupils and
 * skin patterns, and whether the race size slider does anything. With every race on offer, everything; a game that allows only some races (only
 * humans, say) offers just what those races have, so its editor shows no horns, tails or scales
 * and `set` takes them off.
 */
export interface RaceFeatures {
  horns: HornStyle[];
  tails: TailStyle[];
  pupils: PupilShape[];
  patterns: SkinPattern[];
  tusks: boolean;
  eyeGlow: boolean;
  /** Whether the Size slider changes anything (humans all have the same scale). */
  size: boolean;
}

export function raceFeatures(races: readonly { id: RaceId }[], all: { horns: readonly HornStyle[]; tails: readonly TailStyle[]; pupils: readonly PupilShape[]; patterns: readonly SkinPattern[] }): RaceFeatures {
  const ids = new Set(races.map((r) => r.id));
  if (!ids.size || RACE_IDS.every((id) => ids.has(id))) return { horns: [...all.horns], tails: [...all.tails], pupils: [...all.pupils], patterns: [...all.patterns], tusks: true, eyeGlow: true, size: true };
  const styles = [...ids].map((id) => RACE_STYLES[id]);
  const used = <T>(pick: (s: (typeof styles)[number]) => [T, number][], keep: T[], list: readonly T[]) => {
    const on = new Set<T>(keep);
    for (const s of styles) for (const [v, w] of pick(s)) if (w > 0) on.add(v);
    return list.filter((v) => on.has(v));
  };
  return {
    horns: used((s) => s.horns, ["none"], all.horns),
    tails: used((s) => s.tail, ["none"], all.tails),
    pupils: used((s) => s.pupil, ["round"], all.pupils),
    patterns: used((s) => s.pattern, ["none"], all.patterns),
    tusks: styles.some((s) => s.tuskChance > 0 && s.tusks[1] > 0),
    eyeGlow: styles.some((s) => s.eyeGlow[1] > 0),
    size: styles.some((s) => s.scale[0] !== s.scale[1]),
  };
}

export function fitConfig(catalog: Pick<CharacterCatalog, "races" | "robot" | "skeletal" | "people">, config: CharacterConfig): CharacterConfig {
  const races = new Set<string>(catalog.races.map((r) => r.id));
  const c = { ...config };
  if (races.size && !races.has(c.race)) c.race = races.has("human") ? "human" : catalog.races[0].id;
  if (c.race2 && !races.has(c.race2)) Object.assign(c, { race2: null, raceMix: 0 });
  if (!catalog.robot) c.robot = false;
  if (!catalog.skeletal) c.skeletal = false;
  if (catalog.people === false && !c.robot && !c.skeletal) {
    if (catalog.robot) c.robot = true;
    else if (catalog.skeletal) c.skeletal = true;
  }
  // Only the horns, tails, eyes and skin patterns the races on offer have.
  const f = raceFeatures(catalog.races, { horns: [c.horns], tails: [c.tail], pupils: [c.pupil], patterns: [c.skinPattern] });
  if (!f.horns.includes(c.horns)) Object.assign(c, { horns: "none", hornColor: null });
  if (!f.tails.includes(c.tail)) c.tail = "none";
  if (!f.pupils.includes(c.pupil)) c.pupil = "round";
  if (!f.patterns.includes(c.skinPattern)) c.skinPattern = "none";
  if (!f.tusks) c.tusks = 0;
  if (!f.eyeGlow) c.eyeGlow = 0;
  const hairRace = c.hair ? PROCEDURAL_HAIR_RACE[c.hair] : undefined;
  if (hairRace && races.size && !races.has(hairRace)) c.hair = null;
  return c;
}

export function defaultConfig(catalog: CharacterCatalog): CharacterConfig {
  return fitConfig(catalog, {
    race: "human",
    race2: null,
    raceMix: 0,
    raceSize: 0.5,
    deform: null,
    youth: 0,
    body: { ...DEFAULT_PARAMS },
    details: {},
    shape: {},
    skin: catalog.photoSkin ? "photo" : "procedural",
    skinTone: 0.3,
    skinColor: null,
    eyeColor: null,
    eyeGlow: 0,
    pupil: "round",
    skinPattern: "none",
    patternStrength: 0.6,
    patternColor: null,
    seed: 0.5,
    eyes: catalog.eyes[0]?.id ?? "brown",
    hair: null,
    hairColor: null,
    beard: "none",
    stubble: 0,
    horns: "none",
    hornSize: 0.7,
    hornColor: null,
    tusks: 0,
    tail: "none",
    tailLength: 0.8,
    brows: catalog.brows[0]?.id ?? PAINTED_BROWS,
    outfit: [],
    garmentColors: {},
    anatomy: true,
    animation: catalog.animations.some((a) => a.id === "idle") ? "idle" : null,
    expression: "neutral",
    expressionIntensity: 0.8,
    blink: true,
    faceRig: false,
    faceAnimation: false,
    gaze: "camera",
    wrinkles: false,
    skinDetail: true,
    skinWetness: 0,
    clothTuck: true,
    clothMotion: true,
    detail: "high",
    robot: false,
    robotLook: { ...DEFAULT_ROBOT_LOOK },
    skeletal: false,
    skeletalLook: { ...DEFAULT_SKELETAL_LOOK },
    costume: { ...DEFAULT_COSTUME, finishes: {} },
  });
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
  /** Race of the new character, "any" for one from `catalog.races` (default: the base's race and mix). */
  race?: RaceId | "any";
  /** Make a robot (true), a human (false), or keep the base's kind (default). Robots get a random robot look. */
  robot?: boolean;
  /** Make a skeleton (true), not one (false), or keep the base's kind (default). Skeletons get a random skeleton look. */
  skeletal?: boolean;
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
  // Robots and skeletons only when the catalog offers them; one of them when it offers no living people.
  let skeletal = !!catalog.skeletal && (options.skeletal ?? (options.robot ? false : base.skeletal));
  let robot = !!catalog.robot && !skeletal && (options.robot ?? base.robot);
  if (catalog.people === false && !robot && !skeletal) {
    if (catalog.robot && (!catalog.skeletal || r() < 0.5)) robot = true;
    else skeletal = !!catalog.skeletal;
  }
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
  // Shape sliders vary the build and face in ways people read (shoulders, hips, jaw...).
  const shape: Record<string, number> = {};
  for (const s of SHAPE_SLIDERS) if (r() < 0.5) shape[s.id] = Math.round((r() - 0.5) * 80) / 100;
  const hairPool = catalog.hair.filter((h) => !(h.id in PROCEDURAL_HAIR) && (female || SHORT_HAIR.test(h.id)));
  const old = body.ageYears > 60 && r() < 0.7;
  const presets = catalog.outfits.filter((o) => !o.gender || o.gender === (female ? "female" : "male"));
  const outfitPreset = options.outfit === false ? undefined : pick(presets.length ? presets : catalog.outfits);
  const outfit = outfitPreset ? outfitGarments(outfitPreset, body) : base.outfit;
  // About half the garments get a colour from the palette; the rest keep their own.
  const garmentColors: Record<string, string> = {};
  if (outfitPreset) for (const g of outfit) if (r() < 0.5) garmentColors[g] = pick(catalog.garmentColors)?.id ?? "#808080";
  const offered = (id: RaceId) => catalog.races.some((x) => x.id === id);
  const wanted = options.race === "any" ? (pick(catalog.races)?.id ?? base.race) : (options.race ?? base.race);
  const race = offered(wanted) || !catalog.races.length ? wanted : catalog.races[0].id;
  const race2 = options.race ? null : base.race2;
  const human = race === "human" && !race2;
  const look = human ? undefined : randomRaceLook(catalog, race, race2, base.raceMix, body, r);
  if (look) Object.assign(body, look.body);
  const humanLook = {
    eyes: pick(catalog.eyes)?.id ?? base.eyes,
    hair: !female && r() < 0.12 ? null : (pick(hairPool)?.id ?? null),
    hairColor: old ? "#9a968f" : r() < 0.4 ? null : (pick(catalog.hairColors)?.id ?? null),
    brows: pick(catalog.brows)?.id ?? base.brows,
  };
  const parts = raceParts(race, race2, base.raceMix, body, r);
  return fitConfig(catalog, {
    ...base,
    race,
    race2,
    raceSize: look?.raceSize ?? 0.5,
    body,
    details,
    shape,
    ...humanLook,
    skinColor: look?.skinColor ?? null,
    eyeColor: look?.eyeColor ?? null,
    eyeGlow: look?.eyeGlow ?? 0,
    pupil: look?.pupil ?? "round",
    skinPattern: look?.skinPattern ?? "none",
    patternStrength: look?.patternStrength ?? base.patternStrength,
    patternColor: look?.patternColor ?? null,
    seed: r(),
    ...(look ? { hair: look.hair, hairColor: look.hairColor, brows: look.brows } : {}),
    ...parts,
    outfit,
    garmentColors: outfitPreset ? { ...outfitPreset.colors, ...garmentColors } : base.garmentColors,
    animation: options.animation ? (pick(catalog.animations.filter((a) => !a.library))?.id ?? base.animation) : base.animation,
    // Robot and skeleton exclude each other; an explicit option wins over the base.
    robot,
    robotLook: robot ? randomRobotLook(r) : base.robotLook,
    skeletal,
    skeletalLook: skeletal ? randomSkeletalLook(r) : base.skeletalLook,
  });
}
