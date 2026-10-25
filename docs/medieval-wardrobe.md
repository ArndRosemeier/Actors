# Medieval wardrobe

Clothes and armour for a medieval setting: commoners, soldiers, knights, nobles and clergy.

## Presets

The editor's outfit list has a **Medieval** group (`MEDIEVAL_OUTFITS` in `packages/generator/src/medieval-outfits.ts`): Peasant, Peasant woman, Traveller, Archer, Man-at-arms, Mail knight, Plate knight, Noble, Lady, Merchant, Nun and Plague doctor. Every piece can also be worn and recoloured on its own.

```ts
await character.wear("med-plate-knight");
await character.set({ garmentColors: { ...character.config.garmentColors, "med-mantle": "#1f3a6b" } });
```

## Pieces

**From MakeHuman packs** (`tools/import-makehuman/src/wardrobe.ts`, credited in NOTICE-ASSETS.md): embroidered tunic, laced chemise, peasant blouse, open coat, gored skirt, long gown, square-neck gown, medieval/riding/leather boots, pointed and buckled shoes, veil, plague-doctor mask (CC-BY), and a lowered monk hood (CC0). Older items such as the knight helmet, monk robe and hoods fit too.

**Procedural** (`tools/import-makehuman/src/medieval.ts`, ids start with `med-`), cut from MakeHuman's tights and skirt helpers:

| Layer (inside → out) | Pieces |
|---|---|
| Underwear and hose | `med-hose` (footless, so any boots fit) |
| Clothing | `med-tunic`, `med-long-tunic`, `med-jerkin` (sleeveless leather) |
| Padding | `med-gambeson` (quilted) |
| Mail | `med-hauberk`, `med-coif` |
| Over the mail | `med-surcoat`, `med-tabard`, `med-cuirass`, `med-vambraces`, `med-greaves`, `med-pauldrons` |
| On top | `med-belt`, `med-mantle` (short shoulder cape) |

Each mesh carries a `layer:<n>` tag (draw order for coincident layers, see `packages/three/src/layers.ts`) and a `fabric:<kind>` tag. The fabrics `weave`, `quilted`, `leather`, `mail` and `plate` are procedural normal maps; `mail` and `plate` are drawn as metal, so they look best with an environment map in the scene.

## How the procedural pieces stay in place

* Each layer is pushed out to a convex envelope of the body (per height slice), not along the skin normal, so stacked layers don't intersect and armour doesn't show every muscle.
* Torso pieces are bound to a shared coarse sample of the body (Shepard weights), so layers worn over each other move alike under morphs and animation. Sleeves stay bound to their own vertices.
* There is no long cloak: without cloth simulation it can't follow the arms, so they show through it. Everything here is cut from the body or the skirt helper and bends with the skin; the shoulder mantle stops above the elbows.

Regenerate the pack after changing them: `npm run import:human`. `apps/viewer/scripts/medieval.mjs` screenshots every medieval preset (female and male, front, back, walking) against a running viewer.
