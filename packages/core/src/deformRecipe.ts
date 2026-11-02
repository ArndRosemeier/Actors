/**
 * Deform: a seeded recipe with a strength that changes a body's bones, skin and movement.
 *
 * A recipe turns `(recipe, seed, strength)` into a plan of plain numbers, the same everywhere:
 * - **bones**: length and girth per body part (`parts`), and a size to grow the whole body by (`scale`),
 * - **skin**: colour numbers (`skin`), applied by an adapter to the one material the body already has,
 *   so a deformed body costs no new shader,
 * - **movement**: how the clips play (`gait`): slower for the size, heavier on the feet.
 *
 * The plan is renderer-free and rig-free. `deformBones` maps it onto any skeleton by bone name (people,
 * the generated animals, library animals), and `@actors/animal` (`deformShape`) and `@actors/three`
 * (`LibraryAnimal.setDeform`) apply it. Strength 0 changes nothing; the same seed and strength give the
 * same body; no `Math.random`.
 *
 * Recipes: `giant` (a bigger body with square-cube proportions: thicker legs and neck for the weight, a
 * heavier jaw, a head a little small for the body, the look of age, slow heavy steps). More recipes
 * (the plague's twisted bodies) follow; they share this plan.
 */
import type { Vec3 } from "./math";
import type { BoneScale, ShapeOptions } from "./deform";

export type DeformRecipe = "giant";

/** Every recipe there is. */
export const DEFORM_RECIPES: readonly DeformRecipe[] = ["giant"];

/** The parts of a body that a recipe shapes. */
export type BodyPart = "leg" | "foot" | "arm" | "hand" | "neck" | "head" | "jaw" | "spine" | "tail" | "ear" | "horn" | "other";

export const BODY_PARTS: readonly BodyPart[] = ["leg", "foot", "arm", "hand", "neck", "head", "jaw", "spine", "tail", "ear", "horn", "other"];

export interface DeformSpec {
  recipe: DeformRecipe;
  /** Any number: the same seed always gives the same body. */
  seed: number;
  /** 0 (nothing changes) .. 1 (the recipe at its fullest). */
  strength: number;
}

/** What the recipe does to the skin, as numbers an adapter turns into the material's own colour. */
export interface SkinChange {
  /** Multiplies the body's colour (linear, 1 = unchanged): warmer and duller with age. */
  tint: Vec3;
  /** 0..1: how far the coat has gone grey (adapters with a coat pull its colours towards grey). */
  grey: number;
  /** 0..1: the look of age (a darker, weathered skin). */
  age: number;
  /** 0..1: a greyed muzzle and face (coats that have a mask, such as the animals' fur). */
  muzzleGrey: number;
  /** 0..1: scars (adapters with a detail layer). */
  scars: number;
  /** The seed for anything an adapter draws from it (where the scars lie). */
  seed: number;
}

/** How the clips play. */
export interface GaitChange {
  /** Playback speed times the clip's own (a big body moves slower; 1 = unchanged). */
  rate: number;
  /** How heavy the steps are, 0..1 (adapters add weight: a deeper step sound, a shaken camera). */
  heft: number;
}

export interface DeformPlan {
  recipe: DeformRecipe;
  seed: number;
  strength: number;
  /** Grow the whole body by this (1 = unchanged). The bones below are relative to it. */
  scale: number;
  /** Length and girth of each body part, relative to the whole body's growth (1 = unchanged). */
  parts: Record<BodyPart, Required<BoneScale>>;
  skin: SkinChange;
  gait: GaitChange;
}

/** The biggest the giant recipe grows a body at strength 1 (times its normal size). */
export const GIANT_SCALE = 2.6;

