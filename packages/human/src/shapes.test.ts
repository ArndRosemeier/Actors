import { describe, expect, it } from "vitest";
import { BODY_TYPES, SHAPE_SLIDERS, shapeModifiers } from "./shapes";

describe("shape sliders", () => {
  it("leaves the raw sliders alone at zero", () => {
    expect(shapeModifiers({}, { "a/b": 0.3 })).toEqual({ "a/b": 0.3 });
    expect(shapeModifiers({ waist: 0 }, {})).toEqual({});
  });

  it("adds weighted values on top of the raw sliders and clamps", () => {
    const waist = SHAPE_SLIDERS.find((s) => s.id === "waist")!;
    const [id, w] = Object.entries(waist.drives)[0];
    expect(shapeModifiers({ waist: 0.5 }, {})[id]).toBeCloseTo(w * 0.5);
    expect(shapeModifiers({ waist: 1 }, { [id]: Math.sign(w) })[id]).toBe(Math.sign(w));
    // Out-of-range slider values count as ±1.
    expect(shapeModifiers({ waist: 5 })[id]).toBeCloseTo(Math.max(-1, Math.min(1, w)));
  });

  it("only touches modifiers the pack has, with their lower bound", () => {
    const fat = SHAPE_SLIDERS.find((s) => s.id === "fat")!;
    const ids = Object.keys(fat.drives);
    const known = new Map([[ids[0], 0]]);
    const out = shapeModifiers({ fat: -1 }, {}, known);
    expect(Object.keys(out)).toEqual([ids[0]]);
    expect(out[ids[0]]).toBeGreaterThanOrEqual(0);
  });

  it("body types use only real shape sliders", () => {
    const ids = new Set(SHAPE_SLIDERS.map((s) => s.id));
    for (const t of BODY_TYPES) for (const k of Object.keys(t.shape)) expect(ids.has(k), `${t.id}.${k}`).toBe(true);
  });

  it("never drives genital or breast modifiers", () => {
    for (const s of SHAPE_SLIDERS) for (const id of Object.keys(s.drives)) expect(/genital|breast|penis|vagina/i.test(id), id).toBe(false);
  });
});
