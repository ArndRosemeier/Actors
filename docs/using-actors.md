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
npm install three https://github.com/ArndRosemeier/Actors/releases/download/v0.6.1/actors-generator-0.6.1.tgz
```

`@actors/generator` depends on the `core`, `human` and `three` tarballs of the same release, so npm fetches them too, and you can import from all four. For animals or drones, add `.../v0.6.1/actors-animal-0.6.1.tgz` or `.../v0.6.1/actors-drone-0.6.1.tgz` to the same command. `three` (0.180 or newer) is a peer dependency, so your app's copy is used. To upgrade, change both version numbers in the URL.

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

## Licences and credits

Code is MIT. Most assets are CC0, but some garments and hairstyles are **CC-BY**: if your app shows a character wearing one, credit its author. `character.catalog` carries the credit line for those choices (`credit`), and `NOTICE-ASSETS.md` (also inside each package) lists them all. The CMU motion capture data may be used freely but not resold as data.

## Publishing a new version (maintainers)

1. Bump `version` in all `packages/*/package.json` (and `tools/*`, `apps/viewer`) (and the `@actors/*` dependency versions) to the same new number; run `npm install` to update the lockfile.
2. Optionally write the release notes in `docs/releases/<version>.md` (what's new, how to use it); they go under the install line on the release page, and editing the file later updates the page on the next push to `main`.
3. Merge to `main`. The Pages workflow builds the packages, checks them in a fresh Vite app (`npm run check:consumer`), and creates release `v<version>` with the six tarballs and `actors-packs-<version>.tar.gz`. A version that already has a release is skipped.

Locally, `npm run build:packages` writes the tarballs to `release/`, and `npm run check:consumer [dir]` installs them into a throwaway app and builds it.
