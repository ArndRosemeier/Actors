//! Capes that move: a small cloth simulation of the cape's bone chains (`cape_r_*`, `cape_c_*`,
//! `cape_l_*` from `actors_human::costume`), baked into a clip's keyframes.
//!
//! Engine plays baked clips, so the swing is simulated once per clip when the character is built:
//! each chain is a string of particles at the bones' heads (plus the hem), pinned at the top to
//! the upper back. The particles are pulled softly toward where a stiff cape would be (the cloth
//! keeps its drape), pushed by the air as the character travels, flutter in that wind, and are
//! kept off the body by capsules round the torso, hips, legs and arms. Neighbouring chains hold
//! the cloth spread. The clip is run a few times first so the cape has settled, and the recorded
//! loop is blended so its end meets its start (looping clips stay seamless). The particles then
//! become bone rotations: each link turns from its parent toward the next particle.
//!
//! [`swing_cape`] re-bakes any clip, so a game can add its own poses (flying, hovering) and give
//! them their own wind.

use engine::anim::{AnimatedModel, AnimationClip, QuatTrack, Vec3Track};
use glam::{Mat4, Quat, Vec3};

/// Where a character's cape bones are, to re-bake clips with [`swing_cape`].
#[derive(Clone, Debug, PartialEq)]
pub struct CapeRig {
    /// Joint indices of each chain, root to hem.
    pub chains: Vec<Vec<usize>>,
    /// Bind position (model space) of each chain's hem, below its last bone.
    pub tips: Vec<Vec3>,
    /// The joint the chains hang from (`spine_03`).
    pub anchor: usize,
    capsules: Vec<Capsule>,
}

#[derive(Clone, Debug, PartialEq)]
struct Capsule {
    a: usize,
    /// End points in their joints' bind frames.
    oa: Vec3,
    b: usize,
    ob: Vec3,
    radius: f32,
}

/// How the air moves past the character during a clip.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CapeWind {
    /// The character's velocity through the air (m/s, model space): the cape streams the other
    /// way. A run is about 4.5 m/s forward (+Z), flight 10 or more.
    pub travel: Vec3,
    /// The clip carries that travel as root motion (`InPlace::Off`): it is taken out before the
    /// cape is simulated, so the loop closes.
    pub root_motion: bool,
}

impl CapeWind {
    pub const STILL: CapeWind = CapeWind { travel: Vec3::ZERO, root_motion: false };
}

fn bind_globals(model: &AnimatedModel) -> Vec<Mat4> {
    model.skeleton.inverse_bind.iter().map(|m| m.inverse()).collect()
}

impl CapeRig {
    /// The cape rig of a model, or None without cape bones.
    pub fn of(model: &AnimatedModel) -> Option<Self> {
        let names = &model.skeleton.joint_names;
        let find = |n: &str| names.iter().position(|x| x == n);
        let mut chains = Vec::new();
        for side in actors_human::costume::CAPE_CHAINS {
            let chain: Option<Vec<usize>> = (1..=actors_human::costume::CAPE_LINKS).map(|k| find(&format!("cape_{side}_{k}"))).collect();
            chains.push(chain?);
        }
        let anchor = model.skeleton.parents[chains[0][0]]?;
        let g = bind_globals(model);
        let pos = |j: usize| g[j].w_axis.truncate();
        let tips = chains
            .iter()
            .map(|c| {
                let (a, b) = (pos(c[c.len() - 2]), pos(c[c.len() - 1]));
                b + (b - a)
            })
            .collect();
        let height = names.iter().position(|n| n == "head").map_or(1.75, |h| pos(h).y + 0.12).max(0.5);
        let k = height / 1.75;
        let mut capsules = Vec::new();
        let mut cap = |a: &str, b: &str, forward: f32, radius: f32| {
            if let (Some(a), Some(b)) = (find(a), find(b)) {
                let off = Vec3::Z * forward * k;
                capsules.push(Capsule {
                    a,
                    oa: g[a].inverse().transform_point3(pos(a) + off),
                    b,
                    ob: g[b].inverse().transform_point3(pos(b) + off),
                    radius: radius * k,
                });
            }
        };
        cap("pelvis", "spine_02", 0.05, 0.15);
        cap("spine_02", "neck_01", 0.07, 0.14);
        for s in ["l", "r"] {
            cap(&format!("thigh_{s}"), &format!("calf_{s}"), 0.0, 0.085);
            cap(&format!("calf_{s}"), &format!("foot_{s}"), 0.0, 0.06);
            cap(&format!("upperarm_{s}"), &format!("lowerarm_{s}"), 0.0, 0.05);
            cap(&format!("lowerarm_{s}"), &format!("hand_{s}"), 0.0, 0.04);
        }
        Some(Self { chains, tips, anchor, capsules })
    }

