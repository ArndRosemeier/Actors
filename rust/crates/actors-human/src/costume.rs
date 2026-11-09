//! Hero costume parts generated from the current body shape (port of
//! `packages/human/src/costume.ts`): a cape (with a collar) on chains of bones so it can swing,
//! masks (domino, bandit, cowl), a belt (plain, with a buckle, or a utility belt with pouches)
//! and a raised chest emblem.
//!
//! Masks, belts, buckles and emblems are shells cut from the body surface: the body triangles of
//! a region, subdivided, cut along a signed field (an iso-line, so the edge does not follow the
//! mesh), lifted off the skin and given a thin edge wall. The cape is draped over the back: at
//! each height it lies just outside the furthest-back point of the body above it.
//!
//! Deterministic, and the same numbers as the TypeScript builders (golden test `tests/parts.rs`).

use crate::emblem::plate_distance;
use crate::parts::{Builder, PartsBody, Weights, NO_ANCHOR};
use actors_core::math::Vec3;
use actors_core::parts::{PartBone, PartKind, PartMesh};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::f64::consts::PI;
use std::rc::Rc;

pub const CAPE_STYLES: [&str; 6] = ["none", "short", "classic", "long", "scalloped", "pointed"];
pub const COLLAR_STYLES: [&str; 3] = ["none", "standing", "flared"];
pub const MASK_STYLES: [&str; 4] = ["none", "domino", "bandit", "cowl"];
pub const BELT_STYLES: [&str; 4] = ["none", "plain", "buckle", "utility"];

/// Cape bone chains (right, centre, left as the wearer sees them), each root to hem.
pub const CAPE_CHAINS: [&str; 3] = ["r", "c", "l"];
pub const CAPE_LINKS: usize = 5;

/// Cape bone names, chain by chain, root to hem (`cape_r_1` ... `cape_l_5`).
pub fn cape_bones() -> Vec<String> {
    CAPE_CHAINS.iter().flat_map(|s| (1..=CAPE_LINKS).map(move |k| format!("cape_{s}_{k}"))).collect()
}

/// The costume pieces of a character (styles by name, colours sRGB 0..1).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CostumeParts {
    pub cape: String,
    /// A collar on the cape (no cape, no collar).
    pub collar: String,
    pub cape_color: [f64; 3],
    pub lining_color: [f64; 3],
    pub mask: String,
    pub mask_color: [f64; 3],
    pub belt: String,
    pub belt_color: [f64; 3],
    pub buckle_color: [f64; 3],
    pub emblem: String,
    /// The symbol on the emblem; a "cutout" emblem has the symbol's outline.
    pub symbol: String,
    /// 0..1
    pub emblem_size: f64,
    /// Colour of the emblem's raised rim.
    pub rim_color: [f64; 3],
}

impl Default for CostumeParts {
    fn default() -> Self {
        Self {
            cape: "none".into(),
            collar: "none".into(),
            cape_color: [0.78, 0.13, 0.16],
            lining_color: [0.95, 0.76, 0.19],
            mask: "none".into(),
            mask_color: [0.12, 0.16, 0.42],
            belt: "none".into(),
            belt_color: [0.95, 0.76, 0.19],
            buckle_color: [0.85, 0.87, 0.89],
            emblem: "none".into(),
            symbol: "bolt".into(),
            emblem_size: 0.5,
            rim_color: [0.95, 0.76, 0.19],
        }
    }
}

/// True if the costume adds any part.
pub fn has_costume(c: Option<&CostumeParts>) -> bool {
    c.is_some_and(|c| c.cape != "none" || c.mask != "none" || c.belt != "none" || c.emblem != "none")
}

/// A cowl covers the head: the hair (and brows) under it are not drawn.
pub fn costume_hides_hair(c: Option<&CostumeParts>) -> bool {
    c.is_some_and(|c| c.mask == "cowl")
}

fn add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn mul(a: Vec3, s: f64) -> Vec3 {
    [a[0] * s, a[1] * s, a[2] * s]
}
fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn len(a: Vec3) -> f64 {
    (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt()
}
fn norm(a: Vec3) -> Vec3 {
    let l = len(a);
    let l = if l == 0.0 { 1.0 } else { l };
    [a[0] / l, a[1] / l, a[2] / l]
}
fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn smoothstep(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}
/// JavaScript's `Math.round`.
fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}
fn clampi(x: i64, a: i64, b: i64) -> usize {
    x.clamp(a, b) as usize
}

/// What the costume builders read from the body.
struct Body<'a> {
    b: &'a PartsBody<'a>,
    n: usize,
    /// Dominant bone per base vertex (-1 off the body surface).
    dom: Vec<i32>,
    mid: Vec3,
    ipd: f64,
    height: f64,
}

impl<'a> Body<'a> {
    fn new(b: &'a PartsBody<'a>) -> Self {
        let n = b.positions.len() / 3;
        let mut dom = vec![-1; n];
        let (mut top, mut bottom) = (f64::NEG_INFINITY, f64::INFINITY);
        for v in 0..n {
            if b.is_body[v] == 0 {
                continue;
            }
            let mut best = 0;
            for k in 1..4 {
                if b.weights[v * 4 + k] > b.weights[v * 4 + best] {
                    best = k;
                }
            }
            dom[v] = b.joints[v * 4 + best] as i32;
            let y = b.positions[v * 3 + 1] as f64;
            top = top.max(y);
            bottom = bottom.min(y);
        }
        let [el, er] = b.eyes;
        let d = len(sub(el, er));
        Self { b, n, dom, mid: mul(add(el, er), 0.5), ipd: if d == 0.0 { 0.064 } else { d }, height: top - bottom }
    }
    fn bone(&self, name: &str) -> i32 {
        self.b.skeleton.names.iter().position(|x| x == name).unwrap_or(0) as i32
    }
    fn head(&self, name: &str) -> Vec3 {
        self.b.skeleton.heads[self.bone(name) as usize]
    }
    fn name(&self, bone: i32) -> &str {
        &self.b.skeleton.names[bone as usize]
    }
    fn at(&self, v: usize) -> Vec3 {
        let p = self.b.positions;
        [p[v * 3] as f64, p[v * 3 + 1] as f64, p[v * 3 + 2] as f64]
    }
}

