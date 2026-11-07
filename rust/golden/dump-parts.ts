/**
 * Reference race add-ons (horns, tusks, tails, beards, leaves, crest) of @actors/human for the
 * Rust port's golden test (rust/crates/actors-human/tests/parts.rs), for the cases in
 * parts-cases.json.
 *
 *   npx tsx rust/golden/dump-parts.ts <packs dir> <out dir>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Fetcher } from "../../packages/core/src/index";
import { Human, type HumanParams, type PartsConfig, type RaceSettings } from "../../packages/human/src/index";

const [packs, out] = process.argv.slice(2);
if (!packs || !out) throw new Error("usage: dump-parts.ts <packs dir> <out dir>");
const fetcher: Fetcher = async (url) => {
  const b = readFileSync(url);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

interface PartsCase {
  name: string;
  params?: Partial<HumanParams>;
  race?: RaceSettings;
  parts: Partial<Omit<PartsConfig, "scale">>;
}
const cases: PartsCase[] = JSON.parse(readFileSync(new URL("./parts-cases.json", import.meta.url), "utf8"));
const base = await Human.load(join(packs, "human", "manifest.json"), fetcher, true);
await base.runtime.loadMeshes(["body", "eyes"]);
const defaults: Omit<PartsConfig, "scale"> = { seed: 0, horns: "none", hornSize: 0, hornColor: [0.85, 0.81, 0.71], tusks: 0, tail: "none", tailLength: 0, beard: "none", hair: "none" };
const results = [];
for (const c of cases) {
  const h = Human.share(base);
  h.params = { ...h.params, ...c.params };
  if (c.race) h.race = c.race;
  h.fit = ["body", "eyes"];
  const shape = await h.evaluate();
  const parts = await h.parts(shape, { ...defaults, ...c.parts });
  results.push({
    name: c.name,
    parts: parts.map((p) => ({
      name: p.name,
      kind: p.kind,
      color: p.color ?? null,
      positions: [...p.positions],
      normals: [...p.normals],
      uvs: [...p.uvs],
      shade: [...p.shade],
      joints: [...p.joints],
      weights: [...p.weights],
      indices: [...p.indices],
      anchors: p.anchors ? [...p.anchors] : [],
      bones: p.bones ?? [],
    })),
  });
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "parts.json"), JSON.stringify(results));
console.log(`parts: ${results.length} cases, ${results.reduce((n, r) => n + r.parts.length, 0)} parts`);
