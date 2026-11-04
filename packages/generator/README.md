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

### Face rig

By default a character holds one expression at a time in a GPU morph (switching rebuilds it). Turn on the face rig to get every one of MakeHuman's face units (brows, lids, cheeks, nose, mouth, jaw, tongue) as its own GPU morph: expressions then blend smoothly into each other, and you can drive single units every frame, for lip-sync, gaze or your own face animation.

```ts
await character.set({ faceRig: true });
character.expressionFade = 0.35;               // seconds one expression takes to blend into the next
await character.set({ expression: "smile" });  // fades from the current face
character.faceUnits();                          // the unit names, e.g. "mouth-open", "eyebrows-left-up"
character.setFaceUnits({ "mouth-open": 0.4 }); // added on top of expression and blink every frame; null clears
```

The rig is built in the worker with each shape (all units at once) and kept sparse: only vertices a unit moves are stored, as half floats in one texture per character. A frame only uploads the unit weights; the vertex shader does the rest, on both renderers. It is off by default because it costs GPU memory (about 7 MB for MakeHuman's 34 units: 12,800 moved vertices) and time per shape change (about 0.1 s extra in the worker); robots and skeletons don't use it.

### Wrinkles

`clothTuck` (on by default, "Tuck covered layers in" in the outfit panel) stops inner layers poking through outer ones. Where a garment covers the body (the parts it hides anyway), whatever lies under it sinks in: skin 3 mm under its surface, body-cut garments down onto the skin, fitted garments most of the way to the body point they hang from. Shoes now cover socks worn on the same layer, as later garments in the outfit cover earlier ones. It is done once per outfit or shape change on the CPU and costs nothing per frame. `ThreeActor.tuckCovered` switches it directly.

`clothMotion` (on by default, "Loose clothes swing" in the outfit panel) lets skirts, dresses, robes and tunics (the garments hung between the legs) move with the body. One point per character follows the hips on a damped spring: moving leaves the hem trailing a little, stopping swings it forward and back until it settles, and a quick turn makes it lag behind and catch up. The vertex shader swings the cloth below the hips by that much, more the lower it hangs; cloth against a leg stays with the leg, and cloth swung into one stops at it. It needs the character to move in the world (a game moving `character.object`); clips that walk on the spot only sway a little. `ThreeActor.clothMotion` switches it directly and `ThreeActor.clothSway` holds the spring. `apps/viewer/scripts/sway.mjs` shoots run, stop and spin frames with it on and off.

`skinDetail` (on by default, "Skin detail" under Look) makes skin read less like smooth plastic, for photo and procedural skins alike. The skin shader adds blood flush on the cheeks, nose, ears, chin, knees, elbows and hands, a shadow under the eyes, fine pigment speckle, a shinier T-zone (forehead and nose) and slightly rougher skin elsewhere, uneven roughness at a fine scale, pores that show more on the nose and cheeks, and a second, finer layer of skin texture. Creases (eyelids, nose wings, the folds of the ear) are a little darker, from the surface's curvature measured per pixel, and thin skin (ears, nose wings, hands) glows red when lit from behind. The face regions are placed from the eyes (the same face frame as painted stubble), the limb ones from the skeleton's knees, elbows and wrists, so they follow every body and race. It costs a few dozen instructions and one texture read per skin pixel; `ThreeActor.skin.uDetail` (0..1) drives it directly. `apps/viewer/scripts/skin.mjs` shoots face, shoulder, torso and backlit close-ups with it on and off.

`skinWetness` (0 to 1, "Wet skin" under Look, 0 by default) makes skin wet or sweaty: glossy in uneven patches and a little darker. `ThreeActor.skin.uWet` drives it directly, for example to let a character sweat while running or step out of water.

`wrinkles: true` draws expression wrinkles in the skin shader: forehead lines when the brows go up, the vertical lines between the brows and the line across the nose root when they go down or the nose wrinkles, crow's feet and the nasolabial fold when the face smiles or squints. Their depth follows the face units every frame (the expression, the face rig and the living face alike), and older faces keep some at rest. The crease patterns are drawn once by the importer into the skin's third mask (`skin_mask_c.png`, green, blue and alpha); the shader reads the depth and its slope there and shades the creases a little. While no wrinkle shows it costs nothing; while one does, four extra texture reads per skin pixel. `ThreeActor.setWrinkles(forehead, frown, smile)` and `wrinkleWeights` in `@actors/human` drive them directly.

### Living face

`faceAnimation` makes the face move on its own: natural blinks (varied speed, now and then a double or a half blink), small eye jumps while looking at something and now and then a glance away, eyes that turn toward the camera or any point (each eye on its own, so near points make them converge), upper lids that follow the eyes down and up, slow idle movement of brows, mouth corners and nostrils, and lip-sync. The eyes turn with or without the face rig; lids, idle movement and lip-sync need `faceRig` too.

```ts
await character.set({ faceRig: true, faceAnimation: true, gaze: "camera" }); // or gaze: "ahead"
character.camera = myCamera;            // what "camera" means (default: lodCamera, the stage camera)
character.lookAt(npc.object);           // follow an object or a point; null = ahead, undefined = back to the config
character.say("Well met, traveller!");  // rough English letter-to-mouth rules; returns the length in seconds
character.speak([{ time: 0, viseme: "PP" }, { time: 0.08, viseme: "aa" }]); // exact timing from a TTS engine (VISEMES)
character.setVoiceLevel(level);         // or move the jaw with your audio's loudness, 0..1, every frame
character.faceAnimator!.options.saccades = false; // each part can be switched off; speechIntensity scales the lips
```

All of it is a few dozen multiply-adds per frame on the CPU (about 0.02 ms per character with the mixer); the faces move on the GPU through the face rig. The eyes get two bones (`eye_l`, `eye_r`, children of the head) when the living face is first switched on, so they also turn in exported glTF skeletons. The animator itself (`FaceAnimator`, `textToVisemes` and `VISEMES` in `@actors/human`) is renderer-free and works with any engine that can set face units and turn two bones.

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

### Body types and shape sliders

Besides the raw MakeHuman sliders (`details`, about 250), a character has `shape`: named sliders from -1 to 1 that each move several raw modifiers together (`SHAPE_SLIDERS` in `@actors/human`: body fat, fitness, shoulders, waist, hips, jaw, nose and so on). They add to the raw values, so both can be used together. `BODY_TYPES` are starting points that set the macros and shape at once:

```ts
import { BODY_TYPES } from "@actors/human";
const t = BODY_TYPES.find((b) => b.id === "athletic")!;
await character.set({ body: { ...t.body }, shape: { ...t.shape, waist: -0.4 } });
```

The editor shows a "Body type" picker under Body and a "Shape" section (`"shape"` in `sections`).

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