/// Skin weights in insertion order, summed per bone (a small `Map<bone, weight>`).
#[derive(Clone, Default)]
struct WMap(Vec<(u16, f64)>);

impl WMap {
    fn put(&mut self, j: u16, x: f64) {
        match self.0.iter_mut().find(|e| e.0 == j) {
            Some(e) => e.1 += x,
            None => self.0.push((j, 0.0 + x)),
        }
    }
}

/// Up to four (bone, weight) pairs, heaviest first (ties: lower bone first).
fn top4(w: &WMap) -> Weights {
    let mut list: Vec<(u16, f64)> = w.0.iter().copied().filter(|x| x.1 > 1e-6).collect();
    list.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap().then(a.0.cmp(&b.0)));
    list.truncate(4);
    list
}

// ------------------------------------------------------------------ shells cut from the body

/// A point of a shell: on the body surface, with its skinning and the base vertex it follows.
struct Sv {
    p: Vec3,
    n: Vec3,
    w: WMap,
    a: u32,
    key: String,
}

type Field<'f> = &'f dyn Fn(Vec3, Vec3) -> f64;

struct ShellOpts<'f> {
    /// Base vertices the shell may cover (all three corners of a triangle must).
    pick: &'f dyn Fn(usize) -> bool,
    /// Signed field in meters: > 0 on the shell.
    value: Field<'f>,
    offset: f64,
    subdiv: u32,
    rim: f64,
    uv: Option<&'f dyn Fn(Vec3) -> (f64, f64)>,
    follow: bool,
    shade: f64,
}

fn mix(a: &Sv, b: &Sv, t: f64, key: String) -> Sv {
    let mut w = WMap::default();
    for &(j, x) in &a.w.0 {
        w.put(j, x * (1.0 - t));
    }
    for &(j, x) in &b.w.0 {
        w.put(j, x * t);
    }
    Sv { p: add(a.p, mul(sub(b.p, a.p), t)), n: norm(add(mul(a.n, 1.0 - t), mul(b.n, t))), w, a: if t < 0.5 { a.a } else { b.a }, key }
}

struct Shell<'s, 'f> {
    bd: &'s Body<'s>,
    o: &'s ShellOpts<'f>,
    base: HashMap<usize, Rc<Sv>>,
    values: HashMap<String, f64>,
    mids: HashMap<String, Rc<Sv>>,
    index: HashMap<String, u32>,
    tri: Vec<u32>,
}

impl Shell<'_, '_> {
    fn sv(&mut self, v: usize) -> Rc<Sv> {
        if let Some(s) = self.base.get(&v) {
            return s.clone();
        }
        let b = self.bd.b;
        let mut w = WMap::default();
        for k in 0..4 {
            let x = b.weights[v * 4 + k] as f64;
            if x > 0.0 {
                w.put(b.joints[v * 4 + k], x);
            }
        }
        let nr = b.normals;
        let n = norm([nr[v * 3] as f64, nr[v * 3 + 1] as f64, nr[v * 3 + 2] as f64]);
        let s = Rc::new(Sv { p: self.bd.at(v), n, w, a: v as u32, key: v.to_string() });
        self.base.insert(v, s.clone());
        s
    }
    fn value(&mut self, s: &Sv) -> f64 {
        if let Some(&x) = self.values.get(&s.key) {
            return x;
        }
        let x = (self.o.value)(s.p, s.n);
        self.values.insert(s.key.clone(), x);
        x
    }
    fn mid(&mut self, a: &Rc<Sv>, b: &Rc<Sv>) -> Rc<Sv> {
        let (p, q) = if a.key < b.key { (a, b) } else { (b, a) };
        let key = format!("{}|{}", p.key, q.key);
        if let Some(m) = self.mids.get(&key) {
            return m.clone();
        }
        let m = Rc::new(mix(p, q, 0.5, key.clone()));
        self.mids.insert(key, m.clone());
        m
    }
    fn emit(&mut self, s: &Sv, out: &mut Builder) -> u32 {
        if let Some(&i) = self.index.get(&s.key) {
            return i;
        }
        let i = out.count() as u32;
        self.index.insert(s.key.clone(), i);
        let uv = self.o.uv.map_or((0.5, 0.5), |f| f(s.p));
        out.follow = if self.o.follow { s.a } else { NO_ANCHOR };
        out.vert(add(s.p, mul(s.n, self.o.offset)), s.n, uv.0, uv.1, self.o.shade, &top4(&s.w));
        i
    }
    fn cut(&mut self, a: &Rc<Sv>, b: &Rc<Sv>) -> Rc<Sv> {
        let (p, q) = if a.key < b.key { (a, b) } else { (b, a) };
        let (vp, vq) = (self.value(p), self.value(q));
        let key = format!("{}~{}", p.key, q.key);
        Rc::new(mix(p, q, vp / (vp - vq), key))
    }
    fn clip(&mut self, t: [Rc<Sv>; 3], out: &mut Builder) {
        let mut poly: Vec<Rc<Sv>> = Vec::new();
        for i in 0..3 {
            let (a, b) = (&t[i], &t[(i + 1) % 3]);
            let (va, vb) = (self.value(a), self.value(b));
            if va >= 0.0 {
                poly.push(a.clone());
            }
            if (va >= 0.0) != (vb >= 0.0) {
                let c = self.cut(a, b);
                poly.push(c);
            }
        }
        if poly.len() < 3 {
            return;
        }
        let ids: Vec<u32> = poly.iter().map(|s| self.emit(s, out)).collect();
        for i in 1..ids.len() - 1 {
            self.tri.extend_from_slice(&[ids[0], ids[i], ids[i + 1]]);
        }
    }
    fn split(&mut self, t: [Rc<Sv>; 3], depth: u32, out: &mut Builder) {
        if depth == 0 {
            return self.clip(t, out);
        }
        let [a, b, c] = t;
        let ab = self.mid(&a, &b);
        let bc = self.mid(&b, &c);
        let ca = self.mid(&c, &a);
        self.split([a, ab.clone(), ca.clone()], depth - 1, out);
        self.split([ab.clone(), b, bc.clone()], depth - 1, out);
        self.split([ca.clone(), bc.clone(), c], depth - 1, out);
        self.split([ab, bc, ca], depth - 1, out);
    }
}

