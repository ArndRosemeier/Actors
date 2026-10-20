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
await character.play("walk");               // any id from character.catalog.animations; null = bind pose
character.rootMotion = true;                // move through the scene instead of walking in place
await character.randomize({ gender: "female", outfit: true });

const saved = JSON.stringify(character.config); // restore with character.set(JSON.parse(saved))
const glb = await character.exportGlb("all");   // mesh, rig, visible clothes/hair, every clip
```

`character.catalog` lists every choice the pack offers (ids and labels): `animations`, `garments` (with slots and whether they cover the anatomy), `outfits` (presets), `hair`, `hairColors`, `brows`, `eyes`, `expressions` and the detail sliders. Build your own UI from it, or use `CharacterEditor`.

Notes:
* `set()` merges `body` and replaces every other field. It resolves once the change is visible; rapid calls (slider drags) are merged.
* Garments in the same slot replace each other (the long and the mini skirt).
* Age is clamped to adults (18+) in `set()` and again in `@actors/human`.
* The materials are tuned for ACES tone mapping and an environment map; `CharacterStage` shows the settings.
