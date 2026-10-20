# Actors

Engine-agnostic, morphable, rigged characters for TypeScript web apps. Humans first; other species (animals, …) later, using the same pack format and runtime.

The first actor is an adult human built on the **MakeHuman / MPFB2 CC0 assets** (hm08 base mesh, ~1,000 morph targets, `game_engine` rig and skin weights). See [docs/architecture.md](docs/architecture.md) for how it fits together and [docs/roadmap.md](docs/roadmap.md) for what comes next.

## Quick start

```bash
npm install
npm run import:human   # clones MPFB2, fetches the CC0 skins/hair/skirts/animations it needs into .cache/, builds the pack
npm run dev            # viewer at http://localhost:5173
```

`npm run import:human -- --mpfb <path>` uses an existing MPFB2 checkout instead of cloning.

Other scripts: `npm test` (unit tests), `npm run typecheck`, `npm run build` (static viewer build in `apps/viewer/dist`), and `node apps/viewer/scripts/smoke.mjs [url] [outDir]` (headless browser smoke test with screenshots; dev server must be running).

## Layout

| Path | What it is |
|---|---|
| `packages/core` | Renderer-free runtime: pack format, morph blending, normals, Catmull-Clark subdivision, skeleton fitting, garment (proxy) fitting, clip retargeting, Web Worker evaluation. Runs in a browser, a worker or Node. |
| `packages/human` | Human-specific logic: MakeHuman-style macro sliders (gender, age, muscle, …), detail sliders, adult age clamp, facial expressions and blinking, worker entry. |
| `packages/three` | three.js adapter: skinned meshes sharing one skeleton, skin/eye/lash/cloth materials, dual-quaternion skinning, GPU face morphs, clip playback. |
| `tools/import-makehuman` | Offline importer: MakeHuman/MPFB2 data, MakeHuman eyes and Quaternius animations → actor pack (JSON manifest + binary blob + one streamed file per morph target + clips + textures). |
| `apps/viewer` | Vite demo: live sliders, skin/eyes/detail, outfit layering, animation clips (with `?compare` to show the source animation side by side), expressions, glTF export. |

## What the human can do

* **Shape**: every MakeHuman macro and detail slider, evaluated in a Web Worker so dragging never stalls rendering.
* **Skin**: MakeHuman's 18 CC0 photo skins (young / middle-aged / old × female / male × African / Asian / Caucasian), blended on the GPU to follow the gender, age and ethnicity sliders; own skin shader with pores and wrapped per-channel diffuse as cheap subsurface scattering. A procedural mode (region tints from MPFB's CC0 masks (lips, areolae, nails, eyelids, genitals, ears), skin-tone slider) is still available.
* **Hair and brows**: 9 MakeHuman CC0 hairstyles and 5 eyebrow styles as fitted proxies that follow every morph, with recolouring.
* **Detail**: one Catmull-Clark subdivision level built at load time (55k vertices for the body) with a low-detail option; dual-quaternion skinning on every material so elbows, knees and shoulders keep their volume.
* **Face**: MakeHuman CC0 eyes with adjustable iris colour, procedural eyelashes, teeth and tongue; nine expression presets built from MakeHuman's 34 face units (mixed by ethnicity) plus automatic blinking, blended on the GPU.
* **Anatomy** (adults only): male genital mesh (subdivided MakeHuman helper) and procedural female detail in the skin shader; hidden automatically under garments that cover them.
* **Clothing**: briefs, bra, T-shirt, long-sleeve top, shorts, jeans, tights, fitted socks, plus a long and a mini skirt from MakeHuman's CC0 skirts pack (skirt skinning + leg colliders, so a stride doesn't pierce them), all following every morph; layering by inflate and depth bias, smooth hems cut per pixel, skin under clothes hidden.
* **Animation**: 13 clips from Quaternius' CC0 Universal Animation Library (idle, talk, arms folded, phone, walk, formal walk, jog, sprint, crouch walk, dance, sit, nod, pick up), including fingers, retargeted to the fitted rig of any body shape.

## Engine-agnostic by design

* The core never touches a renderer; adapters do (three.js today, Babylon.js etc. later).
* Packs use glTF conventions (meters, +Y up, +Z forward).
* The viewer exports any character (mesh, rig, garments, animations) as **glTF/GLB**, which Unity, Unreal, Godot and Blender import.

## Content rules

* **Adults only.** Age is clamped to 18+ in the data path (`@actors/human` `sanitizeParams`), not just in the UI, and the importer never ships the baby targets.
* Code: MIT (see [LICENSE](LICENSE)). Assets: see [NOTICE-ASSETS.md](NOTICE-ASSETS.md). No MakeHuman/MPFB *code* is used; the runtime is an independent implementation.
