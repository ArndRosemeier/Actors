//! Actors characters for [Engine](https://github.com/ArndRosemeier/Engine).
//!
//! A [`CharacterBuilder`] holds a loaded human pack; [`CharacterBuilder::build`] turns a
//! [`CharacterConfig`] (the same JSON as the web generator) into an [`engine::anim::AnimatedModel`]:
//! the shaped body, eyes, hair, brows and clothes as skinned meshes with their textures and
//! colours, the fitted skeleton, and the chosen clips retargeted and baked as keyframes. Spawn it
//! with `world.spawn_animated` and play clips by name.
//!
//! ```no_run
//! use actors_engine::{BuildOptions, CharacterBuilder};
//! use actors_generator::{AllowOptions, RandomOptions};
//!
//! let mut builder = CharacterBuilder::load("assets/packs")?;
//! builder.allow(&AllowOptions::preset("fantasy").unwrap());
//! let config = builder.random(7, &RandomOptions::default());
//! let character = builder.build(&config, &BuildOptions::default())?;
//! // world.spawn_animated(character.model, Place::at(0.0, 0.0, 0.0)?)?; world.play_animation(id, "idle")?;
//! # Ok::<(), actors_core::Error>(())
//! ```
//!
//! What is baked is a snapshot: change the config and build again (about 0.3 to 0.6 s in a
//! release build with three clips; build on a worker thread in a game). The engine has no polygon
//! offset, so outer garments sit a millimetre or two further out per layer instead.
//!
//! What the three.js shaders do per pixel is baked into textures here: iris colour, pupil shape
//! and glowing eyes into the eye texture, race skin patterns (scales, bark, veins, ...) and
//! painted stubble into a 1024² skin texture (see [`pattern`]). Race add-ons (horns, tusks, tails,
//! beards, leaf hair, crest) come from `actors_human::parts`; a tail adds six bones
//! (`tail_01`..`tail_06`) that sway in every clip. Hero costumes (cape, collar, mask, belt, chest
//! emblem; `actors_human::costume`) are built with their finishes, and the cape's bones get a
//! cloth simulation baked into every clip ([`cape`]; `swing_cape` for clips a game adds).
//!
//! Faces: with `face_animation` (or `face_rig`) in the config, every face unit becomes one of the
//! model's morph targets ([`CharacterModel::face`]) and the expression becomes their resting
//! weights. A [`FaceDriver`] adds blinks, glances, idle movement and lip-sync
//! (`driver.animator.say("...")`); pass its weights to `world.set_morph_weights` every frame.
//! Without it the expression is baked into the shape.
//!
//! Robots (`config.robot`, shaped by `config.robot_look`; `actors_human::robot`): plates, inner
//! frame, joint housings, a helmet with visor or optics, and lights, all over the body's shape and
//! skinned to the same skeleton, so every clip plays on them. They stand on their soles.
//!
//! Not yet carried over from the three.js adapter: skeletons, skin detail, the
//! patterns' bump and roughness, fabric shaders, eye bones (gaze) and wrinkles.

pub mod cape;
pub mod pattern;
pub mod texture;

pub use cape::{cape_sink, swing_cape, CapeRig, CapeSink, CapeWind};

use actors_core::format::{MaterialKind, MeshRole};
use actors_core::parts::{PartBone, PartKind, PartMesh};
use actors_core::{
    ActorRuntime, ActorShape, DirSource, Error, FittedSkeleton, InPlace, MeshData, Result, RetargetOptions, Retargeter, Weights,
};
use actors_generator::{
    allow_catalog, build_catalog, concealed_garments, costume_dyes_solid, costume_finish, default_config, height_fit, random_config,
    sanitize_config, AllowOptions, CharacterCatalog, CharacterConfig, Detail, RandomOptions, SeededRandom, SkinKind,
};
use actors_human::{expression, shape_modifiers, Human, HumanPack, PartsConfig};
use engine::anim::{AnimatedModel, AnimationClip, JointChannels, MeshMorph, QuatTrack, Skeleton, SkinMesh, Vec3Track, MAX_JOINTS};
use engine::mesh::{AlbedoMap, MaterialMaps};
use glam::{Mat4, Quat, Vec3, Vec4};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use texture::{hex_linear, luminance, srgb_to_linear};

/// How to build a character.
#[derive(Clone, Debug)]
pub struct BuildOptions {
    /// Clips to bake, by name (see `catalog().animations`). Empty: the config's animation plus
    /// idle, walk and run where the pack has them.
    pub clips: Vec<String>,
    /// Keyframes per second of the baked clips.
    pub fps: f64,
    /// Locomotion clips walk on the spot (the game moves the character) or carry their travel.
    pub in_place: InPlace,
    /// Photo skins blended for the body texture (more is closer to the web editor, slower to build).
    pub skin_layers: usize,
}

impl Default for BuildOptions {
    fn default() -> Self {
        Self { clips: Vec::new(), fps: 30.0, in_place: InPlace::On, skin_layers: 3 }
    }
}

/// A built character.
#[derive(Clone, Debug)]
pub struct CharacterModel {
    pub model: AnimatedModel,
    /// The config as built (made valid: adult age, wearable outfit, allowed race).
    pub config: CharacterConfig,
    /// Standing height in meters (after the catalog's height range).
    pub height: f32,
    /// The meshes drawn, by pack name (then the generated parts: "beard", "horns", "tail", ...),
    /// in the order of `model.meshes`.
    pub meshes: Vec<String>,
    /// The face as morph targets, when the config asks for a face rig or face animation.
    pub face: Option<Face>,
    /// The cape's bones, when the costume has a cape: every built clip swings it already; give
    /// clips added later their swing with [`swing_cape`].
    pub cape: Option<CapeRig>,
}

/// A character's face as morph targets: every face unit (brow raiser, lid closure, mouth
/// corner puller, ...) is one of `model.morph_targets`, in the same order as `units`. Set their
/// weights each frame with `world.set_morph_weights`, or let a [`FaceDriver`] do it.
#[derive(Clone, Debug, PartialEq)]
pub struct Face {
    /// Face unit names (MakeHuman's expression units), as `model.morph_targets`.
    pub units: Vec<String>,
    /// Unit weights of the config's expression at its intensity (the resting face).
    pub expression: Vec<f32>,
}

impl Face {
    /// Index of a face unit (and its morph target).
    pub fn unit(&self, name: &str) -> Option<usize> {
        self.units.iter().position(|u| u == name)
    }

    /// Morph weights for an expression (see `actors_human::expression`) at `intensity`.
    pub fn expression_weights(&self, name: &str, intensity: f64) -> Vec<f32> {
        let mut out = vec![0.0; self.units.len()];
        if let Some(units) = actors_human::expression(name) {
            for (u, w) in units {
                if let Some(i) = self.unit(u) {
                    out[i] += (w * intensity) as f32;
                }
            }
        }
        out
    }
}

/// A living face for a built character: blinks, glances, idle movement and lip-sync (see
/// `actors_human::FaceAnimator`) over its expression. Call [`FaceDriver::update`] every frame and
/// pass the result to `world.set_morph_weights(id, ...)`.
#[derive(Clone, Debug)]
pub struct FaceDriver {
    pub animator: actors_human::FaceAnimator,
    /// The resting face (one weight per unit); starts as the config's expression.
    pub expression: Vec<f32>,
    units: Vec<String>,
    out: Vec<f32>,
}

