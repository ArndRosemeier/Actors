// Writes the public WildMesh3D catalogue (names and facts only, no asset data) from a
// PrivateAssets checkout: node scripts/library/catalogue.mjs <PrivateAssets dir>
// Output: packages/animal/src/library/wildmesh3d.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const src = process.argv[2];
if (!src) throw new Error("usage: node scripts/library/catalogue.mjs <PrivateAssets dir>");
const root = join(src, "wildmesh3d");
const config = JSON.parse(readFileSync(join(root, "animals.json"), "utf8"));

// Channel counts per clip, read from the .glb files with PrivateAssets' own glTF-Transform.
const req = createRequire(join(src, "package.json"));
const load = async (name) => import(pathToFileURL(req.resolve(name)).href);
const { NodeIO } = await load("@gltf-transform/core");
const { ALL_EXTENSIONS } = await load("@gltf-transform/extensions");
const { MeshoptDecoder } = await load("meshoptimizer");
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
async function channels(id) {
  const doc = await io.read(join(root, id, `${id}.glb`));
  return new Map(doc.getRoot().listAnimations().map((a) => [a.getName(), a.listChannels().length]));
}

// What kind of animal each one is (by id), so a game can filter: everything else is a mammal.
const GROUPS = {
  bird: ["buzzard-stylized", "chicken", "chicken-stylized", "crow", "duck", "eagle-stylized", "flamingo-stylized", "goose", "guineafowl", "ostrich-stylized", "parrot-stylized", "parrot2-stylized", "pheasant", "rooster", "tukan-stylized"],
  reptile: ["american-aligator", "anaconda-stylized", "crocodile-stylized", "king-cobra-stylized", "tortoise-stylized"],
  fish: ["blue-gill", "trout", "tuna", "jaws-stylized"],
  crustacean: ["crab-stylized", "hermit-crab-stylized"],
};
const groupOf = (id) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(id)) ?? "mammal";

// "AfricanElephant" -> "African elephant", "Cat_Stylized" -> "Cat", "Deer_1" -> "Deer 1"
const nameOf = (folder) =>
  folder
    .replace(/_Stylized$/, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/ (\w)/g, (_, c) => " " + c.toLowerCase());

// Spelling fixes for display names (ids keep the pack's spelling).
const NAMES = { "american-aligator": "American alligator", bloodhund: "Bloodhound", "raindeer-stylized": "Reindeer", "tukan-stylized": "Toucan", racoon: "Raccoon", "blue-gill": "Bluegill" };

const seen = new Set(Object.values(GROUPS).flat());
const animals = [];
for (const [folder, c] of Object.entries(config.animals)) {
    const meta = JSON.parse(readFileSync(join(root, c.id, "meta.json"), "utf8"));
    const tracks = await channels(c.id);
    seen.delete(c.id);
    animals.push({
      id: c.id,
      name: NAMES[c.id] ?? nameOf(folder),
      set: c.set,
      group: groupOf(c.id),
      ...(meta.rigFamily ? { rig: meta.rigFamily } : {}),
      size: meta.size,
      triangles: meta.triangles,
      mb: Math.round(meta.bytes / 1e5) / 10,
      // [name, seconds, animated channels]
      clips: meta.clips.map((k) => [k.name, k.seconds, tracks.get(k.name) ?? 0]),
    });
}
animals.sort((a, b) => a.id.localeCompare(b.id));
if (seen.size) throw new Error(`unknown ids in GROUPS: ${[...seen].join(", ")}`);

const out = join(dirname(fileURLToPath(import.meta.url)), "../../packages/animal/src/library/wildmesh3d.json");
mkdirSync(dirname(out), { recursive: true });
// One animal per line keeps diffs readable.
writeFileSync(out, "[\n" + animals.map((a) => JSON.stringify(a)).join(",\n") + "\n]\n");
console.log(`${animals.length} animals, ${animals.reduce((n, a) => n + a.clips.length, 0)} clips -> ${out}`);
