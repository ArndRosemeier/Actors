import { describe, expect, it } from "vitest";
import { HAIR_STYLE_MESHES } from "../../../packages/generator/src/racelook";
import { HAIRSTYLES } from "./hairstyles";

const SYSTEM_HAIR = ["hair-short02", "hair-short03", "hair-short04", "hair-bob01", "hair-bob02", "hair-long01", "hair-ponytail01", "hair-braid01", "hair-afro01"];

describe("hairstyles", () => {
  const names = HAIRSTYLES.map((h) => h.name);

  it("has unique, file-safe names and one entry per source asset", () => {
    expect(new Set([...names, ...SYSTEM_HAIR]).size).toBe(names.length + SYSTEM_HAIR.length);
    for (const n of names) expect(n).toMatch(/^hair-[a-z0-9-]+$/);
    const sources = HAIRSTYLES.map((h) => `${h.pack}/${h.id}`);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("credits an author for every style", () => {
    for (const h of HAIRSTYLES) expect(h.author, h.name).not.toBe("");
  });

  it("only maps race hairstyles to hair meshes that exist", () => {
    const all = new Set([...names, ...SYSTEM_HAIR, "leaves", "crest"]);
    for (const [style, meshes] of Object.entries(HAIR_STYLE_MESHES)) for (const m of meshes) if (m) expect(all.has(m), `${style}: ${m}`).toBe(true);
  });
});