impl FaceDriver {
    pub fn new(face: &Face, options: actors_human::FaceAnimatorOptions) -> Self {
        Self {
            animator: actors_human::FaceAnimator::new(options),
            expression: face.expression.clone(),
            units: face.units.clone(),
            out: vec![0.0; face.units.len()],
        }
    }

    /// Advances the face by `dt` seconds; returns the morph weights for this frame.
    pub fn update(&mut self, dt: f32) -> &[f32] {
        self.out.copy_from_slice(&self.expression);
        let frame = self.animator.update(dt as f64, 0.0);
        for (u, w) in &frame.units {
            if let Some(i) = self.units.iter().position(|n| n == u) {
                self.out[i] += *w as f32;
            }
        }
        &self.out
    }
}

/// A loaded human pack that builds characters for the engine.
pub struct CharacterBuilder {
    rt: ActorRuntime,
    pack: Arc<HumanPack>,
    full: CharacterCatalog,
    catalog: CharacterCatalog,
    known: HashMap<String, f64>,
    textures: HashMap<String, Arc<AlbedoMap>>,
    /// Baked eyes (iris colour, pupil, glow) by look.
    eyes: HashMap<String, EyeMaps>,
}

type EyeMaps = (Arc<AlbedoMap>, Option<Arc<AlbedoMap>>);

impl CharacterBuilder {
    /// Loads `<packs>/human/manifest.json` (packs from `npm run import:human` or a release's
    /// actors-packs archive).
    pub fn load(packs: impl AsRef<Path>) -> Result<Self> {
        Self::from_runtime(ActorRuntime::load(DirSource::new(packs.as_ref()), "human/manifest.json")?)
    }

    /// Uses an already loaded human runtime (any [`actors_core::PackSource`]).
    pub fn from_runtime(rt: ActorRuntime) -> Result<Self> {
        let pack = HumanPack::new(rt.manifest())?;
        let mut full = build_catalog(rt.manifest(), &pack, rt.clip_defs(), None);
        // Skeletons are not ported to the engine yet.
        full.skeletal = None;
        let known = pack.extra.modifiers.iter().map(|m| (m.id.clone(), if m.negative.is_empty() { 0.0 } else { -1.0 })).collect();
        Ok(Self { rt, pack, catalog: full.clone(), full, known, textures: HashMap::new(), eyes: HashMap::new() })
    }

    /// What can be built (after [`Self::allow`]).
    pub fn catalog(&self) -> &CharacterCatalog {
        &self.catalog
    }

    /// The runtime (to load clip libraries, say).
    pub fn runtime(&mut self) -> &mut ActorRuntime {
        &mut self.rt
    }

    /// Keeps characters to what a game allows (races, clothing, height).
    pub fn allow(&mut self, allow: &AllowOptions) {
        self.catalog = allow_catalog(&self.full, allow);
    }

    /// The default character.
    pub fn default_config(&self) -> CharacterConfig {
        default_config(&self.catalog)
    }

    /// A random adult character; the same seed gives the same character (also in TypeScript).
    pub fn random(&self, seed: u32, options: &RandomOptions) -> CharacterConfig {
        random_config(&self.catalog, &self.default_config(), options, &mut SeededRandom::new(seed as f64))
    }

    /// Builds the character.
    pub fn build(&mut self, config: &CharacterConfig, options: &BuildOptions) -> Result<CharacterModel> {
        let c = sanitize_config(&self.catalog, config);
        // A robot is built over the bare body (its parts stand in for every pack mesh).
        let names = if c.robot { self.robot_mesh_names() } else { self.mesh_names(&c) };
        self.rt.load_meshes(&names)?;
        let fit: Vec<&str> = names.iter().map(String::as_str).collect();

        let mut human = Human::new(self.pack.clone());
        human.params = c.body;
        human.modifier_values = shape_modifiers(&c.shape, &c.details, Some(&self.known));
        human.race = c.race_settings();
        human.deform = c.deform.as_ref().map(actors_core::deform_recipe::deform);
        let mut shape = self.evaluate(&human, &c, &fit)?;
        let body = names.first().and_then(|n| self.rt.mesh(n)).filter(|m| m.def.role == MeshRole::Body).cloned();
        let range = |s: &ActorShape| body_range(s, body.as_ref());
        let mut height = range(&shape).1 - range(&shape).0;
        let scale = height_fit(height as f64, self.catalog.height.as_ref());
        if scale != 1.0 {
            human.fit_scale = scale;
            shape = self.evaluate(&human, &c, &fit)?;
            height = range(&shape).1 - range(&shape).0;
        }
        let sk = shape.skeleton.clone().ok_or_else(|| Error::Format("pack has no skeleton".into()))?;
        if sk.len() > MAX_JOINTS {
            return Err(Error::Format(format!("{} bones, the engine takes {MAX_JOINTS}", sk.len())));
        }
        if c.robot {
            let bottom = range(&shape).0;
            return self.build_robot(c, &shape, &sk, bottom, height, options);
        }

        let skin = self.skin_albedo(&human, &c, options.skin_layers)?;
        // Drawing order as in the three.js adapter: the body, then garments by layer, and within a
        // layer by their place in the outfit. What a later garment covers is not drawn under it
        // (skin under clothes, briefs under trousers), so it can't poke through.
        let order: Vec<f32> = names.iter().map(|n| self.rt.mesh(n).map_or(0.0, |m| depth_order(m, &names, &self.rt))).collect();
        let covers: Vec<(f32, &[u32])> = names
            .iter()
            .zip(&order)
            .filter_map(|(n, &o)| self.rt.mesh(n).and_then(|m| m.hides_base_vertices.as_deref()).map(|h| (o, h)))
            .collect();
        let hides: Vec<HashSet<u32>> =
            order.iter().map(|&mine| covers.iter().filter(|(o, _)| *o > mine).flat_map(|(_, h)| h.iter().copied()).collect()).collect();
        // Pack shapes are centred on the body; the engine's characters stand on y = 0.
        let lift = -range(&shape).0;
        let patterned = self.patterned_skin(&c, &human, &sk, &shape, &names, lift, skin.as_deref())?;
        let parts = self.parts(&c, &human, &shape)?;
        let extra: Vec<PartBone> = parts.iter().flat_map(|p| p.bones.iter().cloned()).collect();
        if sk.len() + extra.len() > MAX_JOINTS {
            return Err(Error::Format(format!("{} bones, the engine takes {MAX_JOINTS}", sk.len() + extra.len())));
        }
        let mut meshes = Vec::with_capacity(names.len());
        for (i, n) in names.iter().enumerate() {
            let md = self.rt.mesh(n).ok_or_else(|| Error::Unknown { kind: "mesh", name: n.clone() })?.clone();
            let mut material = self.material(&md, &c, &human, skin.as_deref())?;
            if let (MaterialKind::Skin, Some((albedo, emit))) = (md.def.material.kind, &patterned) {
                material.albedo = Some(albedo.clone());
                material.color = [1.0; 3];
                material.emissive = emit.clone().map(|e| (e, PATTERN_EMIT));
            }
            // The engine has no polygon offset: outer layers sit a little further out instead.
            let offset = if md.def.material.kind == MaterialKind::Cloth { order[i] * LAYER_GAP } else { 0.0 };
            meshes.push(skin_mesh(&md, &shape, &hides[i], material, lift, offset)?);
        }

        if !parts.is_empty() {
            let body = self.rt.mesh(&names[0]).ok_or_else(|| Error::NotLoaded(names[0].clone()))?.clone();
            let mut skin_mat = self.material(&body, &c, &human, skin.as_deref())?;
            if let Some((albedo, emit)) = &patterned {
                skin_mat.albedo = Some(albedo.clone());
                skin_mat.color = [1.0; 3];
                skin_mat.emissive = emit.clone().map(|e| (e, PATTERN_EMIT));
            }
            let hair_color = self.beard_color(&c);
            for p in &parts {
                meshes.push(part_mesh(p, part_material(p, &c, &skin_mat, hair_color), lift));
            }
        }

        let face = if c.face_rig || c.face_animation {
            let mut face = self.face_morphs(&human, &shape, &names, &mut meshes)?;
            face.expression = face.expression_weights(&c.expression, c.expression_intensity);
            Some(face)
        } else {
            None
        };
        let (skeleton, bind_local) = engine_skeleton(&sk, lift, &extra);
        let caped = extra.iter().any(|b| b.name.starts_with("cape_"));
        let (mut clips, travel) = self.clips(&sk, &c, options, caped)?;
        for clip in &mut clips {
            clip.channels.resize_with(sk.len() + extra.len(), Default::default);
            tail_sway(clip, &extra, sk.len(), &bind_local);
        }
        let mut model = AnimatedModel {
            skeleton,
            meshes,
            clips,
            bind_local,
            morph_targets: face.as_ref().map(|f| f.units.clone()).unwrap_or_default(),
        };
        let cape = if caped { CapeRig::of(&model) } else { None };
        if let Some(rig) = &cape {
            for (i, t) in travel.iter().enumerate() {
                swing_cape(&mut model, rig, i, CapeWind { travel: *t, root_motion: options.in_place == InPlace::Off });
            }
        }
        Ok(CharacterModel {
            model,
            config: c,
            height,
            meshes: names.into_iter().chain(parts.into_iter().map(|p| p.name)).collect(),
            face,
            cape,
        })
    }