/// Cuts a shell from the body (see `ShellOpts`) into `out`.
fn shell(bd: &Body, out: &mut Builder, o: &ShellOpts) {
    let mut sh =
        Shell { bd, o, base: HashMap::new(), values: HashMap::new(), mids: HashMap::new(), index: HashMap::new(), tri: Vec::new() };
    let start = out.count() as u32;
    let tris = &bd.b.triangles;
    for t in (0..tris.len()).step_by(3) {
        let v = [tris[t] as usize, tris[t + 1] as usize, tris[t + 2] as usize];
        if !v.iter().all(|&x| bd.b.is_body[x] != 0 && (o.pick)(x)) {
            continue;
        }
        let s = [sh.sv(v[0]), sh.sv(v[1]), sh.sv(v[2])];
        let m = s.iter().map(|x| sh.value(x)).fold(f64::NEG_INFINITY, f64::max);
        if m < -0.03 {
            continue;
        }
        sh.split(s, o.subdiv, out);
    }
    let tri = std::mem::take(&mut sh.tri);
    out.idx.extend_from_slice(&tri);
    if o.rim > 0.0 {
        edge_wall(out, &tri, start, o.rim);
    }
}

/// A wall down from the open edges of the triangles `tri` (vertex indices into `b`).
fn edge_wall(b: &mut Builder, tri: &[u32], start: u32, depth: f64) {
    let key = |i: u32, j: u32| if i < j { (i, j) } else { (j, i) };
    let mut count: HashMap<(u32, u32), u32> = HashMap::new();
    for t in (0..tri.len()).step_by(3) {
        for k in 0..3 {
            *count.entry(key(tri[t + k], tri[t + (k + 1) % 3])).or_insert(0) += 1;
        }
    }
    let p3 = |a: &[f64], i: usize| -> Vec3 { [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]] };
    for t in (0..tri.len()).step_by(3) {
        for k in 0..3 {
            let (i, j) = (tri[t + k], tri[t + (k + 1) % 3]);
            if i < start || j < start || count.get(&key(i, j)) != Some(&1) {
                continue;
            }
            let (iu, ju) = (i as usize, j as usize);
            let e = sub(p3(&b.pos, ju), p3(&b.pos, iu));
            let n_avg = norm(add(p3(&b.nrm, iu), p3(&b.nrm, ju)));
            let side = norm(cross(e, n_avg));
            let q = b.count() as u32;
            for (v, down) in [(iu, 0.0), (iu, 1.0), (ju, 1.0), (ju, 0.0)] {
                let w: Weights = (0..4).filter(|&k| b.jw[v * 4 + k] > 0.0).map(|k| (b.ji[v * 4 + k], b.jw[v * 4 + k])).collect();
                b.follow = b.anchor[v];
                let p = add(p3(&b.pos, v), mul(p3(&b.nrm, v), -depth * down));
                let (u, uv, sh) = (b.uv[v * 2], b.uv[v * 2 + 1], b.shade[v] * 0.82);
                b.vert(p, side, u, uv, sh, &w);
            }
            b.idx.extend_from_slice(&[q, q + 1, q + 3, q + 3, q + 1, q + 2]);
        }
    }
}

// ------------------------------------------------------------------ masks

fn is_arm(name: &str) -> bool {
    ["clavicle", "upperarm", "lowerarm", "hand", "index", "middle", "ring", "pinky", "thumb"].iter().any(|p| name.starts_with(p))
}

/// Face coordinates: (p - eye midpoint) / eye distance, z forward.
fn face_of(bd: &Body, p: Vec3) -> Vec3 {
    mul(sub(p, bd.mid), 1.0 / bd.ipd)
}

/// Distance outside an eye hole (face units, > 0 outside) for either eye.
fn eye_holes(f: Vec3, rx: f64, ry: f64) -> f64 {
    let d = |cx: f64| ((f[0] - cx) / rx).hypot((f[1] - 0.03) / ry) - 1.0;
    // Only in the face: the back of the head at eye height has no holes.
    if f[2] < -0.6 {
        1.0
    } else {
        d(0.5).min(d(-0.5)) * rx.min(ry)
    }
}

