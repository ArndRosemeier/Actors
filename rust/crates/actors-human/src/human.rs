//! [`Human`]: parameters + detail sliders + race -> target weights and shape options.

use crate::expressions::expression_target_weights;
use crate::macros::{macro_target_weights, MacroTargetDef};
use crate::modifiers::{modifier_target_weights, muscle_target_weights, ModifierDef};
use crate::params::HumanParams;
use crate::raceshape::{race_head_scale, race_scale, race_shape_options, race_target_weights, RaceSettings, TargetResolver};
use crate::skins::{skin_texture_weights, SkinTextureDef};
use crate::UnitWeights;
use actors_core::deform_recipe::{merge_deform, DeformPlan};
use actors_core::{ActorPackManifest, ActorRuntime, ActorShape, Error, Result, ShapeOptions, SurfaceDelta, Weights};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;

/// Per-garment info written by the importer.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct GarmentInfo {
    pub label: Option<String>,
    /// UI group ("Tops", "Shoes").
    pub category: Option<String>,
    /// Body layers the garment takes; garments sharing a layer replace each other.
    pub occupies: Vec<String>,
    /// Typical wearer ("female" / "male"), for random outfits.
    pub gender: Option<String>,
    pub credit: Option<String>,
    pub author: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Anatomy {
    #[serde(rename = "genitalsUV")]
    /// UV box [u0, v0, u1, v1] of the genital region on the body texture.
    pub genitals_uv: [f64; 4],
}

/// The human data of a pack (`manifest.extra.human`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HumanExtra {
    pub macro_targets: Vec<MacroTargetDef>,
    pub modifiers: Vec<ModifierDef>,
    pub adult_min_age: f64,
    pub expression_units: Vec<String>,
    pub garment_labels: IndexMap<String, String>,
    pub garments: IndexMap<String, GarmentInfo>,
    pub anatomy: Option<Anatomy>,
    pub skins: Vec<SkinTextureDef>,
    pub hair_labels: IndexMap<String, String>,
    pub hair_credits: IndexMap<String, String>,
    pub brow_labels: IndexMap<String, String>,
}

impl HumanExtra {
    pub fn from_manifest(manifest: &ActorPackManifest) -> Result<Self> {
        let v = manifest.extra.get("human").ok_or_else(|| Error::Format("pack has no human data".into()))?;
        serde_json::from_value(v.clone()).map_err(|source| Error::Json { path: "manifest extra.human".into(), source })
    }
}

/// Pack data a [`Human`] needs, shared by every human on the same pack.
#[derive(Debug)]
pub struct HumanPack {
    pub extra: HumanExtra,
    pub resolver: TargetResolver,
    pub bone_names: Vec<String>,
    pub bone_parents: Vec<i32>,
    target_names: HashSet<String>,
    face_units: Vec<String>,
}

impl HumanPack {
    pub fn new(manifest: &ActorPackManifest) -> Result<Arc<Self>> {
        let extra = HumanExtra::from_manifest(manifest)?;
        let bones = manifest.skeleton.as_ref().map(|s| s.bones.as_slice()).unwrap_or_default();
        let mut units: Vec<String> = manifest
            .targets
            .iter()
            .filter_map(|t| t.name.strip_prefix("expression/").and_then(|r| r.split_once('/')).map(|(_, u)| u.to_string()))
            .collect();
        units.sort();
        units.dedup();
        Ok(Arc::new(Self {
            extra,
            resolver: TargetResolver::new(manifest.targets.iter().map(|t| t.name.as_str())),
            bone_names: bones.iter().map(|b| b.name.clone()).collect(),
            bone_parents: bones.iter().map(|b| b.parent).collect(),
            target_names: manifest.targets.iter().map(|t| t.name.clone()).collect(),
            face_units: units,
        }))
    }

    /// The face units this pack has (MakeHuman's expression units, e.g. "mouth-corner-puller").
    pub fn face_units(&self) -> &[String] {
        &self.face_units
    }

    pub fn has_target(&self, name: &str) -> bool {
        self.target_names.contains(name)
    }
}

/// A human actor: parameters + detail sliders + race -> target weights -> shape.
#[derive(Clone, Debug)]
pub struct Human {
    pub pack: Arc<HumanPack>,
    pub params: HumanParams,
    /// Detail slider values by modifier id (-1..1).
    pub modifier_values: IndexMap<String, f64>,
    pub race: RaceSettings,
    /// A deform plan (giants) laid over the race's proportions.
    pub deform: Option<DeformPlan>,
    /// A uniform scale on top of the race and the deform plan (a game's height range).
    pub fit_scale: f64,
}

impl Human {
    pub fn new(pack: Arc<HumanPack>) -> Self {
        Self {
            pack,
            params: HumanParams::default(),
            modifier_values: IndexMap::new(),
            race: RaceSettings::default(),
            deform: None,
            fit_scale: 1.0,
        }
    }

    /// A human on a runtime's pack.
    pub fn for_runtime(rt: &ActorRuntime) -> Result<Self> {
        Ok(Self::new(HumanPack::new(rt.manifest())?))
    }

    pub fn modifiers(&self) -> &[ModifierDef] {
        &self.pack.extra.modifiers
    }

    /// Skin textures to blend for the current parameters (empty if the pack has none).
    pub fn skin_textures(&self, max: usize) -> Vec<(String, f64)> {
        skin_texture_weights(&self.pack.extra.skins, &self.params, max)
    }