    /// A robot (see `actors_human::robot`): plates, frame, joints, head and lights over the
    /// body's shape, skinned to the same skeleton, standing on its soles (`bottom` is the body's
    /// lowest point, `height` the body's height).
    fn build_robot(
        &mut self,
        c: CharacterConfig,
        shape: &ActorShape,
        sk: &FittedSkeleton,
        bottom: f32,
        height: f32,
        options: &BuildOptions,
    ) -> Result<CharacterModel> {
        let look = &c.robot_look;
        let cfg = actors_human::RobotConfig {
            head: look.head.clone(),
            ears: look.ears.clone(),
            plating: look.plating.clone(),
            thickness: look.thickness,
            core: look.core,
        };
        let body = actors_human::robot_body(shape, self.rt.meshes())
            .ok_or_else(|| Error::Format("no skinned body with eyes for a robot".into()))?;
        let robot = actors_human::build_robot(&body, &cfg);
        let lift = robot.lift as f32 - bottom;
        let meshes = robot.parts.iter().map(|p| part_mesh(p, robot_material(p.kind, look), lift)).collect();
        let (skeleton, bind_local) = engine_skeleton(sk, lift, &[]);
        let (mut clips, _) = self.clips(sk, &c, options, false)?;
        for clip in &mut clips {
            clip.channels.resize_with(sk.len(), Default::default);
        }
        let model = AnimatedModel { skeleton, meshes, clips, bind_local, morph_targets: Vec::new() };
        Ok(CharacterModel {
            model,
            config: c,
            height: height + robot.lift as f32,
            meshes: robot.parts.into_iter().map(|p| p.name).collect(),
            face: None,
            cape: None,
        })
    }

    /// Pack meshes a robot is built from: the body (first, it sets the height) and the eyes.
    fn robot_mesh_names(&self) -> Vec<String> {
        let has = |n: &str| self.rt.manifest().meshes.iter().any(|m| m.name == n);
        ["body", "eyes"].into_iter().filter(|n| has(n)).map(String::from).collect()
    }

    /// The skin texture with the race pattern and painted stubble baked in (and the pattern's
    /// glow), or None when there is neither.
    #[allow(clippy::too_many_arguments)]
    fn patterned_skin(
        &mut self,
        c: &CharacterConfig,
        human: &Human,
        sk: &FittedSkeleton,
        shape: &ActorShape,
        names: &[String],
        lift: f32,
        photo: Option<&AlbedoMap>,
    ) -> Result<Option<(AlbedoMap, Option<AlbedoMap>)>> {
        let id = if c.pattern_strength > 0.0 { pattern::pattern_id(&c.skin_pattern) } else { 0 };
        let stubble = self.stubble(c, shape, lift);
        if id == 0 && stubble.is_none() {
            return Ok(None);
        }
        let tone = skin_tone(c);
        let head = sk.names.iter().position(|n| n == "head").map(|i| sk.heads[i]);
        let scale = actors_human::race_scale(&human.race) * human.deform.as_ref().map_or(1.0, |d| d.scale) * human.fit_scale;
        let glow = match c.skin_pattern.as_str() {
            _ if id == 0 => 0.0,
            "veins" => 0.6 + c.eye_glow as f32 * 0.6,
            "crystals" => 0.4,
            _ => 0.0,
        };
        let p = pattern::Pattern {
            id,
            strength: c.pattern_strength as f32,
            seed: (c.seed * 97.0) as f32,
            glow,
            accent: Vec3::from(c.pattern_color.as_deref().and_then(hex_linear).unwrap_or(tone.map(|v| v * 0.3))),
            scale: scale as f32,
            head: head.map_or([1.55, 0.0], |h| [h[1] as f32 + lift, -h[2] as f32]),
        };
        // Bind-pose positions of the skin meshes' texels (feet at 0, +Z back, as the shader's vBind).
        let mut tris = Vec::new();
        for n in names {
            let Some(md) = self.rt.mesh(n).filter(|m| m.def.material.kind == MaterialKind::Skin) else { continue };
            let Some((pos, _)) = shape.source_of(md) else { continue };
            let at = |v: u32| {
                let s = md.map[v as usize] as usize * 3;
                Vec3::new(pos[s], pos[s + 1] + lift, -pos[s + 2])
            };
            let uv = |v: u32| [md.uv[v as usize * 2], md.uv[v as usize * 2 + 1]];
            for t in md.indices.as_chunks::<3>().0 {
                tris.push((t.map(uv), t.map(at)));
            }
        }
        let bind = pattern::bind_map(PATTERN_SIZE, tris.into_iter());
        let mask = match self.rt.mesh(&names[0]).and_then(|m| m.def.textures.as_ref()).and_then(|t| t.get("maskA")).cloned() {
            Some(f) => Some(self.texture(&f)?),
            None => None,
        };
        let tint = photo.map(|_| photo_tint(c, human));
        let size = PATTERN_SIZE;
        // Point sample of a map at a texel of the pattern grid (maps are 2048 or any size).
        let sample = |m: &AlbedoMap, x: usize, y: usize| {
            let (mx, my) = (x * m.width as usize / size, y * m.height as usize / size);
            let i = (my * m.width as usize + mx) * 4;
            [m.rgba[i], m.rgba[i + 1], m.rgba[i + 2]]
        };
        let mut albedo = vec![0u8; size * size * 4];
        let mut emit = vec![0u8; size * size * 4];
        let threads = std::thread::available_parallelism().map_or(4, |n| n.get()).min(16);
        let rows = size.div_ceil(threads);
        std::thread::scope(|scope| {
            for ((a, e), r0) in albedo.chunks_mut(rows * size * 4).zip(emit.chunks_mut(rows * size * 4)).zip((0..).step_by(rows)) {
                let (bind, mask, p, stubble) = (&bind, mask.as_deref(), &p, &stubble);
                scope.spawn(move || {
                    for (k, (ap, ep)) in a.as_chunks_mut::<4>().0.iter_mut().zip(e.as_chunks_mut::<4>().0.iter_mut()).enumerate() {
                        let (x, y) = (k % size, r0 + k / size);
                        let base = match (photo, tint) {
                            (Some(ph), Some(t)) => {
                                let px = sample(ph, x, y);
                                Vec3::new(
                                    texture::byte_to_linear(px[0]) * t[0],
                                    texture::byte_to_linear(px[1]) * t[1],
                                    texture::byte_to_linear(px[2]) * t[2],
                                )
                            }
                            _ => Vec3::from(tone),
                        };
                        let (col, glow) = match bind[y * size + x] {
                            Some(b) => {
                                let m = mask.map_or([0; 3], |m| sample(m, x, y));
                                let lips = m[0] as f32 / 255.0;
                                let c = stubble.as_ref().map_or(base, |s| s.apply(base, b, lips));
                                p.apply(c, b, lips, m[2] as f32 / 255.0)
                            }
                            None => (base, Vec3::ZERO),
                        };
                        *ap = [texture::linear_to_byte(col.x), texture::linear_to_byte(col.y), texture::linear_to_byte(col.z), 255];
                        let g = glow / PATTERN_EMIT;
                        *ep = [texture::linear_to_byte(g.x), texture::linear_to_byte(g.y), texture::linear_to_byte(g.z), 255];
                    }
                });
            }
        });
        let map = |rgba: Vec<u8>| AlbedoMap { width: size as u32, height: size as u32, rgba: rgba.into() };
        Ok(Some((map(albedo), (glow > 0.0).then(|| map(emit)))))
    }