fn build_mask(bd: &Body, style: &str, out: &mut Builder) {
    let (head, neck) = (bd.bone("head"), bd.bone("neck_01"));
    let neck_base = bd.head("neck_01");
    let spine = bd.bone("spine_03");
    // The head and neck, and the top of the back the neck's edge runs over.
    let on_head = |v: usize| {
        let d = bd.dom[v];
        d == head || d == neck || (d == spine && bd.b.positions[v * 3 + 1] as f64 > neck_base[1] - 0.05)
    };
    let k = bd.ipd;
    if style == "domino" || style == "bandit" {
        let domino = style == "domino";
        let value = |p: Vec3, _n: Vec3| {
            let f = face_of(bd, p);
            let ax = f[0].abs();
            let band = if domino {
                // Swept-up wings at the temples, a dip under each eye and a narrow bridge over the nose.
                let top = 0.36 + 0.3 * smoothstep(0.55, 1.4, ax) - 0.06 * smoothstep(0.35, 0.0, ax);
                let bottom = -0.3 - 0.12 * smoothstep(0.15, 0.5, ax) * (1.0 - smoothstep(0.75, 1.25, ax))
                    + 0.42 * smoothstep(0.9, 1.45, ax)
                    + 0.05 * smoothstep(0.2, 0.0, ax);
                (f[1] - bottom).min(top - f[1]).min(1.5 - ax).min(f[2] + 1.1)
            } else {
                // A cloth band all round the head.
                (f[1] + 0.34).min(0.42 - f[1])
            };
            band.min(eye_holes(f, 0.3, 0.2)) * k
        };
        let o = ShellOpts { pick: &on_head, value: &value, offset: 0.0045, subdiv: 1, rim: 0.0035, uv: None, follow: true, shade: 1.0 };
        shell(bd, out, &o);
        if !domino {
            bandit_tails(bd, out);
        }
        return;
    }
    // Cowl: the whole head and neck but the eyes and the lower face, down to the base of the neck.
    let value = |p: Vec3, _n: Vec3| {
        let f = face_of(bd, p);
        // The lower face is open where it is inside the ellipse and in front of the jaw.
        let mouth = (f[0] / 0.95).hypot((f[1] + 1.42) / 0.72) - 1.0;
        let front = f[2] + 0.55;
        (mouth * 0.7).max(-front * 0.5).min(eye_holes(f, 0.34, 0.24)).min((p[1] - (neck_base[1] - 0.012)) / k) * k
    };
    let o = ShellOpts { pick: &on_head, value: &value, offset: 0.0055, subdiv: 0, rim: 0.004, uv: None, follow: true, shade: 1.0 };
    shell(bd, out, &o);
}

/// The knot and two tails of a bandit mask at the back of the head.
fn bandit_tails(bd: &Body, out: &mut Builder) {
    let (head, neck) = (bd.bone("head"), bd.bone("neck_01"));
    // The back of the head at eye height.
    let (mut best, mut bz) = (None, f64::INFINITY);
    for v in 0..bd.n {
        if bd.b.is_body[v] == 0 || bd.dom[v] != head {
            continue;
        }
        let p = bd.at(v);
        if p[0].abs() > 0.02 || (p[1] - bd.mid[1]).abs() > 0.015 {
            continue;
        }
        if p[2] < bz {
            bz = p[2];
            best = Some(v);
        }
    }
    if best.is_none() {
        return;
    }
    let knot = [0.0, bd.mid[1], bz - 0.012];
    for s in [-1.0, 1.0] {
        let pts: Vec<Vec3> = (0..=8)
            .map(|i| {
                let t = i as f64 / 8.0;
                add(knot, [s * (0.01 + 0.035 * t), -0.16 * t - 0.02 * t * t, -0.025 * (t * PI).sin() - 0.01 * t])
            })
            .collect();
        let base = out.count() as u32;
        for (i, &pt) in pts.iter().enumerate() {
            let t = i as f64 / (pts.len() - 1) as f64;
            let w: Weights = vec![(head as u16, 1.0 - 0.6 * t), (neck as u16, 0.6 * t)];
            let width = 0.022 * (1.0 - 0.3 * t);
            let side = norm([1.0, 0.0, s * 0.3]);
            let nrm = norm(cross(side, [0.0, -1.0, 0.0]));
            out.follow = NO_ANCHOR;
            out.vert(add(pt, mul(side, -width / 2.0)), nrm, 0.0, t, 0.92, &w);
            out.vert(add(pt, mul(side, width / 2.0)), nrm, 1.0, t, 0.92, &w);
        }
        for i in 0..pts.len() as u32 - 1 {
            let a = base + i * 2;
            out.idx.extend_from_slice(&[a, a + 2, a + 1, a + 1, a + 2, a + 3]);
            // Both sides: the tails are thin cloth.
            out.idx.extend_from_slice(&[a, a + 1, a + 2, a + 1, a + 3, a + 2]);
        }
    }
}

// ------------------------------------------------------------------ belt, buckle, emblem

fn waist_y(bd: &Body) -> f64 {
    lerp(bd.head("pelvis")[1], bd.head("spine_01")[1], 0.35)
}

fn torso_pick<'a>(bd: &'a Body<'a>) -> impl Fn(usize) -> bool + 'a {
    let (head, neck) = (bd.bone("head"), bd.bone("neck_01"));
    move |v| {
        let d = bd.dom[v];
        d >= 0 && !is_arm(bd.name(d)) && d != head && d != neck
    }
}

/// Rounded rectangle, negative inside.
fn round_rect(x: f64, y: f64, hx: f64, hy: f64, r: f64) -> f64 {
    let (qx, qy) = (x.abs() - hx + r, y.abs() - hy + r);
    qx.max(0.0).hypot(qy.max(0.0)) + qx.max(qy).min(0.0) - r
}

fn build_belt(bd: &Body, style: &str, belt: &mut Builder, buckle: &mut Builder) {
    let s = bd.height / 1.75;
    let wy = waist_y(bd);
    let half = 0.026 * s;
    let pick = torso_pick(bd);
    let band = |p: Vec3, _n: Vec3| (p[1] - (wy - half)).min(wy + half - p[1]);
    shell(bd, belt, &ShellOpts { pick: &pick, value: &band, offset: 0.02, subdiv: 1, rim: 0.012, uv: None, follow: false, shade: 1.0 });
    if style == "plain" {
        return;
    }
    // Buckle on the front of the belt.
    let utility = style == "utility";
    let plate = |x: f64, y: f64| {
        if utility {
            round_rect(x, y, 0.05 * s, 0.032 * s, 0.008 * s)
        } else {
            round_rect(x, y, 0.042 * s, 0.034 * s, 0.016 * s)
        }
    };
    let value = |p: Vec3, n: Vec3| (-plate(p[0], p[1] - wy)).min(if n[2] > 0.2 { 1.0 } else { -1.0 });
    shell(bd, buckle, &ShellOpts { pick: &pick, value: &value, offset: 0.029, subdiv: 2, rim: 0.012, uv: None, follow: false, shade: 1.0 });
    if !utility {
        return;
    }
    // Pouches round the belt.
    for a in [0.85, 1.45, 2.2] {
        for side in [-1.0, 1.0] {
            let ang = a * side;
            let value = |p: Vec3, _n: Vec3| {
                let r = p[0].hypot(p[2]);
                let t = p[0].atan2(p[2]);
                let d = t - ang;
                let d = d.sin().atan2(d.cos());
                -round_rect(d * r, p[1] - (wy - 0.006 * s), 0.034 * s, 0.03 * s, 0.008 * s)
            };
            shell(
                bd,
                belt,
                &ShellOpts { pick: &pick, value: &value, offset: 0.042, subdiv: 2, rim: 0.03, uv: None, follow: false, shade: 0.94 },
            );
        }
    }
}

