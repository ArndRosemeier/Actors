import { describe, expect, it } from "vitest";
import { DEER, DOG, SPECIES } from "./animal";
import { DEER_DEFAULT_SHAPE, DEER_PRESETS, DEER_SHAPE_RANGES, deerParams, deerShapeOptions, deerTargetWeights, mixDeerParams, sanitizeDeerShape } from "./deer";

describe("deer parameters", () => {
  it("every preset stays inside the slider ranges", () => {
    for (const [id, p] of Object.entries(DEER_PRESETS)) {
      for (const [k, v] of Object.entries(p.shape)) {
        const [lo, hi] = DEER_SHAPE_RANGES[k as keyof typeof DEER_SHAPE_RANGES];
        expect(v, `${id}.${k}`).toBeGreaterThanOrEqual(lo);
        expect(v, `${id}.${k}`).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("the default shape (the sika hind) needs no morphs and no bone changes", () => {
    expect(deerTargetWeights(DEER_DEFAULT_SHAPE).size).toBe(0);
    const o = deerShapeOptions(DEER_DEFAULT_SHAPE);
    expect(o.scale).toBe(1);
    for (const s of Object.values(o.bones ?? {})) {
      expect(s.len ?? 1).toBeCloseTo(1);
      expect(s.girth ?? 1).toBeCloseTo(1);
    }
  });

  it("maps shape values to morphs and the deer rig's bones", () => {
    const w = deerTargetWeights({ ...DEER_DEFAULT_SHAPE, bulk: 1.11, neckThick: 0.5, muzzle: 0.3 });
    expect(w.get("bulk")).toBeCloseTo(0.5);
    expect(w.get("neck-thick")).toBeCloseTo(0.5);
    expect(w.get("muzzle-long")).toBeCloseTo(0.3);
    const o = deerShapeOptions({ ...DEER_DEFAULT_SHAPE, legs: 1.2, tail: 0.5, size: 1.4 }, ["FrontLowerLeg.L", "Tail2"]);
    expect(o.scale).toBeCloseTo(1.4);
    expect(o.bones!["FrontLowerLeg.L"].len!).toBeGreaterThan(1.2);
    expect(o.bones!.Tail2.len).toBeCloseTo(0.5);
    // Bones the pack doesn't have are left out.
    expect(o.bones!["FrontLowerLeg.R"]).toBeUndefined();
  });

  it("clamps shapes, fills coats and mixes presets", () => {
    expect(sanitizeDeerShape({ legs: 9 }).legs).toBe(DEER_SHAPE_RANGES.legs[1]);
    const sika = deerParams("sika"), red = deerParams("red");
    expect(sika.coat.dapple).toBe(1);
    expect(red.coat.dapple).toBe(0);
    // Dog markings are present (as 0), so the coat works as a fur-material coat.
    expect(sika.coat.saddle).toBe(0);
    const m = mixDeerParams(sika, red, 0.5);
    expect(m.shape.size).toBeCloseTo((sika.shape.size + red.shape.size) / 2);
    expect(m.coat.base[1]).toBeCloseTo((sika.coat.base[1] + red.coat.base[1]) / 2);
  });

  it("is registered as a species next to the dog", () => {
    expect(SPECIES.deer).toBe(DEER);
    expect(SPECIES.dog).toBe(DOG);
    expect(DEER.presets[DEER.base]).toBeDefined();
    expect(DOG.presets[DOG.base]).toBeDefined();
  });
});
