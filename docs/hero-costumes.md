# Hero costumes

A `costume` on the character config adds superhero pieces on top of the outfit. They are
generated from the current body shape (like the race add-ons), so they fit every body, race and
size:

| Piece | Styles | Notes |
| --- | --- | --- |
| `cape` | `short`, `classic`, `long`, `scalloped` (bat wing), `pointed` | Draped over the back with flare and folds, outside and lining in their own colours. Three chains of five bones (`cape_r_1`..`cape_l_5`) so it moves. |
| `collar` | `standing`, `flared` | On the cape (no cape, no collar). |
| `mask` | `domino`, `bandit` (with knot and tails), `cowl` | Masks follow the face's morphs. A cowl hides the hair and brows. |
| `belt` | `plain`, `buckle`, `utility` (buckle and six pouches) | |
| `emblem` | `circle`, `shield`, `diamond`, `star`, `hexagon`, `badge`, `cutout` | A raised chest plate with a rim. `symbol`: `star`, `bolt`, `atom`, `rocket`, `planet`, `comet`, `flame`, `eye`, `wings`, `crown` (or none). A `cutout` emblem has the symbol's own outline. `emblemSize` 0..1. |

Colours are sRGB hex (`capeColor`, `liningColor`, `maskColor`, `beltColor`, `buckleColor`,
`emblemColor`, `symbolColor`, `rimColor`). `finishes` gives any costume part (`cape`, `mask`,
`belt`, `buckle`, `emblem`, `rim`) or worn garment (by id) a finish: `cloth`, `satin`, `leather`,
`rubber`, `gloss` or `metallic`. Parts without one have a sensible default (satin cape and mask,
leather belt, metal buckle and rim, gloss emblem).

```json
"costume": {
  "cape": "classic", "collar": "standing", "capeColor": "#c8202a", "liningColor": "#f2c230",
  "mask": "domino", "belt": "utility", "emblem": "shield", "symbol": "bolt",
  "finishes": { "tights": "satin", "boots": "rubber" }
}
```

Where it lives:

- Geometry: `@actors/human` `costume.ts` and `emblem.ts` (the emblem's outline and its texture
  come from the same signed distance field); Rust `actors_human::costume` and `emblem`, checked
  against the TypeScript by the parts golden test.
- Web: `@actors/generator` (`CostumeLook`, the editor's Costume section), `@actors/three` (physical
  materials per finish; the cape chains sway).
- Engine: `actors-engine` builds the parts with their materials and bakes a cloth simulation of
  the cape into every clip: the cape hangs, swings as the body moves, is kept off the torso, legs
  and arms, and streams back in the wind of walking, running and sprinting. A game's own clips
  (flying, hovering) get their swing with `swing_cape(&mut model, rig, clip, CapeWind { travel,
  root_motion: false })`, where `travel` is the character's velocity through the air in model
  space (+Z forward) and `rig` is `CharacterModel::cape`. The cloth is a grid of points with
  stretch, shear and bend limits; it is kept off capsules fitted to the body's own skin (torso in
  strips, upper and lower arms, hands, thighs, calves, neck, head), and the threads between points
  are tested too, so a forearm cannot slip between two of them. `cape_sink(&model, rig, clip,
  time)` measures how deep the drawn cape passes into the drawn body; the `capes_stay_off_the_body`
  test keeps standing, walking and flying clean for several cape styles.