fn build_emblem(bd: &Body, c: &CostumeParts, plate: &mut Builder, rim: &mut Builder) {
    let (s3, nk) = (bd.head("spine_03"), bd.head("neck_01"));
    let (cx, cy) = (0.0, lerp(s3[1], nk[1], 0.3));
    let half = (0.075 + 0.055 * c.emblem_size.clamp(0.0, 1.0)) * (bd.height / 1.75);
    let chest = s3[2];
    let pick = torso_pick(bd);
    let d = |p: Vec3| plate_distance(&c.emblem, &c.symbol, (p[0] - cx) / half, (p[1] - cy) / half) * half;
    let front = |p: Vec3, n: Vec3| if n[2] > 0.15 && p[2] > chest { 1.0 } else { -1.0 };
    let rim_w = if c.emblem == "cutout" { 0.004 } else { 0.008 * (half / 0.1) };
    let uv = |p: Vec3| (0.5 + (p[0] - cx) / (2.0 * half), 0.5 + (p[1] - cy) / (2.0 * half));
    let pv = |p: Vec3, n: Vec3| (-d(p) - rim_w).min(front(p, n));
    shell(
        bd,
        plate,
        &ShellOpts { pick: &pick, value: &pv, offset: 0.017, subdiv: 2, rim: 0.012, uv: Some(&uv), follow: false, shade: 1.0 },
    );
    let rv = |p: Vec3, n: Vec3| {
        let x = d(p);
        (-x).min(x + rim_w + 0.0015).min(front(p, n))
    };
    shell(bd, rim, &ShellOpts { pick: &pick, value: &rv, offset: 0.0195, subdiv: 2, rim: 0.016, uv: Some(&uv), follow: false, shade: 1.0 });
}

// ------------------------------------------------------------------ cape

struct CapeGrid {
    cols: usize,
    rows: usize,
    p: Vec<Vec3>,
    n: Vec<Vec3>,
    shade: Vec<f64>,
    /// Normalized column position -1..1 and row 0..1 per point.
    s: Vec<f64>,
    v: Vec<f64>,
}

struct Cand {
    phi: f64,
    r: f64,
    y: f64,
}

