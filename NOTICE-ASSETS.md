# Third-party assets

| Asset | Source | Licence |
|---|---|---|
| hm08 base mesh, morph targets, `game_engine` rig and weights | [MakeHuman / MPFB2](https://github.com/makehumancommunity/mpfb2) (`src/mpfb/data`) | CC0 1.0 |
| `better_socks_low` test garment | MPFB2 `test/testdata` | CC0 1.0 |
| Skin region masks (`mpfb_*.jpg`), face expression units | MPFB2 `src/mpfb/data` | CC0 1.0 |
| High-poly eyes (`eyes/high-poly`) and `brown_eye.png` | [MakeHuman system assets](https://github.com/makehumancommunity/makehuman) (`makehuman/data/eyes`) | CC0 1.0 |
| Skins (18 photo skins), hairstyles (9), eyebrows (5) | [MakeHuman system assets pack](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html) | CC0 1.0 |
| Long full skirt (Toigo), mini skirt 01 (frankyaye) | [MakeHuman skirts01 asset pack](https://static.makehumancommunity.org/assets/assetpacks/skirts01.html) | CC0 1.0 |
| Wardrobe: tops, trousers, skirts, dresses, suits, outfits, underwear, hosiery, shoes, hats, glasses, gloves, mask (about 90 garments by Margaret Toigo, culturalibre, Cortu, JoePal, Wolgade, Mindfront and other MakeHuman community authors; the list with sources is in `tools/import-makehuman/src/wardrobe.ts`) | MakeHuman [system assets](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html) and the CC0 asset packs Shirts 01, Pants 01, Dress 01, Skirts 01, Suits 01, Suits 02, Shoes 01, Underwear 01, Underwear 04, Gloves 01, Hats 01, Hats 02, Glasses 01, Masks 01 ([list](https://static.makehumancommunity.org/assets/assetpacks.html)) | CC0 1.0 |
| Motion capture library (2,548 motions, loaded on demand) | [CMU Graphics Lab Motion Capture Database](http://mocap.cs.cmu.edu), BVH conversion by Bruce Hahne ([mirror](https://github.com/una-dinosauria/cmu-mocap)). "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217." | Free for any use, including commercial products; the data itself may not be resold |
| Body animations (84 clips: idles, walks, runs, jumps, swimming, sitting, work, combat, reactions, …) | Quaternius [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) and [Universal Animation Library 2](https://opengameart.org/content/universal-animation-library-2), Standard editions, via OpenGameArt | CC0 1.0 |

Painted eyebrows (optional), eyelashes, pores, fabric weaves and female genital detail are generated procedurally by this project's code (MIT).

The importer downloads these at build time; generated packs are not committed.
MakeHuman's and MPFB2's *code* (AGPL / GPL) is not used or copied.

Not used on purpose: the community genital proxies on makehumancommunity.org are AGPL-licensed, so this project will make its own.
