import { describe, expect, it } from "vitest";
import { BODY_PARTS, GIANT_SCALE, MAX_GROWTH, changesBody, classifyBones, deform, deformBones, deformShapeOptions, noDeform, partOfBone } from "./deformRecipe";
import { hasShapeOptions } from "./deform";

describe("deform recipes", () => {
  it("changes nothing at strength 0", () => {
    const p = deform({ recipe: "giant", seed: 3, strength: 0 });
    expect(changesBody(p)).toBe(false);
    expect(p.scale).toBe(1);
    expect(p.gait).toEqual({ rate: 1, heft: 0 });
    for (const part of BODY_PARTS) expect(p.parts[part]).toEqual({ len: 1, girth: 1 });
    expect(p.skin.tint).toEqual([1, 1, 1]);
    expect(p.skin.age).toBe(0);
    expect(deformBones(p, ["Front_Leg_Upper_L"])).toEqual({});
    expect(hasShapeOptions(deformShapeOptions(p, ["Front_Leg_Upper_L"]))).toBe(false);
    expect(noDeform().scale).toBe(1);
  });

  it("gives the same body for the same seed and strength, another for another seed", () => {
    const a = deform({ recipe: "giant", seed: 11, strength: 0.7 });
    const b = deform({ recipe: "giant", seed: 11, strength: 0.7 });
    const c = deform({ recipe: "giant", seed: 12, strength: 0.7 });
    expect(a).toEqual(b);
    expect(a.parts.leg).not.toEqual(c.parts.leg);
    // Seeds that are only a hash apart still differ, and fractions are kept apart.
    expect(deform({ recipe: "giant", seed: 0, strength: 1 }).parts.neck).not.toEqual(deform({ recipe: "giant", seed: 1, strength: 1 }).parts.neck);
  });

  it("grows square-cube: thicker legs and neck, a head that lags, slower heavier steps", () => {
    for (let seed = 0; seed < 40; seed++) {
      const p = deform({ recipe: "giant", seed, strength: 1 });
      expect(p.scale).toBeCloseTo(GIANT_SCALE, 6);
      expect(p.parts.leg.girth).toBeGreaterThan(1.15);
      expect(p.parts.neck.girth).toBeGreaterThan(1.1);
      expect(p.parts.jaw.girth).toBeGreaterThan(1.05);
      expect(p.parts.head.len).toBeLessThan(1);
      expect(p.parts.leg.len).toBeLessThan(1.01);
      expect(p.gait.rate).toBeCloseTo(1 / Math.sqrt(GIANT_SCALE), 6);
      expect(p.gait.heft).toBe(1);
      expect(p.skin.age).toBeGreaterThan(0.3);
      expect(p.skin.tint.every((v) => v > 0.8 && v <= 1)).toBe(true);
    }
  });

  it("grows with the strength", () => {
    const at = (s: number) => deform({ recipe: "giant", seed: 5, strength: s });
    expect(at(0.25).scale).toBeLessThan(at(0.5).scale);
    expect(at(0.5).scale).toBeLessThan(at(1).scale);
    expect(at(0.25).gait.rate).toBeGreaterThan(at(1).gait.rate);
    // Out of range or not a number is clamped.
    expect(deform({ recipe: "giant", seed: 1, strength: 5 }).scale).toBeCloseTo(GIANT_SCALE, 6);
    expect(changesBody(deform({ recipe: "giant", seed: 1, strength: Number.NaN }))).toBe(false);
  });

  it("grows to a size: a barn of an elk, thicker for its weight the bigger it is, the same seed the same body", () => {
    const at = (size: number) => deform({ recipe: "giant", seed: 9, strength: 1, size });
    expect(at(7).scale).toBe(7);
    expect(at(7)).toEqual(at(7));
    expect(at(7).gait.rate).toBeCloseTo(1 / Math.sqrt(7), 6);
    // Proportions follow the size, not twice as thick for twice as big, and stop growing at a point.
    expect(at(7).parts.leg.girth).toBeGreaterThan(at(GIANT_SCALE).parts.leg.girth);
    expect(at(14).parts.leg.girth).toBeGreaterThan(at(7).parts.leg.girth);
    expect(at(14).parts.leg.girth).toBeLessThan(2 * at(7).parts.leg.girth);
    expect(at(MAX_GROWTH).parts.neck.girth).toBeLessThan(2.2);
    expect(at(7).parts.head.len).toBeGreaterThan(0.6);
    // A size at the old maximum is the old giant; sizes are clamped; no size is what the strength gives.
    expect(at(GIANT_SCALE).parts.leg.girth).toBeCloseTo(deform({ recipe: "giant", seed: 9, strength: 1 }).parts.leg.girth, 6);
    expect(at(1000).scale).toBe(MAX_GROWTH);
    expect(deform({ recipe: "giant", seed: 9, strength: 1, size: Number.NaN }).scale).toBeCloseTo(GIANT_SCALE, 6);
    // Strength 0 changes nothing, whatever the size.
    expect(changesBody(deform({ recipe: "giant", seed: 9, strength: 0, size: 7 }))).toBe(false);
  });

  it("finds the part of a bone by its name, on the animals', the people's and the library's rigs", () => {
    const parts: Record<string, string> = {
      Front_Leg_Upper_L: "leg", Back_Leg_Lower_R: "leg", Front_Leg_Foot_L: "foot", Back_Leg_Tip_R: "foot", Spine_3: "spine", Head: "head", Nose: "head", Chin: "jaw",
      Ear_L: "ear", Tail_Mid: "tail", Antler_R: "horn", Armature: "other",
      "upperleg01.L": "leg", "lowerleg02.R": "leg", "foot.L": "foot", "toe1-1.L": "foot", "upperarm01.R": "arm", "lowerarm01.L": "arm", "hand.L": "hand", "finger3-2.R": "hand", "neck02": "neck", "spine03": "spine", "clavicle.L": "arm",
      Thigh_L: "leg", Calf_R: "leg", Hoof_L: "foot", Neck_01: "neck", Jaw: "jaw", Hips: "spine", root: "spine",
    };
    for (const [name, part] of Object.entries(parts)) expect(partOfBone(name), name).toBe(part);
  });

  it("lets a bone with no telling name follow its parent's limb, but not the spine's", () => {
    const names = ["Hips", "Spine", "B1", "Thigh", "B2", "B3"];
    const parents = [-1, 0, 1, 1, 3, 4];
    expect(classifyBones(names, parents)).toEqual(["spine", "spine", "other", "leg", "leg", "leg"]);
  });

  it("makes bone scales and shape options for a skeleton", () => {
    const names = ["Hips", "Thigh_L", "Calf_L", "Hoof_L", "Head", "Tail_Base", "Nothing"];
    const p = deform({ recipe: "giant", seed: 2, strength: 1 });
    const bones = deformBones(p, names);
    expect(bones.Thigh_L!.girth).toBeCloseTo(p.parts.leg.girth, 9);
    expect(bones.Hoof_L!.len).toBeCloseTo(p.parts.foot.len, 9);
    expect(bones.Nothing).toBeUndefined();
    const o = deformShapeOptions(p, names);
    expect(o.scale).toBeCloseTo(GIANT_SCALE, 6);
    expect(hasShapeOptions(o)).toBe(true);
  });
});

import { mergeDeform } from "./deformRecipe";
describe("laying a plan over a race's proportions", () => {
  it("multiplies bones and scale, and returns the base itself when nothing changes", () => {
    const base = { bones: { Thigh_L: { len: 1.1, girth: 0.9 } }, scale: 1.2 };
    expect(mergeDeform(base, deform({ recipe: "giant", seed: 1, strength: 0 }), ["Thigh_L"])).toBe(base);
    expect(mergeDeform(base, null, ["Thigh_L"])).toBe(base);
    const p = deform({ recipe: "giant", seed: 1, strength: 1 });
    const o = mergeDeform(base, p, ["Thigh_L", "Head"]);
    expect(o.bones!.Thigh_L!.len).toBeCloseTo(1.1 * p.parts.leg.len, 9);
    expect(o.bones!.Thigh_L!.girth).toBeCloseTo(0.9 * p.parts.leg.girth, 9);
    expect(o.bones!.Head!.len).toBeCloseTo(p.parts.head.len, 9);
    expect(o.scale).toBeCloseTo(1.2 * p.scale, 9);
    expect(base.bones.Thigh_L.len).toBe(1.1);
  });
});