    fn joints(&self) -> impl Iterator<Item = usize> + '_ {
        self.chains.iter().flatten().copied()
    }
}

fn sample_index(times: &[f32], t: f32) -> (usize, usize, f32) {
    let n = times.len();
    if n <= 1 || t <= times[0] {
        return (0, 0, 0.0);
    }
    if t >= times[n - 1] {
        return (n - 1, n - 1, 0.0);
    }
    let i = times.partition_point(|&x| x <= t).max(1) - 1;
    let (t0, t1) = (times[i], times[i + 1]);
    (i, i + 1, if t1 > t0 { (t - t0) / (t1 - t0) } else { 0.0 })
}

/// Model-space joint transforms of a clip at time `t` (cape joints at bind).
fn pose(model: &AnimatedModel, clip: &AnimationClip, t: f32, skip: &[bool], drift: Vec3) -> Vec<Mat4> {
    let sk = &model.skeleton;
    let mut g = vec![Mat4::IDENTITY; sk.joint_names.len()];
    for j in 0..g.len() {
        let (mut tr, mut rot, sc) = model.bind_local[j];
        if !skip[j] {
            if let Some(ch) = clip.channels.get(j) {
                if let Some(track) = ch.translation.as_ref().filter(|t| !t.values.is_empty()) {
                    let (a, b, u) = sample_index(&track.times, t);
                    tr = track.values[a].lerp(track.values[b], u);
                }
                if let Some(track) = ch.rotation.as_ref().filter(|t| !t.values.is_empty()) {
                    let (a, b, u) = sample_index(&track.times, t);
                    rot = track.values[a].slerp(track.values[b], u).normalize();
                }
            }
        }
        let local = Mat4::from_scale_rotation_translation(sc, rot, tr);
        g[j] = match sk.parents[j] {
            Some(p) if p < j => g[p] * local,
            _ => Mat4::from_translation(-drift * t) * local,
        };
    }
    g
}

fn closest_on_segment(p: Vec3, a: Vec3, b: Vec3) -> Vec3 {
    let ab = b - a;
    let l2 = ab.length_squared();
    if l2 < 1e-12 {
        return a;
    }
    a + ab * ((p - a).dot(ab) / l2).clamp(0.0, 1.0)
}

