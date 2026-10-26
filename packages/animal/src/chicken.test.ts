import { describe, expect, it } from "vitest";
import { CHICKEN, SPECIES } from "./animal";
import { CHICKEN_DEFAULT_SHAPE, CHICKEN_PRESETS, CHICKEN_SHAPE_RANGES, chickenParams, chickenShapeOptions, chickenTargetWeights, sanitizeChickenShape } from "./chicken";

describe("chicken parameters", () => {
  it("every preset stays inside the slider ranges", () => {
    for (const [id, p] of Object.entries(CHICKEN_PRESETS)) {
      for (const [k, v] of Object.entries(p.shape)) {
        const [lo, hi] = CHICKEN_SHAPE_RANGES[k as keyof typeof CHICKEN_SHAPE_RANGES];
        expect(v, `${id}.${k}`).toBeGreaterThanOrEqual(lo);
        expect(v, `${id}.${k}`).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("the default shape (the photo's brown hen) needs no morphs and no bone changes", () => {
    expect(chickenTargetWeights(CHICKEN_DEFAULT_SHAPE).size).toBe(0);
    const o = chickenShapeOptions(CHICKEN_DEFAULT_SHAPE);
    expect(o.scale).toBe(1);
    for (const s of Object.values(o.bones ?? {})) {
      expect(s.len ?? 1).toBeCloseTo(1);
      expect(s.girth ?? 1).toBeCloseTo(1);
    }
  });

  it("maps comb and wattles both ways", () => {
    const leghorn = chickenTargetWeights(chickenParams("leghorn").shape);
    expect(leghorn.get("comb-large")).toBeCloseTo(1);
    expect(leghorn.has("comb-small")).toBe(false);
    const rose = chickenTargetWeights({ ...CHICKEN_DEFAULT_SHAPE, comb: -0.8, wattles: -0.5 });
    expect(rose.get("comb-small")).toBeCloseTo(0.8);
    expect(rose.get("wattles-small")).toBeCloseTo(0.5);
    expect(chickenTargetWeights({ ...CHICKEN_DEFAULT_SHAPE, bulk: 1.18 }).get("bulk")).toBeCloseTo(1);
  });

  it("maps proportions to the bird rig's bones", () => {
    const o = chickenShapeOptions({ ...CHICKEN_DEFAULT_SHAPE, legs: 1.2, size: 0.6 }, ["AnkleLeg_L", "tail_1"]);
    expect(o.scale).toBeCloseTo(0.6);
    expect(o.bones!.AnkleLeg_L.len!).toBeGreaterThan(1.2);
    expect(o.bones!.AnkleLeg_R).toBeUndefined();
  });

  it("clamps shapes and fills coats with feathers on", () => {
    expect(sanitizeChickenShape({ comb: 3 }).comb).toBe(1);
    const brown = chickenParams("brown");
    // The fur material draws feathers when the coat has a comb colour.
    expect(brown.coat.comb).toBeDefined();
    expect(brown.coat.saddle).toBe(0);
    expect(chickenParams("barredRock").coat.barring).toBeGreaterThan(0.5);
    expect(() => chickenParams("dodo")).toThrow();
  });

  it("is registered as a species", () => {
    expect(SPECIES.chicken).toBe(CHICKEN);
    expect(CHICKEN.presets[CHICKEN.base]).toBeDefined();
  });
});
