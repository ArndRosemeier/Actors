import { describe, expect, it } from "vitest";
import { ADULT_MIN_AGE, RACE_IDS } from "@actors/human";
import { type CharacterCatalog, GARMENT_COLORS, OUTFITS, defaultConfig, outfitGarments, randomConfig, resolveOutfit, seededRandom } from "./catalog";

const IDS = ["briefs", "bra", "tshirt", "jeans", "socks", "skirt", "skirt-mini", "dress", "sneakers"];
const catalog: CharacterCatalog = {
  races: RACE_IDS.map((id) => ({ id, label: id, description: "" })),
  animations: [{ id: "idle", label: "Idle", category: "Idle", loop: true, library: "" }, { id: "walk", label: "Walk", category: "Locomotion", loop: true, library: "" }],
  libraries: [{ id: "", label: "Animations" }],
  garments: IDS.map((id) => ({
    id,
    label: id,
    coversAnatomy: id === "briefs",
    slot: id.startsWith("skirt") ? "skirt" : undefined,
    category: "Clothes",
    occupies: id.startsWith("skirt") || id === "jeans" ? ["bottom"] : id === "tshirt" ? ["top"] : id === "dress" ? ["top", "bottom"] : id === "sneakers" ? ["shoes"] : [],
    ...(id === "dress" || id.startsWith("skirt") ? { gender: "female" as const } : {}),
  })),
  outfits: OUTFITS.filter((o) => o.garments.every((g) => IDS.includes(g))),
  hair: [{ id: "hair-short02", label: "Short" }, { id: "hair-long01", label: "Long" }],
  hairColors: [{ id: "#1b1512", label: "Black" }],
  garmentColors: [{ id: "#1c1c1f", label: "Black" }, { id: "#b3262e", label: "Red" }],
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

describe("resolveOutfit", () => {
  it("lets a garment take off others on the same body layer or slot", () => {
    expect(resolveOutfit(catalog, ["briefs", "tshirt", "jeans", "dress"])).toEqual(["briefs", "dress"]);
    expect(resolveOutfit(catalog, ["dress", "tshirt"])).toEqual(["tshirt"]);
    expect(resolveOutfit(catalog, ["skirt", "skirt-mini", "sneakers", "nope", "sneakers"])).toEqual(["skirt-mini", "sneakers"]);
  });

  it("keeps every preset intact", () => {
    for (const o of catalog.outfits) for (const gender of [0, 1]) expect(resolveOutfit(catalog, outfitGarments(o, { gender }))).toEqual(outfitGarments(o, { gender }));
  });
});

describe("garment colours", () => {
  it("offers valid sRGB hex presets", () => {
    expect(GARMENT_COLORS.length).toBeGreaterThan(8);
    for (const c of GARMENT_COLORS) expect(c.id).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("random characters only use palette colours on worn garments", () => {
    const base = defaultConfig(catalog);
    for (let s = 0; s < 50; s++) {
      const c = randomConfig(catalog, base, { random: seededRandom(s) });
      for (const [id, col] of Object.entries(c.garmentColors)) {
        expect(c.outfit).toContain(id);
        expect(catalog.garmentColors.map((x) => x.id)).toContain(col);
      }
    }
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

describe("race looks", () => {
  const base = defaultConfig(catalog);

  it("rolls race members with race colours, patterns and eyes", () => {
    for (let s = 0; s < 30; s++) {
      const orc = randomConfig(catalog, base, { random: seededRandom(s), race: "orc" });
      expect(orc.race).toBe("orc");
      expect(orc.skinColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(orc.body.ageYears).toBeGreaterThanOrEqual(ADULT_MIN_AGE);
      const drake = randomConfig(catalog, base, { random: seededRandom(s), race: "drakeborn" });
      expect(drake.pupil).toBe("slit");
      expect(drake.skinPattern).toBe("scales");
      expect(drake.eyeGlow).toBeGreaterThan(0.1);
    }
  });

  it("keeps humans on the photo skin", () => {
    const h = randomConfig(catalog, base, { random: seededRandom(3), race: "human" });
    expect(h.skinColor).toBeNull();
    expect(h.skinPattern).toBe("none");
  });

  it("gives races their add-ons", () => {
    let dwarfBeards = 0;
    for (let s = 0; s < 30; s++) {
      const r = seededRandom(s);
      const drake = randomConfig(catalog, base, { random: r, race: "drakeborn" });
      expect(drake.horns).not.toBe("none");
      expect(drake.tail).toBe("reptile");
      expect(drake.hornColor).toMatch(/^#[0-9a-f]{6}$/);
      const orc = randomConfig(catalog, base, { random: r, race: "orc" });
      expect(orc.tusks).toBeGreaterThan(0.5);
      const dwarf = randomConfig(catalog, base, { random: r, race: "dwarf", gender: "male" });
      if (dwarf.beard !== "none") dwarfBeards++;
      const woman = randomConfig(catalog, base, { random: r, race: "human", gender: "female" });
      expect(woman.beard).toBe("none");
      expect(woman.horns).toBe("none");
      expect(woman.tail).toBe("none");
      expect(["leaves", "crest"]).not.toContain(woman.hair);
    }
    expect(dwarfBeards).toBeGreaterThan(25);
  });
});
