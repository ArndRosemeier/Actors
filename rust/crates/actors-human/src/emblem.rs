//! Chest emblems for hero costumes: plate shapes and symbols as 2D signed distance fields, and the
//! emblem texture painted from them (port of `packages/human/src/emblem.ts`).
//!
//! Coordinates: the emblem's unit square, -1..1, x to the wearer's left (+X), y up. Distances are
//! negative inside.

use std::f64::consts::PI;
use std::sync::OnceLock;

pub const EMBLEM_SHAPES: [&str; 8] = ["none", "circle", "shield", "diamond", "star", "hexagon", "badge", "cutout"];
pub const EMBLEM_SYMBOLS: [&str; 11] = ["none", "star", "bolt", "atom", "rocket", "planet", "comet", "flame", "eye", "wings", "crown"];

type P = [f64; 2];

fn length(x: f64, y: f64) -> f64 {
    (x * x + y * y).sqrt()
}

/// Signed distance to a closed polygon (iq's sdPolygon).
pub fn sd_polygon(x: f64, y: f64, v: &[P]) -> f64 {
    let mut d = (x - v[0][0]).powi(2) + (y - v[0][1]).powi(2);
    let mut s = 1.0;
    let mut j = v.len() - 1;
    for i in 0..v.len() {
        let (ex, ey) = (v[j][0] - v[i][0], v[j][1] - v[i][1]);
        let (wx, wy) = (x - v[i][0], y - v[i][1]);
        let t = ((wx * ex + wy * ey) / (ex * ex + ey * ey)).clamp(0.0, 1.0);
        let (bx, by) = (wx - ex * t, wy - ey * t);
        d = d.min(bx * bx + by * by);
        let c1 = y >= v[i][1];
        let c2 = y < v[j][1];
        let c3 = ex * wy > ey * wx;
        if (c1 && c2 && c3) || (!c1 && !c2 && !c3) {
            s = -s;
        }
        j = i;
    }
    s * d.sqrt()
}

fn circle(x: f64, y: f64, cx: f64, cy: f64, r: f64) -> f64 {
    length(x - cx, y - cy) - r
}

fn ellipse(x: f64, y: f64, rx: f64, ry: f64, a: f64) -> f64 {
    let (c, s) = (a.cos(), a.sin());
    let (u, v) = (x * c + y * s, -x * s + y * c);
    (length(u / rx, v / ry) - 1.0) * rx.min(ry)
}

fn union(d: &[f64]) -> f64 {
    d.iter().copied().fold(f64::INFINITY, f64::min)
}

fn minus(a: f64, b: f64) -> f64 {
    a.max(-b)
}

fn teardrop(x: f64, y: f64, bx: f64, by: f64, r: f64, tx: f64, ty: f64) -> f64 {
    let (dx, dy) = (tx - bx, ty - by);
    let l = length(dx, dy);
    let u = ((x - bx) * dy - (y - by) * dx) / l;
    let v = ((x - bx) * dx + (y - by) * dy) / l;
    let c = (l * l - r * r) / (2.0 * r);
    let rr = c + r;
    let lens = (length(u - c, v) - rr).max(length(u + c, v) - rr).max(-v);
    (length(u, v) - r).min(lens)
}

fn star_points(n: usize, k: f64, r: f64, cx: f64, cy: f64) -> Vec<P> {
    (0..n * 2)
        .map(|i| {
            let a = PI / 2.0 + (i as f64 * PI) / n as f64;
            let rr = if i % 2 == 1 { r * k } else { r };
            [cx + a.cos() * rr, cy + a.sin() * rr]
        })
        .collect()
}

struct Polys {
    star: Vec<P>,
    hex: Vec<P>,
    shield: Vec<P>,
    badge: Vec<P>,
    bolt: Vec<P>,
    rocket_fins: Vec<P>,
    crown: Vec<P>,
    wing: Vec<P>,
    wing_l: Vec<P>,
}