fn cape_grid(bd: &Body, style: &str) -> CapeGrid {
    let k = bd.height / 1.75;
    // The axis the cape wraps round: the middle of the chest (the spine's joints lie near the back).
    let z_a = bd.head("spine_03")[2] + 0.07 * k;
    let shoulder_y = bd.head("upperarm_l")[1];
    let neck_head = bd.head("neck_01");
    // The body the cape rests on: torso, hips, legs and the tops of the shoulders.
    let mut cand = Vec::new();
    for v in 0..bd.n {
        let d = bd.dom[v];
        if d < 0 {
            continue;
        }
        let name = bd.name(d);
        if name == "head" || ["lowerarm", "hand", "index", "middle", "ring", "pinky", "thumb"].iter().any(|x| name.starts_with(x)) {
            continue;
        }
        let p = bd.at(v);
        // The neck's weights reach down over the trapezius: keep those, not the neck itself.
        if name == "neck_01" && p[1] > neck_head[1] + 0.01 * k {
            continue;
        }
        if name.starts_with("upperarm") && p[1] < shoulder_y - 0.03 * k {
            continue;
        }
        let dz = p[2] - z_a;
        cand.push(Cand { phi: p[0].atan2(-dz), r: p[0].hypot(dz), y: p[1] });
    }
    let sector = 0.09;
    let y_top_at = |phi: f64| {
        let mut y = f64::NEG_INFINITY;
        for q in &cand {
            if (q.phi - phi).abs() < sector && q.r > 0.03 && q.y > y {
                y = q.y;
            }
        }
        if y.is_finite() {
            y
        } else {
            shoulder_y
        }
    };
    let (knee, ankle, hip) = (bd.head("calf_l")[1], bd.head("foot_l")[1], bd.head("pelvis")[1]);
    let (hem0, flare, rows) = match style {
        "short" => (hip + 0.03 * k, 0.035, 24),
        "long" => (ankle + 0.1 * k, 0.11, 52),
        _ => (knee - 0.03 * k, 0.075, 42),
    };
    let cols = 33;
    let phi_max = |v: f64| lerp(1.42, 1.2, smoothstep(0.0, 0.35, v));
    let hem_at = |s: f64| match style {
        "scalloped" => {
            // Bat-wing scallops: points hang between shallow arcs.
            let t = ((s + 1.0) / 2.0) * 5.0;
            let f = t - t.floor();
            hem0 + 0.075 * k * (1.0 - (2.0 * f - 1.0).abs().powf(0.6)) * 0.9 - 0.02 * k
        }
        "pointed" => hem0 + 0.1 * k * s.abs() - 0.08 * k,
        _ => hem0 + 0.02 * k * s * s,
    };
    let col_s = |j: usize| (j as f64 / (cols - 1) as f64) * 2.0 - 1.0;
    let mut g = CapeGrid { cols, rows, p: Vec::new(), n: Vec::new(), shade: Vec::new(), s: Vec::new(), v: Vec::new() };
    // Column tops, then rows down with a running maximum of the body's reach (cloth falls from the
    // furthest-back point above it).
    let mut reach = vec![0.0; cols];
    let neck_y = neck_head[1];
    let raw_top: Vec<f64> = (0..cols).map(|j| neck_y.min(y_top_at(col_s(j) * phi_max(0.0)))).collect();
    // A smooth shoulder line (no notch or spike where the neck meets the back).
    let y_top: Vec<f64> = (0..cols)
        .map(|j| {
            let (mut sum, mut wsum) = (0.0, 0.0);
            for d in -4i64..=4 {
                let o = clampi(j as i64 + d, 0, cols as i64 - 1);
                let w = (-((d * d) as f64) / 8.0).exp();
                sum += raw_top[o] * w;
                wsum += w;
            }
            sum / wsum + 0.016 * k
        })
        .collect();
    let mut phis: Vec<Vec<f64>> = Vec::new();
    for i in 0..rows {
        let v = i as f64 / (rows - 1) as f64;
        let mut row = Vec::with_capacity(cols);
        for j in 0..cols {
            let s = col_s(j);
            let phi = s * phi_max(v);
            row.push(phi);
            let y = lerp(y_top[j], hem_at(s), v);
            let mut r = reach[j];
            let below = (0.015 + 0.03 * (1.0 - v).powf(3.0)) * k;
            for q in &cand {
                // Near the top the cloth also clears the curve of the back just below it.
                if q.y < y - below || (q.phi - phi).abs() > sector {
                    continue;
                }
                let proj = q.r * (q.phi - phi).cos();
                if proj > r {
                    r = proj;
                }
            }
            reach[j] = r;
        }
        // Cloth bridges hollows (the groove of the spine): each column reaches at least as far as
        // its neighbours' reach seen from its own angle.
        let bridged: Vec<f64> = (0..cols)
            .map(|j| {
                let mut m = reach[j];
                for d in -5i64..=5 {
                    let o = j as i64 + d;
                    if o < 0 || o >= cols as i64 || d == 0 {
                        continue;
                    }
                    let o = o as usize;
                    m = m.max(reach[o] * (row[o] - row[j]).cos());
                }
                m
            })
            .collect();
        reach = bridged;
        for j in 0..cols {
            let s = col_s(j);
            let phi = row[j];
            let y = lerp(y_top[j], hem_at(s), v);
            let r = reach[j];
            let fold = smoothstep(0.06, 0.55, v);
            let wave = 0.5 + 0.5 * (s * PI * 3.5).cos();
            let rr = r + (0.016 + 0.008 * v) * k + flare * k * v.powf(1.3) + 0.03 * k * fold * wave;
            g.p.push([phi.sin() * rr, y, z_a - phi.cos() * rr]);
            g.shade.push(1.0 - 0.14 * fold * (1.0 - wave));
            g.s.push(s);
            g.v.push(v);
        }
        phis.push(row);
    }
    // Normals from the grid, pointing away from the body.
    for i in 0..rows {
        for j in 0..cols {
            let pp = |a: i64, b: i64| g.p[clampi(a, 0, rows as i64 - 1) * cols + clampi(b, 0, cols as i64 - 1)];
            let (ii, jj) = (i as i64, j as i64);
            let du = sub(pp(ii, jj + 1), pp(ii, jj - 1));
            let dv = sub(pp(ii + 1, jj), pp(ii - 1, jj));
            let mut n = norm(cross(du, dv));
            let phi = phis[i][j];
            if dot(n, [phi.sin(), 0.0, -phi.cos()]) < 0.0 {
                n = mul(n, -1.0);
            }
            g.n.push(n);
        }
    }
    g
}

/// Bone rows (grid rows of each link's head) and chain columns (normalized).
const CHAIN_S: [f64; 3] = [-0.64, 0.0, 0.64];
const LINK_V: [f64; 5] = [0.1, 0.28, 0.46, 0.64, 0.82];

fn cape_weights(bd: &Body, s: f64, v: f64, bone_base: usize) -> Weights {
    // Columns: between the two nearest chains.
    let mut cw: Vec<(usize, f64)> = Vec::new();
    if s <= CHAIN_S[0] {
        cw.push((0, 1.0));
    } else if s >= CHAIN_S[2] {
        cw.push((2, 1.0));
    } else {
        let c = if s < 0.0 { 0 } else { 1 };
        let t = (s - CHAIN_S[c]) / (CHAIN_S[c + 1] - CHAIN_S[c]);
        cw.push((c, 1.0 - t));
        cw.push((c + 1, t));
    }
    // Rows: the link and its nearer neighbour.
    let link = |chain: usize, k: usize| (bone_base + chain * CAPE_LINKS + k) as u16;
    let mut w = WMap::default();
    let spine = bd.bone("spine_03") as u16;
    let clav = bd.bone(if s > 0.0 { "clavicle_l" } else { "clavicle_r" }) as u16;
    if v <= LINK_V[0] {
        // The top band rides on the upper back and shoulders, blending into the first links.
        let t = smoothstep(0.03, LINK_V[0], v) * 0.5;
        w.put(spine, (1.0 - t) * (1.0 - 0.45 * s.abs()));
        w.put(clav, (1.0 - t) * 0.45 * s.abs());
        for &(c, x) in &cw {
            w.put(link(c, 0), t * x);
        }
        return top4(&w);
    }
    let mut k = 0;
    while k + 1 < LINK_V.len() && v >= LINK_V[k + 1] {
        k += 1;
    }
    let next = if k + 1 < LINK_V.len() { LINK_V[k + 1] } else { 1.0 };
    let f = (v - LINK_V[k]) / (next - LINK_V[k]);
    // At a link's head the cloth is shared half and half with the link above.
    let (other, own, share): (i64, usize, f64) = if f < 0.5 {
        (k as i64 - 1, k, 0.5 * (1.0 - smoothstep(0.0, 0.5, f)))
    } else {
        (k as i64 + 1, k, if k + 1 < CAPE_LINKS { 0.5 * smoothstep(0.5, 1.0, f) } else { 0.0 })
    };
    for &(c, x) in &cw {
        if other < 0 {
            // Above the first link's head: shared with the spine.
            w.put(spine, x * share);
        } else {
            w.put(link(c, other as usize), x * share);
        }
        w.put(link(c, own), x * (1.0 - share));
    }
    top4(&w)
}

