import { describe, expect, it } from "vitest";
import { SHAPE_TARGETS, dogShapeOptions, dogTargetWeights } from "./animal";
import { BREEDS, CAT_BREEDS, DEFAULT_SHAPE, SHAPE_RANGES, breedParams, mixParams, presetsFor, sanitizeShape } from "./breeds";

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

describe("cat presets", () => {
  it("are found by species and don't share ids with the dog breeds", () => {
    expect(presetsFor("cat")).toBe(CAT_BREEDS);
    expect(presetsFor("dog")).toBe(BREEDS);
    for (const id of Object.keys(CAT_BREEDS)) expect(BREEDS[id], id).toBeUndefined();
    const p = breedParams("mainecoon");
    expect(p.coat.tabby).toBeGreaterThan(0);
    expect(p.coat.pupil).toBeGreaterThan(0);
    expect(p.shape).toEqual(DEFAULT_SHAPE);
  });

  it("names the morph targets each shape value drives", () => {
    // Every morph-driven value names targets; dogTargetWeights only emits those names.
    const all = new Set(Object.values(SHAPE_TARGETS).flat());
    const w = dogTargetWeights({ ...DEFAULT_SHAPE, earDrop: 0.7, earFold: 0.4, muzzle: 0.5, muzzleBroad: 1, muzzleDeep: 1, stop: 1, skullDome: 1, chestDeep: 1, bellyTuck: 1, tailCurl: 0.7, bulk: 1.2 });
    for (const name of w.keys()) expect(all.has(name), name).toBe(true);
  });
});
