# Navy wardrobe (age of sail)

Clothes for the crews of sailing warships around 1800: seamen, petty officers, marines and officers of
two navies, the Royal Navy and the French Marine. Made for Nauta, where two brig crews of about 120
men each are seen up close on deck, and the captain looks down at his own coat sleeves and breeches.

## Presets

The editor's outfit list has a **Navy** group (`NAVY_OUTFITS` in `packages/generator/src/navy-outfits.ts`):

| Royal Navy | French Marine |
|---|---|
| British captain: blue tailcoat, white lapels and cuffs, gold epaulettes, white waistcoat and breeches, laced bicorne | French captain: blue coat with scarlet cuffs and waistcoat, gold epaulettes, laced bicorne, tricolour cockade |
| British lieutenant: the same coat, blue cuffs, no epaulettes | French officer: one epaulette on the right shoulder |
| British midshipman: white collar patches, round hat | French aspirant: scarlet collar and cuffs, round hat |
| British boatswain: blue jacket, red waistcoat, white trousers, shoes | French boatswain: blue jacket, red waistcoat, striped trousers |
| British seaman: shirt, short blue jacket, wide white duck trousers, black neckerchief, round hat, barefoot | French seaman: the same with red-and-white striped trousers and the red knitted bonnet |
| British seaman at work: shirt, trousers, neckerchief, bareheaded | French seaman at work: the same with the bonnet |
| Royal Marine: red coatee with the blue facings of 1802, white cross belts, white breeches, black gaiters, round hat | French marine: blue coatee with scarlet collar and cuffs, white cross belts, black gaiters, bicorne |

```ts
await character.wear("navy-rn-captain");
// Twenty seamen of one crew, each a little different: recolour the slops (seeded in the game).
await character.set({ garmentColors: { ...character.config.garmentColors, "navy-jacket": "#3a3f52", "navy-slops": "#cfc6b0" } });
```

All of it is tagged with the `age-of-sail` theme (see `THEMES`), so a game can offer only these:
`?themes=age-of-sail`. The buckled shoes fit the theme too; knee socks, socks and briefs fit every theme.

Seamen had no uniform yet: they bought slops from the purser, so a crew varies. A game gets that
variety by recolouring jacket, waistcoat, trousers, neckerchief and hat per man from its own seed
(dull blues, browns, greys and off-whites for the jacket; white, off-white or striped trousers).

## Pieces (all generated, ids start with `navy-`)

**Cut from the base mesh's helpers** (`tools/import-makehuman/src/navy.ts`, like the medieval kit), so
they bend with the skin:

| Layer (inside → out) | Pieces |
|---|---|
| Shirt and legs | `navy-shirt` (loose, open at the throat), `navy-breeches` (to below the knee), `navy-slops` (wide trousers flaring from the knee), `navy-slops-striped` (the same with a stripe print running down the leg) |
| Neck | `navy-stock` (a high neck band; white for officers, black for marines) |
| Waistcoat | `navy-waistcoat` |
| Jackets and coats | `navy-jacket` (seaman's short jacket, open at the front), `navy-tailcoat` (officer's coat cut away at the waist, tails to the knee with a vent), `navy-coatee` (marine's coat with short tails) |
| Facings | `navy-lapels`, `navy-collar` (standing, open at the throat), `navy-cuffs`: each its own garment and colour |
| Over the coat | `navy-gaiters`, `navy-crossbelts` (from each shoulder to the other hip) |

**Built as new geometry** and bound to the torso or the skull:

| Kind | Pieces |
|---|---|
| Buttons | `navy-buttons-officer` (two columns down the lapels), `navy-buttons-single` (one column, marines and midshipmen), `navy-buttons-jacket` |
| Rank | `navy-epaulettes` (pair: strap, crescent and bullion fringe), `navy-epaulette` (right shoulder only) |
| Neck | `navy-neckerchief`: round the neck, knotted at the throat, the ends hanging |
| Hats | `navy-bicorne` (worn athwartships, two half-moon flaps), `navy-bicorne-lace` (gold edging), `navy-cockade` (black), `navy-cockade-tricolour` (printed), `navy-round-hat` (low crown, narrow brim), `navy-knit-cap` (pulled down over the hair, the top falling back) |

The stripe print and the tricolour are textures drawn at import; like every textured garment they store
their mean colour, so a recoloured stripe keeps its stripes and a crowd-level mesh shows the mean.

## Cost

Every piece is a separate garment, so a fully dressed captain draws about fourteen meshes near the
camera. At the crowd level (`LodDef.merge`) body and garments become one mesh with vertex colours, so a
distant seaman is one draw call however many pieces he wears; the stripe and cockade prints show as
their mean colour there. Use the crowd level for most of a crew and the full level for the few men
within reach.

## Known limits

* Coat tails and the bullion fringe are skinned like the rest, they don't swing on their own (the
  coat tails use skirt skinning between the legs, like the medieval surcoat).
* An arm raised high pushes the shoulder into the epaulette's fringe.
* The knitted cap hides the hair; round hats and bicornes sit over short hair, very full styles can
  show through the crown.
* No swords, pistols, telescopes or bosun's calls: hand props need holding poses first.
* At the crowd level the coat tails stay their own mesh (they need the leg colliders), so an officer or a
  marine is two draw calls there, a seaman one.

Regenerate the pack after changing them: `npm run import:human`. `apps/viewer/scripts/navy.mjs`
screenshots every navy preset (front, back, close-up, walking, and the view down from the eyes)
against a running viewer.
