// Run inside the fresh consumer app, against its installed release tarballs.
import assert from "node:assert/strict";
import { Color, Mesh, BufferGeometry } from "three";
import { ThreeActor, ScreenTexturePool, screenPixels, SCREEN_TEXTURE_SIZE } from "@actors/three";
import { createNodeClothMaterial, nodeMeshMaterial } from "@actors/three/webgpu";

const actor = new ThreeActor({ manifest: { meshes: [], proxies: [] }, meshes: [] });
actor.flushVisibility();
const original = new Color("#b7ddea");
const a = createNodeClothMaterial(original, 0.4, "screen", 1);
const b = createNodeClothMaterial(original, 0.4, "screen", 1);
actor.meshes.set("screen", new Mesh(new BufferGeometry(), a));
const before = a.emissiveMap.image.data.slice();
assert.equal(SCREEN_TEXTURE_SIZE, a.emissiveMap.image.width);
assert.deepEqual(screenPixels(0), before, "public generator must match the built-in screen pattern");
const scratch = new Uint8Array(SCREEN_TEXTURE_SIZE * SCREEN_TEXTURE_SIZE * 4);
assert.equal(screenPixels(2, scratch), scratch, "public generator must reuse the caller's buffer");
const version = a.emissiveMap.version;
actor.update(2);
assert(a.emissiveMap.version > version, "packaged WebGPU screen must upload its next frame");
assert(before.some((v, i) => v !== a.emissiveMap.image.data[i]), "screen pixels must animate across entry points");
assert.deepEqual(scratch, a.emissiveMap.image.data, "public phase frame must match the actor's updated texture");
assert.equal(b.emissiveMap.version, version, "another actor's screen must stay independent");
actor.setGarmentColor("screen", "#ff8800");
assert.equal(a.emissive.getHexString(), "ff8800", "packaged WebGPU emission must take the garment tint");
actor.setGarmentColor("screen", null);
assert(a.emissive.equals(original), "reset must restore the original screen palette");
a.dispose();
b.dispose();

// The public scene pool crosses the installed main/WebGPU entry boundary too.
const pool = new ScreenTexturePool(4);
const crowd = new ThreeActor({ manifest: { meshes: [], proxies: [] }, meshes: [] }, undefined, { screenTextures: pool });
crowd.flushVisibility();
const materials = Array.from({ length: 32 }, (_, i) => {
  const mat = nodeMeshMaterial({ def: { name: `screen-${i}`, source: { kind: "base" }, role: "garment", material: { kind: "cloth", color: [0.4, 0.6, 0.8] }, tags: ["fabric:screen"] } }, crowd);
  crowd.meshes.set(`screen-${i}`, new Mesh(new BufferGeometry(), mat));
  return mat;
});
const textures = [...new Set(materials.map((m) => m.emissiveMap))];
assert.equal(textures.length, 4, "32 installed WebGPU materials must allocate only four screen textures");
const versions = textures.map((t) => t.version);
pool.update(2);
crowd.update(2);
crowd.update(2); // actor updates must not advance the scene's shared clock again
assert.deepEqual(textures.map((t, i) => t.version - versions[i]), [1, 1, 1, 1]);
textures.forEach((t, i) => assert.deepEqual(t.image.data, screenPixels(2 + i * 5)));
const peerColor = materials[4].emissive.clone();
crowd.setGarmentColor("screen-0", "#ff8800");
assert.equal(materials[0].emissive.getHexString(), "ff8800");
assert(materials[4].emissive.equals(peerColor));
let disposed = 0;
for (const t of textures) t.addEventListener("dispose", () => disposed++);
materials[0].dispose();
assert.equal(disposed, 0, "disposing one wearer must not dispose a shared texture");
materials.forEach((m) => m.dispose());
assert.equal(disposed, 4);
console.log("installed screen API, WebGPU animation/tint, four-phase sharing and lifetime OK");
