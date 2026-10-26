import { describe, expect, it } from "vitest";
import { COW, SPECIES } from "./animal";
import { COW_DEFAULT_SHAPE, COW_PRESETS, COW_SHAPE_RANGES, cowParams, cowShapeOptions, cowTargetWeights, sanitizeCowShape } from "./cow";

describe("cow parameters", () => {
  it("every preset stays inside the slider ranges", () => {
    for (const [id, p] of Object.entries(COW_PRESETS)) {
      for (const [k, v] of Object.entries(p.shape)) {
        const [lo, hi] = COW_SHAPE_RANGES[k as keyof typeof COW_SHAPE_RANGES];
        expect(v, `${id}.${k}`).toBeGreaterThanOrEqual(lo);
        expect(v, `${id}.${k}`).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("the default shape (horned base body) needs no morphs and no bone changes", () => {
    expect(cowTargetWeights(COW_DEFAULT_SHAPE).size).toBe(0);
    const o = cowShapeOptions(COW_DEFAULT_SHAPE);
    expect(o.scale).toBe(1);
    for (const s of Object.values(o.bones ?? {})) {
      expect(s.len ?? 1).toBeCloseTo(1);
      expect(s.girth ?? 1).toBeCloseTo(1);
    }
  });

  it("maps the udder both ways and sizes the horns", () => {
    const big = cowTargetWeights({ ...COW_DEFAULT_SHAPE, udder: 0.6 });
    expect(big.get("udder-large")).toBeCloseTo(0.6);
    expect(big.has("udder-small")).toBe(false);
    const small = cowTargetWeights({ ...COW_DEFAULT_SHAPE, udder: -1 });
    expect(small.get("udder-small")).toBeCloseTo(1);
    // Polled: the horns shrink away, and the long sweep goes with them.
    const polled = cowTargetWeights({ ...COW_DEFAULT_SHAPE, horns: 0, hornsLong: 1 });
    expect(polled.get("horns-none")).toBeCloseTo(1);
    expect(polled.has("horns-long")).toBe(false);
    const highland = cowTargetWeights(cowParams("highland").shape);
    expect(highland.get("horns-long")).toBeCloseTo(1);
    expect(highland.has("horns-none")).toBe(false);
  });

  it("maps proportions to the horse rig's bones", () => {
    const o = cowShapeOptions({ ...COW_DEFAULT_SHAPE, legs: 0.85, size: 0.9 }, ["front_leg_lower_l", "tail_2"]);
    expect(o.scale).toBeCloseTo(0.9);
    expect(o.bones!.front_leg_lower_l.len!).toBeLessThan(0.85);
    expect(o.bones!.front_leg_lower_r).toBeUndefined();
  });

  it("clamps shapes and fills coats", () => {
    expect(sanitizeCowShape({ udder: -3 }).udder).toBe(-1);
    const brown = cowParams("braunvieh"), holstein = cowParams("holstein");
    // The base preset matches the photo: dehorned, mealy muzzle.
    expect(brown.shape.horns).toBe(0);
    expect(brown.coat.paleMask).toBeGreaterThan(0.5);
    expect(holstein.coat.pied).toBeGreaterThan(0.3);
    // Cow markings are present on every coat (the fur material tells cows by them), dog markings as 0.
    expect(brown.coat.pied).toBe(0);
    expect(brown.coat.saddle).toBe(0);
    expect(() => cowParams("aurochs")).toThrow();
  });

  it("is registered as a species", () => {
    expect(SPECIES.cow).toBe(COW);
    expect(COW.presets[COW.base]).toBeDefined();
  });
});