/** Seeded numbers (mulberry32): the stream for one `(seed, salt)`. */
export function deformRandom(seed: number, salt = 0): () => number {
  let a = (Math.imul(Math.floor(seed) | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b) ^ 0x2545f491) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function plain(): Record<BodyPart, Required<BoneScale>> {
  const parts = {} as Record<BodyPart, Required<BoneScale>>;
  for (const p of BODY_PARTS) parts[p] = { len: 1, girth: 1 };
  return parts;
}

/** The plan that changes nothing. */
export function noDeform(recipe: DeformRecipe = "giant", seed = 0): DeformPlan {
  return {
    recipe, seed, strength: 0, scale: 1, parts: plain(),
    skin: { tint: [1, 1, 1], grey: 0, age: 0, muzzleGrey: 0, scars: 0, seed },
    gait: { rate: 1, heft: 0 },
  };
}

/** True if the plan changes anything. */
export function changesBody(plan: DeformPlan | null | undefined): plan is DeformPlan {
  return !!plan && plan.strength > 1e-4;
}

/**
 * The plan for a recipe, a seed and a strength.
 *
 * `giant`: a body grown to `scale` (up to GIANT_SCALE) is not a bigger copy. By the square-cube law the
 * legs and neck carry cubic weight on square-law bone, so they get thicker, and a little shorter in the
 * shin; the head grows less than the body and the jaw is heavy; tails and ears stay thin. Every part is
 * jittered a little by the seed so no two giants are the same. Its skin is old: duller, warmer, a greyed
 * muzzle, scarred. Its clips play slower, by the square root of the size (a pendulum), with heavy steps.
 */
export function deform(spec: DeformSpec): DeformPlan {
  const s = clamp01(spec.strength);
  if (s <= 1e-4) return { ...noDeform(spec.recipe, spec.seed), seed: spec.seed };
  const r = deformRandom(spec.seed, 1);
  // A jitter in -1..1 for one part, always drawn in the same order so a seed keeps its body.
  const jit = (): number => r() * 2 - 1;
  const scale = lerp(1, GIANT_SCALE, s);
  const parts = plain();
  const part = (p: BodyPart, len: number, girth: number, wobble = 0.06) => {
    // The jitter grows with the strength: a slight giant is only a bigger animal.
    const j = jit() * wobble * s, k = jit() * wobble * s;
    parts[p] = { len: 1 + (len - 1) * s + j, girth: 1 + (girth - 1) * s + k };
  };
  part("leg", 0.93, 1.32);
  part("foot", 0.9, 1.4);
  part("arm", 1, 1.25);
  part("hand", 1.0, 1.3);
  part("neck", 1.0, 1.28);
  part("head", 0.88, 0.88, 0.04);
  part("jaw", 1.05, 1.22);
  part("spine", 1.02, 1.08, 0.03);
  part("tail", 0.95, 0.9, 0.05);
  part("ear", 0.85, 0.9, 0.05);
  part("horn", 1.1, 1.2, 0.05);
  const age = clamp01(0.45 + 0.35 * s + jit() * 0.15 * s);
  const grey = clamp01(0.2 + 0.5 * s + jit() * 0.15 * s);
  return {
    recipe: spec.recipe, seed: spec.seed, strength: s, scale, parts,
    skin: {
      tint: [lerp(1, 0.97, age), lerp(1, 0.93, age), lerp(1, 0.88, age)],
      grey, age, muzzleGrey: clamp01(0.3 + 0.6 * s + jit() * 0.1 * s), scars: clamp01(0.25 + 0.6 * s + jit() * 0.2 * s), seed: spec.seed,
    },
    gait: { rate: 1 / Math.sqrt(scale), heft: s },
  };
}

// ---- Which part a bone is -------------------------------------------------------------------------

/** Name patterns, first match wins. The animals' rigs, the people's and the library's name bones differently. */
const PARTS: readonly (readonly [BodyPart, RegExp])[] = [
  ["other", /armature/i],
  ["ear", /ear/i],
  ["horn", /horn|antler|tusk/i],
  ["tail", /tail|tip_tail/i],
  ["jaw", /jaw|chin|mandible|lowerlip|tongue/i],
  ["head", /head|skull|nose|snout|muzzle|face|eye|brow|forehead|cheek|beak/i],
  ["neck", /neck|throat/i],
  ["hand", /hand|finger|thumb|palm|carpal|wrist|paw|claw|fingers|metacarp/i],
  ["foot", /foot|toe|hoof|ankle|heel|pastern|fetlock|metatars|cannon|tarsal|ball|tip/i],
  ["leg", /leg|thigh|upleg|upperleg|calf|shin|knee|femur|tibia|hock|shank|lowerleg|hind|stifle/i],
  ["arm", /arm|shoulder|clavicle|scapula|elbow|forearm|humerus|foreleg|front|wing|flipper|fin/i],
  ["spine", /spine|back|chest|rib|torso|body|trunk|belly|root|hips?\b|waist|sacrum|pelvis|abdomen|cog|center|master|armature/i],
];

/** The part a bone belongs to by its name; `other` when the name says nothing. */
export function partOfBone(name: string): BodyPart {
  for (const [part, re] of PARTS) if (re.test(name)) return part;
  return "other";
}

/**
 * The part of every bone of a skeleton. A bone whose name says nothing takes its parent's part (the bone below a
 * thigh is the shin), and a chain with no named ancestor is `other` (left as it is). `parents[i]` is the index of
 * bone i's parent, -1 for a root.
 */
export function classifyBones(names: readonly string[], parents?: readonly number[]): BodyPart[] {
  const out = names.map(partOfBone);
  if (!parents) return out;
  const resolve = (i: number, depth = 0): BodyPart => {
    if (out[i] !== "other" || depth > names.length) return out[i];
    const p = parents[i];
    if (p === undefined || p < 0) return "other";
    const above = resolve(p, depth + 1);
    // Only a limb or a head lends its name down the chain; a spine bone with no name is not "spine".
    out[i] = above === "spine" ? "other" : above;
    return out[i];
  };
  for (let i = 0; i < names.length; i++) resolve(i);
  return out;
}

/**
 * Per-bone length and girth for a plan, by bone name: feed it to `ShapeOptions.bones` (people and packs). A part's
 * factors are relative to the whole body's growth, which is `plan.scale`.
 */
export function deformBones(plan: DeformPlan, names: readonly string[], parents?: readonly number[]): Record<string, BoneScale> {
  const out: Record<string, BoneScale> = {};
  if (!changesBody(plan)) return out;
  const part = classifyBones(names, parents);
  names.forEach((n, i) => {
    const p = plan.parts[part[i]];
    if (Math.abs(p.len - 1) > 1e-5 || Math.abs(p.girth - 1) > 1e-5) out[n] = { len: p.len, girth: p.girth };
  });
  return out;
}

/** Shape options (bone proportions and the whole body's growth) for a plan on a skeleton. */
export function deformShapeOptions(plan: DeformPlan, names: readonly string[], parents?: readonly number[]): ShapeOptions {
  if (!changesBody(plan)) return {};
  return { bones: deformBones(plan, names, parents), scale: plan.scale };
}

/**
 * `base` (a race's proportions, say) with the plan on top: each bone's length and girth times the plan's part,
 * the whole body's scale times the plan's growth. No plan (or strength 0) gives `base` back.
 */
export function mergeDeform(base: ShapeOptions, plan: DeformPlan | null | undefined, names: readonly string[], parents?: readonly number[]): ShapeOptions {
  if (!changesBody(plan)) return base;
  const bones: Record<string, BoneScale> = { ...(base.bones ?? {}) };
  for (const [n, d] of Object.entries(deformBones(plan, names, parents))) {
    bones[n] = { len: (bones[n]?.len ?? 1) * (d.len ?? 1), girth: (bones[n]?.girth ?? 1) * (d.girth ?? 1) };
  }
  return { ...base, bones, scale: (base.scale ?? 1) * plan.scale };
}
