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
* `clips/<library>/index.json` + `*.bin`: large clip libraries (e.g. CMU) kept out of the manifest and loaded on demand (`ActorRuntime.loadClipLibrary`); clips share bone lists and rest directions through named rigs and may be stored as int16 (`encoding: "i16"`).
* `garments/*.bin`: meshes with their own `blob` (the wardrobe). `ActorRuntime.loadMeshes` loads them on first use (also in the worker), `ThreeActor.addMeshes` creates their scene meshes, and the next shape evaluation fits them.
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
8. `Retargeter`: plays a clip on any fitted skeleton: each limb bone (arms, hands, fingers, legs, feet) is first swung (shortest arc) onto the source rest direction, then the recorded world-space change is applied. Torso, neck, head and clavicle bones are not swung, because each rig places them differently (aligning them tilted the pelvis and lifted the shoulders); they keep the target's own rest posture and only get the change. This is the standard "align rest poses, copy world rotations" retarget.

All of it is synchronous after targets load and has no DOM dependency. `serveRuntime` / `RemoteRuntime` (`packages/core/src/worker.ts`) run it in a Web Worker; the generator does this when given a worker, and the viewer does by default (`?noworker` turns it off).

`@actors/generator` sits on top: `Character` reconciles a JSON `CharacterConfig` onto a `Human` + `ThreeActor` (shape changes are merged into one worker job; look changes such as garments or hair are instant), `CharacterStage` is a studio scene and `CharacterEditor` a DOM panel that only uses the public `Character` API.

## Detail levels (`packages/core/src/lod.ts`)

`manifest.lods` lists the levels (name, suggested camera distance, the bones that still animate, whether to merge). Every level draws from the same `ActorShape`, so morphs, garment fitting and the skeleton carry over and switching costs nothing:

* `MeshDef.lods`: the levels a mesh is drawn at (lashes, teeth and tongue only at full detail).
* `MeshDef.lodOf`: a stand-in drawn where the named mesh is not (the base-mesh body for the subdivided one at "Medium", MakeHuman's 741-vertex proxy body at "Crowd"). The proxy body is bound to the base mesh like a garment, so it follows every slider, and shares the skin UV layout.
* `MeshDef.simplified`: reduced triangle lists over the same render vertices, computed by the importer with meshoptimizer (UV seams and hem cuts kept). Adapters only swap index buffers.
* `LodDef.bones`: the crowd level animates no finger bones; `lodBoneMap` / `remapSkin` move their weights to the hand.
* `LodDef.merge`: `mergeMeshes` / `fillMerged` build one mesh from the body and garments (the adapter colours garments by their tint or mean texture colour and keeps the skin texture), so a crowd actor is one draw call plus its hair.

## Renderer adapter (`@actors/three`)

One `SkinnedMesh` per pack mesh, sharing one `Skeleton`. When the shape changes, vertex buffers are rewritten and the skeleton is re-bound in place; running animations are re-baked against the new bind pose.

Materials (`materials.ts`) patch three's built-in shaders: hair cards (alpha to coverage, luminance-preserving recolour), leg colliders for skirt-skinned garments (`colliders.ts`), skin (mask tints, brows, pores, wrapped diffuse, procedural vulva detail), eyes (iris recolouring), lashes, cloth (weave or garment normal maps, per-pixel hem cut from the `clip` attribute, luminance-preserving recolour) and dual-quaternion skinning on all of them, including the shadow pass. `setLod(level)` / `updateLod(camera)` switch the detail level: index buffers per level are cached, stand-ins swap visibility, and the crowd level hides body and garments behind one merged `SkinnedMesh` (`crowd` material in the kit, linear skinning) and drops finger tracks from the playing clip. Two morph channels per face mesh ("expression", "blink") are filled from `surfaceDelta` and blended every frame.

## Adding another species

Write an importer that emits an actor pack, plus a small package (like `@actors/human`) that maps that species' sliders to target weights. Core and adapters are reused unchanged.
