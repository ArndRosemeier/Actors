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
* `clips/*.bin`: retargetable motion clips (per bone: world-space rotation change since the source rig's rest pose + the bone's rest direction; root motion in hip heights). The source rig must have a real rest pose (glTF/Blender rest), never "frame 0 of the take".
* `textures/`: skin region masks, iris, photo skins (`extra.human.skins`, blended by `skinTextureWeights` and the adapter's `SkinComposer`), hair/brow and skirt textures.
* Meshes can be derived at load time (`subdivide: { source }`), so the subdivided body costs no download.
* `targets/*.bin`: one file per morph target, int16-quantized, sparse or dense, loaded on demand. Only the targets with a non-zero weight are fetched, so the first load is a few MB instead of ~38 MB.

## Runtime (`ActorRuntime`)

1. Species logic turns sliders into target weights (`@actors/human`: product of macro factors, MakeHuman-style).
2. `morph`: base + Σ weight · target (CPU, ~20 ms for a typical update).
3. `computeNormals` on shape vertices (so UV seams don't show).
4. `fitSkeleton`: each joint = mean of marker vertices, bone frames from head/tail/roll (Blender convention, so Blender-authored animation stays compatible).
5. `fitProxy`: garments are bound to body triangles (MakeHuman `.mhclo` scheme) and follow every morph.
6. Subdivided meshes follow via their stencil (each new vertex is a fixed weighted sum of base vertices).
7. `surfaceDelta`: position/normal deltas for extra targets on top of a shape, used for GPU face morphs.
8. `Retargeter`: plays a clip on any fitted skeleton: each bone is first swung (shortest arc) onto the source rest direction, then the recorded world-space change is applied. This is the standard "align rest poses, copy world rotations" retarget.

All of it is synchronous after targets load and has no DOM dependency. `serveRuntime` / `RemoteRuntime` (`packages/core/src/worker.ts`) run it in a Web Worker; the viewer does this by default (`?noworker` turns it off).

## Renderer adapter (`@actors/three`)

One `SkinnedMesh` per pack mesh, sharing one `Skeleton`. When the shape changes, vertex buffers are rewritten and the skeleton is re-bound in place; running animations are re-baked against the new bind pose.

Materials (`materials.ts`) patch three's built-in shaders: hair cards (alpha to coverage, luminance-preserving recolour), leg colliders for skirt-skinned garments (`colliders.ts`), skin (mask tints, brows, pores, wrapped diffuse, procedural vulva detail), eyes (iris recolouring), lashes, cloth (weave normal maps, per-pixel hem cut from the `clip` attribute) and dual-quaternion skinning on all of them, including the shadow pass. Two morph channels per face mesh ("expression", "blink") are filled from `surfaceDelta` and blended every frame.

## Adding another species

Write an importer that emits an actor pack, plus a small package (like `@actors/human`) that maps that species' sliders to target weights. Core and adapters are reused unchanged.