    /// Painted stubble: the config's, or dense stubble in the region of a generated beard so its
    /// ragged edge never shows bare skin. None without stubble or eyes to place it.
    fn stubble(&self, c: &CharacterConfig, shape: &ActorShape, lift: f32) -> Option<pattern::Stubble> {
        let paint = actors_human::parts::beard_paint(&c.beard);
        let (amount, region, blur) = match paint {
            Some((amount, blur)) => (amount.max(c.stubble), actors_human::parts::beard_region(&c.beard), blur),
            None => (c.stubble, 0, 0.0),
        };
        if amount <= 0.0 {
            return None;
        }
        let eyes = self.rt.meshes().iter().find(|m| m.def.material.kind == MaterialKind::Eye && m.stencil.is_none())?;
        let [l, r] = actors_human::parts::eye_centres(shape, eyes)?;
        let face = Vec3::new(((l[0] + r[0]) / 2.0) as f32, ((l[1] + r[1]) / 2.0) as f32 + lift, -((l[2] + r[2]) / 2.0) as f32);
        let eyes = actors_core::math::hypot3(l[0] - r[0], l[1] - r[1], l[2] - r[2]) as f32;
        Some(pattern::Stubble {
            amount: amount as f32,
            region,
            seed: (c.seed * 31.0) as f32,
            blur: blur as f32,
            color: Vec3::from(self.beard_color(c)) * 0.55,
            face,
            eyes,
        })
    }

    /// The face rig as morph targets on the pack meshes that follow the face (the first
    /// `names.len()` of `meshes`).
    fn face_morphs(&mut self, human: &Human, shape: &ActorShape, names: &[String], meshes: &mut [SkinMesh]) -> Result<Face> {
        let rig = human.face_rig(&mut self.rt, shape)?;
        for (n, mesh) in names.iter().zip(meshes.iter_mut()) {
            let md = self.rt.mesh(n).ok_or_else(|| Error::NotLoaded(n.clone()))?;
            if !actors_core::runtime::follows_face(&md.def) {
                continue;
            }
            let Some(units) = rig.spaces.get(&actors_core::runtime::face_space(md)) else { continue };
            // A source vertex can be drawn as several (UV seams).
            let mut drawn: HashMap<u32, Vec<u32>> = HashMap::new();
            for (i, &s) in md.map.iter().enumerate() {
                drawn.entry(s).or_default().push(i as u32);
            }
            for (target, d) in units.iter().enumerate() {
                let Some(d) = d else { continue };
                let mut m = MeshMorph { target, ..Default::default() };
                for (k, v) in d.vertices.iter().enumerate() {
                    let at = |a: &[f32]| Vec3::new(a[k * 3], a[k * 3 + 1], a[k * 3 + 2]);
                    for &i in drawn.get(v).map(Vec::as_slice).unwrap_or_default() {
                        m.vertices.push(i);
                        m.positions.push(at(&d.positions));
                        m.normals.push(at(&d.normals));
                    }
                }
                if !m.vertices.is_empty() {
                    mesh.morphs.push(m);
                }
            }
        }
        Ok(Face { units: rig.units, expression: Vec::new() })
    }

    fn evaluate(&mut self, human: &Human, c: &CharacterConfig, fit: &[&str]) -> Result<ActorShape> {
        let mut weights: Weights = human.target_weights()?;
        // The expression is baked into the shape, unless the face is animated (then it is the
        // resting weights of the face's morph targets).
        if c.face_rig || c.face_animation {
            return self.rt.evaluate(&weights, Some(&human.shape_options()), Some(fit));
        }
        if let Some(units) = expression(&c.expression) {
            for (k, v) in human.face_weights(units, c.expression_intensity) {
                *weights.entry(k).or_insert(0.0) += v;
            }
        }
        self.rt.evaluate(&weights, Some(&human.shape_options()), Some(fit))
    }

    /// Pack meshes the config shows, the way the web generator picks them.
    fn mesh_names(&self, c: &CharacterConfig) -> Vec<String> {
        let has = |n: &str| self.rt.manifest().meshes.iter().any(|m| m.name == n);
        let mut out: Vec<String> = Vec::new();
        let body = if c.detail == Detail::Low && has("body-low") { "body-low" } else { "body" };
        out.push(body.into());
        for n in ["eyes", "eyelashes", "teeth", "tongue"] {
            if has(n) {
                out.push(n.into());
            }
        }
        let concealed = concealed_garments(&self.catalog, &c.outfit);
        let worn: Vec<&String> = c.outfit.iter().filter(|g| !concealed.contains(g) && has(g)).collect();
        let garment = |id: &str| self.catalog.garment(id);
        let hides_hair = c.outfit.iter().any(|g| garment(g).is_some_and(|g| g.hides_hair)) || cowl(c);
        if let Some(h) = c.hair.as_deref().filter(|h| has(h) && !hides_hair) {
            out.push(h.into());
        }
        if let Some(b) = c.brows.as_deref().filter(|b| has(b) && !cowl(c)) {
            out.push(b.into());
        }
        // Adults only (sanitize_config turns anatomy off for children); hidden under covering clothes.
        let covered = c.outfit.iter().any(|g| garment(g).is_some_and(|g| g.covers_anatomy));
        if c.anatomy && c.youth == 0.0 && c.body.gender >= 0.5 && !covered && has("genitals-male") {
            out.push("genitals-male".into());
        }
        out.extend(worn.into_iter().cloned());
        out
    }

    /// Whether a worn garment hides the hair (hats, hoods, helmets).
    fn hides_hair(&self, c: &CharacterConfig) -> bool {
        c.outfit.iter().any(|g| self.catalog.garment(g).is_some_and(|g| g.hides_hair)) || cowl(c)
    }

