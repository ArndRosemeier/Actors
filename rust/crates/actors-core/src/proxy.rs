//! Proxies: garments and body parts bound to triangles of the base shape.

use crate::format::ProxyDef;

/// A proxy's binding data, read from its blob.
#[derive(Clone, Debug, PartialEq)]
pub struct ProxyBinding {
    pub def: ProxyDef,
    /// 3 base vertices per proxy vertex.
    pub refs: Vec<u32>,
    pub weights: Vec<f32>,
    /// 3 floats per proxy vertex (meters).
    pub offsets: Vec<f32>,
}

/// Positions a proxy on the current body shape (3 floats per proxy vertex).
pub fn fit_proxy(binding: &ProxyBinding, positions: &[f32], out: &mut Vec<f32>) {
    let def = &binding.def;
    out.resize(def.vertex_count * 3, 0.0);
    let mut scale = [1.0f64; 3];
    for (axis, [a, b, rest]) in def.scale_refs.iter().enumerate() {
        let (a, b) = (*a as usize, *b as usize);
        let d = (positions[a * 3 + axis] as f64 - positions[b * 3 + axis] as f64).abs();
        scale[axis] = if *rest > 0.0 { d / rest } else { 1.0 };
    }
    let (refs, weights, offsets) = (&binding.refs, &binding.weights, &binding.offsets);
    for i in 0..def.vertex_count {
        let r0 = refs[i * 3] as usize * 3;
        let r1 = refs[i * 3 + 1] as usize * 3;
        let r2 = refs[i * 3 + 2] as usize * 3;
        let (w0, w1, w2) = (weights[i * 3] as f64, weights[i * 3 + 1] as f64, weights[i * 3 + 2] as f64);
        for c in 0..3 {
            out[i * 3 + c] = (w0 * positions[r0 + c] as f64
                + w1 * positions[r1 + c] as f64
                + w2 * positions[r2 + c] as f64
                + offsets[i * 3 + c] as f64 * scale[c]) as f32;
        }
    }
}

/// Weighted joint accumulator that keeps first-insertion order, so ties sort the same way as
/// the TypeScript runtime's `Map`.
#[derive(Default)]
pub(crate) struct JointAcc(pub Vec<(u16, f64)>);

impl JointAcc {
    pub fn clear(&mut self) {
        self.0.clear();
    }
    pub fn get(&self, j: u16) -> f64 {
        self.0.iter().find(|e| e.0 == j).map_or(0.0, |e| e.1)
    }
    pub fn add(&mut self, j: u16, w: f64) {
        match self.0.iter_mut().find(|e| e.0 == j) {
            Some(e) => e.1 += w,
            None => self.0.push((j, w)),
        }
    }
    pub fn set(&mut self, j: u16, w: f64) {
        match self.0.iter_mut().find(|e| e.0 == j) {
            Some(e) => e.1 = w,
            None => self.0.push((j, w)),
        }
    }
    pub fn remove(&mut self, j: u16) -> Option<f64> {
        let i = self.0.iter().position(|e| e.0 == j)?;
        Some(self.0.remove(i).1)
    }
    /// Writes the 4 largest positive influences, renormalized, into `joints` / `weights`.
    pub fn write_top4(&mut self, positive_only: bool, joints: &mut [u16], weights: &mut [f32]) {
        if positive_only {
            self.0.retain(|e| e.1 > 0.0);
        }
        // Stable sort, largest first.
        self.0.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let top = &self.0[..self.0.len().min(4)];
        let sum: f64 = top.iter().map(|e| e.1).sum();
        let sum = if sum == 0.0 { 1.0 } else { sum };
        for (k, (j, w)) in top.iter().enumerate() {
            joints[k] = *j;
            weights[k] = (*w / sum) as f32;
        }
    }
}

/// Interpolates base skin weights onto proxy vertices (top 4 influences, renormalized), with
/// the proxy's skirt-style leg blend if it has one.
pub fn proxy_skin(binding: &ProxyBinding, base_joints: &[u16], base_weights: &[f32], bone_names: &[String]) -> (Vec<u16>, Vec<f32>) {
    let index = |n: &str| bone_names.iter().position(|b| b == n).map(|i| i as u16);
    let blend = binding.def.leg_blend.as_ref();
    let mut remap = Vec::new();
    let mut pairs = Vec::new();
    let mut hip = None;
    if let Some(b) = blend {
        for (from, to) in &b.remap {
            if let (Some(f), Some(t)) = (index(from), index(to)) {
                if !remap.iter().any(|(x, _)| *x == f) {
                    remap.push((f, t));
                }
            }
        }
        for (a, c) in &b.pairs {
            if let (Some(a), Some(c)) = (index(a), index(c)) {
                pairs.push((a, c));
            }
        }
        hip = index(&b.hip);
    }
    let n = binding.def.vertex_count;
    let mut joints = vec![0u16; n * 4];
    let mut weights = vec![0f32; n * 4];
    let mut acc = JointAcc::default();
    for i in 0..n {
        acc.clear();
        for k in 0..3 {
            let v = binding.refs[i * 3 + k] as usize;
            let w = binding.weights[i * 3 + k] as f64;
            for j in 0..4 {
                let bw = base_weights[v * 4 + j] as f64 * w;
                if bw != 0.0 {
                    acc.add(base_joints[v * 4 + j], bw);
                }
            }
        }
        if let Some(b) = blend {
            for &(from, to) in &remap {
                let w = acc.get(from);
                if w != 0.0 {
                    acc.remove(from);
                    acc.add(to, w);
                }
            }
            for &(a, c) in &pairs {
                let legs = acc.get(a) + acc.get(c);
                if legs == 0.0 {
                    continue;
                }
                let to_hip = if hip.is_some() { legs * b.hip_share } else { 0.0 };
                acc.set(a, (legs - to_hip) / 2.0);
                acc.set(c, (legs - to_hip) / 2.0);
                if let Some(h) = hip {
                    acc.add(h, to_hip);
                }
            }
        }
        acc.write_top4(true, &mut joints[i * 4..i * 4 + 4], &mut weights[i * 4..i * 4 + 4]);
    }
    (joints, weights)
}
