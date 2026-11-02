import { describe, expect, it } from "vitest";
import { deform } from "@actors/core";
import { COW, DEER, DOG, deformCoat, deformRanges, deformShape, dogShapeOptions } from "./index";

const giant = deform({ recipe: "giant", seed: 4, strength: 1 });
const none = deform({ recipe: "giant", seed: 4, strength: 0 });

describe("deform on the generated animals", () => {
  it("leaves a shape alone at strength 0 and keeps its size always", () => {
    const { shape } = DEER.params("red");
    expect(deformShape(shape, none)).toBe(shape);
    expect(deformShape(shape, null)).toBe(shape);
    expect(deformShape(shape, giant).size).toBe(shape.size);
  });

  it("thickens the legs and neck of a deer, a wolf and a cow, within each species' ranges", () => {
    for (const [species, kind, id] of [[DEER, "deer", "red"], [DOG, "dog", "wolf"], [COW, "cow", "braunvieh"]] as const) {
      const { shape } = species.params(id) as unknown as { shape: Record<string, number> };
      const big = deformShape(shape, giant, deformRanges(kind)) as Record<string, number>;
      expect(big.bone, kind).toBeGreaterThan(shape.bone);
      expect(big.head, kind).toBeLessThan(shape.head);
      const r = deformRanges(kind)!;
      for (const key of Object.keys(big)) if (r[key]) {
        expect(big[key], `${kind}.${key}`).toBeGreaterThanOrEqual(r[key]![0]);
        expect(big[key], `${kind}.${key}`).toBeLessThanOrEqual(r[key]![1]);
      }
    }
    const { shape } = DEER.params("red");
    expect(deformShape(shape, giant).neckThick).toBeGreaterThan(shape.neckThick);
    expect(deformShape(shape, giant).neckThick).toBeLessThanOrEqual(1);
  });

  it("reaches the bone scales the pack builds from the shape", () => {
    const { shape } = DOG.params("wolf");
    const a = dogShapeOptions(shape).bones!["Front_Leg_Lower_L"]!;
    const b = dogShapeOptions(deformShape(shape, giant, deformRanges("dog"))).bones!["Front_Leg_Lower_L"]!;
    expect(b.girth).toBeGreaterThan(a.girth!);
  });

  it("ages the coat: greyer, darker, a greyer face and frost; and leaves it at strength 0", () => {
    const { coat } = DEER.params("red");
    expect(deformCoat(coat, none)).toBe(coat);
    const old = deformCoat(coat, giant);
    expect(old.base[0] + old.base[1] + old.base[2]).toBeLessThan(coat.base[0] + coat.base[1] + coat.base[2]);
    expect(old.headTone).toBeGreaterThanOrEqual(coat.headTone);
    expect((old as { frost?: number }).frost).toBeGreaterThan(0);
    for (const c of [old.base, old.second, old.tan]) for (const v of c) expect(v >= 0 && v <= 1).toBe(true);
  });
});
