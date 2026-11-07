//! Fantasy-race add-ons generated from the current body shape: horns, tusks, tails, beards,
//! sylvan leaf hair and the drakeborn crest (port of `packages/human/src/parts.ts`).
//!
//! Every part is skinned to existing bones (head, pelvis, ...), except the tail, which adds a
//! chain of bones. Beards are a shell over the skin with wide locks on it, leaves are cards grown
//! from roots sampled on the morphed skin; horns, tusks and tails are tubes along curves.
//! Deterministic from `seed`, and the same numbers as the TypeScript builders.

use actors_core::math::{add, cross, dot, length as len, normalize as norm, scale as mul, sub, Vec3};
use actors_core::parts::{PartBone, PartKind, PartMesh};
use actors_core::{ActorShape, FittedSkeleton, MeshData};
use std::collections::HashMap;
use std::f64::consts::PI;

/// `PartMesh::anchors` value for vertices that don't follow face morphs.
pub const NO_ANCHOR: u32 = 0xffff_ffff;

pub const HORN_STYLES: [&str; 6] = ["none", "ram", "straight", "swept", "antler", "crown"];
pub const TAIL_STYLES: [&str; 4] = ["none", "reptile", "furred", "thin"];
pub const BEARD_STYLES: [&str; 10] = ["none", "short", "full", "long", "braided", "forked", "goatee", "mustache", "mutton", "chinstrap"];
pub const HAIR_PARTS: [&str; 3] = ["none", "leaves", "crest"];
/// Tail bone names, root to tip.
pub const TAIL_BONES: [&str; 6] = ["tail_01", "tail_02", "tail_03", "tail_04", "tail_05", "tail_06"];

/// What to grow (the `PartsConfig` of @actors/human; styles by name).
#[derive(Clone, Debug, PartialEq)]
pub struct PartsConfig {
    pub seed: f64,
    /// Overall race scale (bigger races get slightly longer beards and bigger horns).
    pub scale: f64,
    pub horns: String,
    /// 0..1
    pub horn_size: f64,
    /// sRGB 0..1
    pub horn_color: [f64; 3],
    /// 0..1, 0 = none.
    pub tusks: f64,
    pub tail: String,
    /// 0..1 of the body height × 0.62.
    pub tail_length: f64,
    pub beard: String,
    /// "none", "leaves" or "crest".
    pub hair: String,
}

impl Default for PartsConfig {
    fn default() -> Self {
        Self {
            seed: 0.0,
            scale: 1.0,
            horns: "none".into(),
            horn_size: 0.0,
            horn_color: [0.85, 0.81, 0.71],
            tusks: 0.0,
            tail: "none".into(),
            tail_length: 0.0,
            beard: "none".into(),
            hair: "none".into(),
        }
    }
}

/// What the builders need from the body: the evaluated shape and its landmarks.
#[derive(Clone, Debug)]
pub struct PartsBody<'a> {
    /// Per base vertex (the actor shape).
    pub positions: &'a [f32],
    pub normals: &'a [f32],
    /// Body triangles as base vertex indices.
    pub triangles: Vec<u32>,
    /// Per base vertex skin influences (4 each).
    pub joints: Vec<u16>,
    pub weights: Vec<f32>,
    /// Per base vertex UV (for skin-material parts).
    pub uvs: Vec<f32>,
    /// 1 for base vertices of the body surface (the base mesh also holds helper geometry).
    pub is_body: Vec<u8>,
    pub skeleton: &'a FittedSkeleton,
    /// Eye centres (actor's left and right).
    pub eyes: [Vec3; 2],
    /// Between the ears.
    pub ear_mid: Vec3,
    /// Middle of the upper lip.
    pub mouth: Vec3,
}

