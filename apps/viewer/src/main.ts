import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Character, createCharacterGenerator, randomConfig, seededRandom } from "@actors/generator";
import HumanWorker from "@actors/human/worker?worker";

const params = new URLSearchParams(location.search);
// Shape evaluation runs in a Web Worker so slider drags never stall rendering (`?noworker` to compare).
const { character, stage } = await createCharacterGenerator({
  pack: `${import.meta.env.BASE_URL}packs/human/manifest.json`,
  view: document.getElementById("view")!,
  panel: document.getElementById("panel")!,
  worker: params.has("noworker") ? undefined : new HumanWorker(),
  title: "Character",
  // `?webgpu` draws with three's WebGPURenderer and node materials, `?webgpu-gl` with its WebGL 2 backend.
  renderer: params.has("webgpu") ? "webgpu" : params.has("webgpu-gl") ? "webgpu-gl" : "webgl",
});

// Share a wardrobe preview, e.g. ?outfit=future-orbit. Older packs may not contain it yet.
const outfit = params.get("outfit");
if (outfit && character.catalog.outfits.some((o) => o.id === outfit)) await character.wear(outfit);

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

// `?crowd=N`: N more random characters behind the first, all switching detail level by camera
// distance (zoom out to watch them drop to the medium and crowd levels). They share one loaded pack.
const crowd: Character[] = [];
const crowdSize = Math.min(400, Number(params.get("crowd") ?? 0) || 0);
if (crowdSize > 0) {
  const random = seededRandom(7);
  const cols = Math.ceil(Math.sqrt(crowdSize));
  const clips = ["walk", "idle", "dance", "jog"].filter((id) => character.catalog.animations.some((a) => a.id === id));
  character.setLod("auto");
  for (let i = 0; i < crowdSize; i++) {
    const look = randomConfig(character.catalog, character.config, { random });
    // Procedural skin: a photo skin blend costs a 2k texture per actor in WebGL.
    const c = await Character.load({ pack: "", renderer: stage.renderer, shareWith: character, config: { ...look, skin: "procedural", animation: clips[i % clips.length] ?? null } });
    c.lodCamera = stage.camera;
    c.setLod("auto");
    c.object.position.set(((i % cols) - (cols - 1) / 2) * 1.1, 0, -1.4 - Math.floor(i / cols) * 1.4);
    c.object.rotation.y = (random() - 0.5) * 0.8;
    stage.add(c);
    crowd.push(c);
  }
}

// Test hooks (used by the headless smoke test).
Object.assign(window, { __actors: { character, stage, crowd, ready: true } });
