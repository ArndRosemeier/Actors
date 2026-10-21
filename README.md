# Actors

Engine-agnostic, morphable, rigged characters for TypeScript web apps. Humans first; other species (animals, …) later, using the same pack format and runtime.

The first actor is an adult human built on the **MakeHuman / MPFB2 CC0 assets** (hm08 base mesh, ~1,000 morph targets, `game_engine` rig and skin weights). See [docs/architecture.md](docs/architecture.md) for how it fits together and [docs/roadmap.md](docs/roadmap.md) for what comes next.

## Quick start

```bash
npm install
npm run import:human   # clones MPFB2, fetches the CC0 skins/hair/skirts/animations and the CMU mocap into .cache/, builds the pack
npm run dev            # character generator at http://localhost:5173
```

`npm run import:human -- --mpfb <path>` uses an existing MPFB2 checkout instead of cloning. The first full import downloads about 6 GB of CMU BVH files (converted clips are cached, raw files are deleted); `--no-cmu` skips the library and `--cmu-limit 50` imports only the first 50 motions.

Other scripts: `npm test` (unit tests), `npm run typecheck`, `npm run build` (static viewer build in `apps/viewer/dist`), and `node apps/viewer/scripts/smoke.mjs [url] [outDir] [--all]` (headless browser smoke test with screenshots, `--all` shoots every outfit preset and clip; dev server must be running).

## Live demo

Every push to `main` builds the pack and the generator and deploys them to GitHub Pages (`.github/workflows/pages.yml`): https://arndrosemeier.github.io/Actors/ (add `?compare` to see the source animations side by side). Pull requests run the same build and tests without deploying.

## Use it in your app

`@actors/generator` is the reusable character generator: a `Character` you add to any three.js scene (every option and clip, one JSON config), plus an optional ready-made stage and control panel. See [packages/generator/README.md](packages/generator/README.md).

Other projects install it from a GitHub release (no npm registry or token needed) and get the asset files from the hosted demo or with `npx actors-packs`; see [docs/using-actors.md](docs/using-actors.md):

```bash
npm install three https://github.com/ArndRosemeier/Actors/releases/download/v0.5.0/actors-generator-0.5.0.tgz
npx actors-packs   # asset packs for this version -> public/packs
```

```ts
const character = await Character.load({ pack: "/packs/human/manifest.json", renderer });
scene.add(character.object);
await character.set({ body: { gender: 1, muscle: 0.7 }, hair: "hair-short04" });
await character.wear("casual"); // or "nude", or any garment list via set({ outfit })
await character.play("walk");
```

## Layout

| Path | What it is |
|---|---|
| `packages/core` | Renderer-free runtime: pack format, morph blending, normals, Catmull-Clark subdivision, skeleton fitting, garment (proxy) fitting, clip retargeting, Web Worker evaluation. Runs in a browser, a worker or Node. |
| `packages/human` | Human-specific logic: MakeHuman-style macro sliders (gender, age, muscle, …), detail sliders, adult age clamp, facial expressions and blinking, worker entry. |
| `packages/three` | three.js adapter: skinned meshes sharing one skeleton, skin/eye/lash/cloth materials, dual-quaternion skinning, GPU face morphs, clip playback. Material kits: `webglMaterials` (WebGLRenderer) and `nodeMaterials` from `@actors/three/webgpu` (WebGPURenderer). |
| `tools/import-makehuman` | Offline importer: MakeHuman/MPFB2 data, MakeHuman eyes and Quaternius animations → actor pack (JSON manifest + binary blob + one streamed file per morph target + clips + textures). |
| `packages/drone` | Procedural futuristic drones from building blocks (hull, propulsion, sensors, tools, opt-in weapons, lights, palettes): seeded JSON spec, rigid rig, baked clips; drawn by `ThreeDrone` in `@actors/three`. See [docs/drones.md](docs/drones.md). |
| `packages/generator` | Reusable character generator on top of the three adapters: `Character` (one JSON config for shape, look, outfit, anatomy, clip, face; randomize, save/load, glTF export), `CharacterStage` (studio scene) and `CharacterEditor` (DOM control panel). |
| `apps/viewer` | The generator as a Vite app (a few lines on top of `@actors/generator`), with `?compare` to show the source animation side by side. |

## What the human can do

