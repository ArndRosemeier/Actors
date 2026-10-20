# Third-party assets

| Asset | Source | Licence |
|---|---|---|
| hm08 base mesh, morph targets, `game_engine` rig and weights | [MakeHuman / MPFB2](https://github.com/makehumancommunity/mpfb2) (`src/mpfb/data`) | CC0 1.0 |
| `better_socks_low` test garment | MPFB2 `test/testdata` | CC0 1.0 |
| Skin region masks (`mpfb_*.jpg`), face expression units | MPFB2 `src/mpfb/data` | CC0 1.0 |
| High-poly eyes (`eyes/high-poly`) and `brown_eye.png` | [MakeHuman system assets](https://github.com/makehumancommunity/makehuman) (`makehuman/data/eyes`) | CC0 1.0 |
| Motion capture (walk 07_01, run 09_01, idle 40_10, dance 05_02, wave 13_26) | [CMU Graphics Lab Motion Capture Database](http://mocap.cs.cmu.edu), BVH conversion via [una-dinosauria/cmu-mocap](https://github.com/una-dinosauria/cmu-mocap) | Free to use, including commercially; attribution requested (below) |

CMU attribution: "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217."

Eyebrows, eyelashes, pores, fabric weaves and female genital detail are generated procedurally by this project's code (MIT).

The importer downloads these at build time; generated packs are not committed.
MakeHuman's and MPFB2's *code* (AGPL / GPL) is not used or copied.

Not used on purpose: the community genital proxies on makehumancommunity.org are AGPL-licensed, so this project will make its own.
