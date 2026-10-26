// Dev page (not part of the build): animal packs with the node kit on a real WebGPU stage, for scripts/webgpu-check.mjs. `?animals=dog,cat`; `&fur` draws them with the node fur materials and shells in each species' base coat.
import { Animal } from "@actors/animal";
import { CharacterStage } from "@actors/generator";
import { ThreeActor, createFurUniforms, setFurCoat } from "@actors/three";
import { addNodeFurShells, animalNodeMaterials, nodeMaterials } from "@actors/three/webgpu";

const stage = await CharacterStage.create(document.getElementById("view")!, { renderer: "webgpu" });
const params = new URLSearchParams(location.search);
const kinds = (params.get("animals") ?? "dog,cat,squirrel,deer").split(",").filter(Boolean);
const withFur = params.has("fur");
let x = -kinds.length / 2;
for (const kind of kinds) {
  const animal = await Animal.load(`./packs/${kind}/manifest.json`);
  animal.setPreset(animal.species.base);
  const fur = createFurUniforms();
  const actor = new ThreeActor(animal.runtime, withFur ? animalNodeMaterials(fur) : nodeMaterials);
  if (withFur) {
    addNodeFurShells(actor, fur);
    setFurCoat(fur, animal.coat as never, animal.shape.size);
  }
  actor.applyShape(await animal.evaluate());
  actor.object.position.set((x += 1), actor.groundOffset(), 0);
  stage.add(actor);
}
stage.view([0, 1, 5], [0, 0.4, 0]);
Object.assign(window, { __actors: { stage, ready: true } });
