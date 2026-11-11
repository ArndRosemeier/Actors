//! Capes that move: a small cloth simulation of the cape's bone chains (`cape_r_*`, `cape_c_*`,
//! `cape_l_*` from `actors_human::costume`), baked into a clip's keyframes.
//!
//! Engine plays baked clips, so the swing is simulated once per clip when the character is built.
//! The cloth is a grid of particles over the whole cape: a row at each link's head (plus the hem),
//! and seven columns across, the three bone chains, the cloth between them and both side edges.
//! The top row is pinned to the upper back. The particles are pulled softly toward where a stiff
//! cape would be (the cloth keeps its drape), pushed by the air as the character travels, flutter
//! in that wind, and are kept off the body: by capsules fitted to the wearer's own mesh (torso in
//! three strips, upper and lower arms, hands, thighs, shins), tested against every particle and
//! every edge between them, so an arm cannot slip through the cloth between two particles. Each
//! clip starts from the bind pose and eases into its first frame while the cloth settles, so the
//! arms come down outside the cape as they would putting one on. The clip is then run a few times
//! so the cape has settled, and the recorded loop is blended so its end meets its start (looping
//! clips stay seamless). The particles then become bone rotations: each link turns from its parent
//! toward the next particle, twisted so the cloth beside it (the side flaps) lies where the grid is.
//!
//! [`swing_cape`] re-bakes any clip, so a game can add its own poses (flying, hovering) and give
//! them their own wind; [`cape_sink`] measures how far the drawn cape passes into the body.

use actors_human::costume::{CHAIN_S, LINK_V};
use engine::anim::{AnimatedModel, AnimationClip, QuatTrack, Vec3Track};
use glam::{Mat3, Mat4, Quat, Vec3};

/// Columns of the simulated cloth across the cape (normalized width: -1 is the edge on the
/// wearer's right, 1 on the left); the bone chains run down [`CHAIN_COLS`].
const COL_S: [f32; 7] = [-1.0, -0.64, -0.32, 0.0, 0.32, 0.64, 1.0];
const COLS: usize = COL_S.len();
const CHAIN_COLS: [usize; 3] = [1, 3, 5];

/// Where a character's cape bones are, to re-bake clips with [`swing_cape`].
#[derive(Clone, Debug, PartialEq)]
pub struct CapeRig {
    /// Joint indices of each chain, root to hem.
    pub chains: Vec<Vec<usize>>,
    /// Bind position (model space) of each chain's hem, below its last bone.
    pub tips: Vec<Vec3>,
    /// The joint the chains hang from (`spine_03`).
    pub anchor: usize,
    /// The simulated cloth in the bind pose (model space): a row per link head, then the hem.
    grid: Vec<[Vec3; COLS]>,
    capsules: Vec<Capsule>,
    /// The wearer's height over 1.75 m.
    scale: f32,
}

