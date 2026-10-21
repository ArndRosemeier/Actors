import { describe, expect, it } from "vitest";
import { dogShapeOptions, dogTargetWeights } from "./animal";
import { BREEDS, DEFAULT_PRESET, DEFAULT_SHAPE, PRESETS, SHAPE_RANGES, SQUIRRELS, breedParams, mixParams, sanitizeShape } from "./breeds";

describe("dog parameters", () => {
  it("every breed preset stays inside the slider ranges", () => {
    for (const [id, b] of Object.entries(BREEDS)) {
      for (const [k, v] of Object.entries(b.shape)) {
        const [lo, hi] = SHAPE_RANGES[k as keyof typeof SHAPE_RANGES];
        expect(v, `${id}.${k}`).toBeGreaterThanOrEqual(lo);
        expect(v, `${id}.${k}`).toBeLessThanOrEqual(hi);
      }
      for (const c of [b.coat.base, b.coat.second, b.coat.tan, b.coat.white]) if (c) for (const x of c) expect(x).toBeGreaterThanOrEqual(0);
    }
  });

  it("the default shape needs no morphs and no bone changes", () => {
    expect(dogTargetWeights(DEFAULT_SHAPE).size).toBe(0);
    const o = dogShapeOptions(DEFAULT_SHAPE);
    expect(o.scale).toBe(1);
    for (const s of Object.values(o.bones ?? {})) {
      expect(s.len).toBeCloseTo(1);
      expect(s.girth).toBeCloseTo(1);
    }
  });

  it("maps shape values to morphs and bone scales", () => {
    const w = dogTargetWeights({ ...DEFAULT_SHAPE, muzzle: -0.5, bulk: 0.9, chestDeep: 0.4 });
    expect(w.get("muzzle-short")).toBeCloseTo(0.5);
    expect(w.has("muzzle-long")).toBe(false);
    expect(w.get("bulk")).toBeCloseTo(-0.4);
    expect(w.get("chest-deep")).toBeCloseTo(0.4);
    const o = dogShapeOptions({ ...DEFAULT_SHAPE, legs: 0.5, tail: 0.5, size: 1.3 });
    expect(o.scale).toBeCloseTo(1.3);
    // Short legs: the forearm shrinks most, the upper arm keeps its length.
    expect(o.bones!.Front_Leg_Lower_L.len!).toBeLessThan(0.5);
    expect(o.bones!.Front_Leg_Upper_L.len).toBeCloseTo(1);
    expect(o.bones!.Tail_Mid.len).toBeCloseTo(0.5);
  });

  it("blends big rotations through their in-between target", () => {
    const weights = (t: number) => dogTargetWeights({ ...DEFAULT_SHAPE, earDrop: t });
    expect(weights(0.25).get("ears-drop-half")).toBeCloseTo(0.5);
    expect(weights(0.25).has("ears-drop")).toBe(false);
    expect(weights(0.5).get("ears-drop-half")).toBeCloseTo(1);
    expect(weights(0.75).get("ears-drop-half")).toBeCloseTo(0.5);
    expect(weights(0.75).get("ears-drop")).toBeCloseTo(0.5);
    expect(weights(1).has("ears-drop-half")).toBe(false);
    expect(weights(1).get("ears-drop")).toBeCloseTo(1);
  });

  it("clamps shapes and mixes breeds", () => {
    expect(sanitizeShape({ legs: 9, muzzle: -3 }).legs).toBe(SHAPE_RANGES.legs[1]);
    expect(sanitizeShape({ legs: Number.NaN }).legs).toBe(SHAPE_RANGES.legs[0]);
    const a = breedParams("dachshund"), b = breedParams("greyhound");
    const m = mixParams(a, b, 0.5);
    expect(m.shape.legs).toBeCloseTo((a.shape.legs + b.shape.legs) / 2);
    expect(m.coat.base[0]).toBeCloseTo((a.coat.base[0] + b.coat.base[0]) / 2);
  });
});

describe("squirrel parameters", () => {
  it("species presets stay inside the slider ranges and use squirrel morphs", () => {
    for (const [id, b] of Object.entries(SQUIRRELS)) {
      for (const [k, v] of Object.entries(b.shape)) {
        const [lo, hi] = SHAPE_RANGES[k as keyof typeof SHAPE_RANGES];
        expect(v, `${id}.${k}`).toBeGreaterThanOrEqual(lo);
        expect(v, `${id}.${k}`).toBeLessThanOrEqual(hi);
      }
    }
    expect(PRESETS.squirrel[DEFAULT_PRESET.squirrel]).toBeDefined();
    const red = breedParams("red", "squirrel");
    expect(red.coat.earTufts).toBe(1);
    const w = dogTargetWeights({ ...DEFAULT_SHAPE, tailPlume: 0.5, cheeks: 1 });
    expect(w.get("tail-plume")).toBeCloseTo(0.5);
    expect(w.get("cheeks")).toBeCloseTo(1);
    expect(() => breedParams("red")).toThrow();
  });
});
