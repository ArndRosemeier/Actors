//! Fantasy-race skin patterns (scales, bark, spots, veins, ...) baked into the skin texture.
//!
//! The three.js adapter evaluates these per pixel in bind-pose space (`GLSL_PATTERN` in
//! @actors/three); Engine has no custom skin shader, so the same functions run here once per
//! texel of the body's UV layout, at the texel's bind-pose position. Not baked: the bump the
//! patterns add to the normal and their roughness change.

use glam::Vec3;

fn fract(v: Vec3) -> Vec3 {
    v - v.floor()
}

fn hash13(p: Vec3) -> f32 {
    let mut p = fract(p * 0.1031);
    p += p.dot(Vec3::new(p.z, p.y, p.x) + 31.32);
    let v = (p.x + p.y) * p.z;
    v - v.floor()
}

fn hash33(p: Vec3) -> Vec3 {
    let mut p = fract(p * Vec3::new(0.1031, 0.1030, 0.0973));
    p += p.dot(Vec3::new(p.y, p.x, p.z) + 33.33);
    fract((Vec3::new(p.x, p.x, p.y) + Vec3::new(p.y, p.x, p.x)) * Vec3::new(p.z, p.y, p.x))
}

fn mix(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

fn mix3(a: Vec3, b: Vec3, t: f32) -> Vec3 {
    a + (b - a) * t
}

fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn noise3(p: Vec3) -> f32 {
    let i = p.floor();
    let f = p - i;
    let u = f * f * (Vec3::splat(3.0) - 2.0 * f);
    let h = |x: f32, y: f32, z: f32| hash13(i + Vec3::new(x, y, z));
    mix(
        mix(mix(h(0., 0., 0.), h(1., 0., 0.), u.x), mix(h(0., 1., 0.), h(1., 1., 0.), u.x), u.y),
        mix(mix(h(0., 0., 1.), h(1., 0., 1.), u.x), mix(h(0., 1., 1.), h(1., 1., 1.), u.x), u.y),
        u.z,
    )
}

fn fbm3(mut p: Vec3) -> f32 {
    let (mut s, mut a) = (0.0, 0.5);
    for _ in 0..4 {
        s += a * noise3(p);
        p = p * 2.03 + 17.1;
        a *= 0.5;
    }
    s
}

/// F1 distance, F2 distance, cell id hash.
fn voronoi3(p: Vec3) -> Vec3 {
    let i = p.floor();
    let f = p - i;
    let (mut d1, mut d2, mut id) = (8.0f32, 8.0f32, 0.0);
    for z in -1..=1 {
        for y in -1..=1 {
            for x in -1..=1 {
                let g = Vec3::new(x as f32, y as f32, z as f32);
                let r = g + hash33(i + g) - f;
                let d = r.dot(r);
                if d < d1 {
                    d2 = d1;
                    d1 = d;
                    id = hash13(i + g + 7.7);
                } else if d < d2 {
                    d2 = d;
                }
            }
        }
    }
    Vec3::new(d1.sqrt(), d2.sqrt(), id)
}

/// Pattern settings, as the three.js skin uniforms `uPattern`, `uAccent` and `uBind`.
#[derive(Clone, Copy, Debug)]
pub struct Pattern {
    /// `SKIN_PATTERNS` id: 1 freckles, 2 scales, 3 bark, 4 spots, 5 tattoos, 6 veins, 7 stripes, 8 crystals.
    pub id: u32,
    pub strength: f32,
    pub seed: f32,
    /// Glow of veins and crystals.
    pub glow: f32,
    /// Accent colour, linear.
    pub accent: Vec3,
    /// Body scale (patterns are sized for a 1.7 m body).
    pub scale: f32,
    /// Head joint height and depth in pattern space (feet at 0, +Z back).
    pub head: [f32; 2],
}

/// Pattern ids by the names a `CharacterConfig` uses.
pub fn pattern_id(name: &str) -> u32 {
    match name {
        "freckles" => 1,
        "scales" => 2,
        "bark" => 3,
        "spots" => 4,
        "tattoos" => 5,
        "veins" => 6,
        "stripes" => 7,
        "crystals" => 8,
        _ => 0,
    }
}

impl Pattern {
    /// The patterned colour (linear) at bind position `bind` (feet at 0, +Z back) and the light
    /// it emits. `lips` and `nails` are the skin masks there.
    pub fn apply(&self, mut c: Vec3, bind: Vec3, lips: f32, nails: f32) -> (Vec3, Vec3) {
        let (ps, seed, acc) = (self.strength, self.seed, self.accent);
        let mut emit = Vec3::ZERO;
        if self.id == 0 || ps <= 0.0 {
            return (c, emit);
        }
        let s = self.scale.max(0.3);
        let b = bind / s;
        let hp = Vec3::new(0.0, self.head[0], self.head[1]) / s;
        let face = smoothstep(hp.y - 0.02, hp.y + 0.04, b.y) * smoothstep(0.0, -0.05, b.z - hp.z);
        match self.id {
            1 => {
                let v = voronoi3(b * 260.0 + seed * 13.0);
                let zone = face.max(smoothstep(0.55, 0.8, noise3(b * 3.0)) * 0.6);
                let fr = (1.0 - smoothstep(0.12, 0.3, v.x)) * if v.z >= 0.45 { 1.0 } else { 0.0 } * zone;
                c = mix3(c, c * Vec3::new(0.78, 0.6, 0.48), fr * ps);
            }
            2 => {
                let sc = mix(48.0, 95.0, face);
                let v = voronoi3(b * sc + seed * 5.0);
                let edge = smoothstep(0.0, 0.18, v.y - v.x);
                let mask = ps * (1.0 - lips) * (1.0 - nails);
                let mut plate = mix3(acc, c, 0.45 + 0.45 * v.z);
                let belly = smoothstep(0.0, -0.06, b.z) * smoothstep(0.6, 1.2, b.y) * (1.0 - smoothstep(1.35, 1.5, b.y)) * (1.0 - face);
                plate = mix3(plate, mix3(c, acc, 0.5) * 1.15, belly * 0.6);
                c = mix3(c, mix3(plate * 0.55, plate, edge), mask);
            }
            3 => {
                let q = b * Vec3::new(28.0, 6.0, 28.0) + seed * 3.0;
                let warp = fbm3(q * 0.5) * 2.0;
                let ridge = ((b.x * 70.0 + b.z * 55.0) + warp * 3.0 + noise3(q) * 2.0).sin().abs();
                let groove = 1.0 - smoothstep(0.0, 0.35, ridge);
                let m = ps * (1.0 - face * 0.55) * (1.0 - lips);
                let knots = smoothstep(0.75, 0.9, noise3(b * 12.0 + 4.0));
                c = mix3(c, acc, m * (groove * 0.85).max(knots * 0.5));
                let moss = smoothstep(0.55, 0.75, fbm3(b * 9.0 + 9.0)) * groove;
                c = mix3(c, Vec3::new(0.013, 0.033, 0.005), m * moss * 0.6);
            }
            4 => {
                let sp = smoothstep(0.55, 0.62, fbm3(b * 7.0 + seed * 11.0));
                c = mix3(c, mix3(c, acc, 0.75), sp * ps * (1.0 - lips));
            }
            5 => {
                let bands = (b.y * 34.0 + fbm3(b * 5.0 + seed) * 6.0).sin().abs();
                let zone = smoothstep(0.35, 0.6, noise3(b * 2.2 + seed * 2.0)) * (1.0 - lips);
                let ink = (1.0 - smoothstep(0.15, 0.22, bands)) * zone;
                c = mix3(c, c * mix3(Vec3::new(0.03, 0.04, 0.08), acc * 0.6, 0.3), ink * ps);
            }
            6 => {
                let v1 = (fbm3(b * 14.0 + seed) - 0.5).abs();
                let v2 = (fbm3(b * 31.0 + seed * 2.0) - 0.5).abs();
                let mut vein = (1.0 - smoothstep(0.0, 0.025, v1)) + 0.5 * (1.0 - smoothstep(0.0, 0.018, v2));
                vein *= ps * (1.0 - lips) * (0.6 + 0.4 * (1.0 - face * 0.5));
                c = mix3(c, acc * 0.7, vein.clamp(0.0, 1.0) * 0.7);
                emit += acc * vein * self.glow * 0.8;
            }
            7 => {
                let st = (b.y * 26.0 + fbm3(b * 4.0 + seed) * 7.0 + b.x * 4.0).sin();
                let st = smoothstep(0.55, 0.75, st) * smoothstep(0.3, 0.6, noise3(b * 3.0 + 2.0));
                c = mix3(c, acc, st * ps * (1.0 - lips) * (1.0 - face * 0.4));
            }
            _ => {
                let v = voronoi3(b * 60.0 + seed * 3.0);
                let m = smoothstep(0.58, 0.68, fbm3(b * 5.0 + seed * 8.0)) * ps * (1.0 - lips);
                c = mix3(c, acc * (0.6 + 0.4 * v.z), m);
                emit += acc * m * self.glow * 0.3;
            }
        }
        (c, emit)
    }
}

/// Bind-pose positions per texel of a `size`² UV layout: each triangle (UVs with v up, three
/// corner positions) is rasterised, then the covered area grows a few texels so seams don't show.
pub fn bind_map(size: usize, triangles: impl Iterator<Item = ([[f32; 2]; 3], [Vec3; 3])>) -> Vec<Option<Vec3>> {
    let mut out: Vec<Option<Vec3>> = vec![None; size * size];
    let sz = size as f32;
    for (uv, p) in triangles {
        let pts = uv.map(|t| [t[0] * sz, (1.0 - t[1]) * sz]);
        let (x0, x1) = (pts.iter().map(|p| p[0]).fold(f32::MAX, f32::min), pts.iter().map(|p| p[0]).fold(f32::MIN, f32::max));
        let (y0, y1) = (pts.iter().map(|p| p[1]).fold(f32::MAX, f32::min), pts.iter().map(|p| p[1]).fold(f32::MIN, f32::max));
        let area = (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[2][0] - pts[0][0]) * (pts[1][1] - pts[0][1]);
        if area.abs() < 1e-12 {
            continue;
        }
        let xs = (x0.floor().max(0.0) as usize)..=((x1.ceil() as usize).min(size - 1));
        let ys = (y0.floor().max(0.0) as usize)..=((y1.ceil() as usize).min(size - 1));
        for y in ys {
            for x in xs.clone() {
                let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
                let w = |a: [f32; 2], b: [f32; 2]| ((b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1])) / area;
                let (w0, w1, w2) = (w(pts[1], pts[2]), w(pts[2], pts[0]), w(pts[0], pts[1]));
                if w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4 {
                    out[y * size + x] = Some(p[0] * w0 + p[1] * w1 + p[2] * w2);
                }
            }
        }
    }
    for _ in 0..3 {
        let prev = out.clone();
        for y in 0..size {
            for x in 0..size {
                if prev[y * size + x].is_some() {
                    continue;
                }
                let n = [(x.wrapping_sub(1), y), (x + 1, y), (x, y.wrapping_sub(1)), (x, y + 1)];
                out[y * size + x] = n.iter().filter(|(a, b)| *a < size && *b < size).find_map(|&(a, b)| prev[b * size + a]);
            }
        }
    }
    out
}

