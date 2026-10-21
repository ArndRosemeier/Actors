# @actors/generator

A reusable character generator for three.js apps: shape, skin, eyes, hair, eyebrows, outfit (from nude to fully dressed), adult anatomy, every animation in the pack, facial expressions, randomizing, saving/loading and glTF export. Everything about a character is one JSON-serialisable `CharacterConfig`.

Three layers, use as much as you need:

| Export | What it is |
|---|---|
| `Character` | The character itself. Add `character.object` to your own scene and call `character.update(dt)` each frame. No DOM needed. |
| `CharacterStage` | A ready studio (renderer, lights, shadows, floor, orbit camera, render loop) in a container element. |
| `CharacterEditor` | A plain-DOM control panel for a `Character` (no framework). |
| `createCharacterGenerator` | Stage + character + editor in one call. |

## The whole generator

```ts
import { createCharacterGenerator } from "@actors/generator";
import HumanWorker from "@actors/human/worker?worker"; // Vite; optional

const { character } = await createCharacterGenerator({
  pack: "/packs/human/manifest.json",       // from `npm run import:human`
  view: document.getElementById("view")!,
  panel: document.getElementById("panel")!, // omit for no controls
  worker: new HumanWorker(),
});
```

## Only the character, in your own scene

```ts
import { Character } from "@actors/generator";

const character = await Character.load({ pack: "/packs/human/manifest.json", renderer });
scene.add(character.object);
renderer.setAnimationLoop(() => {
  character.update(clock.getDelta());
  renderer.render(scene, camera);
});

await character.set({ body: { gender: 1, ageYears: 40, muscle: 0.7 }, hair: "hair-short04", hairColor: "#3b2417" });
await character.wear("casual");             // outfit preset; "nude" undresses
await character.set({ outfit: ["briefs", "jeans"] }); // or any garment list
await character.set({ garmentColors: { jeans: "#1f2a44" } }); // recolour any garment (sRGB hex)
await character.play("walk");               // any id from character.catalog.animations; null = bind pose
character.rootMotion = true;                // move through the scene instead of walking in place
await character.randomize({ gender: "female", outfit: true });

const saved = JSON.stringify(character.config); // restore with character.set(JSON.parse(saved))
const glb = await character.exportGlb("all");   // mesh, rig, visible clothes/hair, every clip
```

`character.catalog` lists every choice the pack offers (ids and labels): `animations`, `garments` (with category, body layers, slots and whether they cover the anatomy), `garmentColors` (a suggested palette; any hex colour works), `outfits` (presets), `hair`, `hairColors`, `brows`, `eyes`, `expressions` and the detail sliders. Build your own UI from it, or use `CharacterEditor`.

Large clip libraries in the pack (the 2,548 CMU motions) are listed in `catalog.animations` too, with `library: "cmu"`, a `category` (the capture session) and a `description`; only their index is loaded up front, each clip on first play. Pass `clipLibraries: false` to `Character.load` to skip them.

`CharacterEditor` has two modes: **Simple** (body basics, ethnicity, hair, eyes, outfit preset, animation, face) for everyday users and **Detailed** (every control, garment by garment, the CMU library with search, detail sliders). Pick one with `mode`, hide the switch with `modeSwitch: false`; the viewer's last choice is remembered.

## three's WebGPURenderer

`Character` draws with WebGL materials by default. For three's `WebGPURenderer` (WebGPU, or its WebGL 2 backend with `forceWebGL`), pass the node-material kit; every look, pattern and clip works the same:

```ts
import { WebGPURenderer } from "three/webgpu";
import { nodeMaterials } from "@actors/three/webgpu";

const renderer = new WebGPURenderer({ antialias: true });
await renderer.init();
const character = await Character.load({ pack: "/packs/human/manifest.json", renderer, materials: nodeMaterials });
```

`CharacterStage.create(container, { renderer: "webgpu" })` (or `"webgpu-gl"`) builds such a stage, and `createCharacterGenerator` takes the same `renderer` option. All characters share one shader per material kind; per-character values are uniforms.

Notes:
* `set()` merges `body` and replaces every other field. It resolves once the change is visible; rapid calls (slider drags) are merged.
* Garments in the same slot or on the same body layer replace each other: a dress (top + bottom) takes off a T-shirt and jeans, new shoes replace old ones.
* Every garment can be recoloured; the texture's shading (folds, seams, weave) is kept. `null`/missing keeps its own colours.
* The wardrobe (about 90 MakeHuman CC0 garments) loads lazily: a garment's mesh and textures are fetched the first time it is worn.
* Age is clamped to adults (18+) in `set()` and again in `@actors/human`.
* The materials are tuned for ACES tone mapping and an environment map; `CharacterStage` shows the settings.
