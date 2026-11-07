/**
 * Reference results of @actors/human for the Rust port's golden test
 * (rust/crates/actors-human/tests/golden.rs): target weights, shape options, face weights,
 * skins and deform plans for the cases in human-cases.json.
 *
 *   npx tsx rust/golden/dump-human.ts <packs dir> <out dir>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { deform, type DeformSpec, type Fetcher } from "../../packages/core/src/index";
import { EXPRESSIONS, BLINK, Human, shapeModifiers, wrinkleWeights, type HumanParams, type RaceSettings } from "../../packages/human/src/index";

const [packs, out] = process.argv.slice(2);
if (!packs || !out) throw new Error("usage: dump-human.ts <packs dir> <out dir>");
const fetcher: Fetcher = async (url) => {
  const b = readFileSync(url);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

interface HumanCase {
  name: string;
  params?: Partial<HumanParams>;
  modifiers?: Record<string, number>;
  race?: RaceSettings;
  shape?: Record<string, number>;
  deform?: DeformSpec;
  fitScale?: number;
}
const cases: HumanCase[] = JSON.parse(readFileSync(new URL("./human-cases.json", import.meta.url), "utf8"));
const base = await Human.load(join(packs, "human", "manifest.json"), fetcher, true);
const known = new Map(base.modifiers.map((m) => [m.id, m.negative.length ? -1 : 0]));
const results = [];
for (const c of cases) {
  const h = Human.share(base);
  h.params = { ...h.params, ...c.params };
  h.modifierValues = shapeModifiers(c.shape ?? {}, c.modifiers ?? {}, known);
  if (c.race) h.race = c.race;
  h.deform = c.deform ? deform(c.deform) : null;
  h.fitScale = c.fitScale ?? 1;
  const opts = h.shapeOptions();
  results.push({
    name: c.name,
    modifierValues: h.modifierValues,
    weights: [...h.targetWeights()],
    shapeOptions: { bones: opts.bones ?? {}, tips: opts.tips ?? [], scale: opts.scale ?? null },
    faceScale: h.faceScale,
    smile: [...(h as unknown as { faceWeights(u: unknown, s: number): Map<string, number> }).faceWeights(EXPRESSIONS.smile, 1)],
    blink: [...(h as unknown as { faceWeights(u: unknown, s: number): Map<string, number> }).faceWeights(BLINK, 0.5)],
    skins: h.skinTextures(),
    tone: h.skinTextureTone(),
    wrinkles: wrinkleWeights(EXPRESSIONS.laugh, h.params.ageYears),
    deform: h.deform,
  });
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "human.json"), JSON.stringify(results, null, 1));
console.log(`human: ${results.length} cases`);