/// Painted stubble on the beard region, as the three.js skin uniforms `uFace`, `uStubble` and
/// `uStubbleColor` (`GLSL_STUBBLE` in @actors/three).
#[derive(Clone, Copy, Debug)]
pub struct Stubble {
    /// Density: 0..1 stubble, above 1 a painted short beard.
    pub amount: f32,
    /// Beard region (see `actors_human::parts::beard_coverage`).
    pub region: i32,
    pub seed: f32,
    /// Outline blur in face units (under a generated beard, so its edge fades out softly).
    pub blur: f32,
    /// Hair colour, linear.
    pub color: Vec3,
    /// Eye midpoint in pattern space (feet at 0, +Z back).
    pub face: Vec3,
    /// Eye distance.
    pub eyes: f32,
}

impl Stubble {
    fn coverage(&self, f: Vec3) -> f32 {
        actors_human::parts::beard_coverage(self.region, f.x as f64, f.y as f64, f.z as f64) as f32
    }

    /// The colour (linear) at bind position `bind` with stubble painted on; `lips` is the lip mask.
    pub fn apply(&self, c: Vec3, bind: Vec3, lips: f32) -> Vec3 {
        if self.amount <= 0.0 || self.eyes <= 0.0 {
            return c;
        }
        let mut f = (bind - self.face) / self.eyes;
        f.z = -f.z; // pattern space has +Z back, face coordinates +Z forward
                    // Cheap reject: the beard never reaches above the eyes or far behind the face.
        if f.y > 0.3 || f.y < -2.8 || f.x.abs() > 2.0 {
            return c;
        }
        let mut cov = self.coverage(f);
        if self.blur > 0.0 {
            let mut acc = cov;
            for i in 0..8 {
                let a = i as f32 * std::f32::consts::FRAC_PI_4;
                acc += self.coverage(f + Vec3::new(a.cos(), a.sin(), 0.0) * self.blur);
            }
            cov = acc / 9.0;
        }
        cov *= 1.0 - lips;
        if cov <= 0.0 {
            return c;
        }
        let col = self.color;
        // Short hairs: fine dots (cut hair ends) over a soft shadow of the hair under the skin.
        let dots = smoothstep(0.42, 0.68, noise3(f * 160.0 + self.seed * 17.0)) * 0.7 + smoothstep(0.6, 0.8, noise3(f * 310.0 + 3.1)) * 0.3;
        let shade = cov * self.amount.min(1.0);
        let mut c = mix3(c, c * mix3(Vec3::ONE, col * 3.0 + 0.25, 0.6), shade * 0.65);
        c = mix3(c, col, (shade * dots * 1.1).min(1.0));
        // Above 1: a painted short beard, the skin filled with the hair colour in soft streaks.
        let fill = cov * (self.amount - 1.0).clamp(0.0, 1.0);
        let streaks = 0.75 + 0.35 * noise3(f * Vec3::new(30.0, 7.0, 30.0) + self.seed) + 0.2 * noise3(f * Vec3::new(90.0, 20.0, 90.0));
        mix3(c, col * 2.0 * streaks, fill * (0.85 + 0.15 * dots))
    }
}
