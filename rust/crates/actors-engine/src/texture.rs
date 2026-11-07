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
        let lin = [px[0], px[1], px[2]].map(|v| srgb_to_linear(v as f32 / 255.0));
        let lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
        let k = lum / mean;
        for c in 0..3 {
            px[c] = (linear_to_srgb(tint[c] * k) * 255.0).round() as u8;
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
