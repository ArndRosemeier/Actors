// Dev page (not part of the build): animal packs with the node kit on a real WebGPU stage, for scripts/webgpu-check.mjs. `?animals=dog,cat`.
import { Animal } from "@actors/animal";
import { CharacterStage } from "@actors/generator";
import { ThreeActor } from "@actors/three";
import { nodeMaterials } from "@actors/three/webgpu";

const stage = await CharacterStage.create(document.getElementById("view")!, { renderer: "webgpu" });
const kinds = (new URLSearchParams(location.search).get("animals") ?? "dog,cat,squirrel,deer").split(",").filter(Boolean);
let x = -kinds.length / 2;
for (const kind of kinds) {
  const animal = await Animal.load(`./packs/${kind}/manifest.json`);
  const actor = new ThreeActor(animal.runtime, nodeMaterials);
  animal.setPreset(animal.species.base);
  actor.applyShape(await animal.evaluate());
  actor.object.position.set((x += 1), actor.groundOffset(), 0);
  stage.add(actor);
}
stage.view([0, 1, 5], [0, 0.4, 0]);
Object.assign(window, { __actors: { stage, ready: true } });