    /// Mean sRGB colour of the blended photo skin, or `None` if the pack has no tones.
    pub fn skin_texture_tone(&self, max: usize) -> Option<[f64; 3]> {
        let skins = &self.pack.extra.skins;
        let mut out = [0.0; 3];
        for (file, w) in skin_texture_weights(skins, &self.params, max) {
            let tone = skins.iter().find(|s| s.file == file)?.tone?;
            for c in 0..3 {
                out[c] += tone[c] * w;
            }
        }
        (out[0] + out[1] + out[2] > 0.0).then_some(out)
    }

    /// The pack's target weights for the current parameters, sliders and race.
    pub fn target_weights(&self) -> Result<Weights> {
        let params = self.params.sanitized();
        let mut weights = macro_target_weights(&self.pack.extra.macro_targets, &params)?;
        modifier_target_weights(&self.pack.extra.modifiers, &self.modifier_values, &mut weights);
        muscle_target_weights(params.muscle, params.gender, &self.pack.resolver, &mut weights);
        race_target_weights(&self.race.sanitized(), &self.pack.resolver, params.gender, &mut weights);
        Ok(weights)
    }

    /// Proportion passes for the race and the deform plan (bone scales, ear tips, scale).
    pub fn shape_options(&self) -> ShapeOptions {
        let p = &self.pack;
        let base = race_shape_options(&self.race.sanitized(), &p.bone_names, &p.resolver);
        let mut options = merge_deform(base, self.deform.as_ref(), &p.bone_names, Some(&p.bone_parents));
        if self.fit_scale != 1.0 {
            options.scale = Some(options.scale.unwrap_or(1.0) * self.fit_scale);
        }
        options
    }

    /// How much bigger the face is than on a plain human body, for expression deltas.
    pub fn face_scale(&self) -> f64 {
        let r = self.race.sanitized();
        race_scale(&r) * race_head_scale(&r) * self.deform.as_ref().map_or(1.0, |d| d.scale) * self.fit_scale
    }

    /// Pack target weights of face units for this body and race.
    pub fn face_weights(&self, units: &UnitWeights, scale: f64) -> Weights {
        let available: HashSet<&str> = self.pack.target_names.iter().map(String::as_str).collect();
        expression_target_weights(units, &self.params, scale * self.face_scale(), Some(&available))
    }

    /// Evaluates the shape on `rt` (loading the targets it needs). `fit`: the meshes the shape
    /// is needed for (the body and what is worn), `None` for every loaded mesh.
    pub fn evaluate(&self, rt: &mut ActorRuntime, fit: Option<&[&str]>) -> Result<ActorShape> {
        rt.evaluate(&self.target_weights()?, Some(&self.shape_options()), fit)
    }

    /// Horns, tusks, tail, beard and procedural hair for a shape from [`Human::evaluate`] (see
    /// [`crate::parts`]): skinned to the pack skeleton, in the shape's model space. `config.scale`
    /// is set from the race. Needs the body and eye meshes loaded.
    pub fn parts(
        &self,
        rt: &mut ActorRuntime,
        shape: &ActorShape,
        config: &crate::parts::PartsConfig,
    ) -> Result<Vec<actors_core::parts::PartMesh>> {
        use crate::parts::{build_parts, has_parts, parts_body};
        let cfg = crate::parts::PartsConfig { scale: race_scale(&self.race), ..config.clone() };
        if !has_parts(&cfg) {
            return Ok(Vec::new());
        }
        let masks = &crate::data::data().ear_masks;
        let resolve = |bare: &str| self.pack.resolver.resolve(bare).map(str::to_string);
        let (l, r, lip) = (resolve(&masks.l), resolve(&masks.r), resolve("mouth-upperlip-volume-incr"));
        rt.ensure_targets([&l, &r, &lip].into_iter().flatten())?;
        let mask = |n: &Option<String>| n.as_deref().map(|n| rt.target_mask(n).map(|m| m.into_owned())).transpose();
        let (ml, mr, mlip) = (mask(&l)?, mask(&r)?, mask(&lip)?);
        let ears = match (&ml, &mr) {
            (Some(a), Some(b)) => Some([a.as_slice(), b.as_slice()]),
            _ => None,
        };
        let body = rt.meshes().iter().find(|m| {
            m.def.role == actors_core::format::MeshRole::Body && m.stencil.is_none() && m.joints.is_some() && m.weights.is_some()
        });
        let eyes = rt.meshes().iter().find(|m| m.def.material.kind == actors_core::format::MaterialKind::Eye && m.stencil.is_none());
        let (Some(body), Some(eyes)) = (body, eyes) else { return Ok(Vec::new()) };
        Ok(parts_body(shape, body, eyes, ears, mlip.as_deref()).map_or_else(Vec::new, |b| build_parts(&b, &cfg)))
    }

    /// Surface deltas for face units on top of a shape (an expression, a blink), for GPU morphs.
    pub fn face_delta(&self, rt: &mut ActorRuntime, shape: &ActorShape, units: &UnitWeights, scale: f64) -> Result<SurfaceDelta> {
        let weights = self.face_weights(units, scale);
        rt.ensure_targets(weights.keys())?;
        rt.surface_delta(shape, &weights, None)
    }
}
