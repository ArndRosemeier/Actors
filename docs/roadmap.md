# Roadmap

Based on the research in the project (`research/character-base-options.md`, `research/makehuman-quality-config.md`).

## Done (prototype)
- Actor pack format, importer, renderer-free runtime, three.js adapter, viewer.
- All MakeHuman macro + detail sliders, adult age clamp.
- Rig re-fitted to every body shape; procedural idle/walk to check skinning.
- Garments: base-mesh helpers (tights, skirt) and a fitted proxy garment (socks); skin under garments hidden.
- glTF export.

## Next
1. **Skin**: 4K skin textures on the MakeHuman UV layout (CC0 skins packs / Skins Vol.0 CC-BY), pore detail map, custom subsurface skin shader for WebGL/WebGPU.
2. **Eyes, brows, lashes, teeth** from the CC0 system assets with proper materials.
3. **Anatomy**: our own genital meshes as proxies (the community ones are AGPL), adult-only.
4. **Detail**: one subdivision level + sculpted detail baked into normal maps; corrective shapes for elbows/knees/shoulders/hips.
5. **Clothing**: `.mhclo` garment library (CC0 packs + our own), layering.
6. **Animation**: retarget real mocap (Mixamo / CMU) to the `game_engine` rig; ARKit-style face units (faceunits01) for expressions.
7. **Performance**: move morphing to a Web Worker / WebGPU; precomputed macro bases to cut download size.
