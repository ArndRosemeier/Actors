//! Human sliders, races, body shapes and expressions for Actors packs (Rust port of
//! `@actors/human`).
//!
//! [`Human`] turns MakeHuman-style parameters ([`HumanParams`]), detail sliders and a race
//! ([`RaceSettings`]) into the pack's target weights and shape options, which
//! [`actors_core::ActorRuntime`] evaluates:
//!
//! ```no_run
//! use actors_core::{ActorRuntime, DirSource};
//! use actors_human::{Human, RaceId};
//! let mut rt = ActorRuntime::load(DirSource::new("assets/packs"), "human/manifest.json")?;
//! let mut human = Human::for_runtime(&rt)?;
//! human.params.gender = 1.0;
//! human.params.muscle = 0.8;
//! human.race.race = RaceId::Dwarf;
//! let shape = human.evaluate(&mut rt, Some(&["body", "eyes"]))?;
//! # Ok::<(), actors_core::Error>(())
//! ```
//!
//! Adults only: ages are clamped to [`ADULT_MIN_AGE`] before any weight is computed. Children
//! are adult bodies with child proportions (`RaceSettings::youth`) and never get anatomy.
//!
//! The data tables (races, expressions, shape sliders, ...) are shared with the TypeScript
//! package through `data/human.json`.

pub mod costume;
mod data;
pub mod emblem;
pub mod expressions;
pub mod face_animator;
pub mod human;
pub mod macros;
pub mod modifiers;
pub mod params;
pub mod parts;
pub mod races;
pub mod raceshape;
pub mod shapes;
pub mod skins;

pub use costume::{build_costume, costume_hides_hair, has_costume, CostumeParts};
pub use data::{data as tables, HumanData, UnitWeights};
pub use expressions::{blink, expression, expression_target_weights, wrinkle_weights};
pub use face_animator::{text_to_visemes, FaceAnimator, FaceAnimatorOptions, FaceFrame, VisemeKey, VISEMES};
pub use human::{GarmentInfo, Human, HumanExtra, HumanPack};
pub use params::{HumanParams, ADULT_MIN_AGE, MAX_AGE};
pub use parts::{build_parts, has_parts, parts_body, PartsBody, PartsConfig};
pub use races::{RaceId, RaceInfo, RaceStyle};
pub use raceshape::{race_head_scale, race_scale, RaceSettings, TargetResolver};
pub use shapes::{body_types, shape_modifiers, shape_sliders, BodyType, ShapeSlider};