fn polys() -> &'static Polys {
    static P: OnceLock<Polys> = OnceLock::new();
    P.get_or_init(|| {
        let mut shield: Vec<P> = vec![[-0.86, 0.86], [0.86, 0.86], [0.9, 0.2]];
        for i in 1..12 {
            let t = i as f64 / 12.0;
            shield.push([0.9 * (1.0 - t).powf(1.25) * (t * 0.6).cos(), 0.2 - 1.18 * ((t * PI) / 2.0).sin()]);
        }
        shield.push([0.0, -0.98]);
        for i in (1..12).rev() {
            let t = i as f64 / 12.0;
            shield.push([-0.9 * (1.0 - t).powf(1.25) * (t * 0.6).cos(), 0.2 - 1.18 * ((t * PI) / 2.0).sin()]);
        }
        shield.push([-0.9, 0.2]);
        let wing: Vec<P> = vec![
            [0.08, 0.1],
            [0.95, 0.55],
            [0.85, 0.32],
            [0.98, 0.25],
            [0.78, 0.05],
            [0.9, -0.05],
            [0.62, -0.18],
            [0.7, -0.3],
            [0.08, -0.25],
        ];
        let wing_l = wing.iter().map(|p| [-p[0], p[1]]).rev().collect();
        Polys {
            star: star_points(5, 0.42, 0.98, 0.0, -0.04),
            hex: (0..6).map(|i| [((i as f64 * PI) / 3.0).cos() * 0.98, ((i as f64 * PI) / 3.0).sin() * 0.98]).collect(),
            shield,
            badge: (0..96)
                .map(|i| {
                    let a = (i as f64 / 96.0) * PI * 2.0;
                    let r = 0.9 + 0.08 * (a * 8.0).cos();
                    [a.cos() * r, a.sin() * r]
                })
                .collect(),
            bolt: vec![[0.18, 0.95], [-0.5, -0.05], [-0.06, -0.05], [-0.3, -0.95], [0.55, 0.18], [0.1, 0.18], [0.42, 0.95]],
            rocket_fins: vec![
                [-0.22, -0.2],
                [-0.62, -0.7],
                [-0.58, -0.9],
                [-0.2, -0.62],
                [0.2, -0.62],
                [0.58, -0.9],
                [0.62, -0.7],
                [0.22, -0.2],
            ],
            crown: vec![[-0.8, -0.55], [-0.85, 0.45], [-0.45, 0.0], [0.0, 0.7], [0.45, 0.0], [0.85, 0.45], [0.8, -0.55]],
            wing,
            wing_l,
        }
    })
}

/// Plate outline: negative inside, in emblem units. "cutout" is the symbol's own outline.
pub fn plate_distance(shape: &str, symbol: &str, x: f64, y: f64) -> f64 {
    let p = polys();
    match shape {
        "circle" => length(x, y) - 0.96,
        "shield" => sd_polygon(x, y, &p.shield),
        "diamond" => (x.abs() * 0.78 + y.abs() * 0.63 - 0.62) / (0.78f64 * 0.78 + 0.63 * 0.63).sqrt(),
        "star" => sd_polygon(x, y, &p.star),
        "hexagon" => sd_polygon(x, y, &p.hex),
        "badge" => sd_polygon(x, y, &p.badge),
        "cutout" => {
            if symbol == "none" {
                length(x, y) - 0.96
            } else {
                symbol_distance(symbol, x / 0.95, y / 0.95).0 * 0.95
            }
        }
        _ => 1.0,
    }
}

/// Where the symbol sits on each plate: (centre y, scale).
pub fn symbol_frame(shape: &str) -> (f64, f64) {
    match shape {
        "shield" => (0.08, 0.62),
        "star" => (-0.04, 0.4),
        "diamond" => (0.0, 0.5),
        "cutout" => (0.0, 0.95),
        _ => (0.0, 0.68),
    }
}

