//! Character configs for Actors packs (Rust port of `@actors/generator`, without the renderer).
//!
//! A [`CharacterConfig`] is the whole look of a character as the same JSON the TypeScript
//! generator reads and writes, so a game can store characters made in the web editor and build
//! them in Rust. A [`CharacterCatalog`] lists what a pack offers (races, garments, outfits, hair,
//! animations); [`random_config`] makes random characters (the same seed gives the same
//! character as in TypeScript); [`allow_catalog`] and [`filter_catalog`] keep a catalog to what a
//! game allows.
//!
//! ```no_run
//! use actors_core::{ActorRuntime, DirSource};
//! use actors_generator::*;
//! use actors_human::HumanPack;
//!
//! let rt = ActorRuntime::load(DirSource::new("assets/packs"), "human/manifest.json")?;
//! let pack = HumanPack::new(rt.manifest())?;
//! let catalog = allow_catalog(&build_catalog(rt.manifest(), &pack, rt.clip_defs(), None), &AllowOptions::preset("fantasy").unwrap());
//! let base = default_config(&catalog);
//! let npc = random_config(&catalog, &base, &RandomOptions::default(), &mut SeededRandom::new(42.0));
//! let json = serde_json::to_string(&npc).unwrap();
//! # Ok::<(), actors_core::Error>(())
//! ```
//!
//! Adults only: ages are clamped to `ADULT_MIN_AGE`; children are adult bodies with child
//! proportions (`youth`) and never show anatomy ([`sanitize_config`] turns it off).

pub mod allow;
pub mod catalog;
pub mod config;
pub mod data;
pub mod random;
pub mod themes;

pub use allow::{allow_catalog, flag_on, height_fit, AllowOptions, Flags, HeightRange};
pub use catalog::{
    build_catalog, concealed_garments, outfit_garments, race_features, resolve_outfit, AnimationChoice, CharacterCatalog, Choice,
    DetailChoice, FeatureLists, GarmentChoice, OutfitPreset, RaceChoice, RaceFeatures,
};
pub use config::{default_config, fit_config, sanitize_config, CharacterConfig, Detail, Gaze, RobotLook, SkeletalLook, SkinKind};
pub use data::{data as tables, GeneratorData};
pub use random::{
    race_parts, random_config, random_race_look, random_robot_look, random_skeletal_look, rgb_to_hex, Gender, RaceChoiceOption, Random,
    RandomOptions, SeededRandom,
};
pub use themes::{filter_catalog, fits_themes, ThemeFilter};
