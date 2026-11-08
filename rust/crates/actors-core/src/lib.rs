//! Renderer-free runtime for Actors packs (Rust port of `@actors/core`).
//!
//! An actor pack (built by the importers in the Actors repository, or downloaded with a
//! release's `actors-packs` archive) describes a morphable, rigged character. [`ActorRuntime`]
//! loads it from a [`PackSource`] and evaluates shapes: morph targets, shape passes (bone
//! proportions, tips, scale), normals, the fitted skeleton, garments (proxies) and subdivided
//! meshes. [`Retargeter`] plays the pack's clips on any fitted skeleton, [`PoseMixer`] blends
//! poses, and [`lod`] picks meshes, triangles and bones per detail level.
//!
//! ```no_run
//! use actors_core::{ActorRuntime, DirSource, Weights};
//! let mut rt = ActorRuntime::load(DirSource::new("public/packs"), "human/manifest.json")?;
//! let mut weights = Weights::new();
//! weights.insert("macro/caucasian-female-young".into(), 1.0);
//! let shape = rt.evaluate(&weights, None, Some(&["body", "eyes"]))?;
//! # Ok::<(), actors_core::Error>(())
//! ```
//!
//! Conventions: meters, +Y up, +Z forward (glTF). Bone rolls follow Blender's convention.

pub mod animation;
mod blob;
pub mod deform;
pub mod deform_recipe;
mod error;
pub mod face_rig;
pub mod format;
pub mod hands;
pub mod lod;
pub mod math;
pub mod normals;
pub mod parts;
pub mod pose;
pub mod proxy;
pub mod retarget;
pub mod runtime;
pub mod skeleton;
mod source;
pub mod subdivide;
pub mod target;

pub use deform::{BoneScale, ShapeOptions, TipDeform};
pub use error::{Error, Result};
pub use format::ActorPackManifest;
pub use pose::{blend_poses, pose_world, Pose, PoseMixer};
pub use proxy::ProxyBinding;
pub use retarget::{BakedClip, Clip, InPlace, RetargetOptions, Retargeter};
pub use runtime::{ActorRuntime, ActorShape, Attribute, MeshData, Surface, SurfaceDelta, Weights};
pub use skeleton::FittedSkeleton;
pub use source::{DirSource, MemSource, PackSource};
pub use subdivide::Stencil;
pub use target::MorphTarget;
