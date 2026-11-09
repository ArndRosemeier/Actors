# Actors for Rust

A Rust port of the Actors character generator, for Rust games. It reads the same actor packs as
the TypeScript packages, so a pack built by `npm run import:human` (or downloaded with a
release's `actors-packs-<version>.tar.gz`) works in both.

| Crate | What it is | Status |
|---|---|---|
| `actors-core` | Renderer-free runtime: pack loading, morph targets, face rig, shape passes (bone proportions, tips, scale), normals, skeleton fitting, garment fitting, subdivision, LOD, clip retargeting, pose blending. Port of `@actors/core`. | done |
| `actors-human` | Human sliders, races, body shapes, expressions → target weights; race add-ons (horns, tusks, tails, beards, leaf hair, crest); hero costumes (cape, mask, belt, emblem). Port of `@actors/human`. | done |
| `actors-generator` | The same `CharacterConfig` JSON as `@actors/generator`: catalog, outfits, random characters (same seed, same character), themes, allow rules. Port of `@actors/generator` without the renderer. | done |
| `actors-engine` | Adapter for [Engine](https://github.com/ArndRosemeier/Engine): a `CharacterConfig` becomes an `AnimatedModel` (shaped body, photo skin, race patterns and stubble, race add-ons, hair, clothes in layers, fitted skeleton, baked clips with tail sway and swinging capes, hero costumes with finishes, animated faces as morph targets). | done (humans) |

Later: animals, drones, robots and skeletons, fabric shaders, gaze and wrinkles.

## Using it

```toml
[dependencies]
actors-core = { git = "https://github.com/ArndRosemeier/Actors" }
```

```rust
use actors_core::{ActorRuntime, DirSource, Retargeter, RetargetOptions, Pose, Weights};

let mut rt = ActorRuntime::load(DirSource::new("assets/packs"), "human/manifest.json")?;
let mut weights = Weights::new();
weights.insert("macro/caucasian-female-young".into(), 1.0);
// Fit only what is drawn: the body, the eyes and a t-shirt.
let shape = rt.evaluate(&weights, None, Some(&["body", "eyes", "tshirt"]))?;
let skeleton = shape.skeleton.as_ref().unwrap();

let walk = rt.load_clip("walk")?;
let mut player = Retargeter::new(skeleton, walk, &RetargetOptions::default())?;
let mut pose = Pose::new(skeleton.len(), 0);
player.sample_into(0.5, &mut pose); // bone-local rotations + root position
# Ok::<(), actors_core::Error>(())
```

A human with sliders and a race (`actors-human`, same parameters as `@actors/human`):

```rust
use actors_human::{Human, RaceId};

let mut human = Human::for_runtime(&rt)?;
human.params.gender = 1.0;
human.params.muscle = 0.7;
human.race.race = RaceId::Dwarf;
human.modifier_values.insert("nose/nose-scale-horiz-decr-incr".into(), 0.3);
let shape = human.evaluate(&mut rt, Some(&["body", "eyes"]))?;
```

Characters made in the web editor (or by `randomConfig` in TypeScript) are `CharacterConfig`
JSON, which `actors-generator` reads, checks and makes:

```rust
use actors_generator::*;

let pack = actors_human::HumanPack::new(rt.manifest())?;
let catalog = allow_catalog(&build_catalog(rt.manifest(), &pack, rt.clip_defs(), None), &AllowOptions::preset("fantasy").unwrap());
let stored: CharacterConfig = serde_json::from_str(&json).unwrap();
let hero = sanitize_config(&catalog, &stored); // adult age, wearable outfit, allowed race
let npc = random_config(&catalog, &default_config(&catalog), &RandomOptions::default(), &mut SeededRandom::new(7.0));
```

A character in [Engine](https://github.com/ArndRosemeier/Engine) (`actors-engine`):

```rust
use actors_engine::{BuildOptions, CharacterBuilder};
use actors_generator::{AllowOptions, RandomOptions};

let mut builder = CharacterBuilder::load("assets/packs")?;
builder.allow(&AllowOptions::preset("fantasy").unwrap());
let config = builder.random(7, &RandomOptions::default()); // or a stored CharacterConfig
let character = builder.build(&config, &BuildOptions::default())?;
let id = world.spawn_animated(character.model, Place::at(0.0, 0.0, 0.0)?)?;
world.play_animation(id, "idle")?;
```

The demo puts five random characters in a row (Space: new ones, W: walk):

```bash
cargo run --release -p actors-engine --example characters -- apps/viewer/public/packs fantasy 1
```

`actors-engine` follows Engine's `main` branch (the lock file pins the commit), so a game on Engine `main` builds one Engine for both; run `cargo update -p engine` to follow it. It is not a default workspace member (it pulls in wgpu, winit and audio; on Linux
install `libasound2-dev libudev-dev`), so build and test it with `-p actors-engine`. Its tests
build real characters when `ACTORS_PACKS` points at the packs. Without a display, a screenshot:
`ENGINE_SCREENSHOT=out.png ENGINE_SCREENSHOT_FRAME=20 xvfb-run -a cargo run ...` (with
`mesa-vulkan-drivers` and `VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json`).

The human and generator tables (races, modifiers, expressions, body types, outfits, themes) are
exported from the TypeScript sources into `crates/*/data/*.json` by `npx tsx rust/golden/export-data.ts`; don't
edit that file by hand, CI checks it is current.

Pack files come through the `PackSource` trait (`DirSource` for a folder, `MemSource` for
embedded data); implement it to read from an archive or the network. Loading takes `&mut self`;
evaluation only reads, so a loaded runtime can be shared between threads (behind an `Arc`, or
an `RwLock` while more garments or targets still load).

Conventions are those of the packs: meters, +Y up, +Z forward, Blender bone rolls.

## Tests

`cargo test` runs the unit tests and a small in-memory pack. The golden test compares the Rust
runtime with the TypeScript runtime on the real packs (shapes, garments, subdivided body, skins,
retargeted poses, LOD merges; cases in `golden/cases.json`):

```bash
npm run import:human && npm run import:animals        # or unpack actors-packs into apps/viewer/public/packs
npx tsx rust/golden/dump.ts apps/viewer/public/packs /tmp/golden
npx tsx rust/golden/dump-human.ts apps/viewer/public/packs /tmp/golden   # human sliders, races, deform plans
npx tsx rust/golden/dump-generator.ts apps/viewer/public/packs /tmp/golden   # catalog, random configs, allow rules
npx tsx rust/golden/dump-parts.ts apps/viewer/public/packs /tmp/golden       # horns, tusks, tails, beards, costumes
ACTORS_PACKS=apps/viewer/public/packs ACTORS_GOLDEN=/tmp/golden cargo test --manifest-path rust/Cargo.toml
```

CI runs it in the Pages workflow (which builds the packs) and formatting, clippy and the unit
tests in the Rust workflow. When the TypeScript runtime changes, the golden test shows where the
port has to follow.
