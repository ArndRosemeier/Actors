# Third-party assets

| Asset | Source | Licence |
|---|---|---|
| hm08 base mesh, morph targets, `game_engine` rig and weights | [MakeHuman / MPFB2](https://github.com/makehumancommunity/mpfb2) (`src/mpfb/data`) | CC0 1.0 |
| `better_socks_low` test garment | MPFB2 `test/testdata` | CC0 1.0 |
| Skin region masks (`mpfb_*.jpg`), face expression units | MPFB2 `src/mpfb/data` | CC0 1.0 |
| High-poly eyes (`eyes/high-poly`) and `brown_eye.png` | [MakeHuman system assets](https://github.com/makehumancommunity/makehuman) (`makehuman/data/eyes`) | CC0 1.0 |
| Skins (18 photo skins), hairstyles (9), eyebrows (5) | [MakeHuman system assets pack](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html) | CC0 1.0 |
| Long full skirt (Toigo), mini skirt 01 (frankyaye) | [MakeHuman skirts01 asset pack](https://static.makehumancommunity.org/assets/assetpacks/skirts01.html) | CC0 1.0 |
| Wardrobe: tops, trousers, skirts, dresses, suits, outfits, underwear, hosiery, shoes, hats, glasses, gloves, mask (about 100 CC0 garments by Margaret Toigo, culturalibre, Cortu, JoePal, Wolgade, Mindfront and other MakeHuman community authors; the list with sources is in `tools/import-makehuman/src/wardrobe.ts`) | MakeHuman [system assets](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html) and the CC0 asset packs Shirts 01, Pants 01, Dress 01, Skirts 01, Suits 01, Suits 02, Shoes 01, Underwear 01, Underwear 04, Gloves 01, Hats 01, Hats 02, Glasses 01, Masks 01 ([list](https://static.makehumancommunity.org/assets/assetpacks.html)) | CC0 1.0 |
| Motion capture library (2,548 motions, loaded on demand) | [CMU Graphics Lab Motion Capture Database](http://mocap.cs.cmu.edu), BVH conversion by Bruce Hahne ([mirror](https://github.com/una-dinosauria/cmu-mocap)). "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217." | Free for any use, including commercial products; the data itself may not be resold |
| Body animations (84 clips: idles, walks, runs, jumps, swimming, sitting, work, combat, reactions, …) | Quaternius [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) and [Universal Animation Library 2](https://opengameart.org/content/universal-animation-library-2), Standard editions, via OpenGameArt | CC0 1.0 |

Painted eyebrows (optional), eyelashes, pores, fabric weaves and female genital detail are generated procedurally by this project's code (MIT).


## CC-BY assets

These are licensed under Creative Commons Attribution (CC-BY): anyone who ships a character wearing one must credit its author. The editor marks them "CC-BY · author", and the catalog carries the credit line (`GarmentChoice.credit`).

| Asset | Author | Pack | Source |
|---|---|---|---|
| Wizard robe (`maciekg_wizard_robe`) | maciekg | MakeHuman suits03 | [asset packs](https://static.makehumancommunity.org/assets/assetpacks/suits03.html) |
| Medieval dress (`punkduck_medieval_dress`) | punkduck | MakeHuman dress03 | [asset packs](https://static.makehumancommunity.org/assets/assetpacks/dress03.html) |
| Goddess dress (`elvs_goddess_dress1`) | Elvaerwyn | MakeHuman dress02 | [asset packs](https://static.makehumancommunity.org/assets/assetpacks/dress02.html) |
| Draped gown (`elvs_goddess_dress3`) | Elvaerwyn | MakeHuman dress02 | [asset packs](https://static.makehumancommunity.org/assets/assetpacks/dress02.html) |
| Halter gown (`elvs_goddess_dress4`) | Elvaerwyn | MakeHuman dress02 | [asset packs](https://static.makehumancommunity.org/assets/assetpacks/dress02.html) |
| Elven gown (`elvs_goddess_dress5`) | Elvaerwyn | MakeHuman dress02 | [asset packs](https://static.makehumancommunity.org/assets/assetpacks/dress02.html) |
| Priestess robe (`elvs_goddess_dress6`) | Elvaerwyn | MakeHuman dress02 | [asset packs](https://static.makehumancommunity.org/assets/assetpacks/dress02.html) |
| Ruffled gown (`elvs_goddess_dress8`) | Elvaerwyn | MakeHuman dress02 | [asset packs](https://static.makehumancommunity.org/assets/assetpacks/dress02.html) |
| Ninja (`mindfront_f_ninja`) | Mindfront | MakeHuman suits03 | [asset packs](https://static.makehumancommunity.org/assets/assetpacks/suits03.html) |
| Dark horned helmet (`culturalibre_warrior_helmet_02`) | culturalibre | MakeHuman hats04 | [asset packs](https://static.makehumancommunity.org/assets/assetpacks/hats04.html) |
| Horned cap (`maciekg_horned_helmet`) | maciekg | MakeHuman hats04 | [asset packs](https://static.makehumancommunity.org/assets/assetpacks/hats04.html) |
| Leather helmet (`maciekg_leather_helmet`) | maciekg | MakeHuman hats04 | [asset packs](https://static.makehumancommunity.org/assets/assetpacks/hats04.html) |
| Wizard hat (`maciekg_wizard_hat`) | maciekg | MakeHuman hats03 | [asset packs](https://static.makehumancommunity.org/assets/assetpacks/hats03.html) |
| Witch hat (`elvs_witchy_hallows_hat1`) | Elvaerwyn | MakeHuman hats03 | [asset packs](https://static.makehumancommunity.org/assets/assetpacks/hats03.html) |
| Wide-brim hat (`culturalibre_cl_don_quixote_hat`) | culturalibre | MakeHuman hats03 | [asset packs](https://static.makehumancommunity.org/assets/assetpacks/hats03.html) |

The importer downloads these at build time; generated packs are not committed.
MakeHuman's and MPFB2's *code* (AGPL / GPL) is not used or copied.

Not used on purpose: the community genital proxies on makehumancommunity.org are AGPL-licensed, so this project will make its own.
