// Run inside the fresh consumer app, against its installed release tarballs.
import assert from "node:assert/strict";
import { Color, Mesh, BufferGeometry } from "three";
import { ThreeActor } from "@actors/three";
import { createNodeClothMaterial } from "@actors/three/webgpu";

const actor = new ThreeActor({ manifest: { meshes: [], proxies: [] }, meshes: [] });
actor.flushVisibility();
const original = new Color("#b7ddea");
const a = createNodeClothMaterial(original, 0.4, "screen", 1);
const b = createNodeClothMaterial(original, 0.4, "screen", 1);
actor.meshes.set("screen", new Mesh(new BufferGeometry(), a));
const before = a.emissiveMap.image.data.slice();
const version = a.emissiveMap.version;
actor.update(2);
assert(a.emissiveMap.version > version, "packaged WebGPU screen must upload its next frame");
assert(before.some((v, i) => v !== a.emissiveMap.image.data[i]), "screen pixels must animate across entry points");
assert.equal(b.emissiveMap.version, version, "another actor's screen must stay independent");
actor.setGarmentColor("screen", "#ff8800");
assert.equal(a.emissive.getHexString(), "ff8800", "packaged WebGPU emission must take the garment tint");
actor.setGarmentColor("screen", null);
assert(a.emissive.equals(original), "reset must restore the original screen palette");
a.dispose();
b.dispose();
console.log("installed WebGPU screen animation, tint, reset and isolation OK");