fn build_cape(bd: &Body, c: &CostumeParts, outer: &mut Builder, lining: &mut Builder, bone_base: usize) {
    let g = cape_grid(bd, &c.cape);
    let (cols, rows) = (g.cols, g.rows);
    let k = bd.height / 1.75;
    // Bones: three chains down the back, parented to the upper spine.
    let mut bones = Vec::new();
    for (ci, side) in CAPE_CHAINS.iter().enumerate() {
        for l in 0..CAPE_LINKS {
            let i = js_round(LINK_V[l] * (rows - 1) as f64) as usize;
            let j = js_round(((CHAIN_S[ci] + 1.0) / 2.0) * (cols - 1) as f64) as usize;
            let p = g.p[i * cols + j];
            bones.push(PartBone {
                name: format!("cape_{side}_{}", l + 1),
                parent: if l > 0 { format!("cape_{side}_{l}") } else { "spine_03".into() },
                head: [p[0] as f32, p[1] as f32, p[2] as f32],
            });
        }
    }
    outer.bones = bones;
    let thick = 0.0045 * k;
    let w: Vec<Weights> = (0..g.p.len()).map(|i| cape_weights(bd, g.s[i], g.v[i], bone_base)).collect();
    let uv_of = |i: usize| ((g.s[i] + 1.0) / 2.0, g.v[i]);
    // Outside and lining.
    let (o0, l0) = (outer.count() as u32, lining.count() as u32);
    for i in 0..g.p.len() {
        outer.follow = NO_ANCHOR;
        lining.follow = NO_ANCHOR;
        let (u, v) = uv_of(i);
        outer.vert(g.p[i], g.n[i], u, v, g.shade[i], &w[i]);
        lining.vert(sub(g.p[i], mul(g.n[i], thick)), mul(g.n[i], -1.0), u, v, g.shade[i] * 0.95, &w[i]);
    }
    for i in 0..rows - 1 {
        for j in 0..cols - 1 {
            let a = (i * cols + j) as u32;
            let (b, d) = (a + 1, a + cols as u32);
            let e = d + 1;
            outer.idx.extend_from_slice(&[o0 + a, o0 + b, o0 + d, o0 + b, o0 + e, o0 + d]);
            lining.idx.extend_from_slice(&[l0 + a, l0 + d, l0 + b, l0 + b, l0 + d, l0 + e]);
        }
    }
    let pp = |i: i64, j: i64| g.p[clampi(i, 0, rows as i64 - 1) * cols + clampi(j, 0, cols as i64 - 1)];
    // The cloth's edge: hem, sides and top, a strip between outside and lining.
    let edge = |outer: &mut Builder, ids: &[usize], dir: &dyn Fn(usize) -> Vec3| {
        let q0 = outer.count() as u32;
        for &i in ids {
            let n = dir(i);
            let (u, v) = uv_of(i);
            outer.follow = NO_ANCHOR;
            outer.vert(g.p[i], n, u, v, g.shade[i] * 0.9, &w[i]);
            outer.vert(sub(g.p[i], mul(g.n[i], thick)), n, u, v, g.shade[i] * 0.9, &w[i]);
        }
        for m in 0..ids.len() - 1 {
            let a = q0 + m as u32 * 2;
            let n = dir(ids[m]);
            let ab = sub(g.p[ids[m + 1]], g.p[ids[m]]);
            // Wind the strip so it faces along `dir`.
            if dot(cross(ab, mul(g.n[ids[m]], -1.0)), n) > 0.0 {
                outer.idx.extend_from_slice(&[a, a + 1, a + 2, a + 2, a + 1, a + 3]);
            } else {
                outer.idx.extend_from_slice(&[a, a + 2, a + 1, a + 2, a + 3, a + 1]);
            }
        }
    };
    let hem: Vec<usize> = (0..cols).map(|j| (rows - 1) * cols + j).collect();
    edge(outer, &hem, &|i| norm(sub(g.p[i], pp(rows as i64 - 2, (i % cols) as i64))));
    for j in [0, cols - 1] {
        let ids: Vec<usize> = (0..rows).map(|i| i * cols + j).collect();
        let inner = if j == 0 { 1 } else { cols as i64 - 2 };
        edge(outer, &ids, &|i| norm(sub(g.p[i], pp((i / cols) as i64, inner))));
    }
    let top: Vec<usize> = (0..cols).collect();
    edge(outer, &top, &|i| norm(sub(g.p[i], pp(1, i as i64))));
    if c.collar != "none" {
        build_collar(bd, &c.collar, outer, lining);
    }
}