/// Simulates the cape through `model.clips[clip]` and writes its bones' rotation keys.
pub fn swing_cape(model: &mut AnimatedModel, rig: &CapeRig, clip: usize, wind: CapeWind) {
    let Some(c) = model.clips.get(clip) else { return };
    let duration = c.duration;
    let n_joints = model.skeleton.joint_names.len();
    let mut skip = vec![false; n_joints];
    for j in rig.joints() {
        if j >= n_joints {
            return;
        }
        skip[j] = true;
    }
    let drift = if wind.root_motion { Vec3::new(wind.travel.x, 0.0, wind.travel.z) } else { Vec3::ZERO };
    let air = -wind.travel;
    let speed = air.length();

    // The body through one loop at the simulation's step (a whole number of steps per loop).
    let cycle = duration.max(0.25);
    let steps = ((cycle * 120.0).round() as usize).max(30);
    let dt = cycle / steps as f32;
    let still = duration <= 0.0;
    let body: Vec<Vec<Mat4>> = (0..steps).map(|i| pose(model, c, if still { 0.0 } else { i as f32 * dt }, &skip, drift)).collect();

    let bind = bind_globals(model);
    let anchor_bind_inv = bind[rig.anchor].inverse();
    // Particles per chain: the bones' heads, then the hem.
    let rest: Vec<Vec<Vec3>> = rig
        .chains
        .iter()
        .zip(&rig.tips)
        .map(|(ch, tip)| ch.iter().map(|&j| bind[j].w_axis.truncate()).chain(std::iter::once(*tip)).collect())
        .collect();
    let lengths: Vec<Vec<f32>> = rest.iter().map(|r| r.windows(2).map(|w| w[0].distance(w[1])).collect()).collect();
    let spread: Vec<Vec<f32>> =
        (0..rest.len().saturating_sub(1)).map(|c| (0..rest[c].len()).map(|i| rest[c][i].distance(rest[c + 1][i])).collect()).collect();
    // How close each particle may come to each capsule: its own distance in the bind pose (the
    // cape is drawn there), never more than the capsule's radius.
    let cap_end = |g: &[Mat4], cp: &Capsule| (g[cp.a].transform_point3(cp.oa), g[cp.b].transform_point3(cp.ob));
    let clearance: Vec<Vec<Vec<f32>>> = rest
        .iter()
        .map(|r| {
            r.iter()
                .map(|&p| {
                    rig.capsules
                        .iter()
                        .map(|cp| {
                            let (a, b) = cap_end(&bind, cp);
                            cp.radius.min(p.distance(closest_on_segment(p, a, b)) - 0.005).max(0.0)
                        })
                        .collect()
                })
                .collect()
        })
        .collect();

    // Where a stiff cape would be: the bind drape carried by the anchor joint. The top rides the
    // shoulders; lower down it turns less and less with the back (cloth hangs, it does not lean or
    // twist with the torso; the game turns the whole character).
    let anchor_bind = bind[rig.anchor].w_axis.truncate();
    const RIGID: [f32; 6] = [1.0, 1.0, 0.7, 0.5, 0.35, 0.25];
    let target = |g: &[Mat4], i: usize, p: Vec3| {
        let (_, r, _) = (g[rig.anchor] * anchor_bind_inv).to_scale_rotation_translation();
        let q = Quat::IDENTITY.slerp(r, RIGID[i.min(5)]);
        g[rig.anchor].w_axis.truncate() + q * (p - anchor_bind)
    };
    let mut x: Vec<Vec<Vec3>> = rest.iter().map(|r| r.iter().enumerate().map(|(i, &p)| target(&body[0], i, p)).collect()).collect();
    let mut prev = x.clone();
    let gravity = Vec3::new(0.0, -9.81, 0.0);
    let drag = 3.0;
    // Air resists the cloth moving through it; a cape streaming in strong wind is held taut.
    let damping = 3.0 + 0.6 * speed;
    let flutter_hz = 1.2 + 0.25 * speed;
    let step = |x: &mut Vec<Vec<Vec3>>, prev: &mut Vec<Vec<Vec3>>, g: &[Mat4], time: f32| {
        for (ci, chain) in x.iter_mut().enumerate() {
            for (i, p) in chain.iter_mut().enumerate() {
                let goal = target(g, i, rest[ci][i]);
                if i == 0 {
                    prev[ci][i] = goal;
                    *p = goal;
                    continue;
                }
                let v = (*p - prev[ci][i]) / dt;
                let stiff = 34.0 * (1.0 - 0.08 * i as f32);
                let phase = time * flutter_hz * std::f32::consts::TAU - i as f32 * 0.9 + ci as f32 * 1.7;
                let flutter = Vec3::new(0.5 * phase.sin(), (phase * 1.3).cos(), 0.0) * (0.8 * speed * i as f32 / 5.0);
                let a = (goal - *p) * stiff + gravity * 0.2 + air * drag - v * damping + flutter;
                let next = *p + v * dt + a * dt * dt;
                prev[ci][i] = *p;
                *p = next;
            }
        }
        let caps: Vec<(Vec3, Vec3)> = rig.capsules.iter().map(|cp| cap_end(g, cp)).collect();
        for _ in 0..6 {
            for (ci, chain) in x.iter_mut().enumerate() {
                for i in 1..chain.len() {
                    let (a, b) = (chain[i - 1], chain[i]);
                    let d = b - a;
                    let l = d.length();
                    if l > 1e-6 {
                        chain[i] = a + d * (lengths[ci][i - 1] / l);
                    }
                }
            }
            for c in 0..spread.len() {
                for i in 1..x[c].len() {
                    let (a, b) = (x[c][i], x[c + 1][i]);
                    let d = b - a;
                    let l = d.length();
                    let r = spread[c][i];
                    let want = l.clamp(r * 0.55, r * 1.02);
                    if l > 1e-6 && want != l {
                        let fix = d * ((l - want) / l * 0.5);
                        x[c][i] += fix;
                        x[c + 1][i] -= fix;
                    }
                }
            }
            for (ci, chain) in x.iter_mut().enumerate() {
                for (i, p) in chain.iter_mut().enumerate().skip(1) {
                    for (k, &(a, b)) in caps.iter().enumerate() {
                        let r = clearance[ci][i][k];
                        let q = closest_on_segment(*p, a, b);
                        let d = *p - q;
                        let l = d.length();
                        if l < r && l > 1e-6 {
                            *p = q + d * (r / l);
                        }
                    }
                }
            }
        }
    };

    // Settle: a second still, then two loops; then record one loop and one step past it.
    let settle = (1.0 / dt) as usize;
    for _ in 0..settle {
        step(&mut x, &mut prev, &body[0], 0.0);
    }
    let warm = if still { 0 } else { steps * ((2.0 / cycle).ceil() as usize).max(2) };
    for n in 0..warm {
        step(&mut x, &mut prev, &body[n % steps], n as f32 * dt);
    }
    let mut rec = Vec::with_capacity(steps + 1);
    for n in 0..=steps {
        rec.push(x.clone());
        step(&mut x, &mut prev, &body[(n + 1) % steps], (warm + n + 1) as f32 * dt);
    }
    // Close the loop: spread the mismatch between the end and the start over the loop.
    if !still {
        let (first, last) = (rec[0].clone(), rec[steps].clone());
        for (n, frame) in rec.iter_mut().enumerate() {
            let u = n as f32 / steps as f32;
            for (ci, chain) in frame.iter_mut().enumerate() {
                for (i, p) in chain.iter_mut().enumerate() {
                    *p += (first[ci][i] - last[ci][i]) * u;
                }
            }
        }
    }

    // Particles to bone rotations, at 30 keys a second.
    let keys = if still { 1 } else { ((duration * 30.0).round() as usize).max(2) };
    let times: Vec<f32> = (0..=keys).map(|i| if still { 0.0 } else { i as f32 / keys as f32 * duration }).collect();
    let mut tracks: Vec<Vec<Quat>> = vec![Vec::with_capacity(times.len()); rig.joints().count()];
    for &t in &times {
        let g = pose(model, c, t, &skip, drift);
        let f = if still { 0.0 } else { t / duration * steps as f32 };
        let (n0, u) = (f.floor() as usize, f.fract());
        let n1 = (n0 + 1).min(steps);
        let n0 = n0.min(steps);
        let mut slot = 0;
        for (ci, chain) in rig.chains.iter().enumerate() {
            let mut parent = g[rig.anchor];
            for (k, &j) in chain.iter().enumerate() {
                let (_, prot, _) = parent.to_scale_rotation_translation();
                let (bt, br, _) = model.bind_local[j];
                let head = parent.transform_point3(bt);
                let base = prot * br;
                let goal = rec[n0][ci][k + 1].lerp(rec[n1][ci][k + 1], u);
                let d0 = base * (rest[ci][k + 1] - rest[ci][k]);
                let d = goal - head;
                let rot = if d.length() > 1e-5 && d0.length() > 1e-5 {
                    Quat::from_rotation_arc(d0.normalize(), d.normalize()) * base
                } else {
                    base
                };
                tracks[slot].push((prot.inverse() * rot).normalize());
                parent = Mat4::from_rotation_translation(rot, head);
                slot += 1;
            }
        }
    }
    let joints: Vec<usize> = rig.joints().collect();
    let c = &mut model.clips[clip];
    for (j, values) in joints.into_iter().zip(tracks) {
        if c.channels.len() <= j {
            c.channels.resize_with(j + 1, Default::default);
        }
        c.channels[j].rotation = Some(QuatTrack { times: times.clone(), values });
        c.channels[j].translation = None::<Vec3Track>;
    }
}
