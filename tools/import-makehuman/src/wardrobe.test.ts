import { describe, expect, it } from "vitest";
import { OUTFITS } from "../../../packages/generator/src/catalog";
import { GARMENTS } from "./garments";
import { WARDROBE } from "./wardrobe";

describe("wardrobe", () => {
  const names = WARDROBE.map((w) => w.name);
  const all = new Set([...names, ...GARMENTS.map((g) => g.name), "tights", "socks", "skirt", "skirt-mini"]);

  it("has unique, file-safe names and one entry per source asset", () => {
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z0-9-]+$/);
    const sources = WARDROBE.map((w) => `${w.pack}/${w.id}`);
    expect(new Set(sources).size).toBe(sources.length);
    // The base skirts come from skirts01 too.
    for (const id of ["toigo_long_full_skirt", "frankyaye_mini_skirt_01"]) expect(WARDROBE.some((w) => w.id === id)).toBe(false);
    for (const n of names) expect(all.has(n) && !GARMENTS.some((g) => g.name === n)).toBe(true);
  });

  it("gives every garment a body layer and a category", () => {
    for (const w of WARDROBE) {
      expect(w.occupies.length).toBeGreaterThan(0);
      expect(w.category).not.toBe("");
    }
  });

  it("names the author of every CC-BY garment", () => {
    for (const w of WARDROBE) if (w.license === "CC-BY") expect(w.author, w.name).toBeTruthy();
  });

  it("only refers to existing garments in the outfit presets", () => {
    for (const o of OUTFITS) for (const g of [...o.garments, ...(o.female ?? [])]) expect(all.has(g), `${o.id}: ${g}`).toBe(true);
  });
});
