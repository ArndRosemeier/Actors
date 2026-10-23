# Commonwear 3026

A growing wardrobe for an expressive, spacefaring, utopian post-scarcity society, one thousand years after 2026. This is a fictional design direction, not a forecast.

## What is ordinary now?

People move between gardens, workshops, public rooms and inhabited spacecraft. Clothing is comfortable and easy to remake. Scarcity no longer makes an object prestigious; the time someone spent caring for it, the memories it holds and the ideas it communicates make it meaningful. A quiet cotton-like wrap and a moving personal sky can belong at the same breakfast table.

Dress is chosen by the wearer, without gender or occupational restrictions. Screens are a form of expression, not compulsory identity displays or advertising. Access to fabrication does not erase regional craft, eccentricity, sentimental attachments or the pleasure of an old favourite.

## First collection

| Piece | Everyday meaning in 3026 | Implemented form |
|---|---|---|
| Continuum wrap | Familiar comfort, reconfigured across a lifetime | Diagonal hem and unequal sleeve lengths; knitted surface |
| Transit trousers | An unremarkable layer for life between habitats | High waist, fitted legs, cropped ankle |
| Aurora screen mantle | A shared sky in an enclosed habitat | Asymmetric shoulder layer with slow emissive aurora ribbons |
| Living canvas | An artwork that happens to be clothing | Screen top with animated colour fields and a visible pixel grid |
| Conversation cuffs | A voluntary surface for colour, gestures or shared art | Paired luminous forearm pieces, separately recolourable as one item |
| Keepsake belt | An attachment surface for things worth keeping | Broad diagonal band, worn over the wrap and trousers |
| Habitat gaiters | A replaceable protective layer at the lower leg | Paired fitted calf shells |
| Comet flares | Taking the scenic route through a habitat | Fitted upper legs opening into sculpted flares |
| Cocoon pants | Unhurried comfort in a shared garden | Rounded leg volume tapering towards the ankle |
| Courtyard culottes | Easy movement around communal spaces | Wide, cropped legs |
| Lightstream leggings | A moving artwork from waist to ankle | Full-length animated screen fabric |
| Drift shorts | Leisure without a dress code | Roomy legs with unequal lengths |
| Arc vest | Quiet geometry around the shoulders | Sleeveless top with a close round neckline |
| Solstice bolero | A warm layer carried through habitat seasons | Cropped knitted shoulder layer with long sleeves |
| Memory ribbon | Sharing a colour or a memory | A diagonal emissive sash around the torso |
| Orbital halo | Wearable spatial sculpture, as ordinary as jewellery | Two intersecting luminous rings fitted to the head |

The belt's attachments, interface functions, adaptive textile behaviour and halo suspension are worldbuilding. This implementation supplies the visible clothing and animated surface art. The halo follows the head; it does not simulate levitation or orbit independently. These are clothes for inhabited spaces, not vacuum protection.

Eight coordinated presets are available to every adult body:

- **Comet trails** (`future-comet`): copper flares, a pale arc vest and a luminous memory ribbon.
- **Garden commons** (`future-garden`): sage cocoon pants, a cream wrap and rose bolero.
- **Open courtyard** (`future-courtyard`): lavender culottes, pale vest and amber cuffs.
- **Lightstream** (`future-lightstream`): screen leggings with a quiet vest and luminous halo.
- **Drift afternoon** (`future-drift`): asymmetric shorts, blue wrap and keepsakes.
- **Common ground** (`future-daily`): sage wrap, dark transit trousers, pale cuffs, warm keepsake belt and gaiters.
- **Aurora commons** (`future-orbit`): a cream wrap under the turquoise screen mantle, lavender trousers and a luminous halo.
- **Living constellation** (`future-festival`): an orchid living canvas, mint cuffs and golden orbits.

The presets reuse the existing sneakers. Every new piece can also be selected independently in the editor's **Future** groups and recoloured using the existing garment colour controls. Accessories occupy separate layers, so a mantle, belt, cuffs and halo can coexist with a top and trousers.

## Run and use

Regenerate the human pack to include the new geometry; an older hosted pack does not contain these garment IDs:

```bash
npm ci
npm run import:human -- --no-cmu
npm run dev
```

In the viewer, choose one of the **3026** Outfit presets, or open `http://localhost:5173/?outfit=future-orbit`. The description below the preset explains its place in the society. The **3026 pants** selector is available in both editor modes; **Detailed** offers all individual garments and colours. There are six future pants choices, including the original Transit trousers.

```ts
await character.wear("future-orbit");
await character.set({ garmentColors: {
  ...character.config.garmentColors,
  "future-mantle": "#9fe5da",
} });
const glb = await character.exportGlb("current");
```

## Geometry, light and limitations

The fifteen textile pieces are cut from the CC0 MakeHuman tights helper and inherit body morphs and skinning. The flares, cocoon pants, culottes and shorts add sculpted offsets bound to their helper vertices through proxies, so their volume scales with the body. Wide full-length pants replace gaiters to avoid conflicting layers. The halo is original procedural geometry bound through the existing proxy format. It scales with head landmarks and uses the head's skin weights. No extra commercial or attribution-required assets are introduced by these pieces.

`fabric:screen` enables a deterministic, opaque, 64 × 64 animated emissive texture in both the WebGL and node-material adapters. The built-in stage shares four phase textures, each updated at most 12 times per second when used by a visible screen. Custom scenes can supply a `ScreenTexturePool`; independent per-material animation remains available. Recolouring also tints emission; restoring the original colour restores its emission colour. Unused phases do not generate frames. Materials keep independent emission colours and release their texture reference when disposed; a shared phase is disposed after its last wearer releases it.

Screen effects are self-luminous surfaces, not scene lights: they do not illuminate nearby skin, cast coloured light or add bloom. The existing crowd LOD uses flat merged colours, so it loses screen animation. glTF contains an emissive texture snapshot, geometry and skeletal animation; it does not contain the procedural screen animation. Hems still use the project's existing runtime clipping shader, which standard glTF does not reproduce. There is no cloth simulation or collision system for the halo; large hair, horns and extreme poses may intersect it.

## Validation

```bash
npm run typecheck
npm test
npm run build
npm run check:consumer
# With npm run dev running and CHROMIUM_PATH pointing to Chromium/Chrome:
node apps/viewer/scripts/future-smoke.mjs
node apps/viewer/scripts/future-smoke.mjs "http://localhost:5173/?webgpu-gl" .cache/future-smoke-node
```

The focused smoke test checks all eight presets on two adult body shapes, animation, recolouring, changing screen pixels, finite fitted geometry and an exported emissive texture. It saves front and back screenshots for visual inspection. The installed-package consumer test checks WebGPU screen animation, tint, reset and isolation across the main and WebGPU exports. Release bundles share their internal modules; independent entry bundles previously duplicated the screen registry. The regular viewer smoke test remains the broader regression check.

## Directions for the next collection

Clothes that unfold into social spaces; patient, slow-growing textile gardens; shared patterns composed by several wearers; very quiet garments for sensory comfort; locally beloved everyday objects whose original function has disappeared. Expand the silhouette and the culture together, with expressive and mundane pieces in every collection.