    /// The race add-ons (horns, tusks, tail, beard, leaf hair or crest) and the costume (cape,
    /// mask, belt, emblem); see actors_human::parts and actors_human::costume.
    fn parts(&mut self, c: &CharacterConfig, human: &Human, shape: &ActorShape) -> Result<Vec<PartMesh>> {
        let hair = c.hair.as_deref().filter(|h| matches!(*h, "leaves" | "crest") && !self.hides_hair(c)).unwrap_or("none");
        let horn = texture::parse_hex(c.horn_color.as_deref().unwrap_or("#d9cfb4")).unwrap_or([0.85, 0.81, 0.71]);
        let cfg = PartsConfig {
            seed: c.seed,
            scale: 1.0,
            horns: c.horns.clone(),
            horn_size: c.horn_size,
            horn_color: horn.map(|v| v as f64),
            tusks: c.tusks,
            tail: c.tail.clone(),
            tail_length: c.tail_length,
            beard: c.beard.clone(),
            hair: hair.into(),
            costume: c.costume.any().then(|| c.costume.parts()),
        };
        human.parts(&mut self.rt, shape, &cfg)
    }

    /// Colour of beards, leaves and furred tails (linear): the hair colour, else the hairstyle's own.
    fn beard_color(&self, c: &CharacterConfig) -> [f32; 3] {
        let own = c.hair.as_deref().and_then(|h| self.rt.manifest().meshes.iter().find(|m| m.name == h)).and_then(|m| m.material.color);
        match c.hair_color.as_deref().and_then(hex_linear) {
            Some(col) => col,
            None => own.map(|col| col.map(srgb_to_linear)).or_else(|| hex_linear("#3b2a1e")).unwrap_or([0.04, 0.02, 0.01]),
        }
    }

    fn texture(&mut self, file: &str) -> Result<Arc<AlbedoMap>> {
        if let Some(t) = self.textures.get(file) {
            return Ok(t.clone());
        }
        let bytes = self.rt.load_file(file)?;
        let map = Arc::new(texture::decode(&bytes).map_err(|e| Error::Format(format!("{file}: {e}")))?);
        self.textures.insert(file.to_string(), map.clone());
        Ok(map)
    }

    /// The body texture: photo skins blended for gender, age and ethnicity.
    fn skin_albedo(&mut self, human: &Human, c: &CharacterConfig, layers: usize) -> Result<Option<Arc<AlbedoMap>>> {
        if c.skin != SkinKind::Photo {
            return Ok(None);
        }
        let skins = human.skin_textures(layers.max(1));
        if skins.is_empty() {
            return Ok(None);
        }
        let key = format!("skin:{skins:?}");
        if let Some(t) = self.textures.get(&key) {
            return Ok(Some(t.clone()));
        }
        let maps: Vec<(Arc<AlbedoMap>, f32)> = skins.iter().map(|(f, w)| self.texture(f).map(|t| (t, *w as f32))).collect::<Result<_>>()?;
        let refs: Vec<(&AlbedoMap, f32)> = maps.iter().map(|(m, w)| (m.as_ref(), *w)).collect();
        let mut blended = texture::blend(&refs).ok_or_else(|| Error::Format("no skin texture".into()))?;
        texture::opaque(&mut blended);
        let blended = Arc::new(blended);
        // Blends are reused for similar bodies; keep the cache small.
        if self.textures.keys().filter(|k| k.starts_with("skin:")).count() > 16 {
            self.textures.retain(|k, _| !k.starts_with("skin:"));
        }
        self.textures.insert(key, blended.clone());
        Ok(Some(blended))
    }

    fn material(&mut self, md: &MeshData, c: &CharacterConfig, human: &Human, skin: Option<&AlbedoMap>) -> Result<Material> {
        let def = &md.def;
        let hint_lin = def.material.color.map(|col| col.map(srgb_to_linear));
        let mut m = Material {
            color: [1.0; 3],
            albedo: None,
            normal: None,
            roughness: def.material.roughness.unwrap_or(0.6),
            metallic: 0.0,
            double_sided: false,
            emissive: None,
        };
        let tex = def.textures.as_ref();
        match def.material.kind {
            MaterialKind::Skin => match skin {
                Some(s) => {
                    m.albedo = Some(s.clone());
                    m.color = photo_tint(c, human);
                }
                None => m.color = skin_tone(c),
            },
            MaterialKind::Hair => {
                m.double_sided = true;
                match tex.and_then(|t| t.get("color")) {
                    Some(file) => {
                        let mut t = self.texture(file)?;
                        if def.tags.iter().any(|t| t == "brows") {
                            t = Arc::new(texture::soft_brows(&t, 3));
                        }
                        m.albedo = Some(match c.hair_color.as_deref().and_then(hex_linear) {
                            Some(tint) => texture::tint(&t, tint, luminance(hint_lin.unwrap_or([0.3, 0.2, 0.1]))),
                            None => (*t).clone(),
                        });
                    }
                    // Eyelashes: strands cut from the lash map (near black either way).
                    None if def.tags.iter().any(|t| t == "lashes") => m.albedo = Some(texture::lash_map()),
                    None => m.color = [0.05, 0.035, 0.03],
                }
            }
            MaterialKind::Cloth => {
                m.double_sided = true;
                let tint = c.garment_colors.get(&def.name).and_then(|h| hex_linear(h));
                let finish = c.costume.finishes.get(&def.name).map(String::as_str);
                match tex.and_then(|t| t.get("color")) {
                    Some(file) => {
                        let t = self.texture(file)?;
                        // Textured garments store their texture's mean colour (sRGB).
                        let mean = luminance(hint_lin.unwrap_or([0.5; 3]));
                        m.albedo = Some(match tint {
                            // A costume finish (satin, leather, ...) dyes the piece one colour: a print
                            // (a giraffe tank top) fades to faint folds.
                            Some(tint) if finish.is_some_and(costume_dyes_solid) => {
                                texture::tint_flat(&t, tint, mean, actors_generator::COSTUME_DYED_PATTERN as f32)
                            }
                            Some(tint) => texture::tint(&t, tint, mean),
                            None => (*t).clone(),
                        });
                    }
                    // Plain garments store their colour linear.
                    None => m.color = tint.unwrap_or_else(|| def.material.color.unwrap_or([0.8; 3])),
                }
                if let Some(file) = tex.and_then(|t| t.get("normal")) {
                    m.normal = Some((*self.texture(file)?).clone());
                }
                // A finish chosen in the costume (satin, leather, rubber, ...).
                if let Some((metal, rough, _, _)) = finish.and_then(costume_finish) {
                    m.roughness = rough as f32;
                    m.metallic = metal as f32;
                }
            }
            MaterialKind::Eye if tex.is_some_and(|t| t.contains_key("color")) => {
                let file = &tex.unwrap()["color"];
                let photo = self.texture(file)?;
                let iris = c.eye_color.as_deref().and_then(texture::iris_from_hex).or_else(|| texture::iris_preset(&c.eyes));
                let glow = c.eye_glow as f32;
                let pupil = texture::pupil_shape(&c.pupil);
                let key = format!("{file}|{iris:?}|{pupil}|{glow}");
                let (albedo, emit) = match self.eyes.get(&key) {
                    Some(e) => e.clone(),
                    None => {
                        let (a, e) = texture::eye(&photo, iris, pupil, glow);
                        let baked = (Arc::new(a), e.map(Arc::new));
                        // A few looks at most: a crowd shares a handful of eye colours.
                        if self.eyes.len() > 32 {
                            self.eyes.clear();
                        }
                        self.eyes.insert(key, baked.clone());
                        baked
                    }
                };
                m.albedo = Some((*albedo).clone());
                m.emissive = emit.map(|e| ((*e).clone(), glow * 2.5));
            }
            MaterialKind::Eye | MaterialKind::Teeth | MaterialKind::Mouth => {
                if let Some(file) = tex.and_then(|t| t.get("color")) {
                    let mut t = (*self.texture(file)?).clone();
                    texture::opaque(&mut t);
                    m.albedo = Some(t);
                } else {
                    m.color = def.material.color.unwrap_or([0.8; 3]);
                }
            }
            _ => m.color = def.material.color.unwrap_or([0.8; 3]),
        }
        Ok(m)
    }

