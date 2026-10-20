import { describe, expect, it } from "vitest";
import { ADULT_MIN_AGE, DEFAULT_PARAMS, ageYearsToValue, sanitizeParams } from "./params";
import { macroTargetWeights, macroTokenWeights } from "./macro";
import { modifierTargetWeights } from "./modifiers";

describe("age", () => {
  it("never goes below the adult minimum", () => {
    expect(sanitizeParams({ ...DEFAULT_PARAMS, ageYears: 5 }).ageYears).toBe(ADULT_MIN_AGE);
    expect(ageYearsToValue(1)).toBe(ageYearsToValue(ADULT_MIN_AGE));
    expect(ageYearsToValue(25)).toBeCloseTo(0.5);
    expect(ageYearsToValue(90)).toBeCloseTo(1);
  });

  it("gives baby targets zero weight for every age", () => {
    for (let y = 0; y <= 100; y += 5) expect(macroTokenWeights({ ...DEFAULT_PARAMS, ageYears: y }).baby).toBe(0);
  });
});

describe("macro weights", () => {
  it("splits each axis into weights that sum to 1", () => {
    const w = macroTokenWeights({ ...DEFAULT_PARAMS, gender: 0.3, muscle: 0.8, ageYears: 40 });
    expect(w.female + w.male).toBeCloseTo(1);
    expect(w.minmuscle + w.averagemuscle + w.maxmuscle).toBeCloseTo(1);
    expect(w.child + w.young + w.old).toBeCloseTo(1);
    expect(w.african + w.asian + w.caucasian).toBeCloseTo(1);
  });

  it("uses no height target at average height", () => {
    const w = macroTokenWeights(DEFAULT_PARAMS);
    expect(w.minheight).toBe(0);
    expect(w.maxheight).toBe(0);
  });

  it("multiplies token weights per target", () => {
    const defs = [{ name: "t", tokens: ["female", "young", "averagemuscle", "averageweight"] }];
    const m = macroTargetWeights(defs, { ...DEFAULT_PARAMS, gender: 0 });
    expect(m.get("t")).toBeCloseTo(1);
  });
});

describe("modifiers", () => {
  it("maps negative and positive values onto their targets", () => {
    const defs = [{ id: "nose/w", group: "nose", label: "w", negative: ["a"], positive: ["b", "c"] }];
    expect([...modifierTargetWeights(defs, { "nose/w": -0.4 })]).toEqual([["a", 0.4]]);
    expect([...modifierTargetWeights(defs, { "nose/w": 0.5 })]).toEqual([["b", 0.5], ["c", 0.5]]);
  });
});

import { BLINK, EXPRESSIONS, expressionTargetWeights } from "./expressions";
import { DEFAULT_PARAMS as P } from "./params";

describe("expressions", () => {
  it("splits each face unit across the ethnic variants by the body's mix", () => {
    const w = expressionTargetWeights({ "mouth-open": 1 }, { ...P, african: 1, asian: 0, caucasian: 3 });
    expect(w.get("expression/african/mouth-open")).toBeCloseTo(0.25);
    expect(w.get("expression/caucasian/mouth-open")).toBeCloseTo(0.75);
    expect(w.has("expression/asian/mouth-open")).toBe(false);
  });
  it("defines blink and the presets on both sides", () => {
    expect(Object.keys(BLINK)).toEqual(["eye-left-closure", "eye-right-closure"]);
    expect(Object.keys(EXPRESSIONS)).toContain("smile");
  });
});
