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
await character.play("jog", 0.3);         // cross-fades from the clip playing now over 0.3 s
character.rootMotion = true;                // move through the scene instead of walking in place
await character.randomize({ gender: "female", outfit: true });

const saved = JSON.stringify(character.config); // restore with character.set(JSON.parse(saved))
const glb = await character.exportGlb("all");   // mesh, rig, visible clothes/hair, every clip
```

### Robots

Any character can be a robot: same skeleton, so every clip plays on it, and it is shaped by the same body and race sliders (a heavy, muscular or female body makes a heavy, muscular or female robot). Armour plates, a flexible inner frame, joint housings and a helmet are generated from the current body; skin, hair and clothes are not drawn.

```ts
await character.set({ robot: true });
await character.set({ robotLook: { head: "optics", ears: "antennae", plating: "armored", paint: "#a3161d", glow: "#ffe2b0", finish: "gloss" } });
await character.set({ robotLook: character.catalog.robot!.palettes[3].look }); // a colour scheme
await character.randomize({ robot: true });  // a random robot body and look
```

`robotLook` takes `head` (visor, optics, mono, android), `ears` (none, pods, antennae, fins), `plating` (sleek, segmented, armored), `thickness` (0..1), `core` (chest light), the colours `paint`, `trim`, `frame`, `metal` and `glow` (sRGB hex), `glowStrength` (0..1) and `finish` (gloss, satin, metallic, matte). Shape options rebuild the robot (in the worker, when there is one); colours, finish and light strength are instant.

`character.catalog` lists every choice the pack offers (ids and labels): `animations`, `garments` (with category, body layers, slots and whether they cover the anatomy), `garmentColors` (a suggested palette; any hex colour works), `outfits` (presets), `hair`, `hairColors`, `brows`, `eyes`, `expressions` and the detail sliders. Build your own UI from it, or use `CharacterEditor`.

Large clip libraries in the pack (the 2,548 CMU motions) are listed in `catalog.animations` too, with `library: "cmu"`, a `category` (the capture session) and a `description`; only their index is loaded up front, each clip on first play. Pass `clipLibraries: false` to `Character.load` to skip them.

`CharacterEditor` has two modes: **Simple** (body basics, ethnicity, hair, eyes, outfit preset, animation, face) for everyday users and **Detailed** (every control, garment by garment, the CMU library with search, detail sliders). Pick one with `mode`, hide the switch with `modeSwitch: false`; the viewer's last choice is remembered.

## Levels of detail and crowds

Every character has three detail levels (`character.lods`: "Full", "Medium", "Crowd"); switching is instant because they all draw from the same shape:

```ts
character.setLod(2);              // fixed level (0 = full detail)
character.lodCamera = camera;     // or pick by camera distance every frame
character.setLod("auto");         // switch distances in character.lods, scaled for the camera's field of view
character.lodBias = 1.5;          // keep detail longer

// Every character on the same pack URL shares one loaded pack (only the first load downloads it).
// `shareWith` does the same and also reuses the other character's worker:
const extra = await Character.load({ pack, renderer, shareWith: character });
await extra.randomize();
await extra.set({ skin: "procedural" }); // WebGL photo skins cost a 2k texture per distinct blend

// A worker pool: one lead per worker, crowd members share with the leads in turn.
const leads = [character, await Character.load({ pack, renderer, shareWith: character, worker: new HumanWorker() })];
const next = await Character.load({ pack, renderer, shareWith: leads[i++ % leads.length] });
```

Only what a character wears is fitted and drawn: garment and hair meshes are made the first time they are shown, and shapes fit just the worn garments (`ThreeActor.neededMeshes`), however much of the wardrobe the shared pack has loaded.

`character.actor.crowdMesh()` returns the "Crowd" level's merged mesh and which vertex range came from which garment, e.g. to bake vertex-animation textures for instanced crowds.

"Medium" uses the base mesh instead of the subdivided body and garments, hair and eyes with about half their triangles. "Crowd" draws MakeHuman's 741-vertex proxy body and the garments as one merged mesh (one draw call plus the hair) and doesn't animate the fingers.

## Spawning many characters quickly

What a character needs is loaded once per page and shared: the pack (mesh, morph targets, garments, hair), clips, textures and the shaders. So the first character costs the most, and later ones only build their own shape and meshes.

- **Load the pack once at startup.** Load one character while the game boots (a loading screen) and keep it, or spawn later ones with `shareWith` it.
- **One worker for all.** Pass the same `worker` to every `Character.load` (or none); a new worker per character loads the whole pack again inside it.
- **Compile shaders before showing.** `await character.compile(renderer, camera, scene)` compiles the character's shaders in the background (`renderer.compileAsync`), so the frame that first draws it doesn't freeze. Each new garment, hairstyle or add-on kind compiles once per page; warm up a few typical outfits behind the loading screen to cover most of them.
- **Photo skins** (WebGL) are blended into a 2k texture; characters with nearly the same blend share one. `skin: "procedural"` needs none.
- `apps/viewer/bench.html` (also on the demo site as `bench.html`) times loading several characters in a row: `?n=8`, `?compile`, `?same`, `?worker`, `?webgpu`.

## A game's own character creator

The editor and the character can be narrowed to what a game offers:

```ts
const character = await Character.load({
  pack, renderer, materials: nodeMaterials, clipLibraries: false,
  // what the character (and so its editor and randomize) may pick from
  catalog: (c) => ({ ...c, races: c.races.filter((r) => r.id === "human"), garments: c.garments.filter((g) => !g.credit), outfits: c.outfits.filter((o) => everyday.includes(o.id)) }),
});
new CharacterEditor(character, panel, {
  sections: ["body", "look", "outfit"],          // no race, animation or detail sliders
  buttons: ["randomize", "reset"],               // no save, load or glTF export
  hide: ["anatomy", "body.cupSize", "outfit-preset"], // single controls, by key or role
  randomize: () => myGameLook(seed++),            // what Randomize sets
});
```

### Themes: only what fits a game's setting

Garments, hairstyles and races carry theme tags (`themes` on each catalog choice; the tables are `GARMENT_THEMES`, `HAIR_THEMES` and `RACE_THEMES`). A game passes the themes it allows, and the character, its editor and `randomize` then offer only what fits:

```ts
const character = await Character.load({
  pack, renderer,
  themes: { themes: ["medieval", "nordic", "fantasy"], without: ["real-faith"] },
});
```

* Themes (`THEMES`): `modern`, `vintage`, `future`, `antique`, `medieval`, `nordic`, `eastern`, `fantasy`. An option fits when it shares one of the game's themes; untagged options (underwear, plain socks, most hairstyles, humans) fit every game.
* Flags (`THEME_FLAGS`) are left out whatever the themes when listed in `without`: `real-faith` marks real-world religious symbols (the templar knight helmet, the Santa hat).
* Outfit presets stay when all their garments do. Robots come with `future`, skeletons with `fantasy`; other races than humans are `fantasy`.
* `filterCatalog(catalog, filter)` and `fitsThemes(tags, filter)` do the same for a catalog you hold; `catalog` (above) narrows further after the themes.
* `randomize({ race: "any" })` picks one of the races the catalog offers.
* The viewer takes `?themes=medieval,fantasy&without=real-faith`.

Restyle the panel with its CSS variables (`--ae-panel`, `--ae-text`, `--ae-muted`, `--ae-accent`, `--ae-border`) on `.actors-editor`.

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