    /// The clips, and with `travel` how fast each one moves the character (m/s, model space;
    /// measured from its root motion), for the cape's wind.
    fn clips(
        &mut self,
        sk: &FittedSkeleton,
        c: &CharacterConfig,
        options: &BuildOptions,
        travel: bool,
    ) -> Result<(Vec<AnimationClip>, Vec<Vec3>)> {
        let mut names = options.clips.clone();
        if names.is_empty() {
            names.extend(c.animation.iter().cloned());
            for n in ["idle", "walk", "run"] {
                if !names.iter().any(|x| x == n) && self.rt.clip_def(n).is_some() {
                    names.push(n.into());
                }
            }
        }
        let opts = RetargetOptions { in_place: options.in_place, ..Default::default() };
        let mut out = Vec::with_capacity(names.len());
        let mut travels = Vec::new();
        for name in names {
            let clip = self.rt.load_clip(&name)?;
            // Root motion of a clip baked in place, for the cape's wind.
            let free = if travel && options.in_place != InPlace::Off {
                Some(Retargeter::new(sk, clip.clone(), &RetargetOptions { in_place: InPlace::Off, ..Default::default() })?.bake(10.0))
            } else {
                None
            };
            let baked = Retargeter::new(sk, clip, &opts)?.bake(options.fps);
            if travel {
                let measured = clip_travel(sk, free.as_ref().unwrap_or(&baked));
                travels.push(if measured.length() > 0.2 { measured } else { Vec3::Z * gait_speed(&name) });
            }
            let times = baked.times.clone();
            let mut channels: Vec<JointChannels> = baked
                .rotations
                .iter()
                .map(|r| JointChannels {
                    rotation: Some(QuatTrack {
                        times: times.clone(),
                        values: r.as_chunks::<4>().0.iter().map(|q| Quat::from_xyzw(q[0], q[1], q[2], q[3])).collect(),
                    }),
                    ..Default::default()
                })
                .collect();
            channels[baked.root_index].translation = Some(Vec3Track {
                times: times.clone(),
                values: baked.root_positions.as_chunks::<3>().0.iter().map(|p| Vec3::new(p[0], p[1], p[2])).collect(),
            });
            out.push(AnimationClip { name, duration: times.last().copied().unwrap_or(0.0), channels });
        }
        Ok((out, travels))
    }
}

/// Forward speed (m/s) of a gait clip recorded on the spot, by its name.
fn gait_speed(name: &str) -> f32 {
    let n = name.to_ascii_lowercase();
    let has = |w: &str| n.contains(w);
    if has("sprint") {
        6.5
    } else if has("run") {
        4.5
    } else if has("jog") {
        3.2
    } else if has("crouch") && has("walk") {
        0.8
    } else if has("walk") {
        1.4
    } else {
        0.0
    }
}

/// How fast a baked clip moves the character: the root's travel over the clip (horizontal, model
/// space, m/s).
fn clip_travel(sk: &FittedSkeleton, baked: &actors_core::BakedClip) -> Vec3 {
    let p = &baked.root_positions;
    let (Some(&t1), true) = (baked.times.last(), p.len() >= 6) else { return Vec3::ZERO };
    let n = p.len();
    let local = Vec3::new(p[n - 3] - p[0], p[n - 2] - p[1], p[n - 1] - p[2]);
    // The root's position is in its parent's frame.
    let mut rot = Quat::IDENTITY;
    let mut j = sk.parent(baked.root_index);
    while let Some(i) = j {
        let q = sk.local_rotations[i];
        rot = Quat::from_xyzw(q[0] as f32, q[1] as f32, q[2] as f32, q[3] as f32).normalize() * rot;
        j = sk.parent(i);
    }
    let d = rot * local;
    let dur = t1 - baked.times[0];
    if dur <= 0.0 {
        return Vec3::ZERO;
    }
    Vec3::new(d.x, 0.0, d.z) / dur
}

/// A cowl covers the head: no hair or brows under it.
fn cowl(c: &CharacterConfig) -> bool {
    actors_human::costume_hides_hair(Some(&c.costume.parts()))
}

/// The procedural skin colour for `skin_tone` (0 = light .. 1 = dark), linear.
/// The skin colour (linear): the custom colour, else the tone slider's.
fn skin_tone(c: &CharacterConfig) -> [f32; 3] {
    c.skin_color.as_deref().and_then(hex_linear).unwrap_or_else(|| skin_tone_color(c.skin_tone))
}

/// A custom skin colour scales the photo skin's channels so its mean becomes that colour.
fn photo_tint(c: &CharacterConfig, human: &Human) -> [f32; 3] {
    match (c.skin_color.as_deref().and_then(hex_linear), human.skin_texture_tone(3)) {
        (Some(custom), Some(tone)) => {
            let tone = tone.map(|v| srgb_to_linear(v as f32));
            [0, 1, 2].map(|i| custom[i] / tone[i].max(1e-3))
        }
        _ => [1.0; 3],
    }
}

/// Emissive strength of baked pattern glow (the map holds half the emitted light).
const PATTERN_EMIT: f32 = 2.0;

/// Texels per side of a patterned skin.
const PATTERN_SIZE: usize = 1024;

pub fn skin_tone_color(tone: f64) -> [f32; 3] {
    const TONES: [[f32; 3]; 4] = [[0.93, 0.76, 0.66], [0.78, 0.57, 0.43], [0.5, 0.33, 0.22], [0.25, 0.15, 0.1]];
    let f = tone.clamp(0.0, 1.0) as f32 * 3.0;
    let i = (f.floor() as usize).min(2);
    let t = f - i as f32;
    [0, 1, 2].map(|c| {
        let (a, b) = (srgb_to_linear(TONES[i][c]), srgb_to_linear(TONES[i + 1][c]));
        a + (b - a) * t
    })
}

#[derive(Clone)]
struct Material {
    /// Linear colour multiplied with the albedo.
    color: [f32; 3],
    albedo: Option<AlbedoMap>,
    normal: Option<AlbedoMap>,
    roughness: f32,
    metallic: f32,
    double_sided: bool,
    /// Emitted colour (sRGB) and its linear strength: glowing eyes.
    emissive: Option<(AlbedoMap, f32)>,
}

/// Lowest and highest point of the visible body (the base mesh also holds helper geometry, such
/// as the tights helper below the feet, which mustn't count).
fn body_range(shape: &ActorShape, body: Option<&MeshData>) -> (f32, f32) {
    let span = |it: &mut dyn Iterator<Item = f32>| it.fold((f32::MAX, f32::MIN), |(l, h), y| (l.min(y), h.max(y)));
    let (lo, hi) = match body.and_then(|b| shape.source_of(b).map(|(p, _)| (b, p))) {
        Some((b, p)) => span(&mut b.map.iter().map(|&v| p[v as usize * 3 + 1])),
        None => span(&mut shape.positions.iter().skip(1).step_by(3).copied()),
    };
    if hi > lo {
        (lo, hi)
    } else {
        (0.0, 0.0)
    }
}

