/**
 * Reference results of @actors/generator for the Rust port's golden test
 * (rust/crates/actors-generator/tests/golden.rs): the catalog of the human pack, the default
 * config, seeded random configs, theme and allow filters, outfit rules.
 *
 *   npx tsx rust/golden/dump-generator.ts <packs dir> <out dir>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Fetcher } from "../../packages/core/src/index";
import { Human } from "../../packages/human/src/index";
import {
  ALLOW_PRESETS, type AllowOptions, type CharacterConfig, type RandomOptions, allowCatalog, buildCatalog, concealedGarments, defaultConfig,
  filterCatalog, fitConfig, heightFit, randomConfig, resolveOutfit, seededRandom, type HeightRange, type ThemeFilter,
} from "../../packages/generator/src/index";
import { IRIS_PRESETS } from "../../packages/three/src/materials";

const [packs, out] = process.argv.slice(2);
if (!packs || !out) throw new Error("usage: dump-generator.ts <packs dir> <out dir>");
const fetcher: Fetcher = async (url) => {
  const b = readFileSync(url);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const human = await Human.load(join(packs, "human", "manifest.json"), fetcher, true);
const catalog = buildCatalog(human, Object.keys(IRIS_PRESETS));
const base = defaultConfig(catalog);

interface Cases {
  random: { name: string; seed: number; options: Omit<RandomOptions, "random">; allow?: string }[];
  randomCount: number;
  allows: Record<string, AllowOptions>;
  themes: Record<string, ThemeFilter>;
  outfits: string[][];
  heights: [number, HeightRange | null][];
}
const cases: Cases = JSON.parse(readFileSync(new URL("./generator-cases.json", import.meta.url), "utf8"));
const allows: Record<string, AllowOptions> = { ...(ALLOW_PRESETS as Record<string, AllowOptions>), ...cases.allows };

// Seeded random characters: each one starts from the previous config, as an editor's "randomize" does.
const random: { name: string; config: CharacterConfig }[] = [];
let prev = base;
for (let i = 0; i < cases.randomCount; i++) {
  const c = cases.random[i % cases.random.length];
  const cat = c.allow ? allowCatalog(catalog, allows[c.allow]) : catalog;
  prev = randomConfig(cat, prev, { ...c.options, random: seededRandom(c.seed * 1000 + i) });
  random.push({ name: `${i}:${c.name}`, config: prev });
}

const ids = (list: { id: string }[]) => list.map((x) => x.id);
const summary = (c: ReturnType<typeof allowCatalog>) => ({
  races: ids(c.races),
  garments: ids(c.garments),
  outfits: c.outfits.map((o) => ({ id: o.id, female: o.female ?? null })),
  hair: ids(c.hair),
  robot: !!c.robot,
  skeletal: !!c.skeletal,
  people: c.people ?? null,
  height: c.height ?? null,
});
const allowed = Object.fromEntries(Object.entries(allows).map(([k, a]) => [k, summary(allowCatalog(catalog, a))]));
const themed = Object.fromEntries(Object.entries(cases.themes).map(([k, f]) => [k, summary(filterCatalog(catalog, f))]));
const fitted = Object.fromEntries(Object.entries(allows).map(([k, a]) => [k, random.map((r) => fitConfig(allowCatalog(catalog, a), r.config))]));
const outfits = cases.outfits.map((o) => ({ resolved: resolveOutfit(catalog, o), concealed: concealedGarments(catalog, resolveOutfit(catalog, o)) }));
const heights = cases.heights.map(([h, r]) => heightFit(h, r ?? undefined));

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "generator.json"), JSON.stringify({ catalog, default: base, random, allowed, themed, fitted, outfits, heights }, null, 1));
console.log(`generator: catalog, ${random.length} random configs`);
