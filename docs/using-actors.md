# Using Actors in another project

The character generator ships as six installable packages, attached to each [GitHub release](https://github.com/ArndRosemeier/Actors/releases) as npm tarballs. Nothing is on the public npm registry; npm installs straight from the release URL, and no token is needed.

| Package | What it is |
|---|---|
| `@actors/generator` | `Character`, `CharacterStage`, `CharacterEditor`, `createCharacterGenerator` ([README](../packages/generator/README.md)). Pulls in the three below. |
| `@actors/human` | Human sliders, races, robots, expressions, and the `@actors/human/worker` Web Worker entry. |
| `@actors/three` | three.js adapter (materials, skinning, playback). |
| `@actors/animal` | Generated animals (dog breeds, squirrel, ...) on a shared quadruped rig, plus the `@actors/animal/worker` entry. Install its tarball separately. |
| `@actors/drone` | Procedural drones from building blocks (`@actors/three` has the matching adapter). Install its tarball separately. |
| `@actors/core` | Renderer-free runtime (pack format, morphs, fitting, retargeting). |

## Install

```bash
npm install three https://github.com/ArndRosemeier/Actors/releases/download/v0.8.2/actors-generator-0.8.2.tgz
```

`@actors/generator` depends on the `core`, `human` and `three` tarballs of the same release, so npm fetches them too, and you can import from all four. For animals or drones, add `.../v0.8.2/actors-animal-0.8.2.tgz` or `.../v0.8.2/actors-drone-0.8.2.tgz` to the same command. `three` (0.180 or newer) is a peer dependency, so your app's copy is used. To upgrade, change both version numbers in the URL.

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

## Sharing screen textures (0.8.2)

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

## Licences and credits

Code is MIT. Most assets are CC0, but some garments and hairstyles are **CC-BY**: if your app shows a character wearing one, credit its author. `character.catalog` carries the credit line for those choices (`credit`), and `NOTICE-ASSETS.md` (also inside each package) lists them all. The CMU motion capture data may be used freely but not resold as data.

## Publishing a new version (maintainers)

1. Bump `version` in all `packages/*/package.json` (and `tools/*`, `apps/viewer`) (and the `@actors/*` dependency versions) to the same new number; run `npm install` to update the lockfile.
2. Optionally write the release notes in `docs/releases/<version>.md` (what's new, how to use it); they go under the install line on the release page, and editing the file later updates the page on the next push to `main`.
3. Merge to `main`. The Pages workflow builds the packages, checks them in a fresh Vite app (`npm run check:consumer`), and creates release `v<version>` with the six tarballs and `actors-packs-<version>.tar.gz`. A version that already has a release keeps its tarballs; only its notes are refreshed.

Locally, `npm run build:packages` writes the tarballs to `release/`, and `npm run check:consumer [dir]` installs them into a throwaway app and builds it.
