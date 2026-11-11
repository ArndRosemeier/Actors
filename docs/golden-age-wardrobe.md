# Golden age wardrobe

Clothes and accessories from the golden age of Hollywood, the 1920s to the 1950s: flappers, screen sirens, showgirls, gangsters, detectives and leading men. Some of it is everyday wear, some of it is deliberately over the top.

## Presets

The editor's outfit list has a **Golden age** group (`GOLDEN_AGE_OUTFITS` in `packages/generator/src/golden-age-outfits.ts`):

| Women | Men |
|---|---|
| Flapper, Screen siren, Showgirl, Starlet, Dame in furs, Secretary, Sock hop, Pin-up, Gala | Gangster, Detective, Leading man, Top hat and tails, Newsboy, City gent |

Every piece can also be worn and recoloured on its own; feathers and fur are white textures, so any colour tints them.

```ts
await character.wear("ga-showgirl");
await character.set({ garmentColors: { ...character.config.garmentColors, "ga-feather-boa": "#1c1c1f" } });
```

All of it is tagged with the `vintage` theme (see `THEMES`), so a game set in the period can offer only these: `?themes=vintage`.

## Pieces

**From MakeHuman packs** (`tools/import-makehuman/src/wardrobe.ts`, CC-BY, credited in NOTICE-ASSETS.md): satin evening gown, little black dress, long halter gown, winter coat, polka-dot circle skirt, pencil skirt, retro top, shirt and tie, dress trousers, 1950s swimsuit, strapless bodysuit, saddle shoes, Mary Janes, oxfords (men's and women's), monk straps, bowler hat, top hat, trilby, flat cap and a handbag. Older items fit too: the flapper dress, cloche hat, fedoras, newsboy cap, suits, opera gloves, stockings and T-bar shoes.

**Generated** (`tools/import-makehuman/src/golden-age.ts`, ids start with `ga-`):

| Kind | Pieces | How |
|---|---|---|
| Clothing | `ga-trench-coat` (belted, open below the belt, collar up), `ga-suspenders` | Cut from the base mesh's tights and skirt helpers, like the medieval kit, so they bend with the skin |
| Jewellery | `ga-pearls` (a collar strand and a long one), `ga-diamond-collar` (two rows and drops), `ga-earrings` | Bead chains hung on the body at import (a small simulation: gravity, fixed bead spacing, the back of the neck held, the skin and the chest's convex outline pushing out), then bound to the same coarse torso samples as the medieval layers; earrings hang from the ear lobes |
| Furs and feathers | `ga-feather-boa`, `ga-fur-stole` | A rope round the back of the neck and down the front, with alpha-cut feather or fur cards all round it |
| Headwear | `ga-headband` (flapper band with a jewel and plumes), `ga-showgirl-headdress` (a fan of fifteen tall plumes) | A band round the brow, clear of the hair at the back, bound to the skull so face animation doesn't bend it |

The fabrics `fur`, `feather`, `pearl` and `gem` are new: `gem` is drawn as metal (it sparkles best with an environment map), `pearl` and `gem` have no weave, and feathers take their look from the generated texture.

## Known limits

* The long ropes and plumes don't sway: they are skinned to the body like every other garment. Arms swung across the chest can pass through the boa's ends.
* Headbands and headdresses sit about 2 cm off the scalp at the back for the hair; very big hairstyles can still cover them.
* No cigarette holder or other hand props: without a holding hand pose they float or bend with the fingers.

Regenerate the pack after changing them: `npm run import:human`. `apps/viewer/scripts/golden-age.mjs` screenshots every golden age preset (front, back, close-up, walking) against a running viewer.
