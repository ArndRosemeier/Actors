import { describe, expect, it } from "vitest";
import { RACE_IDS } from "@actors/human";
import { type CharacterCatalog, type CharacterConfig, defaultConfig, fitConfig, raceFeatures, randomConfig, seededRandom } from "./catalog";
import { ALLOW_PRESETS, allowCatalog, flagOn, heightFit } from "./allow";
import { GARMENT_THEMES } from "./themes";

const ids = ["briefs", "bra", "tshirt", "jeans", "med-tunic", "med-hose", "future-wrap", "future-trousers", "wizard-robe"];
const catalog = {
  races: RACE_IDS.map((id) => ({ id, label: id, description: "" })),
  animations: [],
  libraries: [],
  garments: ids.map((id) => ({ id, label: id, category: "Clothes", occupies: [], coversAnatomy: false, ...(GARMENT_THEMES[id] ? { themes: GARMENT_THEMES[id] } : {}) })),
  outfits: [
    { id: "casual", label: "Casual", garments: ["briefs", "tshirt", "jeans"], female: ["bra"] },
    { id: "future", label: "Future", garments: ["briefs", "future-wrap", "future-trousers"] },
    { id: "nude", label: "Nude", garments: [] },
  ],
  hair: [],
  hairColors: [],
  garmentColors: [],
  brows: [],
  eyes: [{ id: "brown", label: "Brown" }],
  expressions: [],
  details: [],
  photoSkin: false,
  robot: { heads: [], ears: [], plating: [], finishes: [], palettes: [] },
  skeletal: { palettes: [] },
} as unknown as CharacterCatalog;

describe("flags", () => {
  it("read a list as only these, and flags as all but the ones switched off", () => {
    expect(flagOn<string>(undefined, "elf")).toBe(true);
    expect(flagOn<string>(["human"], "elf")).toBe(false);
    expect(flagOn<string>(["human"], "human")).toBe(true);
    expect(flagOn<string>({ elf: false }, "elf")).toBe(false);
    expect(flagOn<string>({ elf: false }, "orc")).toBe(true);
  });
});

describe("allowCatalog", () => {
  it("keeps humans in today's clothes for city life", () => {
    const c = allowCatalog(catalog, ALLOW_PRESETS.city);
    expect(c.races.map((r) => r.id)).toEqual(["human"]);
    expect(c.garments.map((g) => g.id)).toEqual(["briefs", "bra", "tshirt", "jeans"]);
    expect(c.outfits.map((o) => o.id)).toEqual(["casual", "nude"]);
    expect(c.robot).toBeUndefined();
    expect(c.skeletal).toBeUndefined();
    expect(c.height).toEqual({ min: 1.45, max: 2.05 });
  });

  it("keeps humans, robots and the 3026 wardrobe for science fiction", () => {
    const c = allowCatalog(catalog, ALLOW_PRESETS.scifi);
    expect(c.robot).toBeDefined();
    expect(c.garments.map((g) => g.id)).toContain("future-wrap");
    expect(c.garments.map((g) => g.id)).not.toContain("med-tunic");
  });

  it("makes only robots when no race is allowed", () => {
    const c = allowCatalog(catalog, { races: ["robot"] });
    expect(c.people).toBe(false);
    expect(c.races.map((r) => r.id)).toEqual(["human"]);
    expect(defaultConfig(c).robot).toBe(true);
    const r = randomConfig(c, defaultConfig(c), { random: seededRandom(3) });
    expect(r.robot).toBe(true);
  });

  it("narrows an earlier height range", () => {
    const c = allowCatalog(allowCatalog(catalog, { height: { min: 1.5, max: 2.2 } }), { height: { max: 2 } });
    expect(c.height).toEqual({ min: 1.5, max: 2 });
  });
});

describe("fitConfig", () => {
  it("swaps a race and kinds the catalog doesn't offer", () => {
    const c = allowCatalog(catalog, { races: ["elf", "dwarf"] });
    const cfg = fitConfig(c, { ...defaultConfig(catalog), race: "orc", race2: "human", raceMix: 0.5, robot: true } as CharacterConfig);
    expect(cfg.race).toBe("elf");
    expect(cfg.race2).toBeNull();
    expect(cfg.robot).toBe(false);
  });

  it("random characters keep to the allowed races", () => {
    const c = allowCatalog(catalog, { races: ["elf", "dwarf"] });
    for (let i = 0; i < 20; i++) expect(["elf", "dwarf"]).toContain(randomConfig(c, defaultConfig(c), { random: seededRandom(i), race: "any" }).race);
  });
});

describe("heightFit", () => {
  it("scales a body to the nearest limit and leaves one inside alone", () => {
    expect(heightFit(1.8, { min: 1.5, max: 2 })).toBe(1);
    expect(heightFit(3, { max: 2 })).toBeCloseTo(2 / 3, 6);
    expect(heightFit(1, { min: 1.5 })).toBeCloseTo(1.5, 6);
    expect(heightFit(1.8, undefined)).toBe(1);
  });
});

describe("race features", () => {
  const all = { horns: ["none", "ram", "antler"] as const, tails: ["none", "reptile"] as const, pupils: ["round", "slit"] as const, patterns: ["none", "freckles", "scales"] as const };
  it("offers every feature with every race", () => {
    const f = raceFeatures(catalog.races, all);
    expect(f.horns).toEqual(["none", "ram", "antler"]);
    expect(f.tusks && f.eyeGlow).toBe(true);
  });
  it("offers humans no horns, tails, tusks, glowing eyes or scales", () => {
    const f = raceFeatures(allowCatalog(catalog, { races: ["human"] }).races, all);
    expect(f).toEqual({ horns: ["none"], tails: ["none"], pupils: ["round"], patterns: ["none", "freckles"], tusks: false, eyeGlow: false, size: false });
  });
  it("takes them off a human-only character", () => {
    const c = allowCatalog(catalog, { races: ["human"] });
    const cfg = fitConfig(c, { ...defaultConfig(catalog), race: "drakeborn", horns: "ram", tail: "reptile", tusks: 0.6, eyeGlow: 0.5, pupil: "slit", skinPattern: "scales" } as CharacterConfig);
    expect([cfg.race, cfg.horns, cfg.tail, cfg.tusks, cfg.eyeGlow, cfg.pupil, cfg.skinPattern]).toEqual(["human", "none", "none", 0, 0, "round", "none"]);
    const free = fitConfig(catalog, { ...defaultConfig(catalog), horns: "ram", tail: "reptile" } as CharacterConfig);
    expect([free.horns, free.tail]).toEqual(["ram", "reptile"]);
  });
});
