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
    for (const n of names) expect(all.has(n) && !GARMENTS.some((g) => g.name === n)).toBe(true);
  });

  it("gives every garment a body layer and a category", () => {
    for (const w of WARDROBE) {
      expect(w.occupies.length).toBeGreaterThan(0);
      expect(w.category).not.toBe("");
    }
  });

  it("only refers to existing garments in the outfit presets", () => {
    for (const o of OUTFITS) for (const g of [...o.garments, ...(o.female ?? [])]) expect(all.has(g), `${o.id}: ${g}`).toBe(true);
  });
});
