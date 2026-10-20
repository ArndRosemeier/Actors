# Actors

Engine-agnostic, morphable, rigged characters for TypeScript web apps. Humans first; other species (animals, …) later, using the same pack format and runtime.

The first actor is an adult human built on the **MakeHuman / MPFB2 CC0 assets** (hm08 base mesh, ~1,000 morph targets, `game_engine` rig and skin weights). See [docs/architecture.md](docs/architecture.md) for how it fits together and [docs/roadmap.md](docs/roadmap.md) for what comes next.

## Quick start

```bash
npm install
npm run import:human   # clones MPFB2 (CC0 assets) into .cache/ and builds the human pack
npm run dev            # viewer at http://localhost:5173
```

`npm run import:human -- --mpfb <path>` uses an existing MPFB2 checkout instead of cloning.

Other scripts: `npm test` (unit tests), `npm run typecheck`, `npm run build` (static viewer build in `apps/viewer/dist`), and `node apps/viewer/scripts/smoke.mjs [url] [outDir]` (headless browser smoke test with screenshots; dev server must be running).

## Layout

| Path | What it is |
|---|---|
| `packages/core` | Renderer-free runtime: pack format, morph blending, normals, skeleton fitting, garment (proxy) fitting, procedural clips. Runs in a browser, a worker or Node. |
| `packages/human` | Human-specific logic: MakeHuman-style macro sliders (gender, age, muscle, …), detail sliders, adult age clamp, test clips. |
| `packages/three` | three.js adapter: skinned meshes sharing one skeleton, re-bound in place when the shape changes. |
| `tools/import-makehuman` | Offline importer: MakeHuman/MPFB2 data → actor pack (JSON manifest + binary blob + one streamed file per morph target). |
| `apps/viewer` | Vite demo: live sliders, outfit toggles, idle/walk, glTF export. |

## Engine-agnostic by design

* The core never touches a renderer; adapters do (three.js today, Babylon.js etc. later).
* Packs use glTF conventions (meters, +Y up, +Z forward).
* The viewer exports any character (mesh, rig, garments, animations) as **glTF/GLB**, which Unity, Unreal, Godot and Blender import.

## Content rules

* **Adults only.** Age is clamped to 18+ in the data path (`@actors/human` `sanitizeParams`), not just in the UI, and the importer never ships the baby targets.
* Assets: see [NOTICE-ASSETS.md](NOTICE-ASSETS.md). No MakeHuman/MPFB *code* is used; the runtime is an independent implementation.
