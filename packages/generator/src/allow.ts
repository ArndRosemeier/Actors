import { RACE_IDS, type RaceId } from "@actors/human";
import type { CharacterCatalog } from "./catalog";
import { THEMES } from "./themes";

/** What a character can be: one of the races, or a robot or a skeleton. */
export type CharacterKind = RaceId | "robot" | "skeleton";

/** Every kind, races first. */
export const CHARACTER_KINDS: readonly CharacterKind[] = [...RACE_IDS, "robot", "skeleton"];

/**
 * Clothing categories: the themes garments are tagged with (see `THEMES`). `future` is the 3026
 * wardrobe. Untagged garments (underwear, plain socks) belong to every category and always stay.
 */
export type ClothingCategory = "modern" | "vintage" | "future" | "antique" | "medieval" | "nordic" | "eastern" | "fantasy";

export const CLOTHING_CATEGORIES: readonly ClothingCategory[] = THEMES.map((t) => t.id as ClothingCategory);

/**
 * A set of switches: a list of what is allowed (`["human", "robot"]`, everything else off), or flags
 * (`{ fantasy: false }`, anything not named stays on).
 */
export type Flags<K extends string> = readonly K[] | Partial<Record<K, boolean>>;

/** Whether `key` is on in `flags` (absent flags: everything is on). */
export function flagOn<K extends string>(flags: Flags<K> | undefined, key: K): boolean {
  if (!flags) return true;
  if (Array.isArray(flags)) return (flags as readonly K[]).includes(key);
  return (flags as Partial<Record<K, boolean>>)[key] !== false;
}

/**
 * What a game lets its players make. Pass it as `allow` to `Character.load` or
 * `createCharacterGenerator`; the character, its editor and `randomize` then keep to it.
 *
 * ```ts
 * allow: { races: ["human"], clothing: ["modern"], height: { min: 1.5, max: 2.05 } } // city life today
 * allow: ALLOW_PRESETS.fantasy
 * ```
 */
export interface AllowOptions {
  /** Races, robots and skeletons on offer (see `CHARACTER_KINDS`). Default: all. */
  races?: Flags<CharacterKind>;
  /** Clothing categories on offer (see `CLOTHING_CATEGORIES`). Default: all. */
  clothing?: Flags<ClothingCategory>;
  /**
   * Standing height in meters. A body outside the range (a giantkin, a goblin, a tall roll of the
   * dice) is scaled as a whole to the nearest limit, so its proportions stay its own.
   */
  height?: HeightRange;
}

export interface HeightRange {
  min?: number;
  max?: number;
}

/** Ready-made settings for common kinds of games. */
export const ALLOW_PRESETS = {
  /** City life today: humans in today's clothes, everyday heights. */
  city: { races: ["human"], clothing: ["modern"], height: { min: 1.45, max: 2.05 } },
  /** City life in the 1900s to 1950s. */
  vintage: { races: ["human"], clothing: ["vintage"], height: { min: 1.45, max: 2.05 } },
  /** Medieval fantasy: every race and skeletons, medieval, nordic, antique and fantasy clothes; no robots. */
  fantasy: {
    races: { robot: false },
    clothing: ["medieval", "nordic", "antique", "eastern", "fantasy"],
  },
  /** Science fiction: humans and robots in the 3026 wardrobe and today's clothes. */
  scifi: { races: ["human", "robot"], clothing: ["future", "modern"] },
} satisfies Record<string, AllowOptions>;

/**
 * The catalog with only what `allow` lets in: races (the human body stays as the base of robots and
 * skeletons even when humans are off; `catalog.people` then says so), robots, skeletons, garments of
 * the allowed clothing categories, and the outfit presets whose garments all remain.
 */
export function allowCatalog(catalog: CharacterCatalog, allow: AllowOptions): CharacterCatalog {
  const races = catalog.races.filter((r) => flagOn(allow.races, r.id));
  const garments = allow.clothing ? catalog.garments.filter((g) => !g.themes?.length || g.themes.some((t) => flagOn(allow.clothing, t as ClothingCategory) && CLOTHING_CATEGORIES.includes(t as ClothingCategory))) : catalog.garments;
  const have = new Set(garments.map((g) => g.id));
  const outfits = catalog.outfits.filter((o) => o.garments.every((g) => have.has(g))).map((o) => (o.female ? { ...o, female: o.female.filter((g) => have.has(g)) } : o));
  const robot = flagOn(allow.races, "robot") ? catalog.robot : undefined;
  const skeletal = flagOn(allow.races, "skeleton") ? catalog.skeletal : undefined;
  // No race at all: only robots or skeletons, built on the plain human body.
  const people = races.length > 0 && catalog.people !== false;
  const human = catalog.races.find((r) => r.id === "human");
  return {
    ...catalog,
    races: people ? races : human && (robot || skeletal) ? [human] : races,
    people: people || !(robot || skeletal),
    garments,
    outfits,
    robot,
    skeletal,
    height: mergeHeight(catalog.height, allow.height),
  };
}

/** The narrower of two height ranges. */
function mergeHeight(a: HeightRange | undefined, b: HeightRange | undefined): HeightRange | undefined {
  if (!a) return b && { ...b };
  if (!b) return { ...a };
  const pick = (x: number | undefined, y: number | undefined, f: (...v: number[]) => number) => (x === undefined ? y : y === undefined ? x : f(x, y));
  return { min: pick(a.min, b.min, Math.max), max: pick(a.max, b.max, Math.min) };
}

/** The uniform scale that brings a body of `height` meters into `range` (1 when it fits). */
export function heightFit(height: number, range: HeightRange | undefined): number {
  if (!range || !(height > 0)) return 1;
  const { min, max } = range;
  if (min !== undefined && max !== undefined && min > max) return (min + max) / 2 / height;
  if (min !== undefined && height < min) return min / height;
  if (max !== undefined && height > max) return max / height;
  return 1;
}
