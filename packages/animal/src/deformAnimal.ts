/**
 * Deform on the generated animals (dog, deer, cow, ...): a plan (`deform` in @actors/core) becomes shape values
 * and coat colours, which the pack turns into bone scales and the fur material. The plan's `scale` is the body's
 * growth: the caller grows the animal's `place` by it (the `size` value is capped by each species' range).
 */
import { type DeformPlan, changesBody } from "@actors/core";
import { DEER_SHAPE_RANGES } from "./deer";
import { COW_SHAPE_RANGES } from "./cow";
import { SHAPE_RANGES } from "./breeds";

/** How the shape values every species shares answer to a plan's parts (value -> part, and whether length or girth moves it). */
const SHAPE_PARTS: readonly (readonly [string, "leg" | "neck" | "head" | "ear" | "tail" | "spine", "len" | "girth"])[] = [
  ["legs", "leg", "len"],
  ["bone", "leg", "girth"],
  ["neck", "neck", "len"],
  ["neckThick", "neck", "girth"],
  ["head", "head", "len"],
  ["ears", "ear", "len"],
  ["tail", "tail", "len"],
  ["body", "spine", "len"],
  ["bulk", "spine", "girth"],
];

const RANGES: Record<string, Record<string, [number, number]>> = { dog: SHAPE_RANGES, deer: DEER_SHAPE_RANGES, cow: COW_SHAPE_RANGES };

/**
 * `shape` with the plan's proportions on it (each value times its part's factor, kept inside `ranges` when given;
 * `neckThick` is 0..1, so it only gains). Values the shape lacks are left out. Does not change `size`.
 */
export function deformShape<S extends object>(shape: S, plan: DeformPlan | null | undefined, ranges?: Partial<Record<string, [number, number]>>): S {
  if (!changesBody(plan)) return shape;
  const out: Record<string, number> = { ...(shape as Record<string, number>) };
  for (const [key, part, axis] of SHAPE_PARTS) {
    const v = out[key];
    if (typeof v !== "number") continue;
    const f = plan.parts[part][axis];
    // A value that is an amount (0..1), not a multiple, gains by the same share of what is left to it.
    const r = ranges?.[key];
    const next = key === "neckThick" ? v + (1 - v) * Math.max(0, f - 1) : v * f;
    out[key] = r ? Math.min(r[1], Math.max(r[0], next)) : next;
  }
  return out as S;
}

/** The shape ranges of a species by pack kind (`Animal.kind`), for `deformShape`. */
export function deformRanges(kind: string): Partial<Record<string, [number, number]>> | undefined {
  return RANGES[kind];
}

type RGB = [number, number, number];

/**
 * `coat` grown old: the colours pulled towards their grey by `skin.grey`, darker by `skin.age`, the pale face mask
 * and the frost of guard hair raised where the coat has them. Colours stay sRGB 0..1, as the coat holds them.
 */
export function deformCoat<C extends object>(coat: C, plan: DeformPlan | null | undefined): C {
  if (!changesBody(plan)) return coat;
  const out = { ...(coat as Record<string, unknown>) };
  const { grey, age, muzzleGrey } = plan.skin;
  for (const key of ["base", "second", "tan"]) {
    const c = out[key];
    if (!Array.isArray(c) || c.length !== 3) continue;
    const mean = (c[0] + c[1] + c[2]) / 3;
    const dark = 1 - 0.22 * age;
    out[key] = (c as RGB).map((v) => Math.min(1, Math.max(0, (v + (mean - v) * grey * 0.6) * dark))) as RGB;
  }
  // The greyed muzzle: coats with a pale mask show more of it, coats without one frost.
  if (typeof out.paleMask === "number") out.paleMask = Math.min(1, out.paleMask + muzzleGrey * 0.5);
  if (typeof out.headTone === "number") out.headTone = Math.min(1, out.headTone + muzzleGrey * 0.4);
  out.frost = Math.min(1, (typeof out.frost === "number" ? out.frost : 0) + grey * 0.45);
  return out as C;
}
