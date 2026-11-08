import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { GOLDEN_AGE_OUTFITS } from "../../../packages/generator/src/golden-age-outfits";
import { GARMENT_THEMES } from "../../../packages/generator/src/themes";
import { GOLDEN_CUT, GOLDEN_GENERATED, featherPng, furPng, linear } from "./golden-age";

describe("golden age garments", () => {
  const names = [...GOLDEN_CUT.map((g) => g.name), ...GOLDEN_GENERATED.map((g) => g.name)];

  it("have unique ga- names, body layers and a vintage theme tag", () => {
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) {
      expect(n).toMatch(/^ga-[a-z0-9-]+$/);
      expect(GARMENT_THEMES[n], n).toContain("vintage");
    }
    for (const g of [...GOLDEN_CUT, ...GOLDEN_GENERATED]) expect(g.occupies.length).toBeGreaterThan(0);
  });

  it("only uses vintage-tagged or untagged garments in its presets", () => {
    for (const o of GOLDEN_AGE_OUTFITS) {
      expect(o.label.startsWith("Golden age · ")).toBe(true);
      for (const g of [...o.garments, ...(o.female ?? [])]) {
        const themes = GARMENT_THEMES[g];
        expect(!themes || themes.includes("vintage"), `${o.id}: ${g}`).toBe(true);
      }
    }
  });

  it("converts picked sRGB colours to linear", () => {
    expect(linear("#ffffff")).toEqual([1, 1, 1]);
    expect(linear("#808080")[0]).toBeCloseTo(0.216, 3);
  });

  it("draws feather and fur textures with cut-outs", () => {
    for (const buf of [featherPng(), furPng()]) {
      const png = PNG.sync.read(buf);
      let clear = 0, solid = 0;
      for (let i = 3; i < png.data.length; i += 4) png.data[i] < 128 ? clear++ : solid++;
      expect(clear).toBeGreaterThan(0);
      expect(solid).toBeGreaterThan(0);
    }
  });
});
