// Run in the installed consumer app against a freshly imported human pack.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { MeshStandardMaterial } from "three";
import { ActorRuntime } from "@actors/core";
import { ThreeActor } from "@actors/three";

const runtime = await ActorRuntime.load(pathToFileURL(resolve(process.argv[2])).href, async (url) => {
  const data = await readFile(new URL(url));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
});
const sheer = ["stockings", "fishnet-stockings"];
const opaque = "high-socks";
await runtime.loadMeshes([...sheer, opaque]);
for (const name of sheer) {
  const mesh = runtime.meshes.find((m) => m.def.name === name);
  assert(mesh, `missing imported ${name}`);
  assert.equal(mesh.def.hidesBaseVertices, undefined, `${name} must not carry an opaque mask`);
  assert.equal(mesh.hidesBaseVertices, undefined, `${name} must not load an opaque mask`);
}
assert(runtime.meshes.find((m) => m.def.name === opaque).hidesBaseVertices.length > 0, "opaque socks must retain coverage");

// Use real fitted pack geometry; a plain material makes this check independent of a GPU/DOM.
const actor = new ThreeActor(runtime, () => new MeshStandardMaterial());
actor.setVisible("tights", true);
actor.applyShape(runtime.evaluateLoaded(new Map()));
const snapshot = () => Object.fromEntries([...actor.meshes].filter(([name, mesh]) => mesh.visible && (runtime.meshes.find((m) => m.def.name === name)?.def.role === "body" || name === "tights")).map(([name, mesh]) => [name, {
  indices: Array.from(mesh.geometry.index.array),
  clip: Array.from(mesh.geometry.getAttribute("clipValue")?.array ?? []),
}]));
for (const lod of [0, 1]) {
  actor.setLod(lod);
  actor.update(0);
  const baseline = snapshot();
  assert(Object.keys(baseline).length > 0, "must check a visible body surface");
  for (const name of sheer) {
    actor.setVisible(name, true);
    actor.update(0);
    assert(actor.meshes.get(name).visible);
    assert.deepEqual(snapshot(), baseline, `${name} must preserve skin and lower clothing at LOD ${lod}`);
    actor.setVisible(name, false);
    actor.update(0);
  }
  actor.setVisible(opaque, true);
  actor.update(0);
  assert.notDeepEqual(snapshot(), baseline, `opaque coverage must still work at LOD ${lod}`);
  actor.setVisible(opaque, false);
  actor.update(0);
}
console.log("imported sheer hosiery preserves skin and lower layers; opaque sock coverage still works");
