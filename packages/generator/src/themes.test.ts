import { describe, expect, it } from "vitest";
import { RACE_IDS } from "@actors/human";
import { type CharacterCatalog, OUTFITS } from "./catalog";
import { GARMENT_THEMES, HAIR_THEMES, THEMES, THEME_FLAGS, filterCatalog, fitsThemes } from "./themes";

const known = new Set([...THEMES, ...THEME_FLAGS].map((t) => t.id));

describe("theme tags", () => {
  it("use only known themes", () => {
    for (const tags of [...Object.values(GARMENT_THEMES), ...Object.values(HAIR_THEMES)]) for (const t of tags) expect(known.has(t)).toBe(true);
  });

  it("tag every garment the outfit presets use, but underwear and plain socks", () => {
    const timeless = new Set(["briefs", "bra", "socks", "panties", "underwear-top", "high-socks", "low-socks", "gloves-short", "gloves-medium", "tights"]);
    for (const o of OUTFITS) for (const g of [...o.garments, ...(o.female ?? [])]) if (!timeless.has(g)) expect(GARMENT_THEMES[g], g).toBeDefined();
  });

  it("fit when untagged, sharing a theme, or with no themes asked; never with a left-out flag", () => {
    expect(fitsThemes(undefined, { themes: ["medieval"] })).toBe(true);
    expect(fitsThemes(["modern"], { themes: ["medieval"] })).toBe(false);
    expect(fitsThemes(["modern", "medieval"], { themes: ["medieval"] })).toBe(true);
    expect(fitsThemes(["modern"], {})).toBe(true);
    expect(fitsThemes(["medieval", "real-faith"], { themes: ["medieval"], without: ["real-faith"] })).toBe(false);
    expect(fitsThemes(["medieval", "real-faith"], { themes: ["medieval"] })).toBe(true);
  });
});

describe("filterCatalog", () => {
  const ids = ["briefs", "bra", "tshirt", "jeans", "med-tunic", "med-hose", "medieval-boots", "knight-helmet", "future-wrap", "wizard-robe"];
  const catalog = {
    races: RACE_IDS.map((id) => ({ id, label: id, description: "", ...(id === "human" ? {} : { themes: ["fantasy"] }) })),
    garments: ids.map((id) => ({ id, label: id, category: "Clothes", occupies: [], coversAnatomy: false, ...(GARMENT_THEMES[id] ? { themes: GARMENT_THEMES[id] } : {}) })),
    outfits: [
      { id: "casual", label: "Casual", garments: ["briefs", "tshirt", "jeans"], female: ["bra"] },
      { id: "peasant", label: "Peasant", garments: ["briefs", "med-tunic", "med-hose", "medieval-boots"], female: ["bra"] },
      { id: "nude", label: "Nude", garments: [] },
    ],
    hair: [{ id: "hair-short02", label: "Short" }, { id: "hair-80s", label: "80s", themes: HAIR_THEMES["hair-80s"] }, { id: "leaves", label: "Leaves", themes: HAIR_THEMES.leaves }],
    robot: { heads: [], ears: [], plating: [], finishes: [], palettes: [] },
    skeletal: { palettes: [] },
  } as unknown as CharacterCatalog;

  it("keeps what fits a medieval fantasy game and drops the rest", () => {
    const c = filterCatalog(catalog, { themes: ["medieval", "fantasy"], without: ["real-faith"] });
    expect(c.garments.map((g) => g.id)).toEqual(["briefs", "bra", "med-tunic", "med-hose", "medieval-boots", "wizard-robe"]);
    expect(c.outfits.map((o) => o.id)).toEqual(["peasant", "nude"]);
    expect(c.hair.map((h) => h.id)).toEqual(["hair-short02", "leaves"]);
    expect(c.races.length).toBe(RACE_IDS.length);
    expect(c.robot).toBeUndefined();
    expect(c.skeletal).toBeDefined();
  });

  it("keeps humans only, and robots, for a modern and future game", () => {
    const c = filterCatalog(catalog, { themes: ["modern", "future"] });
    expect(c.races.map((r) => r.id)).toEqual(["human"]);
    expect(c.garments.map((g) => g.id)).toEqual(["briefs", "bra", "tshirt", "jeans", "future-wrap"]);
    expect(c.robot).toBeDefined();
    expect(c.skeletal).toBeUndefined();
  });
});