/// Meters between garment layers (see [`depth_order`]).
const LAYER_GAP: f32 = 0.002;

/// A garment's layer (see `garmentLayer` in @actors/three): 0 for the body, then underwear,
/// fitted garments and explicit `layer:` tags.
fn garment_layer(md: &MeshData) -> f32 {
    let def = &md.def;
    if def.role == MeshRole::Body {
        return 0.0;
    }
    if let Some(l) = def.tags.iter().find_map(|t| t.strip_prefix("layer:")).and_then(|v| v.parse::<f32>().ok()) {
        return 2.0 + l;
    }
    let fitted = matches!(def.source, actors_core::format::MeshSource::Proxy { .. }) && !def.has_tag("tucked");
    (if fitted { 2.0 } else { 1.0 }) + def.inflate.unwrap_or(0.0) * 100.0
}

/// Drawing order: the layer, then a quarter step per garment of the same layer drawn before it.
fn depth_order(md: &MeshData, drawn: &[String], rt: &ActorRuntime) -> f32 {
    if md.def.material.kind != MaterialKind::Cloth {
        return garment_layer(md);
    }
    let layer = garment_layer(md);
    let mut rank = 0.0;
    for n in drawn {
        if n == md.name() {
            break;
        }
        if rt.mesh(n).is_some_and(|o| o.def.material.kind == MaterialKind::Cloth && garment_layer(o) == layer) {
            rank += 1.0;
        }
    }
    layer + rank * 0.25
}

fn skin_mesh(md: &MeshData, shape: &ActorShape, hidden: &HashSet<u32>, m: Material, lift: f32, offset: f32) -> Result<SkinMesh> {
    let (pos, nrm) = shape.source_of(md).ok_or_else(|| Error::NotLoaded(format!("shape of mesh {}", md.name())))?;
    let n = md.vertex_count();
    let at = |a: &[f32], s: u32| {
        let i = s as usize * 3;
        Vec3::new(a[i], a[i + 1], a[i + 2])
    };
    let normals: Vec<Vec3> = md.map.iter().map(|&s| at(nrm, s).normalize_or_zero()).collect();
    let positions: Vec<Vec3> = md.map.iter().zip(&normals).map(|(&s, n)| at(pos, s) + Vec3::Y * lift + *n * offset).collect();
    let uvs: Vec<[f32; 2]> = (0..n).map(|i| md.uv.get(i * 2..i * 2 + 2).map_or([0.0, 0.0], |u| [u[0], 1.0 - u[1]])).collect();
    let joints: Vec<[u16; 4]> = match &md.joints {
        Some(j) => j.as_chunks::<4>().0.iter().map(|j| [j[0], j[1], j[2], j[3]]).collect(),
        None => vec![[0; 4]; n],
    };
    let weights: Vec<[f32; 4]> = match &md.weights {
        Some(w) => w.as_chunks::<4>().0.iter().map(|w| [w[0], w[1], w[2], w[3]]).collect(),
        None => vec![[1.0, 0.0, 0.0, 0.0]; n],
    };
    // Covered surface: a triangle goes when all its corners are covered (the body, garments cut
    // from it, and fitted garments under a fitted one). Cut hems (clip < 0) too.
    let coverable = md.def.role == MeshRole::Body
        || (md.def.role == MeshRole::Garment && (md.def.source == actors_core::format::MeshSource::Base || md.dominant.is_some()));
    let hidden_vertex = |v: u32| {
        if !coverable || hidden.is_empty() {
            return false;
        }
        let s = md.map[v as usize];
        let base = md.dominant.as_ref().map_or(s, |d| d[s as usize]);
        hidden.contains(&base)
    };
    let cut = |v: u32| md.clip.as_ref().is_some_and(|c| c[v as usize] < 0.0);
    let indices: Vec<u32> = md
        .indices
        .as_chunks::<3>()
        .0
        .iter()
        .filter(|t| !(t.iter().all(|&v| hidden_vertex(v)) || t.iter().all(|&v| cut(v))))
        .flatten()
        .copied()
        .collect();
    let color = Vec4::new(m.color[0], m.color[1], m.color[2], 1.0);
    let mut maps = MaterialMaps { normal: m.normal, ..MaterialMaps::default() };
    if let Some((e, k)) = m.emissive {
        maps.emissive = Some(e);
        maps.emissive_factor = [k; 3];
    }
    maps.roughness = m.roughness;
    maps.metallic = m.metallic;
    Ok(SkinMesh {
        positions,
        normals,
        colors: vec![color; n],
        uvs,
        joints,
        weights,
        indices,
        double_sided: m.double_sided,
        albedo: m.albedo,
        maps,
        morphs: Vec::new(),
    })
}

/// The engine's skeleton and bind pose from a fitted skeleton (bind matrices composed the way the
/// engine composes them, so the bind pose skins to exactly the shaped mesh).
fn engine_skeleton(sk: &FittedSkeleton, lift: f32, extra: &[PartBone]) -> (Skeleton, Vec<(Vec3, Quat, Vec3)>) {
    let n = sk.len();
    let mut bind_local: Vec<(Vec3, Quat, Vec3)> = (0..n)
        .map(|i| {
            let p = sk.local_positions[i];
            let q = sk.local_rotations[i];
            let up = if sk.parent(i).is_none() { lift } else { 0.0 };
            (
                Vec3::new(p[0] as f32, p[1] as f32 + up, p[2] as f32),
                Quat::from_xyzw(q[0] as f32, q[1] as f32, q[2] as f32, q[3] as f32).normalize(),
                Vec3::ONE,
            )
        })
        .collect();
    let mut global = vec![Mat4::IDENTITY; n];
    for i in 0..n {
        let (t, r, s) = bind_local[i];
        let local = Mat4::from_scale_rotation_translation(s, r, t);
        global[i] = match sk.parent(i) {
            Some(p) => global[p] * local,
            None => local,
        };
    }
    let mut names = sk.names.clone();
    let mut parents: Vec<Option<usize>> = (0..n).map(|i| sk.parent(i)).collect();
    // Part bones (a tail chain): unrotated, at their heads, under their parent.
    for b in extra {
        let parent = names.iter().position(|x| *x == b.parent);
        let world = Mat4::from_translation(Vec3::new(b.head[0], b.head[1] + lift, b.head[2]));
        let local = parent.map_or(world, |p| global[p].inverse() * world);
        let (s, r, t) = local.to_scale_rotation_translation();
        bind_local.push((t, r, s));
        global.push(world);
        names.push(b.name.clone());
        parents.push(parent);
    }
    let count = names.len();
    let skeleton = Skeleton {
        joint_names: names,
        parents,
        inverse_bind: global.iter().map(|g| g.inverse()).collect(),
        joint_node_indices: (0..count).collect(),
        root_transforms: vec![Mat4::IDENTITY; count],
    };
    (skeleton, bind_local)
}

