import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { NAVY_OUTFITS } from "../../../packages/generator/src/navy-outfits";
import { GARMENT_THEMES } from "../../../packages/generator/src/themes";
import { NAVY_CUT, NAVY_GENERATED, stripesPng, tricolourPng } from "./navy";

describe("navy garments", () => {
  const all = [...NAVY_CUT, ...NAVY_GENERATED];
  const names = all.map((g) => g.name);

  it("have unique navy- names, body layers and the age-of-sail theme", () => {
    expect(new Set(names).size).toBe(names.length);
    for (const g of all) {
      expect(g.name).toMatch(/^navy-[a-z0-9-]+$/);
      expect(g.occupies.length, g.name).toBeGreaterThan(0);
      expect(GARMENT_THEMES[g.name], g.name).toContain("age-of-sail");
    }
  });

  it("keep a coat's facings and trimmings on their own layers, over the coat", () => {
    const layer = (n: string) => all.find((g) => g.name === n)!.layer;
    for (const n of ["navy-lapels", "navy-collar", "navy-cuffs", "navy-crossbelts"]) expect(layer(n), n).toBeGreaterThan(layer("navy-tailcoat"));
    const occupies = (n: string) => all.find((g) => g.name === n)!.occupies;
    for (const n of ["navy-lapels", "navy-collar", "navy-cuffs"]) expect(occupies(n)).not.toContain("coat");
  });

  it("dress every preset in age-of-sail or untagged garments, from both navies", () => {
    for (const o of NAVY_OUTFITS) {
      expect(o.label.startsWith("Navy · ")).toBe(true);
      expect(new Set(o.garments).size, o.id).toBe(o.garments.length);
      for (const g of o.garments) {
        const themes = GARMENT_THEMES[g];
        expect(!themes || themes.includes("age-of-sail"), `${o.id}: ${g}`).toBe(true);
      }
      // No preset puts two garments on one body layer.
      const layers = o.garments.flatMap((g) => all.find((x) => x.name === g)?.occupies ?? []);
      expect(new Set(layers).size, o.id).toBe(layers.length);
    }
    for (const navy of ["rn", "fr"]) for (const role of ["captain", "seaman", "marine", "hand", "boatswain"]) expect(NAVY_OUTFITS.some((o) => o.id === `navy-${navy}-${role}`), `${navy} ${role}`).toBe(true);
  });

  it("draws the stripe and cockade prints opaque", () => {
    for (const buf of [stripesPng(), tricolourPng()]) {
      const png = PNG.sync.read(buf);
      for (let i = 3; i < png.data.length; i += 4) expect(png.data[i]).toBe(255);
    }
  });
});