/// A part of the body the cloth stays off: a capsule riding one joint.
#[derive(Clone, Debug, PartialEq)]
struct Capsule {
    /// The end points, each in its joint's bind frame.
    ja: usize,
    a: Vec3,
    jb: usize,
    b: Vec3,
    radius: f32,
    /// An arm: the cloth leaves it toward the back and outside (it drapes over the arm), never
    /// toward the body.
    arm: bool,
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

/// The value below which `q` of the values lie (`q` 0..1); sorts `v`.
fn quantile(v: &mut [f32], q: f32) -> f32 {
    v.sort_by(f32::total_cmp);
    v[((v.len() - 1) as f32 * q).round() as usize]
}

/// A capsule round `pts` along `axis`: through their middle, wide enough for nearly all of them,
/// as long as they reach. None for a handful of points.
fn fit_capsule(joint: usize, frame: &Mat4, pts: &[Vec3], axis: Vec3) -> Option<Capsule> {
    if pts.len() < 12 {
        return None;
    }
    let c = pts.iter().copied().sum::<Vec3>() / pts.len() as f32;
    let mut along: Vec<f32> = pts.iter().map(|p| (*p - c).dot(axis)).collect();
    let mut across: Vec<f32> = pts.iter().map(|p| (*p - c).reject_from_normalized(axis).length()).collect();
    let radius = quantile(&mut across, 0.95);
    let (lo, hi) = (quantile(&mut along, 0.03), quantile(&mut along, 0.97));
    let (lo, hi) = if hi - lo > 1.2 * radius { (lo + 0.6 * radius, hi - 0.6 * radius) } else { ((lo + hi) / 2.0, (lo + hi) / 2.0) };
    let inv = frame.inverse();
    Some(Capsule {
        ja: joint,
        a: inv.transform_point3(c + axis * lo),
        jb: joint,
        b: inv.transform_point3(c + axis * hi),
        radius,
        arm: false,
    })
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
        let tips: Vec<Vec3> = chains
            .iter()
            .map(|c| {
                let (a, b) = (pos(c[c.len() - 2]), pos(c[c.len() - 1]));
                b + (b - a)
            })
            .collect();
        let height = find("head").map_or(1.75, |h| pos(h).y + 0.12).max(0.5);
        let scale = height / 1.75;
        let mut on_cape = vec![false; names.len()];
        for &j in chains.iter().flatten() {
            on_cape[j] = true;
        }

        // The cape's cloth by its uv ((s + 1) / 2, v), and the body's vertices by their joint.
        let mut cloth: Vec<(Vec3, [f32; 2])> = Vec::new();
        let mut by_joint: Vec<Vec<Vec3>> = vec![Vec::new(); names.len()];
        for mesh in &model.meshes {
            for (i, (&js, &ws)) in mesh.joints.iter().zip(&mesh.weights).enumerate() {
                let p = mesh.positions[i];
                let caped = js.iter().zip(&ws).any(|(&j, &w)| w > 0.0 && on_cape.get(j as usize).copied().unwrap_or(false));
                if caped {
                    cloth.push((p, mesh.uvs.get(i).copied().unwrap_or([-9.0; 2])));
                    continue;
                }
                let (j, w) = js.iter().zip(&ws).fold((0u16, -1.0f32), |b, (&j, &w)| if w > b.1 { (j, w) } else { b });
                if w >= 0.5 && (j as usize) < names.len() {
                    by_joint[j as usize].push(p);
                }
            }
        }
        let at_uv = |s: f32, v: f32| -> Option<Vec3> {
            let uv = [(s + 1.0) / 2.0, v];
            let d = |q: &[f32; 2]| (q[0] - uv[0]).powi(2) + (q[1] - uv[1]).powi(2);
            let best = cloth.iter().map(|(_, q)| d(q)).fold(f32::INFINITY, f32::min);
            if best > 0.03f32.powi(2) {
                return None;
            }
            let near: Vec<Vec3> = cloth.iter().filter(|(_, q)| d(q) <= best + 1e-7).map(|(p, _)| *p).collect();
            Some(near.iter().copied().sum::<Vec3>() / near.len() as f32)
        };
        debug_assert!(CHAIN_COLS.iter().zip(CHAIN_S).all(|(&c, s)| (COL_S[c] - s as f32).abs() < 1e-6));
        let mut grid = Vec::new();
        for row in 0..=LINK_V.len() {
            let mut r = [Vec3::ZERO; COLS];
            for (ci, &col) in CHAIN_COLS.iter().enumerate() {
                r[col] = if row < LINK_V.len() { pos(chains[ci][row]) } else { tips[ci] };
            }
            let v = LINK_V.get(row).map_or(1.0, |&v| v as f32);
            for col in [0, 2, 4, 6] {
                r[col] = at_uv(COL_S[col], v).unwrap_or_else(|| match col {
                    // No cloth to read (a cape not built by Actors): between and beside the chains.
                    0 => r[1] + (r[1] - r[3]) * (0.36 / 0.64),
                    6 => r[5] + (r[5] - r[3]) * (0.36 / 0.64),
                    _ => (r[col - 1] + r[col + 1]) / 2.0,
                });
            }
            grid.push(r);
        }

        // The body as capsules fitted to its own vertices (clothes included).
        let mut capsules = Vec::new();
        let Some(pelvis) = find("pelvis") else {
            return Some(Self { chains, tips, anchor, grid, capsules, scale });
        };
        // The torso in bands from below the hips up to the neck, each riding the joints at its
        // ends, and each band in five strips side by side (the torso is wide and flat).
        let mut levels = vec![(pelvis, pos(pelvis).y - 0.14 * scale)];
        for n in ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01"] {
            if let Some(j) = find(n) {
                levels.push((j, pos(j).y));
            }
        }
        let torso: Vec<Vec3> = ["pelvis", "spine_01", "spine_02", "spine_03", "clavicle_l", "clavicle_r"]
            .iter()
            .filter_map(|n| find(n))
            .flat_map(|j| by_joint[j].iter().copied())
            .collect();
        for band in levels.windows(2) {
            let ((ja, ya), (jb, yb)) = (band[0], band[1]);
            if yb <= ya {
                continue;
            }
            let pts: Vec<Vec3> = torso.iter().copied().filter(|p| p.y >= ya && p.y <= yb).collect();
            if pts.len() < 24 {
                continue;
            }
            let cx = pts.iter().map(|p| p.x).sum::<f32>() / pts.len() as f32;
            let w = quantile(&mut pts.iter().map(|p| (p.x - cx).abs()).collect::<Vec<_>>(), 0.95);
            for f in [-0.75, -0.375, 0.0, 0.375, 0.75] {
                let strip: Vec<Vec3> = pts.iter().copied().filter(|p| (p.x - cx - f * w).abs() <= 0.3 * w).collect();
                if strip.len() < 8 {
                    continue;
                }
                let (sx, sz) = (
                    strip.iter().map(|p| p.x).sum::<f32>() / strip.len() as f32,
                    strip.iter().map(|p| p.z).sum::<f32>() / strip.len() as f32,
                );
                let radius = quantile(&mut strip.iter().map(|p| (p.x - sx).hypot(p.z - sz)).collect::<Vec<_>>(), 0.95);
                capsules.push(Capsule {
                    ja,
                    a: g[ja].inverse().transform_point3(Vec3::new(sx, ya, sz)),
                    jb,
                    b: g[jb].inverse().transform_point3(Vec3::new(sx, yb, sz)),
                    radius,
                    arm: false,
                });
            }
        }
        // The neck and head (a cape thrown forward must not pass through them).
        if let (Some(neck), Some(head)) = (find("neck_01"), find("head")) {
            let axis = (pos(head) - pos(neck)).normalize_or(Vec3::Y);
            capsules.extend(fit_capsule(neck, &g[neck], &by_joint[neck], axis));
            capsules.extend(fit_capsule(head, &g[head], &by_joint[head], axis));
        }
        for s in ["l", "r"] {
            for (a, b) in [("upperarm", "lowerarm"), ("lowerarm", "hand"), ("hand", "middle_01"), ("thigh", "calf"), ("calf", "foot")] {
                let a_name = &a;
                let (Some(a), Some(b)) = (find(&format!("{a}_{s}")), find(&format!("{b}_{s}"))) else { continue };
                let axis = (pos(b) - pos(a)).normalize_or_zero();
                if axis != Vec3::ZERO {
                    let arm = !matches!(*a_name, "thigh" | "calf");
                    capsules.extend(fit_capsule(a, &g[a], &by_joint[a], axis).map(|c| Capsule { arm, ..c }));
                }
            }
        }
        Some(Self { chains, tips, anchor, grid, capsules, scale })
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

/// Model-space joint transforms of a clip at time `t` (cape joints at bind), `weight` of the way
/// from the bind pose (0) to the clip (1).
fn pose(model: &AnimatedModel, clip: &AnimationClip, t: f32, skip: &[bool], drift: Vec3, weight: f32) -> Vec<Mat4> {
    let sk = &model.skeleton;
    let mut g = vec![Mat4::IDENTITY; sk.joint_names.len()];
    for j in 0..g.len() {
        let (mut tr, mut rot, sc) = model.bind_local[j];
        if !skip[j] {
            if let Some(ch) = clip.channels.get(j) {
                if let Some(track) = ch.translation.as_ref().filter(|t| !t.values.is_empty()) {
                    let (a, b, u) = sample_index(&track.times, t);
                    tr = tr.lerp(track.values[a].lerp(track.values[b], u), weight);
                }
                if let Some(track) = ch.rotation.as_ref().filter(|t| !t.values.is_empty()) {
                    let (a, b, u) = sample_index(&track.times, t);
                    rot = rot.slerp(track.values[a].slerp(track.values[b], u).normalize(), weight).normalize();
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

/// The closest points of segments `p1 q1` and `p2 q2`: the parameter along the first, and both
/// points.
fn closest_between_segments(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3) -> (f32, Vec3, Vec3) {
    let (d1, d2, r) = (q1 - p1, q2 - p2, p1 - p2);
    let (a, e, f) = (d1.dot(d1), d2.dot(d2), d2.dot(r));
    let (s, t) = if a < 1e-12 {
        (0.0, (f / e.max(1e-12)).clamp(0.0, 1.0))
    } else {
        let c = d1.dot(r);
        if e < 1e-12 {
            ((-c / a).clamp(0.0, 1.0), 0.0)
        } else {
            let b = d1.dot(d2);
            let denom = a * e - b * b;
            let mut s = if denom > 1e-12 { ((b * f - c * e) / denom).clamp(0.0, 1.0) } else { 0.0 };
            let mut t = (b * s + f) / e;
            if t < 0.0 {
                t = 0.0;
                s = (-c / a).clamp(0.0, 1.0);
            } else if t > 1.0 {
                t = 1.0;
                s = ((b - c) / a).clamp(0.0, 1.0);
            }
            (s, t)
        }
    };
    (s, p1 + d1 * s, p2 + d2 * t)
}

/// An orthonormal frame with its first axis along `a` and its second toward `l`.
fn frame(a: Vec3, l: Vec3) -> Option<Mat3> {
    let a = a.try_normalize()?;
    let b = l.reject_from_normalized(a).try_normalize()?;
    Some(Mat3::from_cols(a, b, a.cross(b)))
}

/// The rotation that best turns each `(from, to, weight)`'s `from` toward its `to`, starting at
/// `q` (Müller et al., "A robust method to extract the rotational part of deformations").
fn fit_rotation(mut q: Quat, pts: &[(Vec3, Vec3, f32)]) -> Quat {
    for _ in 0..12 {
        let (mut num, mut den) = (Vec3::ZERO, 0.0);
        for &(a, b, w) in pts {
            let ra = q * a;
            num += ra.cross(b) * w;
            den += ra.dot(b) * w;
        }
        let omega = num / (den.abs() + 1e-9);
        let angle = omega.length();
        if angle < 1e-6 {
            break;
        }
        q = (Quat::from_axis_angle(omega / angle, angle.min(0.5)) * q).normalize();
    }
    q
}

type Grid = Vec<[Vec3; COLS]>;

/// Simulation steps per second.
const SIM_HZ: f32 = 60.0;

/// Cloth near a capsule: a particle (row, column), the thread down to it from the row above, or
/// the thread across to its right.
#[derive(Clone, Copy)]
enum Near {
    Point(usize, usize),
    Down(usize, usize),
    Across(usize, usize),
}

/// A body capsule at one moment: its axis, and a ball round it all to skip far cloth.
struct Placed {
    a: Vec3,
    b: Vec3,
    mid: Vec3,
    reach: f32,
    arm: bool,
}

/// Where cloth at `on` goes to clear a capsule whose axis is nearest at `axis` by `rr`: straight
/// out, but off an arm only toward `outward` (away from the body) or across.
fn clear_of(on: Vec3, axis: Vec3, rr: f32, arm: bool, outward: Vec3) -> Option<Vec3> {
    let d = on - axis;
    let l = d.length();
    if l >= rr || l < 1e-6 {
        return None;
    }
    let mut n = d / l;
    if arm {
        let o = n.dot(outward);
        if o < 0.3 {
            n = (n + outward * (0.3 - o)).normalize_or(outward);
        }
    }
    Some(axis + n * rr)
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
    let steps = ((cycle * SIM_HZ).round() as usize).max(15);
    let dt = cycle / steps as f32;
    let still = duration <= 0.0;
    let body: Vec<Vec<Mat4>> = (0..steps).map(|i| pose(model, c, if still { 0.0 } else { i as f32 * dt }, &skip, drift, 1.0)).collect();

    let bind = bind_globals(model);
    let anchor_bind_inv = bind[rig.anchor].inverse();
    let rest = &rig.grid;
    let rows = rest.len();
    let down: Vec<[f32; COLS]> =
        (0..rows).map(|r| std::array::from_fn(|c| if r == 0 { 0.0 } else { rest[r][c].distance(rest[r - 1][c]) })).collect();
    // How close each particle may come to each capsule: the capsule's radius and the cloth's
    // thickness, but never closer than it is drawn in the bind pose (the cape is made there).
    let margin = 0.012 * rig.scale;
    let place = |g: &[Mat4], cp: &Capsule| (g[cp.ja].transform_point3(cp.a), g[cp.jb].transform_point3(cp.b));
    let clearance: Vec<[Vec<f32>; COLS]> = rest
        .iter()
        .map(|row| {
            std::array::from_fn(|c| {
                rig.capsules
                    .iter()
                    .map(|cp| {
                        let (a, b) = place(&bind, cp);
                        let p = row[c];
                        (cp.radius + margin).min(p.distance(closest_on_segment(p, a, b)) - 0.002).max(0.0)
                    })
                    .collect()
            })
        })
        .collect();

    // The same for the threads between particles (a thread across the back passes nearer the
    // torso than its ends): down from (r - 1, c) and across to (r, c + 1).
    let thread_clearance = |p: Vec3, q: Vec3| -> Vec<f32> {
        rig.capsules
            .iter()
            .map(|cp| {
                let (a, b) = place(&bind, cp);
                let (_, on, axis) = closest_between_segments(p, q, a, b);
                (cp.radius + margin).min(on.distance(axis) - 0.002).max(0.0)
            })
            .collect()
    };
    let clear_down: Vec<Vec<Vec<f32>>> = (0..rows)
        .map(|r| (0..COLS).map(|c| if r == 0 { Vec::new() } else { thread_clearance(rest[r - 1][c], rest[r][c]) }).collect())
        .collect();
    let clear_across: Vec<Vec<Vec<f32>>> =
        (0..rows).map(|r| (0..COLS - 1).map(|c| thread_clearance(rest[r][c], rest[r][c + 1])).collect()).collect();

    // Where a stiff cape would be: the bind drape carried by the anchor joint. The top rides the
    // shoulders; lower down it turns less and less with the back (cloth hangs, it does not lean or
    // twist with the torso; the game turns the whole character).
    let anchor_bind = bind[rig.anchor].w_axis.truncate();
    const RIGID: [f32; 6] = [1.0, 1.0, 0.7, 0.5, 0.35, 0.25];
    let turns = |g: &[Mat4]| -> [Quat; 6] {
        let (_, q, _) = (g[rig.anchor] * anchor_bind_inv).to_scale_rotation_translation();
        RIGID.map(|k| Quat::IDENTITY.slerp(q, k))
    };
    // How far apart particles may move, beside the threads down the columns: across a row (cloth
    // bunches but does not stretch), across each cell's diagonals (it does not shear flat), and
    // over two cells (it bends, but does not fold back on itself).
    let mut spans: Vec<(usize, usize, usize, usize, f32, f32)> = Vec::new();
    let mut span = |(r0, c0): (usize, usize), (r1, c1): (usize, usize), lo: f32, hi: f32| {
        let l = rest[r0][c0].distance(rest[r1][c1]);
        spans.push((r0, c0, r1, c1, l * lo, l * hi));
    };
    for r in 0..rows {
        for c in 0..COLS {
            if r > 0 && c + 1 < COLS {
                span((r, c), (r, c + 1), 0.55, 1.02);
                span((r - 1, c), (r, c + 1), 0.7, 1.05);
                span((r - 1, c + 1), (r, c), 0.7, 1.05);
            }
            if r > 0 && c + 2 < COLS {
                span((r, c), (r, c + 2), 0.75, 1.02);
            }
            if r > 1 {
                span((r - 2, c), (r, c), 0.8, 1.0);
            }
        }
    }
    let mut x: Grid = rest.clone();
    let mut prev = x.clone();
    let gravity = Vec3::new(0.0, -9.81, 0.0);
    let drag = 3.0;
    // Air resists the cloth moving through it; a cape streaming in strong wind is held taut.
    let damping = 3.0 + 0.6 * speed;
    let flutter_hz = 1.2 + 0.25 * speed;
    // Pulls the cloth back into shape and off the body, `iterations` times over.
    let solve = |x: &mut Grid, g: &[Mat4], iterations: usize| {
        let caps: Vec<Placed> = rig
            .capsules
            .iter()
            .map(|cp| {
                let (a, b) = place(g, cp);
                Placed { a, b, mid: (a + b) / 2.0, reach: a.distance(b) / 2.0 + cp.radius + margin, arm: cp.arm }
            })
            .collect();
        // Away from the body: level and out from the upper back's vertical line.
        let spine = g[rig.anchor].w_axis.truncate();
        let outward = |p: Vec3| Vec3::new(p.x - spine.x, 0.0, p.z - spine.z).normalize_or(Vec3::NEG_Z);
        // Which particles and threads each capsule may touch while the cloth settles (it moves a
        // few centimetres at most in one step).
        let mut near: Vec<(usize, Near)> = Vec::new();
        for (ki, pl) in caps.iter().enumerate() {
            let within = |p: Vec3, q: Vec3| ((p + q) / 2.0).distance(pl.mid) < pl.reach + p.distance(q) / 2.0 + 0.04;
            for r in 1..rows {
                for c in 0..COLS {
                    if clearance[r][c][ki] > 0.0 && within(x[r][c], x[r][c]) {
                        near.push((ki, Near::Point(r, c)));
                    }
                    if clear_down[r][c][ki] > 0.0 && within(x[r - 1][c], x[r][c]) {
                        near.push((ki, Near::Down(r, c)));
                    }
                    if c + 1 < COLS && clear_across[r][c][ki] > 0.0 && within(x[r][c], x[r][c + 1]) {
                        near.push((ki, Near::Across(r, c)));
                    }
                }
            }
        }
        let thread = |x: &mut Grid, pl: &Placed, (r0, c0): (usize, usize), (r1, c1): (usize, usize), rr: f32| {
            let (p, q) = (x[r0][c0], x[r1][c1]);
            let (s, on, axis) = closest_between_segments(p, q, pl.a, pl.b);
            let Some(to) = clear_of(on, axis, rr, pl.arm, outward(on)) else { return };
            // Push both ends out, the nearer one more (a pinned top row stays), so the thread
            // clears; an end moves no further than the thread has to.
            let (w0, w1) = (if r0 == 0 { 0.0 } else { 1.0 - s }, s);
            let sum = w0 * w0 + w1 * w1;
            if sum < 1e-6 {
                return;
            }
            let push = to - on;
            x[r0][c0] += push * (w0 / sum).min(1.0);
            x[r1][c1] += push * (w1 / sum).min(1.0);
        };
        for it in 0..iterations {
            // The cloth's threads: down each column (from the pinned top) and across each row.
            for c in 0..COLS {
                for r in 1..rows {
                    let (a, b) = (x[r - 1][c], x[r][c]);
                    let d = b - a;
                    let l = d.length();
                    if l > 1e-6 {
                        x[r][c] = a + d * (down[r][c] / l);
                    }
                }
            }
            for &(r0, c0, r1, c1, lo, hi) in &spans {
                let (a, b) = (x[r0][c0], x[r1][c1]);
                let d = b - a;
                let l = d.length();
                let want = l.clamp(lo, hi);
                if l > 1e-6 && want != l {
                    let fix = d * ((l - want) / l);
                    if r0 == 0 {
                        x[r1][c1] -= fix;
                    } else {
                        x[r0][c0] += fix * 0.5;
                        x[r1][c1] -= fix * 0.5;
                    }
                }
            }
            // Off the body: every particle, and (in the last three rounds, once the cloth has
            // its shape) every thread between two particles.
            for &(ki, what) in &near {
                let pl = &caps[ki];
                match what {
                    Near::Point(r, c) => {
                        let p = x[r][c];
                        let q = closest_on_segment(p, pl.a, pl.b);
                        if let Some(to) = clear_of(p, q, clearance[r][c][ki], pl.arm, outward(p)) {
                            x[r][c] = to;
                        }
                    }
                    _ if it + 3 < iterations => {}
                    Near::Down(r, c) => thread(x, pl, (r - 1, c), (r, c), clear_down[r][c][ki]),
                    Near::Across(r, c) => thread(x, pl, (r, c), (r, c + 1), clear_across[r][c][ki]),
                }
            }
        }
    };
    let step = |x: &mut Grid, prev: &mut Grid, g: &[Mat4], time: f32| {
        let (turn, top) = (turns(g), g[rig.anchor].w_axis.truncate());
        for r in 0..rows {
            for c in 0..COLS {
                let goal = top + turn[r.min(5)] * (rest[r][c] - anchor_bind);
                let p = &mut x[r][c];
                if r == 0 {
                    prev[r][c] = goal;
                    *p = goal;
                    continue;
                }
                let v = (*p - prev[r][c]) / dt;
                let stiff = 34.0 * (1.0 - 0.08 * r as f32);
                let phase = time * flutter_hz * std::f32::consts::TAU - r as f32 * 0.9 + c as f32 * 0.85;
                let flutter = Vec3::new(0.5 * phase.sin(), (phase * 1.3).cos(), 0.0) * (0.8 * speed * r as f32 / 5.0);
                let a = (goal - *p) * stiff + gravity * 0.2 + air * drag - v * damping + flutter;
                let next = *p + v * dt + a * dt * dt;
                prev[r][c] = *p;
                *p = next;
            }
        }
        solve(x, g, 6);
    };

    // Settle: the body eases from the bind pose into the clip's first frame (the arms come down
    // outside the cape), holds it, then runs two loops; then one loop is recorded, ending on its
    // first frame again.
    let settle = (1.0 / dt) as usize;
    let ease = settle * 3 / 5;
    for n in 0..settle {
        if n < ease {
            let w = (n + 1) as f32 / ease as f32;
            let g = pose(model, c, 0.0, &skip, drift, w * w * (3.0 - 2.0 * w));
            step(&mut x, &mut prev, &g, 0.0);
        } else {
            step(&mut x, &mut prev, &body[0], 0.0);
        }
    }
    let warm = if still { 0 } else { steps * ((2.0 / cycle).ceil() as usize).max(2) };
    for n in 0..warm {
        step(&mut x, &mut prev, &body[n % steps], n as f32 * dt);
    }
    let mut rec = Vec::with_capacity(steps + 1);
    for n in 0..=steps {
        step(&mut x, &mut prev, &body[n % steps], (warm + n) as f32 * dt);
        rec.push(x.clone());
    }
    // Close the loop: spread the mismatch between the end and the start over the loop.
    if !still {
        let (first, last) = (rec[0].clone(), rec[steps].clone());
        for (n, frame) in rec.iter_mut().enumerate() {
            let u = n as f32 / steps as f32;
            for (r, row) in frame.iter_mut().enumerate() {
                for (c, p) in row.iter_mut().enumerate() {
                    *p += (first[r][c] - last[r][c]) * u;
                }
            }
        }
        // That blend can push cloth into the body: settle each frame off it again.
        for (n, frame) in rec.iter_mut().enumerate() {
            solve(frame, &body[n % steps], 3);
        }
    }

    // Particles to bone rotations, at 30 keys a second.
    let keys = if still { 1 } else { ((duration * 30.0).round() as usize).max(2) };
    let times: Vec<f32> = (0..=keys).map(|i| if still { 0.0 } else { i as f32 / keys as f32 * duration }).collect();
    let mut tracks: Vec<Vec<Quat>> = vec![Vec::with_capacity(times.len()); rig.joints().count()];
    let mut shifts: Vec<Vec<Vec3>> = vec![Vec::with_capacity(times.len()); rig.joints().count()];
    for &t in &times {
        let g = pose(model, c, t, &skip, drift, 1.0);
        let f = if still { 0.0 } else { t / duration * steps as f32 };
        let (n0, u) = (f.floor() as usize, f.fract());
        let n1 = (n0 + 1).min(steps);
        let n0 = n0.min(steps);
        let at = |r: usize, c: usize| rec[n0][r][c].lerp(rec[n1][r][c], u);
        let mut slot = 0;
        for (ci, chain) in rig.chains.iter().enumerate() {
            let col = CHAIN_COLS[ci];
            let mut parent = g[rig.anchor];
            for (k, &j) in chain.iter().enumerate() {
                let (_, prot, _) = parent.to_scale_rotation_translation();
                let (bt, br, _) = model.bind_local[j];
                // Each link's head sits on its particle (below the first, the cloth stretches a
                // little rather than the hem drifting off the simulated cloth).
                let head = if k == 0 { parent.transform_point3(bt) } else { at(k, col) };
                shifts[slot].push(parent.inverse().transform_point3(head));
                let (_, bind_rot, _) = bind[j].to_scale_rotation_translation();
                // The link's rest direction and the cloth across it, then where they are now.
                let d0 = rest[k + 1][col] - rest[k][col];
                let l0 = rest[k + 1][col + 1] - rest[k + 1][col - 1];
                let d = at(k + 1, col) - head;
                let l = at(k + 1, col + 1) - at(k + 1, col - 1);
                let rot = match (frame(d0, l0), frame(d, l)) {
                    (Some(f0), Some(f1)) => {
                        // Best fit of the link's patch of cloth: the next particle down, the cloth
                        // beside it and beside the head, the side edge too for an outer chain.
                        let mut pts: Vec<(Vec3, Vec3, f32)> = vec![(d0, d, 3.0)];
                        for (rr, w) in [(k + 1, 1.0), (k, 0.5)] {
                            for cc in [col - 1, col + 1] {
                                let w = if cc == 0 || cc == COLS - 1 { w * 2.0 } else { w };
                                pts.push((rest[rr][cc] - rest[k][col], at(rr, cc) - head, w));
                            }
                        }
                        (fit_rotation(Quat::from_mat3(&(f1 * f0.transpose())), &pts) * bind_rot).normalize()
                    }
                    _ => {
                        let base = prot * br;
                        let d0 = base * (bind_rot.inverse() * d0);
                        if d.length() > 1e-5 && d0.length() > 1e-5 {
                            Quat::from_rotation_arc(d0.normalize(), d.normalize()) * base
                        } else {
                            base
                        }
                    }
                };
                tracks[slot].push((prot.inverse() * rot).normalize());
                parent = Mat4::from_rotation_translation(rot, head);
                slot += 1;
            }
        }
    }
    let joints: Vec<usize> = rig.joints().collect();
    let c = &mut model.clips[clip];
    for ((j, values), shift) in joints.into_iter().zip(tracks).zip(shifts) {
        if c.channels.len() <= j {
            c.channels.resize_with(j + 1, Default::default);
        }
        c.channels[j].rotation = Some(QuatTrack { times: times.clone(), values });
        c.channels[j].translation = Some(Vec3Track { times: times.clone(), values: shift });
    }
}

/// How far a cape sinks into its wearer at one moment of a clip: see [`cape_sink`].
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CapeSink {
    /// The deepest cape point under the body's surface (m), 0 when the cape lies clear.
    pub depth: f32,
    /// Cape vertices more than 5 mm under the surface.
    pub vertices: usize,
    /// The body joint the deepest point sinks into.
    pub joint: Option<usize>,
    /// The deepest point's place on the cape: its uv (across 0..1, down 0..1).
    pub uv: [f32; 2],
    /// How far the body pokes out through the cape (m): a body vertex in front of the cape's
    /// outside, between its vertices (a shoulder blade through a tight cape).
    pub poke: f32,
    /// The body joint that pokes out furthest.
    pub poke_joint: Option<usize>,
}

/// Measures how far the drawn (skinned) cape passes into the body (skin, clothes, everything but
/// the head) at `time` in `model.clips[clip]`: a check for clips and for the cloth simulation.
/// A cape point is under the surface when it lies behind the nearest body vertex along that
/// vertex's normal.
pub fn cape_sink(model: &AnimatedModel, rig: &CapeRig, clip: usize, time: f32) -> CapeSink {
    use std::collections::HashMap;
    let skin = engine::anim::sample_joint_matrices(model, clip, time);
    let n_joints = skin.len();
    let mut is_cape = vec![false; n_joints];
    for j in rig.joints() {
        if j < n_joints {
            is_cape[j] = true;
        }
    }
    let head = model.skeleton.joint_names.iter().position(|n| n == "head");
    const CELL: f32 = 0.04;
    let key = |p: Vec3| ((p.x / CELL).floor() as i32, (p.y / CELL).floor() as i32, (p.z / CELL).floor() as i32);
    let mut body: Vec<(Vec3, Vec3, usize)> = Vec::new();
    let mut grid: HashMap<(i32, i32, i32), Vec<u32>> = HashMap::new();
    let mut cape: Vec<(Vec3, [f32; 2])> = Vec::new();
    // The cape's outside (not its lining): vertices facing away from the upper back.
    let spine = {
        let a = rig.anchor;
        (skin[a] * model.skeleton.inverse_bind[a].inverse()).w_axis.truncate()
    };
    let mut outside: Vec<(Vec3, Vec3)> = Vec::new();
    for mesh in &model.meshes {
        for (i, (&p, (&js, &ws))) in mesh.positions.iter().zip(mesh.joints.iter().zip(&mesh.weights)).enumerate() {
            let (mut m, mut on_cape, mut dom, mut best) = (Mat4::ZERO, 0.0, 0usize, -1.0f32);
            for (&j, &w) in js.iter().zip(&ws) {
                let j = j as usize;
                if w <= 0.0 || j >= n_joints {
                    continue;
                }
                m += skin[j] * w;
                if is_cape[j] {
                    on_cape += w;
                }
                if w > best {
                    best = w;
                    dom = j;
                }
            }
            let at = m.transform_point3(p);
            if on_cape >= 0.5 {
                cape.push((at, mesh.uvs.get(i).copied().unwrap_or_default()));
                let n = mesh.normals.get(i).map_or(Vec3::ZERO, |&n| m.transform_vector3(n).normalize_or_zero());
                let away = Vec3::new(at.x - spine.x, 0.0, at.z - spine.z);
                if on_cape >= 0.99 && n.dot(away) > 0.0 {
                    outside.push((at, n));
                }
            } else if on_cape == 0.0 && Some(dom) != head {
                let n = mesh.normals.get(i).map_or(Vec3::ZERO, |&n| m.transform_vector3(n).normalize_or_zero());
                grid.entry(key(at)).or_default().push(body.len() as u32);
                body.push((at, n, dom));
            }
        }
    }
    let mut out = CapeSink::default();
    for &(p, uv) in &cape {
        let (cx, cy, cz) = key(p);
        // The six nearest body vertices: under the surface when behind every one of them (one
        // alone misleads in creases, and where loose clothes lie over the body).
        let mut near: Vec<(f32, usize)> = Vec::new();
        for dx in -2..=2 {
            for dy in -2..=2 {
                for dz in -2..=2 {
                    for &b in grid.get(&(cx + dx, cy + dy, cz + dz)).map_or(&[][..], |v| &v[..]) {
                        near.push((p.distance_squared(body[b as usize].0), b as usize));
                    }
                }
            }
        }
        if near.is_empty() {
            continue;
        }
        near.sort_by(|a, b| a.0.total_cmp(&b.0));
        near.truncate(6);
        let depth = near.iter().map(|&(_, b)| -(p - body[b].0).dot(body[b].1)).fold(f32::INFINITY, f32::min);
        let joint = body[near[0].1].2;
        if depth > 0.005 {
            out.vertices += 1;
        }
        if depth > out.depth {
            out.depth = depth;
            out.joint = Some(joint);
            out.uv = uv;
        }
    }
    // The other way round: body vertices out in front of the cape's outside.
    let mut cells: HashMap<(i32, i32, i32), Vec<u32>> = HashMap::new();
    for (i, &(p, _)) in outside.iter().enumerate() {
        cells.entry(key(p)).or_default().push(i as u32);
    }
    for &(p, _, joint) in &body {
        let (cx, cy, cz) = key(p);
        let mut near: Vec<(f32, usize)> = Vec::new();
        for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    for &o in cells.get(&(cx + dx, cy + dy, cz + dz)).map_or(&[][..], |v| &v[..]) {
                        near.push((p.distance_squared(outside[o as usize].0), o as usize));
                    }
                }
            }
        }
        if near.len() < 3 {
            continue;
        }
        near.sort_by(|a, b| a.0.total_cmp(&b.0));
        near.truncate(3);
        // Close to the cloth (not past its edge): in front of all three nearest.
        if near[0].0 > 0.03f32.powi(2) {
            continue;
        }
        let poke = near.iter().map(|&(_, o)| (p - outside[o].0).dot(outside[o].1)).fold(f32::INFINITY, f32::min);
        if poke > out.poke {
            out.poke = poke;
            out.poke_joint = Some(joint);
        }
    }
    out
}