* **Shape**: every MakeHuman macro and detail slider, evaluated in a Web Worker so dragging never stalls rendering.
* **Fantasy races**: human, elf, dwarf, orc, halfling, goblin, sylvan, drakeborn, umbral and giantkin (ported from the author's Norgo game), and mixes of any two. Each race adds its own MakeHuman target recipe, per-bone length and girth scaling (short, thick dwarf limbs; long goblin arms), head scale, procedural pointed ear tips and an overall size, all applied before the skeleton, clothes and hair are fitted, so everything follows. Picking a race rolls a typical member: race height, skin colour (the photo skin is recoloured, so orcs are green and umbrals grey-violet), eye colour, hair colour and style, plus race skin patterns drawn in 3D bind-pose space (scales, bark, spots, stripes, tattoos, glowing veins, crystals, freckles), slit or goat pupils and glowing irises. Generated add-ons, built from the current body and skinned to existing bones (so clips and glTF export need nothing extra): horns (ram, straight, swept, antler, crown), orc tusks, tails, strand-card beards (full, long, braided, forked, goatee, mustache, mutton chops, chinstrap), sylvan leaf hair and the drakeborn crest. Tails have their own bone chain with a sway baked into every clip, beards and tusks follow facial expressions, and stubble is painted on the skin.
* **Skin**: MakeHuman's 18 CC0 photo skins (young / middle-aged / old × female / male × African / Asian / Caucasian), blended on the GPU to follow the gender, age and ethnicity sliders; own skin shader with pores and wrapped per-channel diffuse as cheap subsurface scattering. A procedural mode (region tints from MPFB's CC0 masks (lips, areolae, nails, eyelids, genitals, ears), skin-tone slider) is still available.
* **Hair and brows**: 64 MakeHuman hairstyles (9 system styles, 24 CC0 and 31 CC-BY community styles that load when first shown; CC-BY authors are credited in the editor and NOTICE-ASSETS.md) and 5 eyebrow styles as fitted proxies that follow every morph, with recolouring.
* **Detail**: one Catmull-Clark subdivision level built at load time (55k vertices for the body) with a low-detail option; dual-quaternion skinning on every material so elbows, knees and shoulders keep their volume.
* **Levels of detail**: three levels built into the actor core, all drawn from the same shape (morphs, fitted clothes and skeleton carry over, switching is instant): full detail; "Medium" (base mesh instead of the subdivided body, garments, hair and eyes with about half their triangles, no lashes, teeth or tongue); "Crowd" (MakeHuman's CC0 741-vertex proxy body with garments merged into one mesh in flat colours, one draw call plus the hair, fingers not animated). `character.setLod(n | "auto")` picks by camera distance; `?crowd=100` in the viewer shows it.
* **Face**: MakeHuman CC0 eyes with adjustable iris colour, procedural eyelashes, teeth and tongue; nine expression presets built from MakeHuman's 34 face units (mixed by ethnicity) plus automatic blinking, blended on the GPU.
* **Anatomy** (adults only): male genital mesh (subdivided MakeHuman helper) and procedural female detail in the skin shader; hidden automatically under garments that cover them.
* **Clothing**: briefs, bra, T-shirt, long-sleeve top, shorts, jeans, tights, fitted socks, plus a long and a mini skirt from MakeHuman's CC0 skirts pack (skirt skinning + leg colliders, so a stride doesn't pierce them), all following every morph; layering by inflate and depth bias, smooth hems cut per pixel, skin under clothes hidden.
* **Animation**: 84 clips from Quaternius' CC0 Universal Animation Library 1 + 2 (idles, walks, runs, jumps, swimming, sitting, work, combat, reactions, zombie, …, with fingers), plus the whole CMU motion capture database (2,548 motions, searchable, loaded on demand), all retargeted to the fitted rig of any body shape.

## Engine-agnostic by design

* The core never touches a renderer; adapters do (three.js today, Babylon.js etc. later). The three.js adapter draws with `THREE.WebGLRenderer` (GLSL patches) or with three's `WebGPURenderer` (node materials from `@actors/three/webgpu`, on WebGPU or its WebGL 2 backend); the viewer shows the latter with `?webgpu` or `?webgpu-gl`.
* Packs use glTF conventions (meters, +Y up, +Z forward).
* The viewer exports any character (mesh, rig, garments, animations) as **glTF/GLB**, which Unity, Unreal, Godot and Blender import.

## Content rules

* **Adults only.** Age is clamped to 18+ in the data path (`@actors/human` `sanitizeParams`), not just in the UI, and the importer never ships the baby targets. Small races (halflings, goblins) keep adult proportions: head scale is capped (`MAX_HEAD_SCALE`).
* Code: MIT (see [LICENSE](LICENSE)). Assets: see [NOTICE-ASSETS.md](NOTICE-ASSETS.md). No MakeHuman/MPFB *code* is used; the runtime is an independent implementation.
