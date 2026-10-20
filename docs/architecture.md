# Architecture

```
MPFB2 data (CC0) --[tools/import-makehuman]--> actor pack --[@actors/core]--> shape --[@actors/three]--> three.js scene
                                                   |                                \--> glTF export (any engine)
                                         manifest.json + base.bin
                                         + targets/*.bin (streamed)
```

## Actor pack (`packages/core/src/format.ts`)

* `manifest.json`: meshes, proxies (garments), skeleton, skin, target index and species data (`extra.human`).
* `base.bin`: base positions, render meshes (split at UV seams, with a map back to shape vertices), skin weights, garment bindings.
* `targets/*.bin`: one file per morph target, int16-quantized, sparse or dense, loaded on demand. Only the targets with a non-zero weight are fetched, so the first load is a few MB instead of ~38 MB.

## Runtime (`ActorRuntime`)

1. Species logic turns sliders into target weights (`@actors/human`: product of macro factors, MakeHuman-style).
2. `morph`: base + Σ weight · target (CPU, ~20 ms for a typical update).
3. `computeNormals` on shape vertices (so UV seams don't show).
4. `fitSkeleton`: each joint = mean of marker vertices, bone frames from head/tail/roll (Blender convention, so Blender-authored animation stays compatible).
5. `fitProxy`: garments are bound to body triangles (MakeHuman `.mhclo` scheme) and follow every morph.

All of it is synchronous after targets load and has no DOM dependency, so it can move into a Web Worker or WebAssembly without API changes.

## Renderer adapter (`@actors/three`)

One `SkinnedMesh` per pack mesh, sharing one `Skeleton`. When the shape changes, vertex buffers are rewritten and the skeleton is re-bound in place; running animations are re-baked against the new bind pose.

## Adding another species

Write an importer that emits an actor pack, plus a small package (like `@actors/human`) that maps that species' sliders to target weights. Core and adapters are reused unchanged.
