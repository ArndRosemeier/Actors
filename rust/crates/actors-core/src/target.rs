//! Morph targets: sparse per-vertex position deltas, quantized to int16.

use crate::blob::{f32s_at, i16s_at, u32_at, u32s_at};
use crate::error::{Error, Result};
use crate::format::{TARGET_FLAG_DENSE, TARGET_MAGIC};

/// delta(vertex) = deltas[i] * scale.
#[derive(Clone, Debug, PartialEq)]
pub struct MorphTarget {
    /// Vertex indices, or `None` when the target covers vertices 0..count densely.
    pub indices: Option<Vec<u32>>,
    pub deltas: Vec<i16>,
    pub scale: f32,
    pub count: usize,
}

impl MorphTarget {
    /// Binary layout: u32 magic, u32 version, u32 count, u32 flags, f32 scale, [u32 indices], i16 deltas[count*3].
    pub fn decode(buf: &[u8]) -> Result<Self> {
        if u32_at(buf, 0) != Some(TARGET_MAGIC) {
            return Err(Error::format("not an actor morph target"));
        }
        let version = u32_at(buf, 4).unwrap_or(0);
        if version != 1 {
            return Err(Error::format(format!("unsupported target version {version}")));
        }
        let count = u32_at(buf, 8).ok_or_else(|| Error::format("short target"))? as usize;
        let flags = u32_at(buf, 12).ok_or_else(|| Error::format("short target"))?;
        let scale = f32s_at(buf, 16, 1, "target scale")?[0];
        let mut offset = 20;
        let mut indices = None;
        if flags & TARGET_FLAG_DENSE == 0 {
            indices = Some(u32s_at(buf, offset, count, "target indices")?);
            offset += count * 4;
        }
        let deltas = i16s_at(buf, offset, count * 3, "target deltas")?;
        Ok(Self { indices, deltas, scale, count })
    }

    /// Inverse of [`MorphTarget::decode`] for importers: `deltas` holds 3 floats per entry of
    /// `indices`. Picks dense storage when the target touches most vertices.
    pub fn encode(indices: &[u32], deltas: &[f32], vertex_count: usize) -> Vec<u8> {
        let count = indices.len();
        let max_abs = deltas.iter().fold(0f64, |m, d| m.max((*d as f64).abs()));
        let scale = if max_abs > 0.0 { max_abs / 32767.0 } else { 1.0 };
        let dense = count as f64 > vertex_count as f64 * 0.6;
        let n = if dense { vertex_count } else { count };
        let mut out = Vec::with_capacity(20 + if dense { 0 } else { n * 4 } + n * 6);
        out.extend_from_slice(&TARGET_MAGIC.to_le_bytes());
        out.extend_from_slice(&1u32.to_le_bytes());
        out.extend_from_slice(&(n as u32).to_le_bytes());
        out.extend_from_slice(&(if dense { TARGET_FLAG_DENSE } else { 0 }).to_le_bytes());
        out.extend_from_slice(&(scale as f32).to_le_bytes());
        if !dense {
            for i in indices {
                out.extend_from_slice(&i.to_le_bytes());
            }
        }
        let mut q = vec![0i16; n * 3];
        for i in 0..count {
            let slot = if dense { indices[i] as usize } else { i };
            for c in 0..3 {
                q[slot * 3 + c] = (deltas[i * 3 + c] as f64 / scale).round() as i16;
            }
        }
        for v in q {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out
    }

    /// Adds `weight` * target to `positions` (3 floats per vertex), in place.
    pub fn apply(&self, positions: &mut [f32], weight: f64) {
        let k = weight * self.scale as f64;
        match &self.indices {
            Some(indices) => {
                for (i, &v) in indices.iter().enumerate() {
                    let v = v as usize * 3;
                    let d = i * 3;
                    for c in 0..3 {
                        positions[v + c] = (positions[v + c] as f64 + self.deltas[d + c] as f64 * k) as f32;
                    }
                }
            }
            None => {
                for (p, d) in positions.iter_mut().zip(&self.deltas).take(self.count * 3) {
                    *p = (*p as f64 + *d as f64 * k) as f32;
                }
            }
        }
    }

    /// Vertex index of entry `i`.
    pub fn vertex(&self, i: usize) -> usize {
        match &self.indices {
            Some(ix) => ix[i] as usize,
            None => i,
        }
    }
}