/// Idle sway for tail chains (part bones from index `first`), as in the three.js adapter: a wave
/// travelling to the tip, stronger toward it, with a slight lift and fall, in whole cycles so
/// looping clips stay seamless. The chains are unrotated at bind, so the sway turns about the
/// body's up and side axes.
fn tail_sway(clip: &mut AnimationClip, extra: &[PartBone], first: usize, bind_local: &[(Vec3, Quat, Vec3)]) {
    let duration = clip.duration;
    if duration <= 0.0 {
        return;
    }
    let is_extra = |name: &str| extra.iter().any(|b| b.name == name);
    for (root, _) in extra.iter().enumerate().filter(|(_, b)| !is_extra(&b.parent) && b.name.starts_with("tail_")) {
        let mut chain = vec![root];
        while let Some(next) = extra.iter().position(|b| b.parent == extra[*chain.last().unwrap()].name) {
            chain.push(next);
        }
        let cycles = (duration / 1.8).round().max(1.0);
        let steps = (cycles as usize * 24).max(12);
        let times: Vec<f32> = (0..=steps).map(|i| i as f32 / steps as f32 * duration).collect();
        for (k, &b) in chain.iter().enumerate() {
            let k = k as f32;
            let rest = bind_local[first + b].1;
            let values = times
                .iter()
                .map(|t| {
                    let ph = t / duration * cycles * std::f32::consts::TAU;
                    let yaw = Quat::from_axis_angle(Vec3::Y, 0.09 * (0.4 + k * 0.25) * (ph - k * 0.7).sin());
                    let pitch = Quat::from_axis_angle(Vec3::X, 0.03 * (ph * 2.0 - k * 0.5).sin());
                    rest * yaw * pitch
                })
                .collect();
            clip.channels[first + b].rotation = Some(QuatTrack { times: times.clone(), values });
        }
    }
}

/// The material of a generated part, as the three.js adapter gives each kind.
fn part_material(p: &PartMesh, c: &CharacterConfig, skin: &Material, hair: [f32; 3]) -> Material {
    let plain = |color: [f32; 3], roughness: f32| Material {
        color,
        albedo: None,
        normal: None,
        roughness,
        metallic: 0.0,
        double_sided: false,
        emissive: None,
    };
    let own = p.color.map(|col| col.map(srgb_to_linear)).unwrap_or([0.3, 0.2, 0.12].map(srgb_to_linear));
    match p.kind {
        PartKind::Skin => Material { normal: None, ..skin.clone() },
        PartKind::Fin => Material { normal: None, double_sided: true, ..skin.clone() },
        PartKind::Hair => Material { albedo: Some(texture::beard_texture().clone()), double_sided: true, ..plain(hair, 0.55) },
        PartKind::Leaf => Material { albedo: Some(texture::leaf_texture().clone()), double_sided: true, ..plain(hair, 0.6) },
        PartKind::Fur => plain(hair, 0.9),
        PartKind::Tusk => plain(own, 0.35),
        PartKind::Horn => plain(c.horn_color.as_deref().and_then(hex_linear).unwrap_or(own), 0.45),
        PartKind::Cloth | PartKind::Emblem => {
            let (metal, rough, coat, _) = c.costume.finish_of(&p.name).and_then(costume_finish).unwrap_or((0.0, 0.6, 0.0, 0.0));
            // No clearcoat in Engine: a coated finish reads a little glossier.
            let roughness = (rough * (1.0 - 0.35 * coat)) as f32;
            let mut m = Material { metallic: metal as f32, double_sided: true, ..plain(own, roughness) };
            if p.kind == PartKind::Emblem {
                m.color = [1.0; 3];
                m.albedo = Some(texture::emblem_texture(&c.costume));
            }
            m
        }
        _ => plain(own, 0.45),
    }
}

/// The material of a robot part, as the web generator colours each kind from the robot's look:
/// paint and trim with the chosen finish, a dark inner frame, metal joints, near-black visor glass
/// and lights in the glow colour.
fn robot_material(kind: PartKind, look: &actors_generator::RobotLook) -> Material {
    let col = |hex: &str, fallback: [f32; 3]| hex_linear(hex).unwrap_or(fallback);
    let plain = |color: [f32; 3], roughness: f32, metallic: f32| Material {
        color,
        albedo: None,
        normal: None,
        roughness,
        metallic,
        double_sided: false,
        emissive: None,
    };
    let finish =
        actors_generator::tables().robot_finishes.get(&look.finish).map_or((0.3, 0.45, 0.35), |f| (f.metalness, f.roughness, f.clearcoat));
    // No clearcoat in Engine: a coated finish reads a little glossier.
    let (metal, rough) = (finish.0 as f32, (finish.1 * (1.0 - 0.35 * finish.2)) as f32);
    let glow = col(&look.glow, [0.06, 0.7, 1.0]);
    match kind {
        PartKind::Plate => plain(col(&look.paint, [0.7; 3]), rough, metal),
        PartKind::Trim => plain(col(&look.trim, [0.3; 3]), rough, metal),
        PartKind::Frame => plain(col(&look.frame, [0.016, 0.018, 0.024]), 0.5, 0.35),
        PartKind::Joint => plain(col(&look.metal, [0.33, 0.35, 0.4]), 0.28, 1.0),
        // Visor glass: near black with a hint of the light colour.
        PartKind::Visor => plain(glow.map(|v| v * 0.04), 0.04, 0.4),
        PartKind::Glow => {
            let strength = look.glow_strength as f32 * 3.2;
            // The light colour as a 1x1 emissive map (sRGB), at the look's strength.
            let rgba = [texture::linear_to_byte(glow[0]), texture::linear_to_byte(glow[1]), texture::linear_to_byte(glow[2]), 255];
            let map = AlbedoMap { width: 1, height: 1, rgba: rgba.to_vec().into() };
            Material { emissive: Some((map, strength)), ..plain(glow.map(|v| v * 0.05), 0.3, 0.0) }
        }
        _ => plain([0.5; 3], 0.45, 0.0),
    }
}

/// A generated part as an engine mesh. Skin-coloured parts read the body's UVs (v up, like the
/// pack's); the part textures are laid out with row 0 at v = 0, as Engine reads them.
fn part_mesh(p: &PartMesh, m: Material, lift: f32) -> SkinMesh {
    let n = p.positions.len() / 3;
    let skin = matches!(p.kind, PartKind::Skin | PartKind::Fin);
    let v3 = |a: &[f32], i: usize| Vec3::new(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
    let shade = |i: usize| if skin { 1.0 } else { p.shade.get(i).copied().unwrap_or(1.0) };
    let mut maps = MaterialMaps { roughness: m.roughness, metallic: m.metallic, ..MaterialMaps::default() };
    if let Some((e, k)) = m.emissive {
        maps.emissive = Some(e);
        maps.emissive_factor = [k; 3];
    }
    SkinMesh {
        positions: (0..n).map(|i| v3(&p.positions, i) + Vec3::Y * lift).collect(),
        normals: (0..n).map(|i| v3(&p.normals, i).normalize_or_zero()).collect(),
        colors: (0..n).map(|i| Vec4::new(m.color[0] * shade(i), m.color[1] * shade(i), m.color[2] * shade(i), 1.0)).collect(),
        uvs: (0..n).map(|i| [p.uvs[i * 2], if skin { 1.0 - p.uvs[i * 2 + 1] } else { p.uvs[i * 2 + 1] }]).collect(),
        joints: p.joints.as_chunks::<4>().0.to_vec(),
        weights: p.weights.as_chunks::<4>().0.to_vec(),
        indices: p.indices.clone(),
        double_sided: m.double_sided,
        albedo: m.albedo,
        maps,
        morphs: Vec::new(),
    }
}
