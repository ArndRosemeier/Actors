//! Robot actors: armour plates, a flexible inner frame, joint housings and a sculpted head, all
//! generated from the current body shape and skinned to the pack skeleton (port of
//! `packages/human/src/robot.ts`). Every slider that shapes a human shapes the robot too, and
//! every clip plays on it unchanged (same bones).
//!
//! - Plates: the body surface is split by skin weights into one region per bone (twist bones
//!   join their parent). Each region is cut where it blends into the next bone (so gaps open at
//!   the joints), smoothed, and thickened into a closed shell with a rounded edge. Plates are
//!   rigid on their bone.
//! - Frame: the body surface itself, smoothly skinned, drawn as a dark synthetic-muscle layer that
//!   shows in the gaps.
//! - Joints: hinge housings (elbows, knees, ankles, hips, fingers) and ball joints (shoulders,
//!   wrists), sized from the limb they sit in.
//! - Head: a helmet surface fitted to the skull in head-centred directions (robust to nose, lips
//!   and ears), with a visor, optics or a faceplate.
//!
//! Deterministic. Axes: +Y up, +Z forward, +X = actor's left. The TypeScript builder keeps some
//! values in 32-bit arrays; this port works in f64 throughout, so the meshes agree to float
//! precision, not bit for bit.

use crate::parts::{eye_centres, Builder, Weights};
use actors_core::format::{MaterialKind, MeshRole};
use actors_core::math::{add, cross, dot, length as len, normalize as norm, scale as mul, sub, Vec3};
use actors_core::parts::{PartKind, PartMesh};
use actors_core::{ActorShape, FittedSkeleton, MeshData};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::f64::consts::PI;

pub const ROBOT_HEADS: [&str; 4] = ["visor", "optics", "mono", "android"];
pub const ROBOT_EARS: [&str; 4] = ["none", "pods", "antennae", "fins"];
pub const ROBOT_PLATING: [&str; 3] = ["sleek", "segmented", "armored"];

/// A robot's build options (the `RobotConfig` of @actors/human; styles by name).
#[derive(Clone, Debug, PartialEq)]
pub struct RobotConfig {
    /// "visor", "optics", "mono" or "android".
    pub head: String,
    /// "none", "pods", "antennae" or "fins".
    pub ears: String,
    /// "sleek", "segmented" or "armored".
    pub plating: String,
    /// 0..1 plate thickness (about 5 to 17 mm; armoured plating adds half).
    pub thickness: f64,
    /// A light core in the chest.
    pub core: bool,
}

impl Default for RobotConfig {
    fn default() -> Self {
        Self { head: "visor".into(), ears: "pods".into(), plating: "segmented".into(), thickness: 0.5, core: true }
    }
}

impl RobotConfig {
    /// A valid config (unknown styles fall back to the defaults).
    pub fn sanitized(&self) -> Self {
        let d = Self::default();
        let pick = |v: &str, list: &[&str], def: String| if list.contains(&v) { v.to_string() } else { def };
        Self {
            head: pick(&self.head, &ROBOT_HEADS, d.head),
            ears: pick(&self.ears, &ROBOT_EARS, d.ears),
            plating: pick(&self.plating, &ROBOT_PLATING, d.plating),
            thickness: if self.thickness.is_finite() { self.thickness.clamp(0.0, 1.0) } else { d.thickness },
            core: self.core,
        }
    }
}

/// What the robot builder needs from an evaluated shape.
pub struct RobotBody<'a> {
    /// Surface vertices (the subdivided body if the pack has one and it was evaluated).
    pub positions: &'a [f32],
    pub normals: &'a [f32],
    /// Body triangles as surface vertex indices.
    pub triangles: Vec<u32>,
    /// Per surface vertex skin influences (4 each).
    pub joints: Vec<u16>,
    pub weights: Vec<f32>,
    /// 1 for vertices used by the body triangles.
    pub used: Vec<u8>,
    /// The body's render mesh (UV seams split), for the frame.
    pub map: &'a [u32],
    pub uv: &'a [f32],
    pub indices: &'a [u32],
    pub skeleton: &'a FittedSkeleton,
    /// Eye centres (actor's left and right).
    pub eyes: [Vec3; 2],
}

/// Generated robot parts.
#[derive(Clone, Debug, Default)]
pub struct RobotParts {
    pub parts: Vec<PartMesh>,
    /// How far the plates reach below the body's lowest point (soles), to stand the robot on the ground.
    pub lift: f64,
}

/// Collects the robot's surfaces from an evaluated shape (None if the pack lacks a skinned body,
/// eyes or skeleton).
pub fn robot_body<'a>(shape: &'a ActorShape, meshes: &'a [MeshData]) -> Option<RobotBody<'a>> {
    let sk = shape.skeleton.as_ref()?;
    let eye_mesh = meshes.iter().find(|m| m.def.material.kind == MaterialKind::Eye && m.stencil.is_none())?;
    let eyes = eye_centres(shape, eye_mesh)?;
    let skinned = |m: &&MeshData| m.def.role == MeshRole::Body && m.joints.is_some() && m.weights.is_some();
    let fine = meshes.iter().filter(skinned).find(|m| m.stencil.is_some() && shape.meshes.contains_key(&m.def.name));
    let mesh = fine.or_else(|| meshes.iter().filter(skinned).find(|m| m.stencil.is_none()))?;
    let (positions, normals): (&[f32], &[f32]) = match fine {
        Some(f) => {
            let s = shape.meshes.get(&f.def.name)?;
            (&s.positions, &s.normals)
        }
        None => (&shape.positions, &shape.normals),
    };
    let n = positions.len() / 3;
    let (mj, mw) = (mesh.joints.as_ref()?, mesh.weights.as_ref()?);
    let (mut joints, mut weights, mut used) = (vec![0u16; n * 4], vec![0f32; n * 4], vec![0u8; n]);
    for (i, &v) in mesh.map.iter().enumerate() {
        let v = v as usize;
        used[v] = 1;
        for k in 0..4 {
            joints[v * 4 + k] = mj[i * 4 + k];
            weights[v * 4 + k] = mw[i * 4 + k];
        }
    }
    let triangles = mesh.indices.iter().map(|&i| mesh.map[i as usize]).collect();
    Some(RobotBody {
        positions,
        normals,
        triangles,
        joints,
        weights,
        used,
        map: &mesh.map,
        uv: &mesh.uv,
        indices: &mesh.indices,
        skeleton: sk,
        eyes,
    })
}

fn lerp3(a: Vec3, b: Vec3, t: f64) -> Vec3 {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/// Vertex `i` of a flat f32 array.
fn at(arr: &[f32], i: usize) -> Vec3 {
    [arr[i * 3] as f64, arr[i * 3 + 1] as f64, arr[i * 3 + 2] as f64]
}

/// Vertex `i` of a flat f64 array.
fn at64(arr: &[f64], i: usize) -> Vec3 {
    [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]]
}

fn set64(arr: &mut [f64], i: usize, v: Vec3) {
    arr[i * 3..i * 3 + 3].copy_from_slice(&v);
}

/// Rounds to f32, as the TypeScript builder's Float32Arrays do.
fn f32r(x: f64) -> f64 {
    x as f32 as f64
}

/// Any unit vector perpendicular to `d`.
fn perp(d: Vec3) -> Vec3 {
    norm(cross(d, if d[1].abs() < 0.9 { [0.0, 1.0, 0.0] } else { [1.0, 0.0, 0.0] }))
}

/// JavaScript's `Math.round`.
fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// JavaScript's `Math.sign`.
fn sign(x: f64) -> f64 {
    if x > 0.0 {
        1.0
    } else if x < 0.0 {
        -1.0
    } else {
        x
    }
}

// ------------------------------------------------------------------ skeleton helpers

struct Rig<'a> {
    sk: &'a FittedSkeleton,
    /// Bone index -> segment bone (twist bones join their parent, face bones the head).
    seg: Vec<i32>,
    index: HashMap<&'a str, usize>,
}

