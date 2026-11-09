/**
 * Reference robot parts of @actors/human for the Rust port's golden test
 * (rust/crates/actors-human/tests/robot.rs), for the cases in robot-cases.json.
 *
 *   npx tsx rust/golden/dump-robot.ts <packs dir> <out dir>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Fetcher } from "../../packages/core/src/index";
import { Human, type HumanParams, type RobotConfig } from "../../packages/human/src/index";

const [packs, out] = process.argv.slice(2);
if (!packs || !out) throw new Error("usage: dump-robot.ts <packs dir> <out dir>");
const fetcher: Fetcher = async (url) => {
  const b = readFileSync(url);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

interface RobotCase {
  name: string;
  params?: Partial<HumanParams>;
  robot: Partial<RobotConfig>;
}
const cases: RobotCase[] = JSON.parse(readFileSync(new URL("./robot-cases.json", import.meta.url), "utf8"));
const base = await Human.load(join(packs, "human", "manifest.json"), fetcher, true);
await base.runtime.loadMeshes(["body", "eyes"]);
const results = [];
for (const c of cases) {
  const h = Human.share(base);
  h.params = { ...h.params, ...c.params };
  h.fit = ["body", "eyes"];
  const shape = await h.evaluate();
  const { parts, lift } = h.robot(shape, c.robot);
  results.push({
    name: c.name,
    lift,
    parts: parts.map((p) => ({
      name: p.name,
      kind: p.kind,
      positions: [...p.positions],
      normals: [...p.normals],
      uvs: [...p.uvs],
      shade: [...p.shade],
      joints: [...p.joints],
      weights: [...p.weights],
      indices: [...p.indices],
    })),
  });
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "robot.json"), JSON.stringify(results));
console.log(`robot: ${results.length} cases, ${results.reduce((n, r) => n + r.parts.length, 0)} parts`);
