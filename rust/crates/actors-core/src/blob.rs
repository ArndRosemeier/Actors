//! Typed views of binary pack data (little-endian).

use crate::error::{Error, Result};
use crate::format::BufferRef;

fn bytes<'a>(blob: &'a [u8], r: &BufferRef, size: usize, what: &str) -> Result<&'a [u8]> {
    let end = r.count.checked_mul(size).and_then(|n| n.checked_add(r.offset));
    match end {
        Some(end) if end <= blob.len() => Ok(&blob[r.offset..end]),
        _ => Err(Error::format(format!("{what}: buffer {}+{}x{size} is outside the blob ({} bytes)", r.offset, r.count, blob.len()))),
    }
}

pub fn read_f32(blob: &[u8], r: &BufferRef, what: &str) -> Result<Vec<f32>> {
    Ok(bytes(blob, r, 4, what)?.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
}

pub fn read_u32(blob: &[u8], r: &BufferRef, what: &str) -> Result<Vec<u32>> {
    Ok(bytes(blob, r, 4, what)?.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
}

pub fn read_u16(blob: &[u8], r: &BufferRef, what: &str) -> Result<Vec<u16>> {
    Ok(bytes(blob, r, 2, what)?.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect())
}

/// `count` little-endian f32 values starting at byte `offset`.
pub fn f32s_at(buf: &[u8], offset: usize, count: usize, what: &str) -> Result<Vec<f32>> {
    read_f32(buf, &BufferRef { offset, count, ty: crate::format::ScalarType::F32 }, what)
}

pub fn i16s_at(buf: &[u8], offset: usize, count: usize, what: &str) -> Result<Vec<i16>> {
    let r = BufferRef { offset, count, ty: crate::format::ScalarType::I16 };
    Ok(bytes(buf, &r, 2, what)?.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect())
}

pub fn u32s_at(buf: &[u8], offset: usize, count: usize, what: &str) -> Result<Vec<u32>> {
    read_u32(buf, &BufferRef { offset, count, ty: crate::format::ScalarType::U32 }, what)
}

pub fn u32_at(buf: &[u8], offset: usize) -> Option<u32> {
    buf.get(offset..offset + 4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]))
}