/// A symbol as two fields: (ink, cut) — the symbol colour, and details drawn back in the plate
/// colour on top of the ink.
pub fn symbol_distance(symbol: &str, x: f64, y: f64) -> (f64, f64) {
    let none = 1.0;
    let p = polys();
    match symbol {
        "star" => (sd_polygon(x, y, &p.star), none),
        "bolt" => (sd_polygon(x, y, &p.bolt), none),
        "atom" => {
            let ring = |a: f64| ellipse(x, y, 0.95, 0.34, a).abs() - 0.075;
            (union(&[ring(0.0), ring(PI / 3.0), ring((2.0 * PI) / 3.0), circle(x, y, 0.0, 0.0, 0.2)]), none)
        }
        "rocket" => {
            let body = circle(x, y, -0.5, -0.2, 0.82).max(circle(x, y, 0.5, -0.2, 0.82)).max(-(y + 0.62));
            let fins = sd_polygon(x, y, &p.rocket_fins);
            let flame = sd_polygon(x, y, &[[-0.12, -0.66], [0.12, -0.66], [0.0, -0.98]]);
            (union(&[body, fins, flame]), circle(x, y, 0.0, 0.12, 0.13).abs() - 0.045)
        }
        "planet" => {
            let ball = circle(x, y, 0.0, 0.0, 0.5);
            let ring = ellipse(x, y, 0.98, 0.26, 0.32).abs() - 0.07;
            let behind = ring < 0.0 && ball < 0.06 && y + x * 0.33 > 0.0;
            if behind {
                (ball.max(-(ring.abs() - 0.0)), none)
            } else {
                (ball.min(ring), (-ring - 0.12).max((ring + 0.035).abs() - 0.02).max(ball))
            }
        }
        "comet" => {
            let head = circle(x, y, 0.42, 0.42, 0.34);
            let tail = |o: f64, w: f64| {
                let (dx, dy) = (-0.7f64, -0.7f64);
                let l = length(dx, dy);
                let (ux, uy) = (dx / l, dy / l);
                let px = x - 0.42 - o * uy;
                let py = y - 0.42 + o * ux;
                let t = ((px * ux + py * uy) / 1.35).clamp(0.0, 1.0);
                let (qx, qy) = (px - ux * t * 1.35, py - uy * t * 1.35);
                length(qx, qy) - w * (1.0 - t).powf(1.4)
            };
            (union(&[head, tail(0.0, 0.26), tail(0.24, 0.12), tail(-0.24, 0.12)]), none)
        }
        "flame" => {
            let main = teardrop(x, y, 0.0, -0.42, 0.5, 0.06, 0.98);
            let left = teardrop(x, y, -0.3, -0.4, 0.3, -0.68, 0.42);
            let right = teardrop(x, y, 0.3, -0.45, 0.28, 0.66, 0.3);
            (union(&[main, left, right]), teardrop(x, y, 0.0, -0.52, 0.24, 0.02, 0.2))
        }
        "eye" => {
            let almond = circle(x, y, 0.0, -0.62, 0.98).max(circle(x, y, 0.0, 0.62, 0.98));
            (almond, minus(circle(x, y, 0.0, 0.0, 0.36), circle(x, y, 0.0, 0.0, 0.16)))
        }
        "wings" => (union(&[sd_polygon(x, y, &p.wing), sd_polygon(x, y, &p.wing_l), circle(x, y, 0.0, -0.05, 0.2)]), none),
        "crown" => (
            union(&[
                sd_polygon(x, y, &p.crown),
                circle(x, y, 0.0, 0.78, 0.1),
                circle(x, y, -0.86, 0.55, 0.09),
                circle(x, y, 0.86, 0.55, 0.09),
            ]),
            circle(x, y, 0.0, -0.28, 0.1).min(circle(x, y, -0.45, -0.3, 0.07)).min(circle(x, y, 0.45, -0.3, 0.07)),
        ),
        _ => (none, none),
    }
}

/// What an emblem texture shows (colours sRGB 0..1).
#[derive(Clone, Debug, PartialEq)]
pub struct EmblemPaint {
    pub shape: String,
    pub symbol: String,
    pub plate: [f64; 3],
    pub ink: [f64; 3],
}

fn smooth(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// The emblem texture: `size`² RGBA (sRGB bytes, row 0 at the top).
pub fn emblem_texture(e: &EmblemPaint, size: usize) -> Vec<u8> {
    let mut out = vec![0u8; size * size * 4];
    let (cy, scale) = symbol_frame(&e.shape);
    let px = 2.0 / size as f64;
    let plain = e.symbol == "none" || e.shape == "none";
    let cutout = e.shape == "cutout";
    for row in 0..size {
        let y = 1.0 - ((row as f64 + 0.5) / size as f64) * 2.0;
        for col in 0..size {
            let x = ((col as f64 + 0.5) / size as f64) * 2.0 - 1.0;
            let (sx, sy) = (x / scale, (y - cy) / scale);
            let (s_ink, s_cut) = if plain { (1.0, 1.0) } else { symbol_distance(&e.symbol, sx, sy) };
            let ink = if cutout { 1.0 } else { 1.0 - smooth(-px, px, s_ink * scale) };
            let cut = 1.0 - smooth(-px, px, s_cut * scale);
            let below = if e.symbol == "none" { 1.0 } else { symbol_distance(&e.symbol, sx + 0.035, sy + 0.05).0 };
            let shadow = if cutout { 0.0 } else { (1.0 - smooth(0.0, 0.08, below * scale)) * (1.0 - ink) * 0.35 };
            let rim = if e.symbol == "none" { 0.0 } else { smooth(-0.035, 0.0, s_ink * scale) * ink };
            let sheen = 1.06 - 0.12 * smooth(0.0, 1.4, length(x + 0.35, y - 0.4));
            let o = (row * size + col) * 4;
            for k in 0..3 {
                let base = if cutout { e.ink[k] } else { e.plate[k] };
                let mut c = base * (1.0 - ink) + e.ink[k] * ink;
                c = c * (1.0 - cut) + e.plate[k] * cut;
                c *= (1.0 - shadow) * sheen * (1.0 - 0.12 * rim * if y < cy { 1.0 } else { -0.6 });
                out[o + k] = (c.clamp(0.0, 1.0) * 255.0 + 0.5).floor() as u8;
            }
            out[o + 3] = 255;
        }
    }
    out
}