impl<'a> Rig<'a> {
    fn new(sk: &'a FittedSkeleton) -> Self {
        let index: HashMap<&str, usize> = sk.names.iter().enumerate().map(|(i, n)| (n.as_str(), i)).collect();
        let head_idx = index.get("head").map_or(-1, |&i| i as i32);
        let mut seg = vec![0i32; sk.names.len()];
        for i in 0..sk.names.len() {
            let mut p = sk.parents[i];
            let mut under_head = false;
            while p >= 0 {
                if p == head_idx {
                    under_head = true;
                }
                p = sk.parents[p as usize];
            }
            let lower = sk.names[i].to_lowercase();
            let helper = ["twist", "metacarpal", "_roll", "corrective", "_helper"].iter().any(|k| lower.contains(k)) && sk.parents[i] >= 0;
            seg[i] = if under_head {
                head_idx
            } else if helper {
                seg[sk.parents[i] as usize]
            } else {
                i as i32
            };
        }
        // Clavicles join the chest: one rigid chest-and-shoulder plate (the arms still swing at the shoulder).
        if let Some(&chest) = index.get("spine_03") {
            for (i, n) in sk.names.iter().enumerate() {
                if n.starts_with("clavicle_") {
                    seg[i] = seg[chest];
                }
            }
        }
        Self { sk, seg, index }
    }
    fn bone(&self, name: &str) -> i32 {
        self.index.get(name).map_or(-1, |&i| i as i32)
    }
    fn has(&self, name: &str) -> bool {
        self.index.contains_key(name)
    }
    fn at_bone(&self, name: &str) -> usize {
        self.bone(name).max(0) as usize
    }
    fn head(&self, name: &str) -> Vec3 {
        self.sk.heads[self.at_bone(name)]
    }
    fn tail(&self, name: &str) -> Vec3 {
        self.sk.tails[self.at_bone(name)]
    }
    fn dir(&self, name: &str) -> Vec3 {
        norm(sub(self.tail(name), self.head(name)))
    }
    /// Local +X of a bone in model space (Blender roll convention).
    fn x_axis(&self, name: &str) -> Vec3 {
        let m = &self.sk.world_rotations[self.at_bone(name)];
        norm([m[0], m[1], m[2]])
    }
    /// Segment of a bone by name.
    fn seg_of(&self, name: &str) -> i32 {
        self.seg[self.at_bone(name)]
    }
    /// Rigid skinning on a bone.
    fn rigid(&self, name: &str) -> Weights {
        vec![(self.at_bone(name) as u16, 1.0)]
    }
}

/// Per vertex: share of segment `s` minus the largest share of any other segment (> 0 where `s` dominates).
fn dominance(body: &RobotBody, r: &Rig, v: usize, s: i32) -> f64 {
    let mut segs = [-1i32; 4];
    let mut w = [0f64; 4];
    let mut n = 0;
    for k in 0..4 {
        let wt = body.weights[v * 4 + k] as f64;
        if wt <= 0.0 {
            continue;
        }
        let sg = r.seg[body.joints[v * 4 + k] as usize];
        let i = match segs[..n].iter().position(|&x| x == sg) {
            Some(i) => i,
            None => {
                segs[n] = sg;
                n += 1;
                n - 1
            }
        };
        w[i] += wt;
    }
    let (mut own, mut other) = (0.0, 0.0f64);
    for i in 0..n {
        if segs[i] == s {
            own = w[i];
        } else {
            other = other.max(w[i]);
        }
    }
    own - other
}

/// Per vertex: share of its skin weight on bones of segment `s`.
fn membership(body: &RobotBody, r: &Rig, v: usize, s: i32) -> f64 {
    (0..4).filter(|&k| r.seg[body.joints[v * 4 + k] as usize] == s).map(|k| body.weights[v * 4 + k] as f64).sum()
}

/// Segment of a vertex's first influence.
fn first_seg(body: &RobotBody, r: &Rig, v: usize) -> i32 {
    r.seg[body.joints[v * 4] as usize]
}

// ------------------------------------------------------------------ small mesh tools

/// Area-weighted vertex normals.
fn vertex_normals(pos: &[f64], idx: &[u32], count: usize) -> Vec<f64> {
    let mut out = vec![0.0; count * 3];
    for t in idx.as_chunks::<3>().0 {
        let (a, b, c) = (t[0] as usize, t[1] as usize, t[2] as usize);
        let n = cross(sub(at64(pos, b), at64(pos, a)), sub(at64(pos, c), at64(pos, a)));
        for v in [a, b, c] {
            for j in 0..3 {
                out[v * 3 + j] += n[j];
            }
        }
    }
    for v in 0..count {
        let n = norm(at64(&out, v));
        set64(&mut out, v, n);
    }
    out
}

