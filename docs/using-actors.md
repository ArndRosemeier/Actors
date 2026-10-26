# Using Actors in another project

The character generator ships as six installable packages, attached to each [GitHub release](https://github.com/ArndRosemeier/Actors/releases) as npm tarballs. Nothing is on the public npm registry; npm installs straight from the release URL, and no token is needed.

| Package | What it is |
|---|---|
| `@actors/generator` | `Character`, `CharacterStage`, `CharacterEditor`, `createCharacterGenerator` ([README](../packages/generator/README.md)). Pulls in the three below. |
| `@actors/human` | Human sliders, races, robots, expressions, and the `@actors/human/worker` Web Worker entry. |
| `@actors/three` | three.js adapter (materials, skinning, playback), and `loadLibraryAnimal` for the library animals. |
| `@actors/animal` | Generated animals (dog breeds, squirrel, ...) on a shared quadruped rig, the `@actors/animal/worker` entry, and `@actors/animal/library` (catalogue of the private library animals, see below). Install its tarball separately. |
| `@actors/drone` | Procedural drones from building blocks (`@actors/three` has the matching adapter). Install its tarball separately. |
| `@actors/core` | Renderer-free runtime (pack format, morphs, fitting, retargeting). |

## Install

```bash
npm install three https://github.com/ArndRosemeier/Actors/releases/download/v0.9.0/actors-generator-0.9.0.tgz
```

`@actors/generator` depends on the `core`, `human` and `three` tarballs of the same release, so npm fetches them too, and you can import from all four. For animals or drones, add `.../v0.9.0/actors-animal-0.9.0.tgz` or `.../v0.9.0/actors-drone-0.9.0.tgz` to the same command. `three` (0.180 or newer) is a peer dependency, so your app's copy is used. To upgrade, change both version numbers in the URL.

The packages are ES modules with type declarations, built for bundlers (Vite, webpack, esbuild, Rollup). Use `"moduleResolution": "Bundler"` in your `tsconfig.json`.

## Asset files

The packages contain code only. The character data (mesh, morph targets, skins, wardrobe, hair, animations) is a *pack*: a folder with `human/manifest.json` and the files it points to. `Character.load({ pack })` takes the manifest URL. There are three ways to get one:

1. **Hosted (quickest).** Point at the demo's copy, which allows cross-origin requests:
   ```ts
   pack: "https://arndrosemeier.github.io/Actors/packs/human/manifest.json"
   ```
   It always holds the latest `main` build, which can be newer than the package version you installed. Good for prototypes; pin with option 2 for anything you ship.
2. **Download the matching release** into your app's static folder:
   ```bash
   npx actors-packs              # -> public/packs, matching your installed @actors/generator version
   npx actors-packs static/packs # another folder
   ```
   Then use `pack: "/packs/human/manifest.json"`. It runs again only when the version changes, so it can go in a `postinstall` script. Add the folder to `.gitignore`; the archive is large (wardrobe, 64 hairstyles, CMU mocap), but apps fetch most of it lazily (garments, hair and clips load on first use).
3. **Build it yourself** from this repo with `npm run import:human` and copy `apps/viewer/public/packs`.

## Minimal app (Vite)

```ts
import { createCharacterGenerator } from "@actors/generator";
import HumanWorker from "@actors/human/worker?worker"; // optional: shape changes off the main thread

const { character } = await createCharacterGenerator({
  pack: "/packs/human/manifest.json",
  view: document.getElementById("view")!,
  panel: document.getElementById("panel")!, // omit for no controls
  worker: new HumanWorker(),
});
await character.wear("casual");
await character.play("walk");
```

Using your own three.js scene instead of the stage, or three's `WebGPURenderer` (`materials: nodeMaterials` from `@actors/three/webgpu`, three 0.180 or newer): see [packages/generator/README.md](../packages/generator/README.md).

Other bundlers: create the worker with `new Worker(new URL("@actors/human/worker", import.meta.url), { type: "module" })` (webpack 5), or leave `worker` out to evaluate shapes on the main thread.

## Spawning many characters

Characters on the same pack URL share everything loaded for it (pack, morph targets, garments, clips, textures, shaders), so only the first `Character.load` is slow. Keep that first character (or load one behind a loading screen), pass the same `worker` to every character, and call `await character.compile(renderer, camera, scene)` before adding a new one to the scene so its first frame doesn't stall on shader compilation. Details: [packages/generator/README.md](../packages/generator/README.md#spawning-many-characters-quickly).

## Application-owned screen textures

Since 0.8.1, `@actors/three` exports `screenPixels(timeSeconds, data?)` and
`SCREEN_TEXTURE_SIZE` (64). The function returns opaque RGBA8 sRGB pixels,
independent of the garment's colour; an optional buffer is filled and returned
in place. Applications managing their own materials can share one texture per
animation phase across many wearers without porting the pattern generator.

```ts
import { screenPixels, SCREEN_TEXTURE_SIZE } from "@actors/three";
import { DataTexture, SRGBColorSpace } from "three";

const pixels = screenPixels(0);
const phaseTexture = new DataTexture(pixels, SCREEN_TEXTURE_SIZE, SCREEN_TEXTURE_SIZE);
phaseTexture.colorSpace = SRGBColorSpace;
phaseTexture.needsUpdate = true;

// In your application's shared-texture update, e.g. at 12 fps:
screenPixels(elapsedSeconds + phaseOffsetSeconds, pixels);
phaseTexture.needsUpdate = true;
```

For a custom pattern or texture manager, the application owns updates, tint
and disposal. For the built-in pattern, use the scene pool below instead.

## Sharing screen textures (0.9.0)

`ScreenTexturePool` shares four phase textures by default. Advance it once per
scene frame, before updating characters. Each visible phase is generated at most
12 times per second, irrespective of the number of garments. Hidden phases do
no pixel work. Emission tint stays on each material.

```ts
import { ScreenTexturePool } from "@actors/three";
import { nodeMaterials } from "@actors/three/webgpu";
import { Character } from "@actors/generator";

const screenTextures = new ScreenTexturePool(4);
const resident = await Character.load({
  pack, renderer, materials: nodeMaterials, screenTextures,
});
// Pass the same screenTextures to all residents in this scene.
// In the scene loop (once, not once per resident):
screenTextures.update(dt);
for (const character of residents) character.update(dt);
renderer.render(scene, camera);
```

For an existing actor, call `character.actor.setScreenTexturePool(screenTextures)`.
Future garments use that pool too. For a low-level actor, use
`new ThreeActor(runtime, nodeMaterials, { screenTextures })`.
Dispose materials/characters normally: a phase texture is released only after
its last material releases it. Separate pools have separate clocks. A paused
wearer sharing a phase still sees changes caused by active wearers; use
`setScreenTexturePool(null)` for independent animation/pause, or stop advancing
the pool to pause the entire scene. Independent animation resumes on its own
material clock when detached.

`CharacterStage` and `createCharacterGenerator` use a four-phase pool by default
and advance it for you. Characters added to the stage join it; removing one
restores its previous pool. Pass `sharedScreenTextures: false` to keep independent
screens. Direct `Character.load`/`ThreeActor` use independent screens unless a
pool is supplied; `shareWith` inherits its character's pool unless overridden.
The pool is renderer-independent and also works with the regular WebGL kit.
Emissive glTF snapshots and the existing flat-colour crowd LOD are unchanged.

## Riding (horses)

The horse pack (`animals.html?animal=horse` in the viewer) has a `saddle` bone where a rider sits and optional tack meshes (`saddlecloth`, `saddle`, `stirrups`, `bridle`, `bit`, tagged `tack`), hidden until you show them. `Mount` (from `@actors/three`) keeps a human on the saddle through every gait, and `RIDE` (from `@actors/human`) is the seated pose:

```ts
import { Mount } from "@actors/three";
import { RIDE } from "@actors/human";

for (const name of ["saddlecloth", "saddle", "stirrups", "bridle", "bit"]) horse.setVisible(name, true);
const mount = new Mount(horse, character.actor, { pose: RIDE });
horse.play(await runtime.loadClip("trot")); // runtime: the horse pack's runtime
// every frame, after both actors' update(dt):
mount.update();
```

## Cows

The cow pack (`animals.html?animal=cow` in the viewer) is a Braunvieh on the horse rig, so it plays the horse's clips except rearing (idle, eat, sleep, walk, trot, gallop, turns, kick, headbutt, get up, death). Its horns are always-on meshes (`horns`, `horn-tips`) sized by the shape: `horns` 0 hides them in the poll, `hornsLong` sweeps them out like a Highland's. The alpine collar and bell (`collar`, `bell`, tagged `tack` and `bell`) are optional and shown by default in the viewer:

```ts
const cow = await Animal.load<CowShape, CowCoat>("./packs/cow/manifest.json");
cow.setPreset("highland"); // braunvieh, holstein, fleckvieh, hereford, angus, jersey, highland, charolais
cow.shape.udder = 0.8; // -1 small .. 1 large
actor.applyShape(await cow.evaluate());
setFurCoat(fur, cow.coat, cow.shape.size); // pied patches, white face, mealy muzzle, switch colour
for (const name of ["collar", "bell"]) actor.setVisible(name, true);
```

## Chickens

The chicken pack (`animals.html?animal=chicken` in the viewer) is a brown laying hen on Mesh2Motion's bird skeleton, with its own clips: idle, walk, run, peck, scratch, flap and sit. `flap` opens the wings (they are separate surfaces, so they lift off the body).

```ts
const hen = await Animal.load<ChickenShape, ChickenCoat>("./packs/chicken/manifest.json");
hen.setPreset("wyandotte"); // brown, leghorn, australorp, barredRock, sussex, buffOrpington, wyandotte, speckledSussex
hen.shape.comb = 1; // -1 low (rose comb) .. 1 tall (Leghorn)
actor.applyShape(await hen.evaluate());
setFurCoat(fur, hen.coat, hen.shape.size); // drawn feathers: lacing, barring, hackle stripes, mottling
actor.play(await runtime.loadClip("peck")); // runtime: the chicken pack's runtime
```

## Library animals (WildMesh3D, private)

Besides the generated animals, Actors can load 100 ready-made, rigged and animated animals (64 realistic, 36 stylized: wolf, fox, bears, big cats, deer, horse, cow, elephant, birds, fish, ...; 3,744 clips). They are licensed for Arnd's projects only, so the models are **not** in Actors, its releases or its Pages site: they live in the private repository [ArndRosemeier/PrivateAssets](https://github.com/ArndRosemeier/PrivateAssets) (`wildmesh3d/<id>/<id>.glb`). Actors has the loader and a catalogue of names and facts; the [library page](https://arndrosemeier.github.io/Actors/library.html) lists every animal with its clips.

**Get the files into your game.** Add PrivateAssets as a git submodule (needs access to the private repo, also in CI), and copy the animals you use into your public folder before `dev` and `build`:

```bash
git submodule add https://github.com/ArndRosemeier/PrivateAssets.git vendor/private-assets
```

```js
// scripts/library-animals.mjs ("predev" and "prebuild" in package.json)
import { cpSync, rmSync } from "node:fs";
const USED = ["wolf", "deer", "horse"];
rmSync("public/wildmesh3d", { recursive: true, force: true });
for (const id of USED) cpSync(`vendor/private-assets/wildmesh3d/${id}`, `public/wildmesh3d/${id}`, { recursive: true });
```

Put `public/wildmesh3d/` in `.gitignore`. Shipping the animals inside a built game is fine; committing the files to a public repo, or offering them for download on their own, is not. (A git dependency, `npm i -D git+https://github.com/ArndRosemeier/PrivateAssets.git`, works too, but clones all 270 MB into `node_modules`.)

**Load and play.** `loadLibraryAnimal` (from `@actors/three`) loads an animal once and clones it for every further call, so a herd costs one download:

```ts
import { loadLibraryAnimal } from "@actors/three";

const wolf = await loadLibraryAnimal("wolf", { baseUrl: "./wildmesh3d/", rootMotion: "move" });
scene.add(wolf.object);                      // faces +Z; position and turn wolf.object
wolf.play(wolf.clipFor("walk")!, { fade: 0.3 });

// every frame:
const step = wolf.update(dt);                // advances the clip; returns this frame's ground travel
wolf.updateLod(camera);                      // farther away: animation updated less often, no shadows
```

- `clipNames` lists the clips; clip names differ between rigs ("WalkFast_F", "G0_Walk", "walk_fwd_01"), so `clipFor("idle" | "walk" | "trot" | "run" | "eat" | "sit" | "lie" | "attack" | "hit" | "death" | "swim" | "fly")` picks the plain forward loop (skipping transitions, turns and broken partial clips). `play(name, { fade, loop: false, speed })`; `play(null)` stops.
- `rootMotion`: `"in-place"` (default) keeps the animal on `object` and only reports the travel; `"move"` moves `object` along it, turned by the object's rotation; `"keep"` plays the clips as authored. The travel is the clip's root motion where it has one, and otherwise (most clips walk on the spot) estimated from the planted foot sliding back, so `speedOf(name)` gives a ground speed in m/s for every walk, trot and run (wolf walk 2.0, cat walk 0.5, horse gallop 7.2). With "in-place", steer by moving `object` at `speedOf(clip)` yourself.
- `travelled` sums the steps; `height()` and `size` are the bind-pose size; `dispose()` stops the animal and removes it (shared geometry stays loaded; `clearLibraryCache()` forgets the files).

**Pick animals in code** with the catalogue (no files needed), from `@actors/animal/library`:

```ts
import { LIBRARY_ANIMALS, findLibraryAnimals, libraryAnimal, libraryClips } from "@actors/animal/library";

findLibraryAnimals("deer");          // deer, deer-1, female-deer, raindeer-stylized (a reindeer), red-deer-male
findLibraryAnimals("bird stylized"); // by name, group (mammal, bird, reptile, fish, crustacean) and set
libraryAnimal("horse");              // { name, set, group, rig: "G", size: [0.93, 1.95, 2.86], triangles, mb, clips }
libraryClips("horse", /gallop/i);    // clip names
```

Animals with the same `rig` family share bone names, so their clips play on each other (`animal.mixer.clipAction(other.clip("Idle")!)`).

Quirks: the horse and `donkey-1` are big files (13 MB, 288-bone rigs with tack; `donkey-1` is horse-sized); the crow and mammoth were rescaled; a few clips are partial (only some channels, e.g. the buck's "Walk"; `clipFor` skips them, the library page greys them out); clip names are the pack's own, typos included. To preview the models on the library page, serve PrivateAssets' `wildmesh3d/` folder locally (with CORS) and open `library.html?base=<its URL>` from `npm run dev`.

## Licences and credits

Code is MIT. Most assets are CC0, but some garments and hairstyles are **CC-BY**: if your app shows a character wearing one, credit its author. `character.catalog` carries the credit line for those choices (`credit`), and `NOTICE-ASSETS.md` (also inside each package) lists them all. The CMU motion capture data may be used freely but not resold as data. The library animals (WildMesh3D) are not part of Actors: their licence covers Arnd's own projects only (use, modify, sell games with them; don't redistribute or resell the models themselves).

## Publishing a new version (maintainers)

1. Bump `version` in all `packages/*/package.json` (and `tools/*`, `apps/viewer`) (and the `@actors/*` dependency versions) to the same new number; run `npm install` to update the lockfile.
2. Optionally write the release notes in `docs/releases/<version>.md` (what's new, how to use it); they go under the install line on the release page, and editing the file later updates the page on the next push to `main`.
3. Merge to `main`. The Pages workflow builds the packages, checks them in a fresh Vite app (`npm run check:consumer`), and creates release `v<version>` with the six tarballs and `actors-packs-<version>.tar.gz`. A version that already has a release keeps its tarballs; only its notes are refreshed.

Locally, `npm run build:packages` writes the tarballs to `release/`, and `npm run check:consumer [dir]` installs them into a throwaway app and builds it.