fn build_collar(bd: &Body, style: &str, outer: &mut Builder, lining: &mut Builder) {
    let k = bd.height / 1.75;
    let nk = bd.head("neck_01");
    let (spine, neck) = (bd.bone("spine_03") as u16, bd.bone("neck_01") as u16);
    let z_n = nk[2];
    // Neck reach per direction just above the neck base.
    let mut cand: Vec<(f64, f64)> = Vec::new();
    for v in 0..bd.n {
        let d = bd.dom[v];
        if d < 0 || (bd.name(d) != "neck_01" && bd.name(d) != "spine_03") {
            continue;
        }
        let p = bd.at(v);
        if (p[1] - (nk[1] + 0.025 * k)).abs() > 0.02 * k {
            continue;
        }
        cand.push((p[0].atan2(-(p[2] - z_n)), p[0].hypot(p[2] - z_n)));
    }
    let (cols, rows) = (41usize, 9usize);
    let flared = style == "flared";
    let span = if flared { 2.1 } else { 1.95 };
    let thick = 0.004 * k;
    let (o0, l0) = (outer.count() as u32, lining.count() as u32);
    let mut pts: Vec<Vec3> = Vec::new();
    let mut ws: Vec<Weights> = Vec::new();
    let col_phi = |j: usize| ((j as f64 / (cols - 1) as f64) * 2.0 - 1.0) * span;
    for i in 0..rows {
        let t = i as f64 / (rows - 1) as f64;
        for j in 0..cols {
            let s = (j as f64 / (cols - 1) as f64) * 2.0 - 1.0;
            let phi = s * span;
            let mut r = 0.05 * k;
            for &(qp, qr) in &cand {
                if (qp - phi).abs() < 0.2 {
                    r = r.max(qr * (qp - phi).cos());
                }
            }
            let front = (s.abs() * span / 2.0).powf(2.0);
            let h = if flared { (0.12 + 0.05 * front) * k } else { (0.07 - 0.015 * front) * k };
            let out = if flared { 0.075 * k * t.powf(1.6) * (0.7 + 0.3 * front) } else { 0.012 * k * t };
            let rr = r + 0.022 * k + out;
            let y = nk[1] - 0.012 * k - 0.03 * k * front + h * t;
            pts.push([phi.sin() * rr, y, z_n - phi.cos() * rr]);
            let mut w = WMap::default();
            w.put(spine, 1.0 - 0.55 * t);
            w.put(neck, 0.55 * t);
            ws.push(top4(&w));
        }
    }
    let mut nrm: Vec<Vec3> = Vec::new();
    for i in 0..rows {
        for j in 0..cols {
            let pp = |a: i64, b: i64| pts[clampi(a, 0, rows as i64 - 1) * cols + clampi(b, 0, cols as i64 - 1)];
            let (ii, jj) = (i as i64, j as i64);
            let mut n = norm(cross(sub(pp(ii, jj + 1), pp(ii, jj - 1)), sub(pp(ii + 1, jj), pp(ii - 1, jj))));
            let phi = col_phi(j);
            if dot(n, [phi.sin(), 0.0, -phi.cos()]) < 0.0 {
                n = mul(n, -1.0);
            }
            nrm.push(n);
        }
    }
    for i in 0..pts.len() {
        let (u, v) = ((i % cols) as f64 / (cols - 1) as f64, (i / cols) as f64 / (rows - 1) as f64);
        outer.follow = NO_ANCHOR;
        lining.follow = NO_ANCHOR;
        outer.vert(pts[i], nrm[i], u, v, 1.0, &ws[i]);
        lining.vert(sub(pts[i], mul(nrm[i], thick)), mul(nrm[i], -1.0), u, v, 0.95, &ws[i]);
    }
    for i in 0..rows - 1 {
        for j in 0..cols - 1 {
            let a = (i * cols + j) as u32;
            let (b, d) = (a + 1, a + cols as u32);
            let e = d + 1;
            outer.idx.extend_from_slice(&[o0 + a, o0 + d, o0 + b, o0 + b, o0 + d, o0 + e]);
            lining.idx.extend_from_slice(&[l0 + a, l0 + b, l0 + d, l0 + b, l0 + e, l0 + d]);
        }
    }
    // A rolled top edge joining outside and lining.
    let q0 = outer.count() as u32;
    for j in 0..cols {
        let i = (rows - 1) * cols + j;
        let up = norm(sub(pts[i], pts[i - cols]));
        outer.vert(pts[i], up, 0.0, 1.0, 0.9, &ws[i]);
        outer.vert(sub(pts[i], mul(nrm[i], thick)), up, 0.0, 1.0, 0.9, &ws[i]);
    }
    for j in 0..cols as u32 - 1 {
        let a = q0 + j * 2;
        outer.idx.extend_from_slice(&[a, a + 2, a + 1, a + 2, a + 3, a + 1]);
    }
}

// ------------------------------------------------------------------ all

/// The costume's meshes. `bone_base` is the joint index the first cape bone gets (the pack
/// skeleton's size plus the bones of the parts built before).
pub fn build_costume(body: &PartsBody, c: &CostumeParts, bone_base: usize) -> Vec<PartMesh> {
    if !has_costume(Some(c)) {
        return Vec::new();
    }
    let bd = Body::new(body);
    let mut out = Vec::new();
    let mut done = |b: Builder, name: &str, kind: PartKind, color: Option<[f64; 3]>| {
        if b.count() > 0 {
            out.push(b.build(name, kind, color));
        }
    };
    if c.cape != "none" {
        let (mut outer, mut lining) = (Builder::new(), Builder::new());
        build_cape(&bd, c, &mut outer, &mut lining, bone_base);
        done(outer, "cape", PartKind::Cloth, Some(c.cape_color));
        done(lining, "cape-lining", PartKind::Cloth, Some(c.lining_color));
    }
    if c.mask != "none" {
        let mut m = Builder::new();
        build_mask(&bd, &c.mask, &mut m);
        done(m, "mask", PartKind::Cloth, Some(c.mask_color));
    }
    if c.belt != "none" {
        let (mut belt, mut buckle) = (Builder::new(), Builder::new());
        build_belt(&bd, &c.belt, &mut belt, &mut buckle);
        done(belt, "belt", PartKind::Cloth, Some(c.belt_color));
        done(buckle, "buckle", PartKind::Cloth, Some(c.buckle_color));
    }
    if c.emblem != "none" {
        let (mut plate, mut rim) = (Builder::new(), Builder::new());
        build_emblem(&bd, c, &mut plate, &mut rim);
        done(plate, "emblem", PartKind::Emblem, None);
        done(rim, "emblem-rim", PartKind::Cloth, Some(c.rim_color));
    }
    out
}