fn lerp3(a: Vec3, b: Vec3, t: f64) -> Vec3 {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

fn smoothstep(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
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

const UP: Vec3 = [0.0, 1.0, 0.0];
const DOWN: Vec3 = [0.0, -1.0, 0.0];
const FWD: Vec3 = [0.0, 0.0, 1.0];
const BACK: Vec3 = [0.0, 0.0, -1.0];

/// ToInt32 of a number, as JavaScript's bit operators read it.
fn to_u32(x: f64) -> u32 {
    let m = x.trunc().rem_euclid(4294967296.0);
    m as u32
}

struct Rng {
    s: u32,
}

impl Rng {
    fn new(seed: f64) -> Self {
        Self { s: to_u32((seed * 4294967295.0).floor()) ^ 0x9e37_79b9 }
    }
    fn float(&mut self) -> f64 {
        self.s = self.s.wrapping_add(0x6d2b_79f5);
        let mut t = self.s;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
    fn range(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.float()
    }
    fn gaussian(&mut self, mean: f64, sd: f64) -> f64 {
        let u = self.float().max(1e-9);
        let v = self.float();
        mean + sd * (-2.0 * u.ln()).sqrt() * (2.0 * PI * v).cos()
    }
}

/// Skin influences as (bone index, weight) pairs (normalized when written).
pub type Weights = Vec<(u16, f64)>;

/// Collects a part's vertices, skinning and triangles.
#[derive(Default)]
pub struct Builder {
    pos: Vec<f64>,
    nrm: Vec<f64>,
    uv: Vec<f64>,
    shade: Vec<f64>,
    ji: Vec<u16>,
    jw: Vec<f64>,
    pub idx: Vec<u32>,
    anchor: Vec<u32>,
    /// Base vertex the next vertices follow in face morphs (NO_ANCHOR = rigid).
    pub follow: u32,
    pub bones: Vec<PartBone>,
}

impl Builder {
    pub fn new() -> Self {
        Self { follow: NO_ANCHOR, ..Default::default() }
    }
    pub fn count(&self) -> usize {
        self.pos.len() / 3
    }
    pub fn vert(&mut self, p: Vec3, n: Vec3, u: f64, v: f64, shade: f64, w: &[(u16, f64)]) {
        self.pos.extend_from_slice(&p);
        self.nrm.extend_from_slice(&n);
        self.uv.extend_from_slice(&[u, v]);
        self.shade.push(shade);
        self.anchor.push(self.follow);
        let m = w.len().min(4);
        let mut total: f64 = w[..m].iter().map(|x| x.1).sum();
        if total == 0.0 {
            total = 1.0;
        }
        for k in 0..4 {
            self.ji.push(if k < m { w[k].0 } else { 0 });
            self.jw.push(if k < m { w[k].1 / total } else { 0.0 });
        }
    }
    pub fn build(self, name: &str, kind: PartKind, color: Option<[f64; 3]>) -> PartMesh {
        let f = |v: Vec<f64>| v.into_iter().map(|x| x as f32).collect::<Vec<f32>>();
        let anchors = if self.anchor.iter().any(|&a| a != NO_ANCHOR) { self.anchor } else { Vec::new() };
        PartMesh {
            name: name.into(),
            kind,
            color: color.map(|c| c.map(|x| x as f32)),
            positions: f(self.pos),
            normals: f(self.nrm),
            uvs: f(self.uv),
            shade: f(self.shade),
            joints: self.ji,
            weights: f(self.jw),
            indices: self.idx,
            bones: self.bones,
            anchors,
        }
    }
}

// ------------------------------------------------------------------ body context

struct Ctx<'a> {
    body: &'a PartsBody<'a>,
    rng: Rng,
    /// Head sphere.
    c: Vec3,
    r: f64,
    ipd: f64,
    /// Face coordinates per base vertex: (p - eye midpoint) / eye distance, z forward (f32 as in TS).
    face: Vec<f32>,
    grid: HashMap<i32, Vec<usize>>,
    cell: f64,
    height: f64,
}

fn grid_key(x: f64, y: f64, z: f64) -> i32 {
    let i = |v: f64, k: f64| to_u32(v * k) as i32;
    i(x, 73856093.0) ^ i(y, 19349663.0) ^ i(z, 83492791.0)
}

impl<'a> Ctx<'a> {
    fn new(body: &'a PartsBody<'a>, seed: f64, scale: f64) -> Self {
        let pos = body.positions;
        let n = pos.len() / 3;
        let p = |v: usize, k: usize| pos[v * 3 + k] as f64;
        let [el, er] = body.eyes;
        let mid = mul(add(el, er), 0.5);
        let d = len(sub(el, er));
        let ipd = if d == 0.0 { 0.064 } else { d };
        let mut face = vec![0f32; n * 3];
        let (mut top, mut bottom) = (f64::NEG_INFINITY, f64::INFINITY);
        for v in 0..n {
            if body.is_body[v] == 0 {
                continue;
            }
            for k in 0..3 {
                face[v * 3 + k] = ((p(v, k) - mid[k]) / ipd) as f32;
            }
            top = top.max(p(v, 1));
            bottom = bottom.min(p(v, 1));
        }
        let mut ctx =
            Self { body, rng: Rng::new(seed), c: [0.0; 3], r: 0.1, ipd, face, grid: HashMap::new(), cell: 0.0, height: top - bottom };
        // Head sphere: mean distance of skull vertices above the ears (rigidly on the head bone).
        let hb = ctx.bone("head") as u16;
        let e = body.ear_mid;
        let (mut hr, mut hn) = (0.0, 0);
        for v in 0..n {
            if body.is_body[v] == 0 || body.joints[v * 4] != hb || body.weights[v * 4] < 0.9 || p(v, 1) < e[1] + 0.01 {
                continue;
            }
            hr += actors_core::math::hypot3(p(v, 0) - e[0], p(v, 1) - e[1], p(v, 2) - e[2]);
            hn += 1;
        }
        ctx.r = if hn > 0 { hr / hn as f64 } else { 0.1 };
        ctx.c = [e[0], e[1] + ctx.r * 0.12, e[2] + ctx.r * 0.08];
        ctx.cell = 0.03 * scale.max(0.5);
        for v in 0..n {
            if body.is_body[v] == 0 {
                continue;
            }
            let c = ctx.cell;
            let k = grid_key((p(v, 0) / c).floor(), (p(v, 1) / c).floor(), (p(v, 2) / c).floor());
            ctx.grid.entry(k).or_default().push(v);
        }
        ctx
    }

    fn bone(&self, name: &str) -> usize {
        self.body.skeleton.names.iter().position(|n| n == name).unwrap_or(0)
    }

    fn head(&self, name: &str) -> Vec3 {
        self.body.skeleton.heads[self.bone(name)]
    }

    fn pos(&self, v: usize) -> Vec3 {
        let p = self.body.positions;
        [p[v * 3] as f64, p[v * 3 + 1] as f64, p[v * 3 + 2] as f64]
    }

    fn face_of(&self, v: usize) -> Vec3 {
        [self.face[v * 3] as f64, self.face[v * 3 + 1] as f64, self.face[v * 3 + 2] as f64]
    }

    fn head_w(&self) -> Weights {
        vec![(self.bone("head") as u16, 1.0)]
    }
}

struct Sample {
    p: Vec3,
    n: Vec3,
    f: Vec3,
    v: usize,
}

/// Area-weighted random surface samples on body triangles where `weight(face coords)` > 0.
fn sample_surface(ctx: &mut Ctx, count: usize, weight: impl Fn(f64, f64, f64) -> f64) -> Vec<Sample> {
    let body = ctx.body;
    let tris = &body.triangles;
    let nrm = body.normals;
    let mut vw: HashMap<u32, f64> = HashMap::new();
    let mut cdf: Vec<f64> = Vec::new();
    let mut ids: Vec<usize> = Vec::new();
    let mut total = 0.0;
    for t in (0..tris.len()).step_by(3) {
        let (a, b, c) = (tris[t], tris[t + 1], tris[t + 2]);
        let mut w = |v: u32| {
            *vw.entry(v).or_insert_with(|| {
                let f = ctx.face_of(v as usize);
                weight(f[0], f[1], f[2])
            })
        };
        let wt = (w(a) + w(b) + w(c)) / 3.0;
        if wt <= 0.02 {
            continue;
        }
        let pa = ctx.pos(a as usize);
        let ab = sub(ctx.pos(b as usize), pa);
        let ac = sub(ctx.pos(c as usize), pa);
        total += (len(cross(ab, ac)) / 2.0) * wt;
        cdf.push(total);
        ids.push(t);
    }
    let mut out = Vec::new();
    if ids.is_empty() {
        return out;
    }
    for _ in 0..count {
        let r = ctx.rng.float() * total;
        let (mut lo, mut hi) = (0usize, cdf.len() - 1);
        while lo < hi {
            let m = (lo + hi) >> 1;
            if cdf[m] < r {
                lo = m + 1;
            } else {
                hi = m;
            }
        }
        let t = ids[lo];
        let (mut u, mut v) = (ctx.rng.float(), ctx.rng.float());
        if u + v > 1.0 {
            u = 1.0 - u;
            v = 1.0 - v;
        }
        let vs = [tris[t] as usize, tris[t + 1] as usize, tris[t + 2] as usize];
        let ws = [1.0 - u - v, u, v];
        let (mut p, mut n, mut f) = ([0.0; 3], [0.0; 3], [0.0; 3]);
        for k in 0..3 {
            for j in 0..3 {
                p[j] += body.positions[vs[k] * 3 + j] as f64 * ws[k];
                n[j] += nrm[vs[k] * 3 + j] as f64 * ws[k];
                f[j] += ctx.face[vs[k] * 3 + j] as f64 * ws[k];
            }
        }
        let pick = if ws[0] > ws[1] {
            if ws[0] > ws[2] {
                0
            } else {
                2
            }
        } else if ws[1] > ws[2] {
            1
        } else {
            2
        };
        out.push(Sample { p, n: norm(n), f, v: vs[pick] });
    }
    out
}

/// The body vertex nearest to `p` (None if none is within four grid cells).
fn nearest_vertex(ctx: &Ctx, p: Vec3) -> Option<usize> {
    let cell = ctx.cell;
    let (cx, cy, cz) = ((p[0] / cell).floor(), (p[1] / cell).floor(), (p[2] / cell).floor());
    let mut best: Option<usize> = None;
    let mut bd = f64::INFINITY;
    let mut r = 1.0;
    while r <= 4.0 && best.is_none() {
        let mut x = cx - r;
        while x <= cx + r {
            let mut y = cy - r;
            while y <= cy + r {
                let mut z = cz - r;
                while z <= cz + r {
                    if let Some(list) = ctx.grid.get(&grid_key(x, y, z)) {
                        for &v in list {
                            let q = ctx.pos(v);
                            let d = (q[0] - p[0]).powi(2) + (q[1] - p[1]).powi(2) + (q[2] - p[2]).powi(2);
                            if d < bd {
                                bd = d;
                                best = Some(v);
                            }
                        }
                    }
                    z += 1.0;
                }
                y += 1.0;
            }
            x += 1.0;
        }
        r += 1.0;
    }
    best
}

/// Skin weights of a body vertex.
fn vertex_weights(ctx: &Ctx, v: Option<usize>) -> Weights {
    let Some(v) = v else { return ctx.head_w() };
    let b = ctx.body;
    let out: Weights = (0..4).filter(|&k| b.weights[v * 4 + k] > 0.0).map(|k| (b.joints[v * 4 + k], b.weights[v * 4 + k] as f64)).collect();
    if out.is_empty() {
        ctx.head_w()
    } else {
        out
    }
}

/// Scalp hair weights: rigid to the head, blending into the neck below the jaw.
fn hair_weights(ctx: &Ctx, p: Vec3) -> Weights {
    let neck_top = ctx.head("head")[1];
    let neck_base = ctx.head("neck_01")[1];
    if p[1] >= neck_top {
        return ctx.head_w();
    }
    let t = ((neck_top - p[1]) / (neck_top - neck_base).max(0.01)).min(1.0);
    vec![(ctx.bone("head") as u16, 1.0 - t * 0.6), (ctx.bone("neck_01") as u16, t * 0.6)]
}

// ------------------------------------------------------------------ strands -> cards

type Comb<'c> = &'c dyn Fn(Vec3, f64) -> Option<Vec3>;

struct StrandOpts<'c> {
    segs: usize,
    length: f64,
    gravity: f64,
    /// How long the strand follows its root normal before bending (0..1).
    stiff: f64,
    /// Extra clearance above the head sphere at the tip (m).
    volume: f64,
    curl: f64,
    curl_freq: f64,
    /// Where combing pulls the strand at a point.
    comb: Comb<'c>,
    comb_k: f64,
    noise: f64,
    collide_head: bool,
}

fn grow_strand(ctx: &mut Ctx, root: Vec3, n: Vec3, o: &StrandOpts) -> Vec<Vec3> {
    let mut pts = vec![add(root, mul(n, -0.0008))];
    // Strands leave the skin at a shallow angle: mostly along the combing direction, lifted by stiffness.
    let c0 = match (o.comb)(root, 0.0) {
        Some(c) => c,
        None => {
            let g = [ctx.rng.gaussian(0.0, 1.0), ctx.rng.gaussian(0.0, 1.0), ctx.rng.gaussian(0.0, 1.0)];
            norm(cross(n, norm(g)))
        }
    };
    let c0t = sub(norm(c0), mul(n, dot(norm(c0), n)));
    let mut dir = norm(add(mul(n, 0.2 + 0.7 * o.stiff), if len(c0t) > 1e-4 { norm(c0t) } else { n }));
    let seg = o.length / o.segs as f64;
    let ph = ctx.rng.range(0.0, PI * 2.0);
    let side = norm(cross(n, if n[1].abs() > 0.9 { FWD } else { UP }));
    // Layering: a strand never dips below the radius of its own root, so crown hair lies over the rest.
    let root_r = (ctx.r * 1.03).max(len(sub(root, ctx.c)) + 0.0025);
    for i in 1..=o.segs {
        let t = i as f64 / o.segs as f64;
        let g = o.gravity * (t / o.stiff.max(0.05)).min(1.0);
        dir = norm(add(dir, mul(DOWN, g * 0.35)));
        if let Some(c) = (o.comb)(pts[i - 1], t) {
            dir = norm(lerp3(dir, norm(c), o.comb_k));
        }
        if o.noise != 0.0 {
            let g = [ctx.rng.gaussian(0.0, o.noise), ctx.rng.gaussian(0.0, o.noise * 0.5), ctx.rng.gaussian(0.0, o.noise)];
            dir = norm(add(dir, g));
        }
        let mut p = add(pts[i - 1], mul(dir, seg));
        if o.curl != 0.0 {
            p = add(p, mul(side, (ph + t * o.curl_freq * PI * 2.0).sin() * o.curl * (t * 3.0).min(1.0) * seg));
        }
        if o.collide_head {
            let rel = sub(p, ctx.c);
            let d = len(rel);
            let min_r = root_r + o.volume * (t * 2.0).min(1.0);
            if d < min_r {
                p = add(ctx.c, mul(rel, min_r / d));
            }
        }
        dir = norm(sub(p, pts[i - 1]));
        pts.push(p);
    }
    pts
}

/// A polyline as a ribbon card. `outward(p)` orients the card face and its shading normal.
#[allow(clippy::too_many_arguments)]
fn card(
    b: &mut Builder,
    pts: &[Vec3],
    width: impl Fn(f64) -> f64,
    u0: f64,
    u1: f64,
    shade: f64,
    weights: impl Fn(Vec3) -> Weights,
    outward: impl Fn(Vec3) -> Vec3,
    twist: f64,
) {
    let base = b.count() as u32;
    let n = pts.len();
    for i in 0..n {
        let t = i as f64 / (n - 1) as f64;
        let tan = norm(sub(pts[(i + 1).min(n - 1)], pts[i.saturating_sub(1)]));
        let out = outward(pts[i]);
        let mut s = norm(cross(tan, out));
        if twist != 0.0 {
            let a = twist * t;
            let o2 = norm(cross(s, tan));
            s = norm(add(mul(s, a.cos()), mul(o2, a.sin())));
        }
        let w = width(t) / 2.0;
        let nn = norm(cross(s, tan));
        let facing = if dot(nn, out) < 0.0 { mul(nn, -1.0) } else { nn };
        let wgt = weights(pts[i]);
        b.vert(add(pts[i], mul(s, -w)), facing, u0, t, shade, &wgt);
        b.vert(add(pts[i], mul(s, w)), facing, u1, t, shade, &wgt);
    }
    for i in 0..n.saturating_sub(1) as u32 {
        let a = base + i * 2;
        b.idx.extend_from_slice(&[a, a + 1, a + 2, a + 1, a + 3, a + 2]);
    }
}

// ------------------------------------------------------------------ scalp (leaves) and crest

/// Scalp coverage in face coordinates (1 = scalp).
fn scalp_coverage(x: f64, y: f64, z: f64) -> f64 {
    let ax = x.abs();
    let hairline = 1.05 + 0.18 * ax * ax;
    let front = smoothstep(hairline - 0.08, hairline + 0.08, y);
    // Above and behind the ears, and the nape.
    let sides = smoothstep(-0.55, -0.85, z) * smoothstep(-0.05, 0.25, y + 0.35 * smoothstep(-1.2, -2.0, z));
    let nape = smoothstep(-1.05, -1.35, z) * smoothstep(-2.2, -1.8, y);
    front.max(sides).max(nape).min(1.0) * if y > -2.6 { 1.0 } else { 0.0 }
}

/// Sylvan hair: leaf cards swept back over the scalp, a little ruffled.
fn build_leaves(ctx: &mut Ctx, b: &mut Builder) {
    let roots = sample_surface(ctx, 420, scalp_coverage);
    let c = ctx.c;
    for r in roots {
        let local = mul(sub(r.p, c), 1.0 / ctx.r);
        let l = ctx.rng.range(0.07, 0.13);
        let comb = move |_p: Vec3, t: f64| Some(norm(add(BACK, mul(DOWN, 0.35 + t * 0.6 + (-local[2]).max(0.0) * 0.2))));
        let o = StrandOpts {
            segs: 4,
            length: l,
            gravity: 0.35,
            stiff: 0.5,
            volume: 0.02,
            curl: 0.15,
            curl_freq: 0.8,
            noise: 0.25,
            comb_k: 0.25,
            comb: &comb,
            collide_head: true,
        };
        let pts = grow_strand(ctx, r.p, r.n, &o);
        let w = ctx.rng.range(0.035, 0.05);
        let shade = ctx.rng.range(0.7, 1.25);
        let twist = ctx.rng.range(-1.0, 1.0);
        card(
            b,
            &pts,
            |t| w * (0.5 + 0.5 * (t.min(1.0) * PI * 0.9 + 0.2).sin()),
            0.0,
            1.0,
            shade,
            |p| hair_weights(ctx, p),
            |p| norm(sub(p, c)),
            twist,
        );
    }
}

/// Drakeborn crest: a row of tapering fins along the skull midline.
fn build_crest(ctx: &mut Ctx, b: &mut Builder) {
    let (c, r) = (ctx.c, ctx.r);
    let n = 9;
    for i in 0..n {
        let k = i as f64 / (n - 1) as f64;
        let a = -0.35 + k * 2.1; // forehead -> nape
        let base = on_skull(ctx, [0.0, a.cos(), -a.sin()], 0.0);
        let h = r * (0.35 + 0.35 * (k * PI).sin()) * ctx.rng.range(0.85, 1.15);
        let out = norm(sub(base, c));
        let tip = add(add(base, mul(out, h)), mul(BACK, h * 0.6));
        let sink = add(base, mul(out, -r * 0.06));
        let head = ctx.head_w();
        card(
            b,
            &[sink, lerp3(base, tip, 0.5), tip],
            |t| r * 0.32 * (1.0 - t * 0.95),
            0.0,
            1.0,
            1.0,
            |_| head.clone(),
            |_| [1.0, 0.0, 0.0],
            0.0,
        );
    }
}

// ------------------------------------------------------------------ beards

/// Painted-stubble region under each beard style (see [`beard_coverage`]; -1 none).
pub fn beard_region(style: &str) -> i32 {
    match style {
        "short" | "full" | "long" | "braided" | "forked" => 0,
        "goatee" => 1,
        "mustache" => 2,
        "mutton" => 3,
        "chinstrap" => 4,
        _ => -1,
    }
}

/// Beard coverage in face coordinates for a region style (0 full, 1 goatee, 2 mustache, 3 mutton
/// chops, 4 chinstrap).
pub fn beard_coverage(style: i32, x: f64, y: f64, z: f64) -> f64 {
    if style < 0 {
        return 0.0;
    }
    let ax = x.abs();
    // Upper edge: the cheek line rising toward the sideburns; lower edge: under the jaw onto the neck.
    let cheek = -0.82 + 0.62 * smoothstep(0.35, 1.25, ax);
    let upper = 1.0 - smoothstep(cheek - 0.06, cheek + 0.06, y);
    let side = smoothstep(-1.45, -1.05, z); // not behind the ears
    let neck = smoothstep(-2.25, -1.95, y + 0.25 * ax) * (1.0 - smoothstep(1.3, 1.6, ax));
    let front = upper * side * neck;
    // The lips stay bare.
    let lip_zone = smoothstep(0.38, 0.5, (x / 1.1).hypot((y + 1.18) / 0.36));
    let mustache = (1.0 - smoothstep(0.5, 0.62, ax)) * smoothstep(-1.12, -1.02, y) * (1.0 - smoothstep(-0.86, -0.78, y)) * side;
    let chin = (1.0 - smoothstep(0.42, 0.56, ax)) * (1.0 - smoothstep(-1.36, -1.28, y)) * smoothstep(-2.1, -1.95, y);
    match style {
        0 => (front * lip_zone).max(mustache),
        1 => chin.max(mustache) * side,
        2 => mustache,
        3 => front * smoothstep(0.5, 0.75, ax) * lip_zone,
        4 => {
            // A band along the jawline, rising toward the ears.
            let jaw = -1.95 + 1.0 * smoothstep(0.5, 1.35, ax);
            front * (1.0 - smoothstep(jaw + 0.32, jaw + 0.48, y)) * lip_zone
        }
        _ => 0.0,
    }
}

/// Beard texture layout: locks use u 0..0.5, the solid mass u 0.5..1 with v as its coverage.
const LOCK_U: [f64; 2] = [0.0, 0.5];

struct BeardLook {
    /// Thickness of the solid mass over the skin (m); 0: none, the skin under it is painted instead.
    mass: f64,
    /// Lock length range (m); 0 = mass only.
    len: [f64; 2],
    /// Lock width range (m).
    width: [f64; 2],
    /// Locks per beard.
    locks: usize,
}

fn beard_look(style: &str) -> Option<BeardLook> {
    let l = |mass, len, width, locks| Some(BeardLook { mass, len, width, locks });
    match style {
        "short" | "chinstrap" => l(0.0, [0.0, 0.0], [0.0, 0.0], 0),
        "full" => l(0.011, [0.035, 0.06], [0.016, 0.026], 540),
        "long" => l(0.013, [0.1, 0.17], [0.02, 0.034], 620),
        "braided" => l(0.012, [0.08, 0.13], [0.02, 0.032], 540),
        "forked" => l(0.013, [0.09, 0.15], [0.02, 0.032], 580),
        "goatee" => l(0.008, [0.035, 0.065], [0.014, 0.022], 200),
        "mustache" => l(0.005, [0.022, 0.04], [0.013, 0.02], 156),
        "mutton" => l(0.008, [0.022, 0.036], [0.013, 0.02], 240),
        _ => None,
    }
}

/// How the skin under a beard is painted (stubble amount and outline blur), None without a beard.
pub fn beard_paint(style: &str) -> Option<(f64, f64)> {
    let look = beard_look(style)?;
    Some((2.0, if look.mass > 0.0 { 0.12 } else { 0.09 }))
}

/// Beards: a solid shell over the beard area with wide, layered locks growing out of it.
fn build_beard(ctx: &mut Ctx, style: &str, scale: f64, b: &mut Builder) {
    let region = beard_region(style);
    let Some(look) = beard_look(style) else { return };
    if region < 0 {
        return;
    }
    let body = ctx.body;
    let chin = body.mouth;
    let scale_k = if scale > 1.3 {
        1.25
    } else if scale < 0.9 {
        0.8
    } else {
        1.0
    };
    let fork_side = |p: Vec3| if p[0] - chin[0] >= 0.0 { 1.0 } else { -1.0 };
    let is_must = |f: Vec3| f[1] > -1.12 && f[0].abs() < 0.62 && f[1] < -0.75;

    // --- The mass: a shell over every skin triangle the beard touches.
    let tris = &body.triangles;
    let n = body.positions.len() / 3;
    let mut cov = vec![-1f32; n];
    let mut coverage = |v: usize| {
        if cov[v] < 0.0 {
            let f = ctx.face_of(v);
            cov[v] = if body.is_body[v] != 0 { beard_coverage(region, f[0], f[1], f[2]) as f32 } else { 0.0 };
        }
        cov[v] as f64
    };
    // The mass ends inside the painted beard: coverage eroded over the skin.
    let mut inner = vec![0f32; n];
    for &t in tris.iter() {
        inner[t as usize] = coverage(t as usize) as f32;
    }
    let mut sum = vec![0f32; n];
    let mut cnt = vec![0f32; n];
    let mut pass = 0;
    while pass < 3 && look.mass > 0.0 {
        sum.fill(0.0);
        cnt.fill(0.0);
        for t in (0..tris.len()).step_by(3) {
            let m = (inner[tris[t] as usize] as f64 + inner[tris[t + 1] as usize] as f64 + inner[tris[t + 2] as usize] as f64) / 3.0;
            for k in 0..3 {
                let v = tris[t + k] as usize;
                sum[v] = (sum[v] as f64 + m) as f32;
                cnt[v] += 1.0;
            }
        }
        for v in 0..n {
            if cnt[v] != 0.0 {
                inner[v] = (inner[v] as f64).min(sum[v] as f64 / cnt[v] as f64) as f32;
            }
        }
        pass += 1;
    }
    let thickness = |ctx: &Ctx, v: usize| {
        let f = ctx.face_of(v);
        // Fuller on the chin and jaw than high on the cheeks.
        let fullness =
            0.7 + 0.3 * smoothstep(-0.6, -1.6, f[1]) + 0.15 * (1.0 - smoothstep(0.3, 1.0, f[0].abs())) * smoothstep(-1.3, -1.9, f[1]);
        0.0008
            + look.mass
                * scale_k
                * fullness
                * smoothstep(0.35, 1.0, inner[v] as f64)
                * if is_must(f) && style != "mustache" { 0.7 } else { 1.0 }
    };
    let mut shell_of: HashMap<usize, u32> = HashMap::new();
    let mut t = 0;
    while t < tris.len() && look.mass > 0.0 {
        let (a, c, d) = (tris[t] as usize, tris[t + 1] as usize, tris[t + 2] as usize);
        t += 3;
        if coverage(a).max(coverage(c)).max(coverage(d)) < 0.02 {
            continue;
        }
        let mut ids = [0u32; 3];
        for (k, v) in [a, c, d].into_iter().enumerate() {
            ids[k] = match shell_of.get(&v) {
                Some(&i) => i,
                None => {
                    let i = b.count() as u32;
                    let nv = [body.normals[v * 3] as f64, body.normals[v * 3 + 1] as f64, body.normals[v * 3 + 2] as f64];
                    let p = ctx.pos(v);
                    b.follow = v as u32;
                    let u = 0.5 + 0.5 * (ctx.face[v * 3] as f64 / 6.0 + 0.5).clamp(0.03, 0.97);
                    let w = vertex_weights(ctx, Some(v));
                    b.vert(add(p, mul(nv, thickness(ctx, v))), nv, u, inner[v] as f64, 1.1, &w);
                    shell_of.insert(v, i);
                    i
                }
            };
        }
        b.idx.extend_from_slice(&ids);
    }

    // --- Locks: wide tapered cards rooted in the mass, combed down (the mustache out to the sides).
    let roots = sample_surface(ctx, look.locks, |x, y, z| smoothstep(0.35, 0.8, beard_coverage(region, x, y, z)));
    for r in roots {
        let must = is_must(r.f);
        let mut l = ctx.rng.range(look.len[0], look.len[1]) * scale_k;
        // Long beards: shorter on the cheeks, longest at the chin.
        let chin_w = 1.0 - smoothstep(0.3, 1.1, r.f[0].abs());
        if l > 0.06 {
            l *= 0.35 + 0.65 * chin_w;
        }
        if must {
            l = ctx.rng.range(0.02, if style == "mustache" { 0.045 } else { 0.03 }) * scale_k;
        }
        let root = add(r.p, mul(r.n, thickness(ctx, r.v) * ctx.rng.range(0.2, 0.7)));
        let forked = style == "forked";
        let comb = move |p: Vec3, t: f64| {
            if must {
                return Some(norm([sign(p[0] - chin[0]) * 0.8, -0.6, 0.2]));
            }
            if forked && t > 0.4 {
                return Some(norm([fork_side(p) * 0.35, -1.0, 0.1]));
            }
            Some(norm([0.0, -1.0, 0.15]))
        };
        let o = StrandOpts {
            segs: if l > 0.06 { 7 } else { 4 },
            length: l,
            gravity: if must { 0.5 } else { 1.0 },
            stiff: 0.05,
            volume: 0.0,
            curl: 0.08,
            curl_freq: 1.0,
            noise: 0.03,
            comb: &comb,
            comb_k: 0.6,
            collide_head: false,
        };
        let pts = grow_strand(ctx, root, r.n, &o);
        let wgt = vertex_weights(ctx, Some(r.v));
        b.follow = r.v as u32;
        let w = ctx.rng.range(look.width[0], look.width[1]) * scale_k * if must { 0.85 } else { 1.0 };
        let flip = ctx.rng.float() < 0.5;
        let shade = ctx.rng.range(0.8, 1.2);
        let (u0, u1) = if flip { (LOCK_U[1], LOCK_U[0]) } else { (LOCK_U[0], LOCK_U[1]) };
        let rn = r.n;
        card(b, &pts, |t| w * (1.0 - t * 0.2), u0, u1, shade, |_| wgt.clone(), |_| rn, 0.0);
    }
    if style == "braided" {
        // A braid hanging from the chin: three twisted locks around one spine.
        let start = add(chin, [0.0, -0.07 * scale_k, 0.012]);
        let down = |_: Vec3, _: f64| Some(DOWN);
        let o = StrandOpts {
            segs: 12,
            length: 0.15 * scale_k,
            gravity: 1.0,
            stiff: 0.05,
            volume: 0.0,
            curl: 0.0,
            curl_freq: 1.0,
            noise: 0.0,
            comb: &down,
            comb_k: 0.5,
            collide_head: false,
        };
        let spine = grow_strand(ctx, start, DOWN, &o);
        let anchor = nearest_vertex(ctx, add(chin, [0.0, -0.04, 0.0]));
        let wgt = vertex_weights(ctx, anchor);
        b.follow = anchor.map_or(u32::MAX, |v| v as u32);
        for s in 0..3 {
            let sf = s as f64;
            let pts: Vec<Vec3> = spine
                .iter()
                .enumerate()
                .map(|(i, &p)| add(p, [(i as f64 * 1.6 + sf * 2.1).sin() * 0.006, 0.0, (i as f64 * 1.6 + sf * 2.1).cos() * 0.004]))
                .collect();
            card(b, &pts, |t| 0.024 * scale_k * (1.0 - t * 0.3), LOCK_U[0], LOCK_U[1], 0.95, |_| wgt.clone(), |_| FWD, sf);
            card(b, &pts, |t| 0.024 * scale_k * (1.0 - t * 0.3), LOCK_U[0], LOCK_U[1], 0.9, |_| wgt.clone(), |_| [1.0, 0.0, 0.0], sf);
        }
    }
}

// ------------------------------------------------------------------ horns, tusks, tail

/// A tube along a curve with a radius profile; `ridges` adds keratin rings.
fn tube(
    b: &mut Builder,
    pts: &[Vec3],
    radius: impl Fn(f64) -> f64,
    radial: usize,
    weights: impl Fn(Vec3, f64) -> Weights,
    ridges: f64,
    shade: impl Fn(f64) -> f64,
) {
    let base = b.count() as u32;
    let n = pts.len();
    let mut rf = if norm(sub(pts[1], pts[0]))[1].abs() > 0.9 { FWD } else { UP };
    for i in 0..n {
        let t = i as f64 / (n - 1) as f64;
        let tan = norm(sub(pts[(i + 1).min(n - 1)], pts[i.saturating_sub(1)]));
        let s1 = norm(cross(tan, rf));
        let s2 = cross(s1, tan);
        rf = s2;
        let ring = if ridges != 0.0 { (t * ridges * PI * 2.0).sin() } else { 0.0 };
        let rr = radius(t) * (1.0 + 0.06 * ring);
        let w = weights(pts[i], t);
        for j in 0..=radial {
            let a = (j as f64 / radial as f64) * PI * 2.0;
            let dir = add(mul(s1, a.cos()), mul(s2, a.sin()));
            b.vert(add(pts[i], mul(dir, rr)), dir, j as f64 / radial as f64, t, shade(t) * (1.0 + 0.08 * ring), &w);
        }
    }
    let radial = radial as u32;
    for i in 0..(n as u32 - 1) {
        for j in 0..radial {
            let a = base + i * (radial + 1) + j;
            let c = a + radial + 1;
            b.idx.extend_from_slice(&[a, c, a + 1, a + 1, c, c + 1]);
        }
    }
}

fn build_horns(ctx: &mut Ctx, style: &str, horn_size: f64, scale: f64, b: &mut Builder) {
    let r = ctx.r;
    let size = horn_size * if scale > 1.3 { 1.2 } else { 1.0 };
    if style == "none" || size < 0.05 {
        return;
    }
    let head = ctx.head_w();
    let head_w = |_: Vec3, _: f64| head.clone();
    let s_ = r * (0.8 + size * 1.2);
    // Darker at the root, paler toward the tip.
    let shade = |t: f64| 0.72 + 0.4 * t;
    for s in [-1.0, 1.0] {
        let mut curve: Vec<Vec3> = Vec::new();
        let steps = 18;
        // Root on the upper forehead / temple, sunk into the skull so the horn grows out of it.
        let base = r * (0.12 + size * 0.08);
        let root = on_skull(ctx, [s * 0.55, 0.62, 0.45], base * 0.9);
        for i in 0..=steps {
            let t = i as f64 / steps as f64;
            let p = match style {
                "ram" => {
                    // Spiral back and round beside the ear.
                    let ang = t * PI * 1.55;
                    let rr = s_ * 0.42 * (1.0 - t * 0.35);
                    let center = add(root, [s * s_ * 0.12, -s_ * 0.12, -s_ * 0.3]);
                    if i == 0 {
                        root
                    } else {
                        add(center, [s * (s_ * 0.2 * t), (ang + 0.6).cos() * rr * 1.1, (ang + 0.6).sin() * rr - s_ * 0.1])
                    }
                }
                "straight" => add(root, mul(norm([s * 0.25, 1.0, -0.35]), s_ * t * 0.95)),
                "antler" => add(root, [s * s_ * 0.45 * t, s_ * 0.95 * t, -s_ * 0.25 * t * t]),
                "crown" => add(root, mul(norm([s * 0.3, 1.0, 0.1]), s_ * 0.35 * t)),
                // Swept: back along the skull, then up.
                _ => add(root, [s * s_ * 0.18 * t, s_ * (0.15 * t + 0.35 * t * t * t), -s_ * t]),
            };
            curve.push(p);
        }
        // A flared base where the horn meets the skin.
        let ridges = match style {
            "ram" => 9.0,
            "straight" => 6.0,
            _ => 4.0,
        };
        tube(b, &curve, |t| base * (1.0 + 0.35 * (1.0 - t * 8.0).max(0.0)) * (1.0 - t).powf(0.75) + 0.0015, 12, head_w, ridges, shade);
        if style == "antler" {
            // Two forward tines.
            for ft in [0.45, 0.72] {
                let o = curve[js_round(ft * steps as f64) as usize];
                let tine: Vec<Vec3> = (0..=6).map(|i| add(o, mul(norm([s * 0.2, 0.8, 0.6]), s_ * 0.32 * (i as f64 / 6.0)))).collect();
                tube(b, &tine, |t| base * 0.5 * (1.0 - t) + 0.001, 8, head_w, 0.0, |t| shade(ft + t * 0.3));
            }
        }
    }
    if style == "crown" {
        // A ring of smaller spikes round the brow line.
        for k in -3i32..=3 {
            if k == 0 {
                continue;
            }
            let ang = k as f64 * 0.32;
            let dir = norm([ang.sin(), 0.7, ang.cos() * 0.75]);
            let root = on_skull(ctx, dir, r * 0.05);
            let tip = add(root, mul(dir, r * 0.3 * size + 0.01 + r * 0.05));
            tube(b, &[root, lerp3(root, tip, 0.5), tip], |t| r * 0.06 * (1.0 - t) + 0.001, 8, head_w, 0.0, shade);
        }
    }
}

/// Z of the body's front surface at (x, y), near `z0`.
fn front_surface(ctx: &Ctx, x: f64, y: f64, z0: f64) -> f64 {
    let n = ctx.body.positions.len() / 3;
    let mut best = f64::NEG_INFINITY;
    for v in 0..n {
        let p = ctx.pos(v);
        if ctx.body.is_body[v] == 0 || (p[0] - x).abs() > 0.005 || (p[1] - y).abs() > 0.005 || (p[2] - z0).abs() > 0.05 {
            continue;
        }
        best = best.max(p[2]);
    }
    if best.is_finite() {
        best
    } else {
        z0
    }
}

fn build_tusks(ctx: &mut Ctx, tusks: f64, scale: f64, b: &mut Builder) {
    if tusks < 0.05 {
        return;
    }
    let mouth = ctx.body.mouth;
    let k = (0.018 + tusks * 0.026) * if scale > 1.3 { 1.2 } else { 1.0 };
    let head = ctx.head_w();
    for s in [-1.0, 1.0] {
        // Rooted in the lower lip near the mouth corners, so they rest in front of the upper lip.
        let x = mouth[0] + s * ctx.ipd * 0.38;
        let y = mouth[1] - 0.009;
        // Deep enough that the whole base sits in the lip; the first point is inside the jaw.
        let r0 = k * 0.23;
        let root = [x, y, front_surface(ctx, x, y, mouth[2]) - r0 * 1.2];
        let mut pts = vec![add(root, [0.0, -r0 * 1.5, -r0 * 0.5])];
        for i in 0..=8 {
            let t = i as f64 / 8.0;
            pts.push(add(root, [s * k * 0.16 * t, k * t, k * 0.12 * t + k * 0.18 * t * t]));
        }
        // Tusks move with the lower lip when the mouth opens.
        b.follow = nearest_vertex(ctx, [x, y, root[2] + r0 * 1.2]).map_or(u32::MAX, |v| v as u32);
        tube(b, &pts, |t| r0 * (1.0 - t).powf(0.8) + 0.0008, 10, |_, _| head.clone(), 0.0, |t| 0.85 + 0.2 * t);
    }
}

/// Distance from the head centre to the skin along `dir` (the head is not a sphere).
fn skull_radius(ctx: &Ctx, dir: Vec3) -> f64 {
    let d = norm(dir);
    let (mut sum, mut n, mut best, mut best_dot) = (0.0, 0, 0.0, -1.0);
    for v in 0..ctx.body.positions.len() / 3 {
        if ctx.body.is_body[v] == 0 {
            continue;
        }
        let rel = sub(ctx.pos(v), ctx.c);
        let l = len(rel);
        if l < ctx.r * 0.5 || l > ctx.r * 2.0 {
            continue;
        }
        let c = dot(rel, d) / l;
        if c > best_dot {
            best_dot = c;
            best = l;
        }
        if c > 0.996 {
            sum += l;
            n += 1;
        }
    }
    if n > 0 {
        sum / n as f64
    } else if best != 0.0 {
        best
    } else {
        ctx.r
    }
}

/// A point on the skull surface in direction `dir`, sunk `sink` meters into the head.
fn on_skull(ctx: &Ctx, dir: Vec3, sink: f64) -> Vec3 {
    let d = norm(dir);
    add(ctx.c, mul(d, skull_radius(ctx, d) - sink))
}

/// Tail root: on the lower back, just above the buttocks.
fn tail_root(ctx: &Ctx) -> (Vec3, Option<usize>) {
    let y = lerp3(ctx.head("pelvis"), ctx.head("spine_01"), 0.6)[1];
    let (mut best, mut bz) = (None, f64::INFINITY);
    for v in 0..ctx.body.positions.len() / 3 {
        let p = ctx.pos(v);
        if ctx.body.is_body[v] == 0 || p[0].abs() > 0.025 || (p[1] - y).abs() > 0.02 {
            continue;
        }
        if p[2] < bz {
            bz = p[2];
            best = Some(v);
        }
    }
    let p = if best.is_some() { [0.0, y, bz + 0.012] } else { add(ctx.head("pelvis"), [0.0, 0.0, -0.1]) };
    (p, best)
}

fn build_tail(ctx: &mut Ctx, style: &str, length: f64, b: &mut Builder) {
    if style == "none" || length < 0.05 {
        return;
    }
    let (surface, v) = tail_root(ctx);
    let h = ctx.height;
    let l = length * h * 0.62;
    let r0 = match style {
        "thin" => 0.022,
        "furred" => 0.05,
        _ => 0.065,
    } * (h / 1.8);
    // The tube starts inside the body (one base radius in front of the skin) so the whole base is
    // buried, and leaves the lower back with a flare.
    let inside = add(surface, [0.0, r0 * 0.15, r0 * 1.1]);
    let mut pts = vec![inside, add(surface, [0.0, r0 * 0.05, r0 * 0.45])];
    let segs = 28;
    for i in 0..=segs {
        let t = i as f64 / segs as f64;
        // Out backwards, drooping, the end curling up a little (resting pose).
        pts.push(add(surface, [0.0, -l * (0.45 * t - 0.12 * t * t * t), -l * t * 0.95]));
    }
    // A chain of bones along the tail (parented to the pelvis) so it can sway.
    let nb = TAIL_BONES.len();
    let at = |f: f64| pts[2 + js_round(f * segs as f64) as usize];
    b.bones = TAIL_BONES
        .iter()
        .enumerate()
        .map(|(k, name)| PartBone {
            name: name.to_string(),
            parent: if k > 0 { TAIL_BONES[k - 1].to_string() } else { "pelvis".into() },
            head: at(k as f64 / nb as f64).map(|x| x as f32),
        })
        .collect();
    let base = ctx.body.skeleton.names.len() as u16;
    let hips = vertex_weights(ctx, v);
    let n = pts.len();
    let segs = segs as f64;
    tube(
        b,
        &pts,
        |t| {
            let u = ((t * (n - 1) as f64 - 2.0) / segs).max(0.0);
            (r0 * (1.0 - u * 0.92) + 0.003) * (1.0 + 0.3 * (1.0 - (u * 9.0).min(1.0)))
        },
        16,
        |_, t| {
            let u = ((t * (n - 1) as f64 - 2.0) / segs).max(0.0);
            // Base: blended with the body's own weights so the seam follows the hips.
            if u < 0.04 {
                return hips.clone();
            }
            let f = (nb as f64 - 1e-3).min(u * nb as f64);
            let i0 = f.floor();
            let w1 = f - i0;
            let i1 = (nb as f64 - 1.0).min(i0 + 1.0);
            if i0 == 0.0 && w1 < 0.5 {
                let mut w = vec![(base, 0.5 + w1)];
                w.extend(hips.iter().map(|&(j, x)| (j, x * (0.5 - w1))));
                w
            } else {
                vec![(base + i0 as u16, 1.0 - w1), (base + i1 as u16, w1)]
            }
        },
        0.0,
        |_| 1.0,
    );
}

/// Per vertex: the body UV at the root (skin-material parts take the skin's colour from there).
fn flat_uv(b: &mut Builder, uvs: &[f32], v: Option<usize>) {
    let (u, w) = match v {
        Some(v) => (uvs[v * 2] as f64, uvs[v * 2 + 1] as f64),
        None => (0.5, 0.5),
    };
    for i in (0..b.uv.len()).step_by(2) {
        b.uv[i] = u;
        b.uv[i + 1] = w;
    }
}

/// True if the config adds any part.
pub fn has_parts(c: &PartsConfig) -> bool {
    (c.horns != "none" && c.horn_size > 0.05)
        || c.tusks > 0.05
        || (c.tail != "none" && c.tail_length > 0.05)
        || c.beard != "none"
        || c.hair != "none"
}

/// Builds the add-on meshes for a body.
pub fn build_parts(body: &PartsBody, c: &PartsConfig) -> Vec<PartMesh> {
    if !has_parts(c) {
        return Vec::new();
    }
    let mut ctx = Ctx::new(body, c.seed, c.scale);
    let mut parts = Vec::new();
    let mut push = |ctx: &mut Ctx, name: &str, kind: PartKind, color: Option<[f64; 3]>, fill: &dyn Fn(&mut Ctx, &mut Builder)| {
        let mut b = Builder::new();
        fill(ctx, &mut b);
        if b.count() > 0 {
            parts.push(b.build(name, kind, color));
        }
    };
    if c.hair == "leaves" {
        push(&mut ctx, "leaves", PartKind::Leaf, None, &build_leaves);
    }
    if c.hair == "crest" {
        push(&mut ctx, "crest", PartKind::Fin, None, &|ctx, b| {
            build_crest(ctx, b);
            let v = nearest_vertex(ctx, add(ctx.c, [0.0, ctx.r, 0.0]));
            flat_uv(b, &ctx.body.uvs, v);
        });
    }
    push(&mut ctx, "beard", PartKind::Hair, None, &|ctx, b| build_beard(ctx, &c.beard, c.scale, b));
    push(&mut ctx, "horns", PartKind::Horn, Some(c.horn_color), &|ctx, b| build_horns(ctx, &c.horns, c.horn_size, c.scale, b));
    push(&mut ctx, "tusks", PartKind::Tusk, Some([0.9, 0.86, 0.74]), &|ctx, b| build_tusks(ctx, c.tusks, c.scale, b));
    let tail_kind = if c.tail == "furred" { PartKind::Fur } else { PartKind::Skin };
    push(&mut ctx, "tail", tail_kind, None, &|ctx, b| {
        build_tail(ctx, &c.tail, c.tail_length, b);
        let v = tail_root(ctx).1;
        flat_uv(b, &ctx.body.uvs, v);
    });
    parts
}

/// Eye centres (actor's left, right) of a shape.
pub fn eye_centres(shape: &ActorShape, eyes: &MeshData) -> Option<[Vec3; 2]> {
    let (src, _) = shape.source_of(eyes)?;
    let mut seen = std::collections::HashSet::new();
    let order: Vec<usize> = eyes.map.iter().map(|&v| v as usize).filter(|v| seen.insert(*v)).collect();
    let mean = |side: f64| -> Vec3 {
        let (mut x, mut y, mut z, mut w) = (0.0, 0.0, 0.0, 0.0);
        for &v in &order {
            if src[v * 3] as f64 * side <= 0.0 {
                continue;
            }
            x += src[v * 3] as f64;
            y += src[v * 3 + 1] as f64;
            z += src[v * 3 + 2] as f64;
            w += 1.0;
        }
        if w > 0.0 {
            [x / w, y / w, z / w]
        } else {
            [0.032 * side, 0.0, 0.0]
        }
    };
    Some([mean(1.0), mean(-1.0)])
}

/// Collects what the builders need from an evaluated shape: body triangles and skin weights (from
/// the unsubdivided body mesh), eye centres, ear midpoint and mouth. `ear_masks` and `lip_mask` are
/// per base vertex masks (see `ActorRuntime::target_mask`).
pub fn parts_body<'a>(
    shape: &'a ActorShape,
    body: &MeshData,
    eyes: &MeshData,
    ear_masks: Option<[&[f32]; 2]>,
    lip_mask: Option<&[f32]>,
) -> Option<PartsBody<'a>> {
    let sk = shape.skeleton.as_ref()?;
    let (bj, bw) = (body.joints.as_ref()?, body.weights.as_ref()?);
    if body.stencil.is_some() {
        return None;
    }
    let pos = &shape.positions;
    let n = pos.len() / 3;
    let (mut joints, mut weights, mut uvs, mut is_body) = (vec![0u16; n * 4], vec![0f32; n * 4], vec![0f32; n * 2], vec![0u8; n]);
    for (i, &v) in body.map.iter().enumerate() {
        let v = v as usize;
        is_body[v] = 1;
        for k in 0..4 {
            joints[v * 4 + k] = bj[i * 4 + k];
            weights[v * 4 + k] = bw[i * 4 + k];
        }
        uvs[v * 2] = body.uv[i * 2];
        uvs[v * 2 + 1] = body.uv[i * 2 + 1];
    }
    let triangles: Vec<u32> = body.indices.iter().map(|&i| body.map[i as usize]).collect();
    let mean = |pick: &dyn Fn(usize) -> f64| -> Vec3 {
        let (mut x, mut y, mut z, mut w) = (0.0, 0.0, 0.0, 0.0);
        for v in 0..n {
            let m = if is_body[v] != 0 { pick(v) } else { 0.0 };
            if m <= 0.0 {
                continue;
            }
            x += pos[v * 3] as f64 * m;
            y += pos[v * 3 + 1] as f64 * m;
            z += pos[v * 3 + 2] as f64 * m;
            w += m;
        }
        if w != 0.0 {
            [x / w, y / w, z / w]
        } else {
            [0.0; 3]
        }
    };
    let [el, er] = eye_centres(shape, eyes)?;
    let head_j = sk.heads[sk.names.iter().position(|n| n == "head")?];
    let ear_mid = match ear_masks {
        Some([l, r]) => mul(add(mean(&|v| if l[v] > 0.5 { 1.0 } else { 0.0 }), mean(&|v| if r[v] > 0.5 { 1.0 } else { 0.0 })), 0.5),
        None => add(head_j, [0.0, 0.06, 0.0]),
    };
    let scale = len(sub(el, er)) / 0.064;
    let mouth = match lip_mask {
        Some(m) => add(mean(&|v| if m[v] > 0.4 { 1.0 } else { 0.0 }), [0.0, -0.008 * scale, 0.0]),
        None => add(el, [-el[0], -0.07 * scale, 0.01]),
    };
    Some(PartsBody {
        positions: pos,
        normals: &shape.normals,
        triangles,
        joints,
        weights,
        uvs,
        is_body,
        skeleton: sk,
        eyes: [el, er],
        ear_mid,
        mouth,
    })
}
