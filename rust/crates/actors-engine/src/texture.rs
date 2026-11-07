//! Pack textures for the engine: decoding, blending photo skins, recolouring.

use engine::mesh::AlbedoMap;

/// sRGB 0..1 -> linear.
pub fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// Linear 0..1 -> sRGB.
pub fn linear_to_srgb(c: f32) -> f32 {
    let c = c.clamp(0.0, 1.0);
    if c <= 0.0031308 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

/// sRGB byte -> linear, from a table.
pub fn byte_to_linear(v: u8) -> f32 {
    static LUT: std::sync::OnceLock<[f32; 256]> = std::sync::OnceLock::new();
    LUT.get_or_init(|| std::array::from_fn(|i| srgb_to_linear(i as f32 / 255.0)))[v as usize]
}

/// Linear 0..1 -> sRGB byte, from a table (4096 steps).
pub fn linear_to_byte(c: f32) -> u8 {
    const N: usize = 4096;
    static LUT: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
    let lut = LUT.get_or_init(|| (0..=N).map(|i| (linear_to_srgb(i as f32 / N as f32) * 255.0).round() as u8).collect());
    lut[(c.clamp(0.0, 1.0) * N as f32 + 0.5) as usize]
}

/// "#rrggbb" -> sRGB 0..1.
pub fn parse_hex(hex: &str) -> Option<[f32; 3]> {
    let h = hex.strip_prefix('#')?;
    if h.len() != 6 {
        return None;
    }
    let ch = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok().map(|v| v as f32 / 255.0);
    Some([ch(0)?, ch(2)?, ch(4)?])
}

/// "#rrggbb" -> linear 0..1.
pub fn hex_linear(hex: &str) -> Option<[f32; 3]> {
    parse_hex(hex).map(|c| c.map(srgb_to_linear))
}

/// Decodes a PNG or JPEG into RGBA.
pub fn decode(bytes: &[u8]) -> Result<AlbedoMap, String> {
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?.to_rgba8();
    Ok(AlbedoMap { width: img.width(), height: img.height(), rgba: img.into_raw() })
}

/// Weighted mix of same-sized images (photo skins); images of another size are skipped.
pub fn blend(layers: &[(&AlbedoMap, f32)]) -> Option<AlbedoMap> {
    let first = layers.first()?.0;
    let same: Vec<_> = layers.iter().filter(|(m, _)| m.width == first.width && m.height == first.height).collect();
    let total: f32 = same.iter().map(|(_, w)| w).sum();
    if total <= 0.0 {
        return Some(first.clone());
    }
    let mut out = vec![0u8; first.rgba.len()];
    for (i, px) in out.iter_mut().enumerate() {
        let v: f32 = same.iter().map(|(m, w)| m.rgba[i] as f32 * w).sum::<f32>() / total;
        *px = v.round().clamp(0.0, 255.0) as u8;
    }
    Some(AlbedoMap { width: first.width, height: first.height, rgba: out })
}

/// Recolours a texture keeping its shading pattern: each texel becomes `tint` (linear) scaled by
/// its luminance over `mean_lum`, the way the three.js adapter tints garments and hair.
pub fn tint(map: &AlbedoMap, tint: [f32; 3], mean_lum: f32) -> AlbedoMap {
    let mean = mean_lum.max(0.01);
    let mut out = map.clone();
    for px in out.rgba.as_chunks_mut::<4>().0 {
        let lin = [px[0], px[1], px[2]].map(byte_to_linear);
        let lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
        let k = lum / mean;
        for c in 0..3 {
            px[c] = linear_to_byte(tint[c] * k);
        }
    }
    out
}

/// Sets every texel opaque.
pub fn opaque(map: &mut AlbedoMap) {
    for px in map.rgba.as_chunks_mut::<4>().0 {
        px[3] = 255;
    }
}

/// Mean linear luminance of a colour.
pub fn luminance(lin: [f32; 3]) -> f32 {
    0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

/// Iris colour as a hue, saturation and lightness shift of the eye photo's iris (see
/// `IRIS_PRESETS` in @actors/three).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Iris {
    pub hue: f32,
    pub sat: f32,
    pub light: f32,
}

/// The three.js adapter's iris presets, by the names a `CharacterConfig` uses in `eyes`.
pub fn iris_preset(name: &str) -> Option<Iris> {
    let (hue, sat, light) = match name {
        "brown" => (0.075, 0.85, 0.95),
        "hazel" => (0.12, 0.9, 1.4),
        "green" => (0.3, 0.9, 1.3),
        "blue" => (0.58, 1.0, 1.6),
        "gray" => (0.58, 0.25, 1.6),
        _ => return None,
    };
    Some(Iris { hue, sat, light })
}

/// The iris shift that turns the eye photo (a mid brown) into this "#rrggbb" colour, as
/// `irisFromColor` in @actors/generator.
pub fn iris_from_hex(hex: &str) -> Option<Iris> {
    let [r, g, b] = parse_hex(hex)?;
    let (max, min) = (r.max(g).max(b), r.min(g).min(b));
    let d = max - min;
    let hue = if d <= 0.0 {
        0.0
    } else if max == r {
        ((g - b) / d).rem_euclid(6.0) / 6.0
    } else if max == g {
        ((b - r) / d + 2.0) / 6.0
    } else {
        ((r - g) / d + 4.0) / 6.0
    };
    let sat = if max > 0.0 { d / max } else { 0.0 };
    Some(Iris { hue, sat: (sat / 0.6).clamp(0.15, 1.4), light: (max / 0.35).clamp(0.4, 2.6) })
}

/// Pupil shapes, as `PUPILS` in @actors/three.
pub fn pupil_shape(name: &str) -> u32 {
    match name {
        "slit" => 1,
        "goat" => 2,
        "none" => 3,
        _ => 0,
    }
}

fn rgb2hsv(c: [f32; 3]) -> [f32; 3] {
    let max = c[0].max(c[1]).max(c[2]);
    let min = c[0].min(c[1]).min(c[2]);
    let d = max - min;
    let h = if d <= 1e-10 {
        0.0
    } else if max == c[0] {
        ((c[1] - c[2]) / d).rem_euclid(6.0) / 6.0
    } else if max == c[1] {
        ((c[2] - c[0]) / d + 2.0) / 6.0
    } else {
        ((c[0] - c[1]) / d + 4.0) / 6.0
    };
    [h, d / (max + 1e-10), max]
}

fn hsv2rgb(c: [f32; 3]) -> [f32; 3] {
    [1.0, 2.0 / 3.0, 1.0 / 3.0].map(|k: f32| {
        let p = (((c[0] + k).fract() * 6.0 - 3.0).abs() - 1.0).clamp(0.0, 1.0);
        c[2] * (1.0 + (p - 1.0) * c[1])
    })
}

fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Bakes iris colour, pupil shape and glow into the eye photo, as the three.js eye shader does per
/// pixel. Returns the albedo and, for glowing eyes, an emissive map (to multiply by `glow * 2.5`).
pub fn eye(map: &AlbedoMap, iris: Option<Iris>, pupil: u32, glow: f32) -> (AlbedoMap, Option<AlbedoMap>) {
    let (w, h) = (map.width as usize, map.height as usize);
    let lin: Vec<[f32; 3]> = map.rgba.as_chunks::<4>().0.iter().map(|p| [p[0], p[1], p[2]].map(byte_to_linear)).collect();
    let shift = |c: [f32; 3]| -> [f32; 3] {
        let Some(i) = iris else { return c };
        let hsv = rgb2hsv(c);
        let k = smoothstep(0.18, 0.4, hsv[1]);
        if k <= 0.0 {
            return c;
        }
        let s = hsv2rgb([i.hue, (hsv[1] * i.sat).clamp(0.0, 1.0), (hsv[2] * i.light).clamp(0.0, 1.0)]);
        [0, 1, 2].map(|n| c[n] + (s[n] - c[n]) * k)
    };
    // Bilinear sample of the photo at a UV (v up, as in three.js).
    let sample = |u: f32, v: f32| -> [f32; 3] {
        let x = (u * w as f32 - 0.5).clamp(0.0, (w - 1) as f32);
        let y = ((1.0 - v) * h as f32 - 0.5).clamp(0.0, (h - 1) as f32);
        let (x0, y0) = (x.floor() as usize, y.floor() as usize);
        let (x1, y1) = ((x0 + 1).min(w - 1), (y0 + 1).min(h - 1));
        let (fx, fy) = (x - x0 as f32, y - y0 as f32);
        let at = |x: usize, y: usize| lin[y * w + x];
        [0, 1, 2].map(|n| {
            let top = at(x0, y0)[n] * (1.0 - fx) + at(x1, y0)[n] * fx;
            let bottom = at(x0, y1)[n] * (1.0 - fx) + at(x1, y1)[n] * fx;
            top * (1.0 - fy) + bottom * fy
        })
    };
    // Iris centres of the two eyes in the atlas and the iris radius (UV units).
    const C0: [f32; 2] = [0.7025, 0.6971];
    const C1: [f32; 2] = [0.2866, 0.2850];
    const IRIS: f32 = 0.115;
    let dilation = 0.5;
    let mut out = map.clone();
    let mut emit = (glow > 0.0).then(|| AlbedoMap { width: map.width, height: map.height, rgba: vec![0; map.rgba.len()] });
    for y in 0..h {
        for x in 0..w {
            let (u, v) = ((x as f32 + 0.5) / w as f32, 1.0 - (y as f32 + 0.5) / h as f32);
            let d = |c: [f32; 2]| ((u - c[0]).powi(2) + (v - c[1]).powi(2)).sqrt();
            let cc = if d(C0) < d(C1) { C0 } else { C1 };
            let q = [(u - cc[0]) / IRIS, (v - cc[1]) / IRIS];
            let r = (q[0] * q[0] + q[1] * q[1]).sqrt();
            let in_iris = 1.0 - smoothstep(0.92, 1.0, r);
            let mut c = shift(lin[y * w + x]);
            let pupil_mask;
            if r > 1.1 {
                // Outside the iris: only the colour shift.
                pupil_mask = 0.0;
            } else if pupil > 0 {
                // Paint the photo's round pupil over with iris colour from the ring outside it.
                let dir = if r > 1e-3 { [q[0] / r, q[1] / r] } else { [1.0, 0.0] };
                let ring = shift(sample(cc[0] + dir[0] * IRIS * 0.62, cc[1] + dir[1] * IRIS * 0.62));
                let old = 1.0 - smoothstep(0.36, 0.5, r);
                c = [0, 1, 2].map(|n| c[n] + (ring[n] - c[n]) * old);
                let pr = 0.32 + dilation * 0.15;
                pupil_mask = match pupil {
                    1 => 1.0 - smoothstep(0.9, 1.05, ((q[0] / (pr * 0.28)).powi(2) + (q[1] / (pr * 2.2)).powi(2)).sqrt()),
                    2 => (1.0 - smoothstep(0.9, 1.05, q[0].abs() / (pr * 1.7))) * (1.0 - smoothstep(0.9, 1.05, q[1].abs() / (pr * 0.45))),
                    _ => 0.0,
                };
                let k = pupil_mask * in_iris;
                c = c.map(|v| v + (0.006 - v) * k);
            } else {
                pupil_mask = 1.0 - smoothstep(0.36, 0.5, r);
            }
            let i = (y * w + x) * 4;
            for n in 0..3 {
                out.rgba[i + n] = linear_to_byte(c[n]);
            }
            out.rgba[i + 3] = 255;
            if let Some(e) = &mut emit {
                let k = in_iris * (1.0 - pupil_mask);
                for n in 0..3 {
                    e.rgba[i + n] = linear_to_byte(c[n] * k);
                }
                e.rgba[i + 3] = 255;
            }
        }
    }
    (out, emit)
}

/// The small deterministic generator the three.js part textures use.
fn part_rng(seed: u32) -> impl FnMut() -> f64 {
    let mut s = seed;
    move || {
        s = s.wrapping_add(0x6d2b_79f5);
        let mut t = s;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
}

fn smooth64(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Beard texture (as `beardTexture` in @actors/three): u 0..0.5 is one lock (v root to tip)
/// splitting into three points at the tip; u 0.5..1 the solid mass, its alpha fading out raggedly
/// toward v = 0. Grey, to multiply with the hair colour. Row 0 is v = 0.
pub fn beard_texture() -> &'static AlbedoMap {
    static MAP: std::sync::OnceLock<AlbedoMap> = std::sync::OnceLock::new();
    MAP.get_or_init(|| {
        use std::f64::consts::PI;
        const W: usize = 256;
        const H: usize = 256;
        let half = W / 2;
        let mut data = vec![0u8; W * H * 4];
        let mut r = part_rng(7);
        let ph: Vec<f64> = (0..6).map(|_| r() * PI * 2.0).collect();
        let streak = |s: f64, v: f64, k: f64| {
            0.07 * (s * k + ph[0] + v * 1.5).sin()
                + 0.05 * (s * k * 2.3 + ph[1] - v * 2.0).sin()
                + 0.03 * (s * k * 5.1 + ph[2] + v * 3.0).sin()
        };
        let prongs = [(-0.27, 0.84, 0.2), (0.02, 1.0, 0.24), (0.29, 0.9, 0.19)];
        for y in 0..H {
            let v = (y as f64 + 0.5) / H as f64;
            for x in 0..W {
                let o = (y * W + x) * 4;
                let (a, g);
                if x < half {
                    let c = (x as f64 + 0.5) / half as f64 - 0.5;
                    let body_hw = 0.47 * (1.0 - smooth64(0.35, 0.82, v));
                    let mut m = (body_hw - c.abs()) / 0.035;
                    for &(pc, len, w) in &prongs {
                        if v > len {
                            continue;
                        }
                        let hw = w * (1.0f64 - (v - 0.4).max(0.0) / (len - 0.4)).max(0.0).powf(0.8);
                        m = m.max((hw - (c - pc - 0.03 * smooth64(0.35, 0.6, v) * (v * 5.0 + pc * 9.0).sin()).abs()) / 0.03);
                    }
                    a = m.clamp(0.0, 1.0) * smooth64(0.0, 0.14, v);
                    let edge_shade = 1.0 - 0.28 * (1.0 - smooth64(0.0, 5.0, m));
                    g = (1.0 + 1.3 * streak(c, v, 18.0)) * edge_shade * (0.82 + 0.18 * smooth64(0.0, 0.35, v)) * (1.0 + 0.06 * v);
                } else {
                    let s = (x as f64 - half as f64 + 0.5) / half as f64;
                    let edge = 0.5
                        + 0.3 * (s * PI * 2.0 * 23.0 + 2.0 * (s * PI * 2.0 * 5.0 + ph[3]).sin()).sin()
                        + 0.2 * (s * PI * 2.0 * 61.0 + ph[4]).sin();
                    a = smooth64(0.3, 0.75, v - 0.35 * (edge - 0.5)) * smooth64(0.0, 0.03, s) * smooth64(1.0, 0.97, s);
                    g = (1.0 + 1.4 * streak(s, v * 0.3, 45.0)) * (0.85 + 0.15 * smooth64(0.3, 0.9, v));
                }
                let gg = (g.min(1.0) * 255.0).round() as u8;
                data[o..o + 3].fill(gg);
                data[o + 3] = (a * 255.0).round() as u8;
            }
        }
        AlbedoMap { width: W as u32, height: H as u32, rgba: data }
    })
}

/// One leaf per card (as `leafTexture` in @actors/three): pointed oval with a midrib and side
/// veins, u across, v from stem to tip. Row 0 is v = 0.
pub fn leaf_texture() -> &'static AlbedoMap {
    static MAP: std::sync::OnceLock<AlbedoMap> = std::sync::OnceLock::new();
    MAP.get_or_init(|| {
        use std::f64::consts::PI;
        const W: usize = 64;
        const H: usize = 128;
        let mut data = vec![0u8; W * H * 4];
        for y in 0..H {
            let v = y as f64 / (H - 1) as f64;
            let half = 0.46 * ((v * 1.05).min(1.0) * PI).sin().powf(0.75);
            for x in 0..W {
                let u = (x as f64 + 0.5) / W as f64 - 0.5;
                let inside = u.abs() < half && v > 0.04;
                let rib = if u.abs() < 0.025 { 0.7 } else { 1.0 };
                let vein = if ((v * 9.0 - u.abs() * 6.0) * PI).sin().abs() < 0.12 { 0.85 } else { 1.0 };
                let edge = if half > 0.0 { u.abs() / half } else { 1.0 };
                let o = (y * W + x) * 4;
                let g = (220.0 * rib * vein * (1.0 - 0.2 * edge)).round() as u8;
                data[o..o + 3].fill(g);
                data[o + 3] = if inside { 255 } else { 0 };
            }
        }
        AlbedoMap { width: W as u32, height: H as u32, rgba: data }
    })
}
