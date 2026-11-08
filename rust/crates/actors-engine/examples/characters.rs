//! A row of random Actors characters in the engine.
//!
//! ```text
//! cargo run --release -p actors-engine --example characters -- <packs dir> [allow preset] [seed]
//! ```
//!
//! The packs come from `npm run import:human` (apps/viewer/public/packs) or a release's
//! actors-packs archive. Space: new characters. W: walk / idle. T: they talk. Esc quits.
//! Faces are alive (blinks, glances, small movements) through `FaceDriver`.

use actors_engine::{BuildOptions, CharacterBuilder, FaceDriver};
use actors_generator::{AllowOptions, RaceChoiceOption, RandomOptions};
use actors_human::FaceAnimatorOptions;
use engine::prelude::*;

const COUNT: usize = 5;

fn main() -> EngineResult<()> {
    let mut args = std::env::args().skip(1);
    let packs = args.next().or_else(|| std::env::var("ACTORS_PACKS").ok()).unwrap_or_else(|| "apps/viewer/public/packs".into());
    let preset = args.next().unwrap_or_else(|| "fantasy".into());
    let mut seed: u32 = args.next().and_then(|s| s.parse().ok()).unwrap_or(1);
    let mut builder = CharacterBuilder::load(&packs).unwrap_or_else(|e| panic!("loading {packs}: {e}"));
    if let Some(allow) = AllowOptions::preset(&preset) {
        builder.allow(&allow);
    }
    let options = RandomOptions { race: Some(RaceChoiceOption::Any), ..Default::default() };

    let mut spawned: Vec<EntityId> = Vec::new();
    let mut faces: Vec<(EntityId, FaceDriver)> = Vec::new();
    let mut walking = false;
    let (mut was_space, mut was_w, mut was_t) = (false, false, false);
    Engine::run("actors characters", move |world, frame| {
        let space = frame.input.down(Key::Space);
        let w = frame.input.down(Key::W);
        let t = frame.input.down(Key::T);
        if frame.first {
            world.set_clear_color(engine::Color::rgb(150, 180, 210));
            world.spawn(Shape::box_at((0.0, -0.05, 0.0), (20.0, 0.1, 8.0), rgb(110, 120, 100)).unwrap());
        }
        if frame.first || (space && !was_space) {
            for id in spawned.drain(..) {
                world.despawn(id);
            }
            faces.clear();
            for i in 0..COUNT {
                let mut config = builder.random(seed, &options);
                config.face_animation = true;
                seed += 1;
                let t0 = std::time::Instant::now();
                let c = builder.build(&config, &BuildOptions::default()).unwrap_or_else(|e| panic!("build: {e}"));
                eprintln!("{} {:.2} m: {:?} ({:?})", c.config.race.as_str(), c.height, c.meshes, t0.elapsed());
                let x = (i as f32 - (COUNT - 1) as f32 / 2.0) * 1.1;
                let face = c.face.as_ref().map(|f| FaceDriver::new(f, FaceAnimatorOptions { seed: seed as u64, ..Default::default() }));
                let id = world.spawn_animated(c.model, Place::at(x, 0.0, 0.0)?)?;
                faces.extend(face.map(|f| (id, f)));
                world.play_animation(id, if walking { "walk" } else { "idle" })?;
                spawned.push(id);
            }
        }
        if w && !was_w {
            walking = !walking;
            for &id in &spawned {
                world.play_animation(id, if walking { "walk" } else { "idle" })?;
            }
        }
        if t && !was_t {
            for (_, f) in &mut faces {
                f.animator.say("Well met, traveller. The road ahead is long.", 1.0);
            }
        }
        for (id, f) in &mut faces {
            world.set_morph_weights(*id, f.update(frame.dt))?;
        }
        (was_space, was_w, was_t) = (space, w, t);
        world.look_orbit(Vec3::new(0.0, 1.0, 0.0), 5.5, 90.0, 8.0);
        world.set_sun(Vec3::new(0.4, 1.0, 0.6), 0.3);
        Ok(())
    })
}
