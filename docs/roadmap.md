# Roadmap

Based on the research in the project (`research/character-base-options.md`, `research/makehuman-quality-config.md`).

## Done
- Actor pack format, importer, renderer-free runtime, three.js adapter, viewer, glTF export.
- All MakeHuman macro + detail sliders, adult age clamp in the data path.
- **Skin**: MakeHuman's 18 CC0 photo skins blended on the GPU by gender, age and ethnicity; own skin shader (pores, wrap-lighting subsurface approximation); procedural mode with region tints from MPFB masks.
- **Eyes, brows, lashes, teeth**: MakeHuman CC0 eyes (iris colour presets), MakeHuman CC0 eyebrow proxies (5 styles, painted brows as an option), procedural lashes, wet teeth/tongue materials.
- **Hair**: 9 MakeHuman CC0 hairstyles as fitted proxies, alpha-to-coverage cards, recolourable.
- **Anatomy**: male geometry from the subdivided MakeHuman genital helper; female detail drawn procedurally in the skin shader. Adult-only, hidden under covering garments.
- **Detail**: Catmull-Clark subdivision at load time; dual-quaternion skinning.
- **Clothing**: generated garment library cut from the tights helper with per-pixel hems, plus a wardrobe of about 90 CC0 MakeHuman garments (tops, trousers, skirts, dresses, suits, complete outfits, underwear, hosiery, shoes, hats, glasses, gloves) fitted by `.mhclo` binding, each in its own file and loaded when first worn. Skirt skinning (averaged thigh weights) and GPU leg colliders for skirts and dresses; body layers decide what replaces what; every garment recolourable (palette + free colour).
- **Animation**: Quaternius Universal Animation Library clips (CC0, Unreal-mannequin skeleton with fingers and a stored rest pose) retargeted to any fitted skeleton (limbs aligned to the source rest pose, torso and clavicles keep the body's own posture); nine expression presets from MakeHuman's face units, auto-blink on GPU morphs.
- **Animation library**: all 84 usable Quaternius clips with categories; the CMU database (2,548 motions) as an on-demand clip library (BVH rest pose from the offsets, zero-length joints skipped, 16-bit clips, ~100 KB each), searchable in the editor.
- **Fantasy races** (from Norgo): ten races and two-race mixes; target recipes, bone proportion pass, head scale (capped for adult proportions), pointed ear tips and overall size in the core shape pipeline.
- **Generator**: `@actors/generator` packages everything as a reusable `Character` (JSON config, every clip, outfit presets from nude up, randomize, save/load, glTF export) with an optional stage and editor panel; the viewer is built on it.
- **Performance**: shape evaluation in a Web Worker; subdivision computed at load time; targets streamed on demand; the importer pulls single files out of MakeHuman's asset-pack zips with HTTP range requests.

## Known gaps and next steps
1. **Anatomy quality**: the male helper mesh is low-poly even after subdivision. The only CC0 community replacement ("man genital" by ukiyoe) was tested and is not better: it has no scrotum and a pubic plate that shows as a raised patch on the subdivided body. Other community genitals are AGPL. Next step: a sculpted or commissioned CC0 mesh. Female detail is shader-only (no geometry).
2. **Corrective shapes**: DQS fixes volume loss; per-joint corrective morphs (shoulder raise, deep knee bend) would further improve extreme poses.
3. **Garments**: no cloth simulation. Combined outfits (e.g. shirt + jeans in one MakeHuman mesh) take one colour for the whole mesh; per-part colours would need part masks. Hats don't hide or flatten hair yet. Long skirts stay outside the legs (colliders) but stretch in a wide stride; multi-layer skirts (tiers) are not supported by the colliders yet.
4. **Animation**: the free Standard editions have ~90 clips between them; only 13 are wired up. No facial animation in the clips (expressions are separate). The first retargeter used CMU BVH files without a real rest pose and broke shoulders and hands; clips now always come from sources with a stored rest pose, and `?compare` in the viewer shows the source next to the actor.
5. **Hair quality**: MakeHuman's hair cards are game-grade; strand-level or higher-density hair would need new assets.
6. **Download size**: hair meshes sit in the base blob (3.5 MB); they could be split out and streamed like targets.
7. **WebGPU**: the skin, eye, DQS, hem and collider shaders are GLSL patches for WebGL; WebGPU needs TSL ports.