/// A heap entry for Dijkstra (smallest distance first).
#[derive(PartialEq)]
struct Near(f64, usize);
impl Eq for Near {}
impl Ord for Near {
    fn cmp(&self, o: &Self) -> Ordering {
        o.0.total_cmp(&self.0).then(o.1.cmp(&self.1))
    }
}
impl PartialOrd for Near {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

/// A cylinder from `a` to `b` with flat caps (separate cap vertices for crisp edges).
fn cylinder(bld: &mut Builder, a: Vec3, b: Vec3, radius: f64, w: &Weights, radial: usize) {
    let axis = norm(sub(b, a));
    let s1 = perp(axis);
    let s2 = cross(axis, s1);
    let ring = |bld: &mut Builder, c: Vec3, n: Option<Vec3>| {
        let base = bld.count() as u32;
        for j in 0..=radial {
            let ang = j as f64 / radial as f64 * PI * 2.0;
            let d = add(mul(s1, ang.cos()), mul(s2, ang.sin()));
            bld.vert(add(c, mul(d, radius)), n.unwrap_or(d), j as f64 / radial as f64, 0.0, 1.0, w);
        }
        base
    };
    let r0 = ring(bld, a, None);
    let r1 = ring(bld, b, None);
    for j in 0..radial as u32 {
        bld.idx.extend_from_slice(&[r0 + j, r0 + j + 1, r1 + j, r0 + j + 1, r1 + j + 1, r1 + j]);
    }
    for (c, n, flip) in [(a, mul(axis, -1.0), true), (b, axis, false)] {
        let centre = bld.count() as u32;
        bld.vert(c, n, 0.5, 0.5, 1.0, w);
        let rr = ring(bld, c, Some(n));
        for j in 0..radial as u32 {
            if flip {
                bld.idx.extend_from_slice(&[centre, rr + j + 1, rr + j]);
            } else {
                bld.idx.extend_from_slice(&[centre, rr + j, rr + j + 1]);
            }
        }
    }
}

/// A flat ring (r0 > 0) or disc (r0 = 0) facing `n`.
#[allow(clippy::too_many_arguments)]
fn annulus(bld: &mut Builder, c: Vec3, n: Vec3, r0: f64, r1: f64, w: &Weights, radial: usize, dome: f64) {
    let s1 = perp(n);
    let s2 = cross(n, s1);
    let base = bld.count() as u32;
    let inner = if r0 > 0.0 { r0 } else { 0.0 };
    for j in 0..=radial {
        let ang = j as f64 / radial as f64 * PI * 2.0;
        let d = add(mul(s1, ang.cos()), mul(s2, ang.sin()));
        bld.vert(add(add(c, mul(d, inner)), mul(n, if inner != 0.0 { 0.0 } else { dome })), n, 0.0, 0.0, 1.0, w);
        bld.vert(add(c, mul(d, r1)), n, 1.0, 0.0, 1.0, w);
    }
    for j in 0..radial as u32 {
        let a = base + j * 2;
        bld.idx.extend_from_slice(&[a, a + 1, a + 3, a, a + 3, a + 2]);
    }
}

/// A UV sphere.
fn sphere(bld: &mut Builder, c: Vec3, r: f64, w: &Weights, rows: usize, cols: usize) {
    let base = bld.count() as u32;
    for i in 0..=rows {
        let th = i as f64 / rows as f64 * PI;
        for j in 0..=cols {
            let ph = j as f64 / cols as f64 * PI * 2.0;
            let d = [th.sin() * ph.cos(), th.cos(), th.sin() * ph.sin()];
            bld.vert(add(c, mul(d, r)), d, j as f64 / cols as f64, i as f64 / rows as f64, 1.0, w);
        }
    }
    let cols = cols as u32;
    for i in 0..rows as u32 {
        for j in 0..cols {
            let a = base + i * (cols + 1) + j;
            let b = a + cols + 1;
            bld.idx.extend_from_slice(&[a, a + 1, b, a + 1, b + 1, b]);
        }
    }
}

/// An elliptical tube along `pts` (fins, rods); `rw` across `side`, `rh` across the other axis.
fn sweep(bld: &mut Builder, pts: &[Vec3], rw: impl Fn(f64) -> f64, rh: impl Fn(f64) -> f64, side: Vec3, w: &Weights, radial: usize) {
    let base = bld.count() as u32;
    let n = pts.len();
    for i in 0..n {
        let t = i as f64 / (n - 1) as f64;
        let tan = norm(sub(pts[(i + 1).min(n - 1)], pts[i.saturating_sub(1)]));
        let s = norm(sub(side, mul(tan, dot(side, tan))));
        let u = cross(tan, s);
        for j in 0..=radial {
            let a = j as f64 / radial as f64 * PI * 2.0;
            let p = add(pts[i], add(mul(s, a.cos() * rw(t)), mul(u, a.sin() * rh(t))));
            let nn = norm(add(mul(s, a.cos() / rw(t).max(1e-4)), mul(u, a.sin() / rh(t).max(1e-4))));
            bld.vert(p, nn, j as f64 / radial as f64, t, 1.0, w);
        }
    }
    let radial = radial as u32;
    for i in 0..n as u32 - 1 {
        for j in 0..radial {
            let a = base + i * (radial + 1) + j;
            let c = a + radial + 1;
            bld.idx.extend_from_slice(&[a, a + 1, c, a + 1, c + 1, c]);
        }
    }
}

// ------------------------------------------------------------------ plates

const GROOVE: f64 = 0.0035;

/// A groove field (m, positive = plate).
enum Groove {
    /// Along the body's midline.
    Midline,
    /// A ring around a limb: plane normal and offset.
    Ring(Vec3, f64),
}

impl Groove {
    fn at(&self, x: f64, y: f64, z: f64) -> f64 {
        match *self {
            Groove::Midline => x.abs() - GROOVE,
            Groove::Ring(d, off) => (x * d[0] + y * d[1] + z * d[2] - off).abs() - GROOVE,
        }
    }
}

struct PlateStyle {
    /// How much a plate's bone must outweigh the next one (higher = wider gaps at the joints).
    margin: f64,
    /// Plate thickness (m).
    thick: f64,
    plating: String,
}

impl PlateStyle {
    fn new(c: &RobotConfig) -> Self {
        let armored = c.plating == "armored";
        let thick = (0.005 + 0.012 * c.thickness) * if armored { 1.5 } else { 1.0 };
        Self { margin: if armored { 0.06 } else { 0.14 }, thick, plating: c.plating.clone() }
    }
    /// Groove field of a segment, or None.
    fn grooves(&self, r: &Rig, name: &str) -> Option<Groove> {
        let ring = |t0: f64| {
            let h = r.head(name);
            let d = r.dir(name);
            Groove::Ring(d, t0 * len(sub(r.tail(name), h)) + dot(h, d))
        };
        if self.plating == "sleek" {
            return None;
        }
        if self.plating == "armored" {
            return matches!(name, "spine_02" | "spine_03" | "spine_04" | "spine_05").then_some(Groove::Midline);
        }
        let base = name.strip_suffix("_l").or_else(|| name.strip_suffix("_r")).unwrap_or(name);
        match base {
            "spine_02" | "spine_03" | "spine_04" | "spine_05" | "pelvis" => Some(Groove::Midline),
            "thigh" => Some(ring(0.5)),
            "calf" => Some(ring(0.55)),
            "upperarm" => Some(ring(0.45)),
            _ => None,
        }
    }
}

/// Segments painted with the second colour (hands, fingers, feet).
fn is_trim(name: &str) -> bool {
    ["hand", "thumb", "index", "middle", "ring", "pinky", "foot", "ball"].iter().any(|p| name.starts_with(p))
}

fn is_finger(name: &str) -> bool {
    ["thumb_", "index_", "middle_", "ring_", "pinky_"].iter().any(|p| name.starts_with(p))
}

/// Cuts the plate of segment `s` out of the body and thickens it into a closed shell, rigid on
/// bone `s`. Returns false if the segment has no plate.
fn build_plate(body: &RobotBody, r: &Rig, s: i32, tris: &[usize], style: &PlateStyle, bld: &mut Builder) -> bool {
    let name = r.sk.names[s as usize].as_str();
    let pos = body.positions;
    let nrm = body.normals;
    let groove = style.grooves(r, name);
    // Plate field per vertex: dominance above the margin, minus grooves (scaled to weight units).
    let mut field: HashMap<usize, f64> = HashMap::new();
    let mut f = |v: usize| -> f64 {
        *field.entry(v).or_insert_with(|| {
            let d = dominance(body, r, v, s) - style.margin;
            match &groove {
                Some(g) => d.min(g.at(pos[v * 3] as f64, pos[v * 3 + 1] as f64, pos[v * 3 + 2] as f64) * 12.0),
                None => d,
            }
        })
    };
    // Clip triangles to F >= 0; cut points on an edge are shared by both triangles of that edge.
    let mut lp: Vec<f64> = Vec::new();
    let mut ln: Vec<f64> = Vec::new();
    let mut local: HashMap<usize, u32> = HashMap::new();
    let mut cuts: HashMap<(usize, usize), u32> = HashMap::new();
    let mut tri: Vec<u32> = Vec::new();
    for &t in tris {
        let vs = [body.triangles[t] as usize, body.triangles[t + 1] as usize, body.triangles[t + 2] as usize];
        let fs = vs.map(&mut f);
        if fs.iter().all(|&x| x < 0.0) {
            continue;
        }
        let mut poly: Vec<u32> = Vec::with_capacity(4);
        for k in 0..3 {
            let (a, b, fa, fb) = (vs[k], vs[(k + 1) % 3], fs[k], fs[(k + 1) % 3]);
            if fa >= 0.0 {
                let i = *local.entry(a).or_insert_with(|| {
                    let i = (lp.len() / 3) as u32;
                    lp.extend_from_slice(&at(pos, a));
                    ln.extend_from_slice(&at(nrm, a));
                    i
                });
                poly.push(i);
            }
            if (fa >= 0.0) != (fb >= 0.0) {
                let key = if a < b { (a, b) } else { (b, a) };
                let i = *cuts.entry(key).or_insert_with(|| {
                    let tt = fa / (fa - fb);
                    let i = (lp.len() / 3) as u32;
                    lp.extend_from_slice(&lerp3(at(pos, a), at(pos, b), tt));
                    ln.extend_from_slice(&norm(lerp3(at(nrm, a), at(nrm, b), tt)));
                    i
                });
                poly.push(i);
            }
        }
        for k in 1..poly.len().saturating_sub(1) {
            if poly[0] != poly[k] && poly[k] != poly[k + 1] && poly[0] != poly[k + 1] {
                tri.extend_from_slice(&[poly[0], poly[k], poly[k + 1]]);
            }
        }
    }
    let n = lp.len() / 3;
    if tri.len() < 3 * 24 {
        return false;
    }
    let mut p: Vec<f64> = lp.iter().map(|&x| f32r(x)).collect();
    // Edges: an edge a->b is on the boundary if no triangle has b->a.
    let mut out: Vec<Vec<u32>> = vec![Vec::new(); n];
    for t in tri.as_chunks::<3>().0 {
        for k in 0..3 {
            out[t[k] as usize].push(t[(k + 1) % 3]);
        }
    }
    let mut nbr: Vec<Vec<u32>> = vec![Vec::new(); n];
    let mut bnbr: Vec<Vec<u32>> = vec![Vec::new(); n];
    let mut boundary = vec![false; n];
    let mut directed: Vec<(usize, usize)> = Vec::new();
    for a in 0..n {
        for &b in &out[a] {
            let bu = b as usize;
            if !nbr[a].contains(&b) {
                nbr[a].push(b);
            }
            if !nbr[bu].contains(&(a as u32)) {
                nbr[bu].push(a as u32);
            }
            if !out[bu].contains(&(a as u32)) {
                boundary[a] = true;
                boundary[bu] = true;
                bnbr[a].push(b);
                bnbr[bu].push(a as u32);
                directed.push((a, bu));
            }
        }
    }
    // Taubin smoothing: plates are smoother than skin (no navel, no nipples), and their edges smoother than the cut.
    // Feet become boots: toes are smoothed away first (plain Laplacian), the plate is then made thicker.
    let boot = name.starts_with("ball_") || name.starts_with("foot_");
    let mut passes: Vec<f64> = if boot { vec![0.6; 10] } else { Vec::new() };
    // The torso is smoothed hardest (no abdominal muscles on a robot).
    let torso = name.starts_with("spine_") || name.starts_with("pelvis");
    for _ in 0..if torso { 24 } else { 10 } {
        passes.extend_from_slice(&[0.5, -0.53]);
    }
    let mut tmp = p.clone();
    for lambda in passes {
        tmp.copy_from_slice(&p);
        for v in 0..n {
            let list = if boundary[v] { &bnbr[v] } else { &nbr[v] };
            if list.is_empty() {
                continue;
            }
            let mut sum = [0.0; 3];
            for &u in list {
                let u = u as usize;
                for j in 0..3 {
                    sum[j] += tmp[u * 3 + j];
                }
            }
            let k = 1.0 / list.len() as f64;
            for j in 0..3 {
                p[v * 3 + j] = f32r(p[v * 3 + j] + lambda * (sum[j] * k - tmp[v * 3 + j]));
            }
        }
    }
    let mut nn = vertex_normals(&p, &tri, n);
    // Keep the body's normal direction where smoothing flipped a thin sliver.
    for v in 0..n {
        if dot(at64(&nn, v), at64(&ln, v)) < 0.0 {
            set64(&mut nn, v, at64(&ln, v));
        }
    }
    // Distance to the plate edge (Dijkstra over edges) for the rounded rim.
    let mut dist = vec![f64::INFINITY; n];
    let mut heap = BinaryHeap::new();
    for v in 0..n {
        if boundary[v] {
            dist[v] = 0.0;
            heap.push(Near(0.0, v));
        }
    }
    while let Some(Near(d, v)) = heap.pop() {
        if d > dist[v] {
            continue;
        }
        for &u in &nbr[v] {
            let u = u as usize;
            let nd = d + len(sub(at64(&p, u), at64(&p, v)));
            if nd < dist[u] {
                dist[u] = nd;
                heap.push(Near(nd, u));
            }
        }
    }
    // Fingers and hands get thinner plates (a finger is under 2 cm thick).
    let finger = is_finger(name);
    let hand = name.starts_with("hand_");
    let thick = if finger {
        style.thick.min(0.0026)
    } else if hand {
        style.thick.min(0.0055)
    } else {
        style.thick * if boot { 1.4 } else { 1.0 }
    };
    let gap = if boot {
        0.004
    } else if finger {
        0.0012
    } else {
        0.0025
    };
    let bevel = thick * 1.3 + if finger { 0.0015 } else { 0.004 };
    let edge = 0.4;
    let prof = |d: f64| {
        let x = (d / bevel).min(1.0);
        edge + (1.0 - edge) * (1.0 - (1.0 - x) * (1.0 - x)).sqrt()
    };
    let mut outer = vec![0.0; n * 3];
    let mut inner = vec![0.0; n * 3];
    for v in 0..n * 3 {
        outer[v] = p[v] + nn[v] * (gap + thick * prof(dist[v / 3]));
        inner[v] = p[v] + nn[v] * gap * 0.4;
    }
    let outer_n = vertex_normals(&outer, &tri, n);
    let w: Weights = vec![(s as u16, 1.0)];
    // Outer skin.
    let o0 = bld.count() as u32;
    for v in 0..n {
        bld.vert(at64(&outer, v), at64(&outer_n, v), 0.0, 0.0, 1.0, &w);
    }
    bld.idx.extend(tri.iter().map(|&i| o0 + i));
    // Inner skin (reversed).
    let i0 = bld.count() as u32;
    for v in 0..n {
        bld.vert(at64(&inner, v), mul(at64(&nn, v), -1.0), 0.0, 0.0, 0.45, &w);
    }
    for t in tri.as_chunks::<3>().0 {
        bld.idx.extend_from_slice(&[i0 + t[0], i0 + t[2], i0 + t[1]]);
    }
    // Rim: one quad per boundary edge, facing away from the plate.
    let mut rim_n: HashMap<usize, Vec3> = HashMap::new();
    for &(a, b) in &directed {
        let o = cross(sub(at64(&p, b), at64(&p, a)), at64(&nn, a));
        for v in [a, b] {
            let e = rim_n.entry(v).or_insert([0.0; 3]);
            *e = add(*e, o);
        }
    }
    for &(a, b) in &directed {
        let r0 = bld.count() as u32;
        for v in [a, b] {
            let rn = norm(add(norm(rim_n[&v]), mul(at64(&nn, v), 0.25)));
            bld.vert(at64(&outer, v), rn, 0.0, 0.0, 0.8, &w);
            bld.vert(at64(&inner, v), rn, 0.0, 0.0, 0.55, &w);
        }
        // r0 = a outer, r0+1 = a inner, r0+2 = b outer, r0+3 = b inner.
        bld.idx.extend_from_slice(&[r0, r0 + 1, r0 + 3, r0, r0 + 3, r0 + 2]);
    }
    true
}

/// Toe cap: a rounded box swept along the toes (heel side open towards the foot plate, front
/// closed), sized from the toes' slices, so feet read as boots.
fn build_toe_cap(body: &RobotBody, r: &Rig, s: i32, thick: f64, bld: &mut Builder) -> bool {
    let name = r.sk.names[s as usize].as_str();
    let h = r.head(name);
    let raw = r.dir(name);
    let d = norm([raw[0], 0.0, raw[2]]);
    let l = norm(cross([0.0, 1.0, 0.0], d));
    let pos = body.positions;
    let mut pts: Vec<(f64, f64, f64)> = Vec::new();
    let mut t_max: f64 = 0.0;
    for v in 0..pos.len() / 3 {
        if body.used[v] == 0 || dominance(body, r, v, s) < -0.3 {
            continue;
        }
        let rel = sub(at(pos, v), h);
        let t = dot(rel, d);
        if t < -0.015 {
            continue;
        }
        pts.push((t, dot(rel, l), rel[1]));
        t_max = t_max.max(t);
    }
    if pts.len() < 20 || t_max < 0.02 {
        return false;
    }
    const N: usize = 14;
    let (t0, t1) = (-0.008, t_max + 0.002);
    let mut slices: Vec<[f64; 4]> = Vec::with_capacity(N + 1);
    for k in 0..=N {
        let t = t0 + (t1 - t0) * k as f64 / N as f64;
        let w = (t1 - t0) / N as f64 * 0.9;
        let (mut x0, mut x1, mut y0, mut y1) = (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY);
        for &(pt, px, py) in &pts {
            if (pt - t).abs() > w {
                continue;
            }
            x0 = x0.min(px);
            x1 = x1.max(px);
            y0 = y0.min(py);
            y1 = y1.max(py);
        }
        let sl = if x0.is_finite() { [x0, x1, y0, y1] } else { k.checked_sub(1).map_or([-0.03, 0.03, -0.02, 0.01], |p| slices[p]) };
        slices.push(sl);
    }
    // Smooth the outline along the foot.
    for _ in 0..3 {
        for k in 1..N {
            for key in 0..4 {
                slices[k][key] = (slices[k - 1][key] + slices[k][key] * 2.0 + slices[k + 1][key]) / 4.0;
            }
        }
    }
    let out = thick + 0.003;
    let radial = 24;
    let w: Weights = vec![(s as u16, 1.0)];
    let ring = |bld: &mut Builder, k: usize, shrink: f64| -> (u32, Vec3) {
        let k = k.min(N);
        let [x0, x1, y0, y1] = slices[k];
        let t = t0 + (t1 - t0) * k as f64 / N as f64;
        let (cx, cy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0);
        let a = ((x1 - x0) / 2.0 + out) * shrink;
        let bb = ((y1 - y0) / 2.0 + out) * shrink;
        let c = add(add(add(h, mul(d, t)), mul(l, cx)), [0.0, cy, 0.0]);
        let base = bld.count() as u32;
        for j in 0..=radial {
            let ang = j as f64 / radial as f64 * PI * 2.0;
            let (ca, sa) = (ang.cos(), ang.sin());
            // Superellipse (exponent 2.6): boxy with round corners.
            let e = 2.0 / 2.6;
            let px = sign(ca) * ca.abs().powf(e) * a;
            let py = sign(sa) * sa.abs().powf(e) * bb;
            let p = add(add(c, mul(l, px)), [0.0, py, 0.0]);
            let nn = norm(add(
                mul(l, sign(ca) * ca.abs().powf(2.0 - e) / a.max(1e-4)),
                [0.0, sign(sa) * sa.abs().powf(2.0 - e) / bb.max(1e-4), 0.0],
            ));
            bld.vert(p, nn, 0.0, 0.0, 1.0, &w);
        }
        (base, c)
    };
    let mut rings: Vec<(u32, Vec3)> = Vec::new();
    // Body of the cap, then a rounded nose (shrinking rings).
    for k in 0..=N {
        rings.push(ring(bld, k, 1.0));
    }
    for k in 1..=4 {
        let f = k as f64 / 4.0;
        let r0 = ring(bld, N, (1.0 - f * f).sqrt() * 0.999 + 0.001);
        // Push the nose forward.
        let off = mul(d, out * 1.4 * (f * PI / 2.0).sin());
        for j in 0..=radial {
            let i = (r0.0 as usize + j) * 3;
            bld.pos[i] += off[0];
            bld.pos[i + 2] += off[2];
            if k == 4 {
                bld.nrm[i..i + 3].copy_from_slice(&d);
            }
        }
        rings.push(r0);
    }
    for k in 0..rings.len() - 1 {
        for j in 0..radial as u32 {
            let a = rings[k].0 + j;
            let c = rings[k + 1].0 + j;
            bld.idx.extend_from_slice(&[a, a + 1, c, a + 1, c + 1, c]);
        }
    }
    // Heel-side cap.
    let back = rings[0];
    let centre = bld.count() as u32;
    bld.vert(back.1, mul(d, -1.0), 0.0, 0.0, 0.6, &w);
    for j in 0..radial as u32 {
        bld.idx.extend_from_slice(&[centre, back.0 + j + 1, back.0 + j]);
    }
    true
}

// ------------------------------------------------------------------ limb measurements

/// Cross-section of the body at a joint: median radius around `dir`, and half width along `axis`.
fn cross_section(body: &RobotBody, r: &Rig, j: Vec3, dir: Vec3, segs: &[i32], axis: Option<Vec3>) -> (f64, f64) {
    let slab = 0.012;
    let mut radii = Vec::new();
    let mut widths = Vec::new();
    let pos = body.positions;
    for v in 0..pos.len() / 3 {
        if body.used[v] == 0 {
            continue;
        }
        let rel = sub(at(pos, v), j);
        let along = dot(rel, dir);
        if along.abs() > slab || !segs.contains(&first_seg(body, r, v)) {
            continue;
        }
        let radial = sub(rel, mul(dir, along));
        let d = len(radial);
        if d > 0.3 {
            continue;
        }
        radii.push(d);
        if let Some(a) = axis {
            widths.push(dot(radial, a).abs());
        }
    }
    let pct = |a: &mut Vec<f64>, q: f64| {
        if a.is_empty() {
            return 0.0;
        }
        a.sort_by(f64::total_cmp);
        a[((q * a.len() as f64).floor() as usize).min(a.len() - 1)]
    };
    (pct(&mut radii, 0.5), pct(&mut widths, 0.92))
}

// ------------------------------------------------------------------ head

/// Half heights (polar angle) of the mono-eye slit and of the visor.
const VISOR_HALF: [f64; 2] = [0.07, 0.17];

fn dir_of(theta: f64, phi: f64) -> Vec3 {
    [theta.sin() * phi.sin(), theta.cos(), theta.sin() * phi.cos()]
}

/// Lower edge of the shell (polar angle from the crown) per direction: under the chin in front,
/// above the nape behind.
fn limit(phi: f64) -> f64 {
    2.18 + 0.52 * (0.5 + 0.5 * phi.cos()).powf(1.5)
}

struct HeadShell {
    c: Vec3,
    /// Mean radius.
    r: f64,
    rows: usize,
    cols: usize,
    knots: [f64; 5],
    counts: [usize; 5],
    starts: [usize; 5],
    /// Shell radius per grid vertex ((rows+1) x cols, wrapping in phi).
    radius: Vec<f64>,
}

impl HeadShell {
    /// Polar angle of grid row `i` (may be fractional) in column `j`.
    fn theta(&self, i: f64, j: usize) -> f64 {
        let mut k = 4;
        while k > 0 && i < self.starts[k] as f64 {
            k -= 1;
        }
        let a = self.knots[k];
        let b = if k < 4 { self.knots[k + 1] } else { limit(j as f64 / self.cols as f64 * PI * 2.0) };
        a + (b - a) * (i - self.starts[k] as f64) / self.counts[k] as f64
    }
    fn rad(&self, i: usize, j: usize) -> f64 {
        self.radius[i * self.cols + j % self.cols]
    }
    /// Shell radius in a direction (bilinear on the grid).
    fn at(&self, d: Vec3) -> f64 {
        let th = d[1].clamp(-1.0, 1.0).acos();
        let mut ph = d[0].atan2(d[2]);
        if ph < 0.0 {
            ph += PI * 2.0;
        }
        let mut k = 0;
        while k < 4 && th >= self.knots[k + 1] {
            k += 1;
        }
        let top = if k < 4 { self.knots[k + 1] } else { limit(ph) };
        let fi = (self.starts[k] as f64 + (th - self.knots[k]) / (top - self.knots[k]) * self.counts[k] as f64).min(self.rows as f64);
        let fj = ph / (PI * 2.0) * self.cols as f64;
        let i0 = (self.rows - 1).min(fi.floor() as usize);
        let j0 = fj.floor() as usize % self.cols;
        let j1 = (j0 + 1) % self.cols;
        let (a, b) = (fi - i0 as f64, fj - fj.floor());
        let g = |i: usize, j: usize| self.radius[i.min(self.rows) * self.cols + j];
        (g(i0, j0) * (1.0 - b) + g(i0, j1) * b) * (1.0 - a) + (g(i0 + 1, j0) * (1.0 - b) + g(i0 + 1, j1) * b) * a
    }
}

/// Fits a smooth helmet surface around the head: for each direction from the head centre, a low
/// percentile of the skin's distance within a cone (so ears, nose and lips don't push it out),
/// then smoothed.
fn head_shell(body: &RobotBody, r: &Rig, android: bool, inflate: f64) -> HeadShell {
    let hs = r.seg_of("head");
    let pos = body.positions;
    let mut idx = Vec::new();
    let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for v in 0..pos.len() / 3 {
        if body.used[v] == 0 || membership(body, r, v, hs) < 0.5 {
            continue;
        }
        idx.push(v);
        for k in 0..3 {
            lo[k] = lo[k].min(pos[v * 3 + k] as f64);
            hi[k] = hi[k].max(pos[v * 3 + k] as f64);
        }
    }
    let [el, er] = body.eyes;
    let eye_mid = lerp3(el, er, 0.5);
    // Centre: midline, between the crown and the chin, behind the eyes.
    let c = [0.0, (hi[1] + lo[1].max(eye_mid[1] - (hi[1] - eye_mid[1]) * 1.15)) / 2.0, (lo[2] + hi[2]) / 2.0 - 0.004];
    // At most ~3000 samples keep the fit fast on subdivided bodies.
    let stride = idx.len().div_ceil(3000).max(1);
    let sample: Vec<usize> = idx.iter().copied().step_by(stride).collect();
    let m = sample.len();
    let mut dist = vec![0.0; m];
    let mut u = vec![[0.0; 3]; m];
    let mut mean_r = 0.0;
    for (k, &v) in sample.iter().enumerate() {
        let rel = sub(at(pos, v), c);
        let l = len(rel);
        let l = if l == 0.0 { 1.0 } else { l };
        dist[k] = l;
        u[k] = mul(rel, 1.0 / l);
        mean_r += l / m.max(1) as f64;
    }
    let cols = 64;
    // Rows run from the crown to the lower edge; row lines sit exactly on the visor edges (eye angle +- 0.07 and 0.17) in every column.
    let theta_e = norm(sub(eye_mid, c))[1].acos();
    let knots = [0.0, theta_e - VISOR_HALF[1], theta_e - VISOR_HALF[0], theta_e + VISOR_HALF[0], theta_e + VISOR_HALF[1]];
    let mut counts = [js_round(knots[1] / 0.055) as usize, 2, 3, 2, 0];
    counts[4] = (js_round((2.45 - knots[4]) / 0.055) as i64).max(4) as usize;
    let mut starts = [0usize; 5];
    for k in 1..5 {
        starts[k] = starts[k - 1] + counts[k - 1];
    }
    let rows = starts[4] + counts[4];
    let mut shell = HeadShell { c, r: mean_r, rows, cols, knots, counts, starts, radius: vec![0.0; (rows + 1) * cols] };
    let cone = if android { 0.2f64 } else { 0.32 }.cos();
    let q = if android { 0.5 } else { 0.4 };
    let mut valid = vec![false; (rows + 1) * cols];
    let mut hits: Vec<f64> = Vec::new();
    for i in 0..=rows {
        for j in 0..cols {
            let d = dir_of(shell.theta(i as f64, j), j as f64 / cols as f64 * PI * 2.0);
            hits.clear();
            for k in 0..m {
                let cc = dot(u[k], d);
                if cc > cone {
                    hits.push(dist[k] * cc);
                }
            }
            if hits.len() < 4 {
                continue;
            }
            hits.sort_by(f64::total_cmp);
            shell.radius[i * cols + j] = hits[(q * (hits.len() - 1) as f64).floor() as usize];
            valid[i * cols + j] = true;
        }
    }
    // Fill empty directions (under the jaw) from the row above.
    for i in 0..=rows {
        for j in 0..cols {
            if !valid[i * cols + j] {
                shell.radius[i * cols + j] = if i > 0 { shell.radius[(i - 1) * cols + j] } else { mean_r };
            }
        }
    }
    // Smooth (wrapping in phi), then inflate by the shell thickness.
    let radius = &mut shell.radius;
    for _ in 0..if android { 4 } else { 5 } {
        let tmp = radius.clone();
        for i in 0..=rows {
            for j in 0..cols {
                let (up, dn) = (i.saturating_sub(1), (i + 1).min(rows));
                radius[i * cols + j] = (tmp[i * cols + j] * 2.0
                    + tmp[up * cols + j]
                    + tmp[dn * cols + j]
                    + tmp[i * cols + (j + 1) % cols]
                    + tmp[i * cols + (j + cols - 1) % cols])
                    / 6.0;
            }
        }
    }
    // The crown row is one point.
    let pole = radius[..cols].iter().sum::<f64>() / cols as f64;
    radius[..cols].fill(pole);
    for x in radius.iter_mut() {
        *x += inflate;
    }
    shell
}

struct Builders {
    plate: Builder,
    trim: Builder,
    frame: Builder,
    joint: Builder,
    visor: Builder,
    glow: Builder,
}

fn build_head(body: &RobotBody, r: &Rig, c: &RobotConfig, shell: &HeadShell, b: &mut Builders) {
    let (cc, rows, cols) = (shell.c, shell.rows, shell.cols);
    let head_w = r.rigid("head");
    let [el, er] = body.eyes;
    let ipd = {
        let d = len(sub(el, er));
        if d == 0.0 {
            0.064
        } else {
            d
        }
    };
    let eye_mid = lerp3(el, er, 0.5);
    let de = norm(sub(eye_mid, cc));
    let theta_e = de[1].acos();
    // Visor band: polar-angle range around the eyes, and its half width in columns around the front.
    let band = match c.head.as_str() {
        "visor" => Some((VISOR_HALF[1], VISOR_HALF[1], 0.26)),
        "mono" => Some((VISOR_HALF[0], VISOR_HALF[0], 0.18)),
        _ => None,
    };
    let half_cols = band.map_or(0, |b| js_round(b.2 * cols as f64) as i64);
    let in_band = |i: usize, j: usize| -> bool {
        let Some((up, down, _)) = band else { return false };
        let jj = if j >= cols / 2 { j as i64 - cols as i64 } else { j as i64 };
        let th = shell.theta(i as f64 + 0.5, j);
        th >= theta_e - up && th < theta_e + down && jj >= -half_cols && jj < half_cols
    };
    let recess = 0.0055;
    let vtx = |i: usize, j: usize, rr: f64| add(cc, mul(dir_of(shell.theta(i as f64, j), j as f64 / cols as f64 * PI * 2.0), rr));
    let grid = |bld: &mut Builder, pick: &dyn Fn(usize, usize) -> bool, offset: f64, shade: f64| {
        let mut pts = vec![0.0; (rows + 1) * (cols + 1) * 3];
        for i in 0..=rows {
            for j in 0..=cols {
                set64(&mut pts, i * (cols + 1) + j, vtx(i, j % cols, shell.rad(i, j) + offset));
            }
        }
        let mut idx: Vec<u32> = Vec::new();
        for i in 0..rows {
            for j in 0..cols {
                if !pick(i, j) {
                    continue;
                }
                let a = (i * (cols + 1) + j) as u32;
                let d = a + cols as u32 + 1;
                idx.extend_from_slice(&[a, d, a + 1, a + 1, d, d + 1]);
            }
        }
        let mut nn = vertex_normals(&pts, &idx, pts.len() / 3);
        // The crown is a single point: give it a straight-up normal. The first and last columns meet at the front.
        for j in 0..=cols {
            set64(&mut nn, j, [0.0, 1.0, 0.0]);
        }
        for i in 1..=rows {
            let a = i * (cols + 1);
            let z = a + cols;
            let n = norm(add(at64(&nn, a), at64(&nn, z)));
            set64(&mut nn, a, n);
            set64(&mut nn, z, n);
        }
        let mut used: HashMap<u32, u32> = HashMap::new();
        for &v in &idx {
            if used.contains_key(&v) {
                continue;
            }
            used.insert(v, bld.count() as u32);
            bld.vert(at64(&pts, v as usize), at64(&nn, v as usize), 0.0, 0.0, shade, &head_w);
        }
        bld.idx.extend(idx.iter().map(|v| used[v]));
    };
    grid(&mut b.plate, &|i, j| !in_band(i, j), 0.0, 1.0);
    // The open lower edge folds inwards so the shell has thickness when seen from below.
    for j in 0..cols {
        let i = rows;
        let base = b.plate.count() as u32;
        for jj in [j, j + 1] {
            let d = dir_of(shell.theta(i as f64, jj), jj as f64 / cols as f64 * PI * 2.0);
            let rr = shell.rad(i, jj);
            b.plate.vert(add(cc, mul(d, rr)), [0.0, -1.0, 0.0], 0.0, 0.0, 0.7, &head_w);
            b.plate.vert(add(cc, mul(d, rr - 0.012)), [0.0, -1.0, 0.0], 0.0, 0.0, 0.5, &head_w);
        }
        b.plate.idx.extend_from_slice(&[base, base + 2, base + 1, base + 1, base + 2, base + 3]);
    }
    if band.is_some() {
        grid(&mut b.visor, &in_band, -recess, 1.0);
        // Walls between the shell and the recessed visor.
        for i in 0..=rows {
            for j in 0..cols {
                let mut edges: Vec<[usize; 4]> = Vec::new();
                // Vertical edge at column j between cells (i, j-1) and (i, j); horizontal edge at row i between (i-1, j) and (i, j).
                if i < rows && in_band(i, j) != in_band(i, (j + cols - 1) % cols) {
                    edges.push([i, j, i + 1, j]);
                }
                if i > 0 && in_band(i, j) != in_band(i - 1, j) {
                    edges.push([i, j, i, j + 1]);
                }
                for [i0, j0, i1, j1] in edges {
                    let p0 = vtx(i0, j0 % cols, shell.rad(i0, j0));
                    let p1 = vtx(i1, j1 % cols, shell.rad(i1, j1));
                    let q0 = add(cc, mul(norm(sub(p0, cc)), len(sub(p0, cc)) - recess));
                    let q1 = add(cc, mul(norm(sub(p1, cc)), len(sub(p1, cc)) - recess));
                    let nn = norm(cross(sub(p1, p0), sub(q0, p0)));
                    let base = b.trim.count() as u32;
                    for p in [p0, p1, q0, q1] {
                        b.trim.vert(p, nn, 0.0, 0.0, 0.6, &head_w);
                    }
                    b.trim.idx.extend_from_slice(&[
                        base,
                        base + 1,
                        base + 2,
                        base + 1,
                        base + 3,
                        base + 2,
                        base,
                        base + 2,
                        base + 1,
                        base + 1,
                        base + 2,
                        base + 3,
                    ]);
                }
            }
        }
        if c.head == "visor" {
            // A light bar across the visor at eye height.
            let base = b.glow.count() as u32;
            let half = js_round(half_cols as f64 * 0.82) as i64;
            for th in [theta_e - 0.012, theta_e + 0.012] {
                for jj in -half..=half {
                    let ph = jj as f64 / cols as f64 * PI * 2.0;
                    let d = dir_of(th, ph);
                    b.glow.vert(add(cc, mul(d, shell.at(d) - recess + 0.0009)), d, 0.0, 0.0, 1.0, &head_w);
                }
            }
            let n = (half * 2 + 1) as u32;
            for k in 0..n - 1 {
                b.glow.idx.extend_from_slice(&[base + k, base + n + k, base + k + 1, base + k + 1, base + n + k, base + n + k + 1]);
            }
        } else {
            // Mono-eye: one round lens in the middle of the slit.
            let d = dir_of(theta_e, 0.0);
            annulus(&mut b.glow, add(cc, mul(d, shell.at(d) - recess + 0.0012)), d, 0.0, ipd * 0.2, &head_w, 28, 0.002);
        }
    }
    if c.head == "optics" || c.head == "android" {
        for e in [el, er] {
            let d = norm(sub(e, cc));
            let surf = add(cc, mul(d, shell.at(d)));
            if c.head == "optics" {
                let rr = ipd * 0.3;
                cylinder(&mut b.joint, add(surf, mul(d, -0.006)), add(surf, mul(d, 0.004)), rr, &head_w, 28);
                annulus(&mut b.glow, add(surf, mul(d, 0.0042)), d, 0.0, rr * 0.7, &head_w, 28, 0.0015);
            } else {
                annulus(&mut b.glow, add(surf, mul(d, 0.0006)), d, 0.0, ipd * 0.17, &head_w, 24, 0.001);
            }
        }
    }
    // Ears.
    let ear_theta = theta_e + 0.12;
    for side in [1.0, -1.0] {
        let d = dir_of(ear_theta, side * PI / 2.0);
        let surf = add(cc, mul(d, shell.at(d)));
        let big_r = shell.r;
        match c.ears.as_str() {
            "pods" | "antennae" => {
                let pods = c.ears == "pods";
                let pr = big_r * if pods { 0.3 } else { 0.2 };
                let out = add(surf, mul(d, if pods { 0.011 } else { 0.007 }));
                cylinder(&mut b.trim, add(surf, mul(d, -0.01)), out, pr, &head_w, 28);
                annulus(&mut b.glow, add(out, mul(d, 0.0004)), d, pr * 0.55, pr * 0.78, &head_w, 28, 0.0);
                if !pods {
                    let q0 = add(out, [0.0, pr * 0.4, -pr * 0.2]);
                    let q1 = add(q0, mul(norm([side * 0.12, 1.0, -0.4]), big_r * 0.85));
                    cylinder(&mut b.joint, q0, q1, 0.0022, &head_w, 10);
                    sphere(&mut b.glow, q1, 0.0055, &head_w, 10, 16);
                }
            }
            "fins" => {
                let root = add(surf, mul(d, -0.004));
                let pts: Vec<Vec3> = (0..=10)
                    .map(|k| {
                        let t = k as f64 / 10.0;
                        add(root, [side * big_r * 0.08 * t, big_r * (0.12 * t + 0.35 * t * t), -big_r * 0.95 * t])
                    })
                    .collect();
                sweep(
                    &mut b.trim,
                    &pts,
                    |t| 0.0045 * (1.0 - t * 0.6),
                    |t| big_r * 0.24 * (1.0 - t * 0.85) + 0.002,
                    [1.0, 0.0, 0.0],
                    &head_w,
                    14,
                );
                annulus(&mut b.glow, add(surf, mul(d, 0.003)), d, 0.0, big_r * 0.09, &head_w, 20, 0.001);
            }
            _ => {}
        }
    }
}

// ------------------------------------------------------------------ joints

const Z: Vec3 = [0.0, 0.0, 1.0];

fn hinge_axis(d: Vec3, fallback: Vec3) -> Vec3 {
    let a = cross(d, Z);
    if len(a) > 0.2 {
        norm(a)
    } else {
        fallback
    }
}

struct Joints<'a, 'b> {
    body: &'a RobotBody<'b>,
    r: &'a Rig<'b>,
    plate_thick: f64,
}

impl Joints<'_, '_> {
    /// A hinge housing across the limb at bone `child`'s head, with glowing caps.
    #[allow(clippy::too_many_arguments)]
    fn hinge(&self, b: &mut Builders, child: &str, parent: &str, axis: Vec3, scale: f64, glow: bool, own: bool, thick: f64) {
        let r = self.r;
        if !r.has(child) || !r.has(parent) {
            return;
        }
        let j = r.head(child);
        let d = r.dir(child);
        let segs = if own { vec![r.seg_of(child)] } else { vec![r.seg_of(child), r.seg_of(parent)] };
        let (radius, cs_half) = cross_section(self.body, r, j, d, &segs, Some(axis));
        if radius == 0.0 {
            return;
        }
        let half = (cs_half + thick * 0.35) * scale;
        let rad = (radius * 0.62).min(half * 0.75) * scale;
        let a = add(j, mul(axis, -half));
        let c = add(j, mul(axis, half));
        let w = r.rigid(child);
        cylinder(&mut b.joint, a, c, rad, &w, 24);
        if glow {
            for (p, n) in [(c, axis), (a, mul(axis, -1.0))] {
                annulus(&mut b.glow, add(p, mul(n, 0.0004)), n, rad * 0.5, rad * 0.68, &w, 24, 0.0);
            }
        }
    }
    fn ball(&self, b: &mut Builders, child: &str, parent: &str, k: f64) {
        let r = self.r;
        if !r.has(child) || !r.has(parent) {
            return;
        }
        let j = r.head(child);
        let (radius, _) = cross_section(self.body, r, j, r.dir(child), &[r.seg_of(child), r.seg_of(parent)], None);
        if radius != 0.0 {
            sphere(&mut b.joint, j, radius * k, &r.rigid(child), 14, 20);
        }
    }
}

fn build_joints(body: &RobotBody, r: &Rig, b: &mut Builders, plate_thick: f64) {
    let jt = Joints { body, r, plate_thick };
    let t = jt.plate_thick;
    for s in ["l", "r"] {
        let x: Vec3 = [if s == "l" { 1.0 } else { -1.0 }, 0.0, 0.0];
        let n = |b: &str| format!("{b}_{s}");
        jt.ball(b, &n("upperarm"), &n("upperarm"), 0.92);
        let la = n("lowerarm");
        jt.hinge(b, &la, &n("upperarm"), hinge_axis(r.dir(&la), r.x_axis(&la)), 1.0, true, false, t);
        jt.ball(b, &n("hand"), &la, 0.85);
        // Hip actuator: a drum on the outside of the hip joint.
        let thigh = n("thigh");
        if r.has(&thigh) {
            let j = r.head(&thigh);
            let pos = body.positions;
            let mut out: f64 = 0.0;
            let (radius, _) = cross_section(body, r, j, r.dir(&thigh), &[r.seg_of(&thigh)], None);
            let (pelvis, ts) = (r.seg_of("pelvis"), r.seg_of(&thigh));
            for v in 0..pos.len() / 3 {
                let p = at(pos, v);
                if body.used[v] == 0 || (p[1] - j[1]).abs() > 0.015 || (p[2] - j[2]).abs() > 0.02 {
                    continue;
                }
                let sg = first_seg(body, r, v);
                if sg != pelvis && sg != ts {
                    continue;
                }
                out = out.max((p[0] - j[0]) * x[0]);
            }
            if out > 0.0 && radius != 0.0 {
                let rad = radius * 0.42;
                let a = add(j, mul(x, out * 0.55));
                let c = add(j, mul(x, out + t * 0.6));
                let w = r.rigid(&thigh);
                cylinder(&mut b.joint, a, c, rad, &w, 28);
                annulus(&mut b.glow, add(c, mul(x, 0.0004)), x, rad * 0.5, rad * 0.68, &w, 24, 0.0);
            }
        }
        let calf = n("calf");
        jt.hinge(b, &calf, &thigh, hinge_axis(r.dir(&calf), x), 1.0, true, false, t);
        jt.hinge(b, &n("foot"), &calf, hinge_axis(r.dir(&calf), x), 0.9, false, false, t);
        jt.hinge(b, &n("ball"), &n("foot"), x, 0.9, false, false, t);
        // Fingers: hinges across the knuckle line.
        let knuckles =
            if r.has(&n("index_01")) && r.has(&n("pinky_01")) { norm(sub(r.head(&n("pinky_01")), r.head(&n("index_01")))) } else { x };
        for f in ["index", "middle", "ring", "pinky", "thumb"] {
            for k in 1..=3 {
                let child = format!("{f}_0{k}_{s}");
                let parent = if k == 1 { n("hand") } else { format!("{f}_0{}_{s}", k - 1) };
                if !r.has(&child) {
                    continue;
                }
                let axis = if f == "thumb" { r.x_axis(&child) } else { hinge_axis(r.dir(&child), knuckles) };
                let axis = if f == "thumb" || dot(axis, knuckles) >= 0.0 { axis } else { mul(axis, -1.0) };
                jt.hinge(b, &child, &parent, axis, 0.72, false, true, 0.0026);
            }
        }
    }
    // Neck: stacked collars from the shoulders to the skull.
    if r.has("neck_01") {
        let a = r.head("neck_01");
        let h = r.head("head");
        let d = norm(sub(h, a));
        let (radius, _) = cross_section(body, r, lerp3(a, h, 0.5), d, &[r.seg_of("neck_01"), r.seg_of("head")], None);
        let (nb, hb) = (r.at_bone("neck_01") as u16, r.at_bone("head") as u16);
        for t in [0.15, 0.45, 0.75] {
            let c = lerp3(a, h, t);
            cylinder(
                &mut b.joint,
                add(c, mul(d, -0.005)),
                add(c, mul(d, 0.005)),
                radius * 0.88,
                &vec![(nb, 1.0 - t * 0.8), (hb, t * 0.8)],
                28,
            );
        }
    }
    // Waist: a ring of the frame showing between abdomen and pelvis is enough; add a slim actuator ring.
    if r.has("spine_01") {
        let a = r.head("spine_01");
        let (radius, _) = cross_section(body, r, a, r.dir("spine_01"), &[r.seg_of("spine_01"), r.seg_of("pelvis")], None);
        if radius != 0.0 {
            let w = vec![(r.at_bone("spine_01") as u16, 0.5), (r.at_bone("pelvis") as u16, 0.5)];
            cylinder(&mut b.joint, add(a, [0.0, -0.007, 0.0]), add(a, [0.0, 0.007, 0.0]), radius * 0.97, &w, 40);
        }
    }
}

/// Segmented plating leaves the abdomen open: a stack of elliptical actuator rings over the
/// frame, each blended between pelvis and chest so the waist still bends.
fn build_spine_rings(body: &RobotBody, r: &Rig, b: &mut Builders) {
    if !r.has("spine_01") || !r.has("spine_03") {
        return;
    }
    let y0 = r.head("spine_01")[1] + 0.005;
    let y1 = lerp3(r.head("spine_02"), r.head("spine_03"), 0.7)[1];
    let torso: Vec<i32> = ["pelvis", "spine_01", "spine_02", "spine_03"].iter().filter(|n| r.has(n)).map(|n| r.seg_of(n)).collect();
    let pos = body.positions;
    let count = 6;
    for k in 0..count {
        let t = (k as f64 + 0.5) / count as f64;
        let y = y0 + (y1 - y0) * t;
        // The body's outline at this height: furthest skin per angle around the centre, smoothed.
        let radial = 48;
        let mut sel = Vec::new();
        let (mut cx, mut cz) = (0.0, 0.0);
        for v in 0..pos.len() / 3 {
            if body.used[v] == 0 || (pos[v * 3 + 1] as f64 - y).abs() > 0.008 || !torso.contains(&first_seg(body, r, v)) {
                continue;
            }
            sel.push(v);
            cx += pos[v * 3] as f64;
            cz += pos[v * 3 + 2] as f64;
        }
        if sel.len() < 12 {
            continue;
        }
        cx /= sel.len() as f64;
        cz /= sel.len() as f64;
        let mut rad = vec![0.0f64; radial];
        for &v in &sel {
            let (dx, dz) = (pos[v * 3] as f64 - cx, pos[v * 3 + 2] as f64 - cz);
            let bin = js_round((dz.atan2(dx) + PI * 2.0) / (PI * 2.0) * radial as f64) as usize % radial;
            rad[bin] = rad[bin].max(dx.hypot(dz));
        }
        for j in 0..radial {
            if rad[j] == 0.0 {
                rad[j] = rad[(j + radial - 1) % radial].max(rad[(j + 1) % radial]);
            }
        }
        for _ in 0..2 {
            let prev = rad.clone();
            for j in 0..radial {
                rad[j] = prev[j].max((prev[(j + radial - 1) % radial] + prev[j] * 2.0 + prev[(j + 1) % radial]) / 4.0);
            }
        }
        let (pelvis, s1, s2) = (r.at_bone("pelvis") as u16, r.at_bone("spine_01") as u16, r.at_bone("spine_02") as u16);
        let w: Weights =
            if t < 0.5 { vec![(pelvis, 1.0 - t * 2.0), (s1, t * 2.0)] } else { vec![(s1, 2.0 - t * 2.0), (s2, t * 2.0 - 1.0)] };
        let (h, inset) = (0.0075, 0.008);
        let base = b.joint.count() as u32;
        // Per angle: outer bottom, outer top, top face (outer, inner), bottom face (outer, inner).
        for j in 0..=radial {
            let a = j as f64 / radial as f64 * PI * 2.0;
            let (ca, sa) = (a.cos(), a.sin());
            let rr = rad[j % radial] + 0.0035;
            let n = norm([ca, 0.0, sa]);
            let o = [cx + ca * rr, y, cz + sa * rr];
            let i = [cx + ca * (rr - inset), y, cz + sa * (rr - inset)];
            let (up, down) = ([0.0, h, 0.0], [0.0, -h, 0.0]);
            for (p, nn) in [
                (add(o, down), n),
                (add(o, up), n),
                (add(o, up), [0.0, 1.0, 0.0]),
                (add(i, up), [0.0, 1.0, 0.0]),
                (add(o, down), [0.0, -1.0, 0.0]),
                (add(i, down), [0.0, -1.0, 0.0]),
            ] {
                b.joint.vert(p, nn, 0.0, 0.0, 1.0, &w);
            }
        }
        for j in 0..radial as u32 {
            let a = base + j * 6;
            let c = a + 6;
            b.joint.idx.extend_from_slice(&[a, a + 1, c, a + 1, c + 1, c]); // outer wall
            b.joint.idx.extend_from_slice(&[a + 2, c + 2, a + 3, a + 3, c + 2, c + 3]); // top
            b.joint.idx.extend_from_slice(&[a + 4, a + 5, c + 4, a + 5, c + 5, c + 4]);
            // bottom
        }
    }
}

/// The chest light: a metal bezel and a domed glowing lens on the sternum plate.
fn build_core(body: &RobotBody, r: &Rig, b: &mut Builders, plate_out: f64) {
    let top = if r.has("neck_01") { r.head("neck_01") } else { r.head("head") };
    let chest = if r.has("spine_03") { "spine_03" } else { "spine_02" };
    if !r.has(chest) {
        return;
    }
    let y = lerp3(r.head(chest), top, 0.32)[1];
    let pos = body.positions;
    let (mut best, mut bz) = (None, f64::NEG_INFINITY);
    for v in 0..pos.len() / 3 {
        let p = at(pos, v);
        if body.used[v] == 0 || p[0].abs() > 0.012 || (p[1] - y).abs() > 0.012 {
            continue;
        }
        if p[2] > bz {
            bz = p[2];
            best = Some(v);
        }
    }
    let Some(best) = best else { return };
    let n = [0.0, 0.0, 1.0];
    let c = [0.0, pos[best * 3 + 1] as f64, bz + plate_out + 0.004];
    let w = r.rigid(chest);
    cylinder(&mut b.joint, add(c, mul(n, -0.02)), add(c, mul(n, 0.003)), 0.032, &w, 32);
    annulus(&mut b.glow, add(c, mul(n, 0.0032)), n, 0.0, 0.022, &w, 32, 0.004);
}

// ------------------------------------------------------------------ frame

/// The inner frame: the body surface itself (UV seams kept), with head vertices pulled inside the helmet.
fn build_frame(body: &RobotBody, r: &Rig, shell: &HeadShell, bld: &mut Builder) {
    let hs = r.seg_of("head");
    for (i, &v) in body.map.iter().enumerate() {
        let v = v as usize;
        let mut p = at(body.positions, v);
        if membership(body, r, v, hs) > 0.3 {
            let rel = sub(p, shell.c);
            let d = norm(rel);
            let th = d[1].clamp(-1.0, 1.0).acos();
            let mut ph = d[0].atan2(d[2]);
            if ph < 0.0 {
                ph += PI * 2.0;
            }
            if th < limit(ph) {
                let lim = shell.at(d) - 0.006;
                if len(rel) > lim {
                    p = add(shell.c, mul(d, lim));
                }
            }
        }
        let mut w: Weights =
            (0..4).filter(|&k| body.weights[v * 4 + k] > 0.0).map(|k| (body.joints[v * 4 + k], body.weights[v * 4 + k] as f64)).collect();
        if w.is_empty() {
            w.push((0, 1.0));
        }
        bld.vert(p, at(body.normals, v), body.uv[i * 2] as f64, body.uv[i * 2 + 1] as f64, 1.0, &w);
    }
    bld.idx.extend_from_slice(body.indices);
}

// ------------------------------------------------------------------ entry

/// Builds every robot part for a body (see the module comment). Colours are set by the renderer
/// per part kind ("plate", "trim", "frame", "joint", "visor", "glow").
pub fn build_robot(body: &RobotBody, config: &RobotConfig) -> RobotParts {
    let c = config.sanitized();
    let r = Rig::new(body.skeleton);
    let style = PlateStyle::new(&c);
    let mut b = Builders {
        plate: Builder::new(),
        trim: Builder::new(),
        frame: Builder::new(),
        joint: Builder::new(),
        visor: Builder::new(),
        glow: Builder::new(),
    };
    let head_seg = r.seg_of("head");
    let neck_seg = if r.has("neck_01") { r.seg_of("neck_01") } else { -2 };
    // Segmented plating shows the abdomen's actuator rings instead of a plate.
    let open: Vec<i32> = if c.plating == "segmented" {
        ["spine_01", "spine_02"].iter().filter(|n| r.has(n)).map(|n| r.seg_of(n)).collect()
    } else {
        Vec::new()
    };
    // Candidate triangles per segment: any vertex with a noticeable weight on it.
    let nv = body.positions.len() / 3;
    let mut vseg = vec![-1i32; nv * 4];
    for v in 0..nv {
        for q in 0..4 {
            if body.weights[v * 4 + q] <= 0.2 {
                continue;
            }
            let sg = r.seg[body.joints[v * 4 + q] as usize];
            if sg != head_seg && sg != neck_seg && !open.contains(&sg) {
                vseg[v * 4 + q] = sg;
            }
        }
    }
    let bones = r.sk.names.len();
    let mut per_seg: Vec<Vec<usize>> = vec![Vec::new(); bones];
    let mut last = vec![usize::MAX; bones];
    let tris = &body.triangles;
    for t in (0..tris.len()).step_by(3) {
        for k in 0..12 {
            let sg = vseg[tris[t + (k >> 2)] as usize * 4 + (k & 3)];
            if sg < 0 || last[sg as usize] == t {
                continue;
            }
            last[sg as usize] = t;
            per_seg[sg as usize].push(t);
        }
    }
    for (s, list) in per_seg.iter().enumerate() {
        if list.is_empty() {
            continue;
        }
        let name = r.sk.names[s].as_str();
        let target = if is_trim(name) { &mut b.trim } else { &mut b.plate };
        if name.starts_with("ball_") && build_toe_cap(body, &r, s as i32, style.thick, target) {
            continue;
        }
        build_plate(body, &r, s as i32, list, &style, target);
    }
    let shell = head_shell(body, &r, c.head == "android", 0.0035 + style.thick * 0.5);
    build_head(body, &r, &c, &shell, &mut b);
    build_joints(body, &r, &mut b, style.thick);
    if !open.is_empty() {
        build_spine_rings(body, &r, &mut b);
    }
    if c.core {
        build_core(body, &r, &mut b, 0.0025 + style.thick);
    }
    build_frame(body, &r, &shell, &mut b.frame);
    let mut parts = Vec::new();
    for (kind, name, bld) in [
        (PartKind::Frame, "frame", b.frame),
        (PartKind::Plate, "plate", b.plate),
        (PartKind::Trim, "trim", b.trim),
        (PartKind::Joint, "joint", b.joint),
        (PartKind::Visor, "visor", b.visor),
        (PartKind::Glow, "glow", b.glow),
    ] {
        if bld.count() > 0 {
            parts.push(bld.build(&format!("robot-{name}"), kind, None));
        }
    }
    let mut body_min = f64::INFINITY;
    for v in 0..nv {
        if body.used[v] != 0 {
            body_min = body_min.min(body.positions[v * 3 + 1] as f64);
        }
    }
    let part_min = parts.iter().flat_map(|p| p.positions.iter().skip(1).step_by(3)).fold(f64::INFINITY, |m, &y| m.min(y as f64));
    RobotParts { parts, lift: (body_min - part_min).max(0.0) }
}
