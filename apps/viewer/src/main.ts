import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createCharacterGenerator } from "@actors/generator";
import HumanWorker from "@actors/human/worker?worker";

const params = new URLSearchParams(location.search);
// Shape evaluation runs in a Web Worker so slider drags never stall rendering (`?noworker` to compare).
const { character, stage } = await createCharacterGenerator({
  pack: `${import.meta.env.BASE_URL}packs/human/manifest.json`,
  view: document.getElementById("view")!,
  panel: document.getElementById("panel")!,
  worker: params.has("noworker") ? undefined : new HumanWorker(),
  title: "Character",
});

// `?compare`: the source animation on its own mannequin next to the actor (dev check for the retarget).
if (params.has("compare")) {
  const base = `${import.meta.env.BASE_URL}reference/`;
  const index = (await (await fetch(`${base}clips.json`)).json()) as Record<string, { glb: string; animation: string }>;
  const libs = new Map<string, Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>>();
  let ref: { scene: THREE.Object3D; mixer: THREE.AnimationMixer; action: THREE.AnimationAction } | undefined;
  const show = async (name: string | null) => {
    if (ref) stage.scene.remove(ref.scene);
    ref = undefined;
    const entry = name ? index[name] : undefined;
    if (!entry) return;
    if (!libs.has(entry.glb)) libs.set(entry.glb, new GLTFLoader().loadAsync(base + entry.glb));
    const lib = await libs.get(entry.glb)!;
    lib.scene.position.set(0.9, 0, 0);
    stage.scene.add(lib.scene);
    const mixer = new THREE.AnimationMixer(lib.scene);
    const action = mixer.clipAction(lib.animations.find((a) => a.name === entry.animation)!);
    action.play();
    ref = { scene: lib.scene, mixer, action };
  };
  let shown: string | null | undefined;
  character.onChange((c) => {
    if (c.animation !== shown) void show((shown = c.animation));
  });
  void show((shown = character.config.animation));
  // Keep the mannequin on the actor's clock.
  stage.onFrame(() => {
    const t = character.actor.currentAction?.time;
    if (!ref || t === undefined) return;
    ref.action.time = t % ref.action.getClip().duration;
    ref.mixer.update(0);
  });
}

// Test hooks (used by the headless smoke test).
Object.assign(window, { __actors: { character, stage, ready: true } });
