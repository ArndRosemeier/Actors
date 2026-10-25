import { describe, expect, it } from "vitest";
import { HORSE, SPECIES } from "./animal";
import { HORSE_DEFAULT_SHAPE, HORSE_PRESETS, HORSE_SHAPE_RANGES, horseParams, horseShapeOptions, horseTargetWeights, sanitizeHorseShape } from "./horse";

describe("horse parameters", () => {
  it("every preset stays inside the slider ranges", () => {
    for (const [id, p] of Object.entries(HORSE_PRESETS)) {
      for (const [k, v] of Object.entries(p.shape)) {
        const [lo, hi] = HORSE_SHAPE_RANGES[k as keyof typeof HORSE_SHAPE_RANGES];
        expect(v, `${id}.${k}`).toBeGreaterThanOrEqual(lo);
        expect(v, `${id}.${k}`).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("the default shape (the bay) needs no morphs and no bone changes", () => {
    expect(horseTargetWeights(HORSE_DEFAULT_SHAPE).size).toBe(0);
    const o = horseShapeOptions(HORSE_DEFAULT_SHAPE);
    expect(o.scale).toBe(1);
    for (const s of Object.values(o.bones ?? {})) {
      expect(s.len ?? 1).toBeCloseTo(1);
      expect(s.girth ?? 1).toBeCloseTo(1);
    }
  });

  it("maps shape values to morphs and the horse rig's bones", () => {
    const w = horseTargetWeights({ ...HORSE_DEFAULT_SHAPE, bulk: 1.1, neckThick: 0.5, dish: 1 });
    expect(w.get("bulk")).toBeCloseTo(0.5);
    expect(w.get("neck-thick")).toBeCloseTo(0.5);
    expect(w.get("dish")).toBeCloseTo(1);
    const o = horseShapeOptions({ ...HORSE_DEFAULT_SHAPE, legs: 1.1, tail: 0.6, size: 0.7 }, ["front_leg_lower_l", "tail_2"]);
    expect(o.scale).toBeCloseTo(0.7);
    expect(o.bones!.front_leg_lower_l.len!).toBeGreaterThan(1.1);
    expect(o.bones!.tail_2.len).toBeCloseTo(0.6);
    // Bones the pack doesn't have are left out.
    expect(o.bones!.front_leg_lower_r).toBeUndefined();
  });

  it("clamps shapes and fills coats", () => {
    expect(sanitizeHorseShape({ size: 0.2 }).size).toBe(HORSE_SHAPE_RANGES.size[0]);
    const bay = horseParams("bay"), grey = horseParams("grey");
    expect(bay.coat.maneTail).toBe(1);
    expect(grey.coat.dapples).toBeGreaterThan(0.5);
    // Dog markings are present (as 0), so the coat works as a fur-material coat.
    expect(bay.coat.saddle).toBe(0);
    expect(() => horseParams("unicorn")).toThrow();
  });

  it("is registered as a species", () => {
    expect(SPECIES.horse).toBe(HORSE);
    expect(HORSE.presets[HORSE.base]).toBeDefined();
  });
});
