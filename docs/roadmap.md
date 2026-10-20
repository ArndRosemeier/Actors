# Roadmap

Based on the research in the project (`research/character-base-options.md`, `research/makehuman-quality-config.md`).

## Done
- Actor pack format, importer, renderer-free runtime, three.js adapter, viewer, glTF export.
- All MakeHuman macro + detail sliders, adult age clamp in the data path.
- **Skin**: own skin shader (region tints from MPFB masks, eyebrows, pores, wrap-lighting subsurface approximation).
- **Eyes, brows, lashes, teeth**: MakeHuman CC0 eyes (iris colour presets), procedural lashes and brows, wet teeth/tongue materials.
- **Anatomy**: male geometry from the subdivided MakeHuman genital helper; female detail drawn procedurally in the skin shader. Adult-only, hidden under covering garments.
- **Detail**: Catmull-Clark subdivision at load time; dual-quaternion skinning.
- **Clothing**: generated garment library cut from the tights helper with per-pixel hems, plus skirt and fitted `.mhclo` socks; layering.
- **Animation**: Quaternius Universal Animation Library clips (CC0, Unreal-mannequin skeleton with fingers and a stored rest pose) retargeted to any fitted skeleton; nine expression presets from MakeHuman's face units, auto-blink on GPU morphs.
- **Performance**: shape evaluation in a Web Worker; subdivision computed at load time (base download 6.5 MB → 1.6 MB); targets streamed on demand.

## Known gaps and next steps
1. **Skin textures**: no photographic skin albedo yet. The CC0 MakeHuman skin packs live on makehumancommunity.org, which this build environment cannot reach; the shader is ready for a `color` texture on the body mesh.
2. **Hair**: none yet (scalp hair is not part of the roadmap's first pass).
3. **Anatomy quality**: the male helper mesh is low-poly even after subdivision; a sculpted, CC0 replacement mesh is the next upgrade. Female detail is shader-only (no geometry).
4. **Corrective shapes**: DQS fixes volume loss; per-joint corrective morphs (shoulder raise, deep knee bend) would further improve extreme poses.
5. **Garments**: no cloth simulation; the skirt is a tube that legs can poke through in a wide stride.
6. **Animation**: the free Standard editions have ~90 clips between them; only 13 are wired up. No facial animation in the clips (expressions are separate). The first retargeter used CMU BVH files without a real rest pose and broke shoulders and hands; clips now always come from sources with a stored rest pose, and `?compare` in the viewer shows the source next to the actor.
7. **WebGPU**: the skin, eye, DQS and hem shaders are GLSL patches for WebGL; WebGPU needs TSL ports.
