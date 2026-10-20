import { describe, expect, it } from "vitest";
import { ADULT_MIN_AGE } from "@actors/human";
import { type CharacterCatalog, OUTFITS, defaultConfig, outfitGarments, randomConfig, seededRandom } from "./catalog";

const catalog: CharacterCatalog = {
  animations: [{ id: "idle", label: "Idle", category: "Idle", loop: true, library: "" }, { id: "walk", label: "Walk", category: "Locomotion", loop: true, library: "" }],
  libraries: [{ id: "", label: "Animations" }],
  garments: ["briefs", "bra", "tshirt", "jeans", "socks", "skirt", "skirt-mini"].map((id) => ({ id, label: id, coversAnatomy: id === "briefs", slot: id.startsWith("skirt") ? "skirt" : undefined })),
  outfits: OUTFITS.filter((o) => !o.garments.includes("shorts") && !o.garments.includes("longsleeve")),
  hair: [{ id: "hair-short02", label: "Short" }, { id: "hair-long01", label: "Long" }],
  hairColors: [{ id: "#1b1512", label: "Black" }],
  brows: [{ id: "brows-eyebrow001", label: "1" }],
  eyes: [{ id: "brown", label: "Brown" }, { id: "blue", label: "Blue" }],
  expressions: [{ id: "neutral", label: "Neutral" }],
  details: [{ id: "nose", label: "Nose", group: "nose", min: -1, max: 1 }],
  photoSkin: true,
};

describe("outfits", () => {
  it("has a nude preset and adds female-only items by gender", () => {
    const nude = OUTFITS.find((o) => o.id === "nude")!;
    expect(outfitGarments(nude, { gender: 0 })).toEqual([]);
    const casual = OUTFITS.find((o) => o.id === "casual")!;
    expect(outfitGarments(casual, { gender: 0 })).toContain("bra");
    expect(outfitGarments(casual, { gender: 1 })).not.toContain("bra");
  });
});

describe("randomConfig", () => {
  const base = defaultConfig(catalog);

  it("is reproducible with a seed and only makes adults", () => {
    const a = randomConfig(catalog, base, { random: seededRandom(7) });
    const b = randomConfig(catalog, base, { random: seededRandom(7) });
    expect(a).toEqual(b);
    for (let s = 0; s < 200; s++) expect(randomConfig(catalog, base, { random: seededRandom(s) }).body.ageYears).toBeGreaterThanOrEqual(ADULT_MIN_AGE);
  });

  it("respects the gender option and keeps the outfit when asked", () => {
    const keep = { ...base, outfit: ["jeans"] };
    for (let s = 0; s < 50; s++) {
      const m = randomConfig(catalog, keep, { random: seededRandom(s), gender: "male", outfit: false });
      expect(m.body.gender).toBeGreaterThan(0.8);
      expect(m.outfit).toEqual(["jeans"]);
      expect(m.hair === null || m.hair === "hair-short02").toBe(true);
    }
    const f = randomConfig(catalog, base, { random: seededRandom(1), gender: "female" });
    expect(f.body.gender).toBeLessThan(0.2);
    expect(catalog.outfits.some((o) => JSON.stringify(outfitGarments(o, f.body)) === JSON.stringify(f.outfit))).toBe(true);
  });
});
