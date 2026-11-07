//! Playing retargetable clips on any fitted skeleton with matching bone names.

use crate::error::{Error, Result};
use crate::format::{ClipDef, ClipEncoding};
use crate::math::*;
use crate::pose::Pose;
use crate::skeleton::FittedSkeleton;
use std::sync::Arc;

/// A loaded clip: its definition and the decoded frames (interleaved f32 per frame:
/// bones x quat, then root xyz).
#[derive(Clone, Debug, PartialEq)]
pub struct Clip {
    pub def: ClipDef,
    pub data: Vec<f32>,
}

impl Clip {
    pub fn stride(&self) -> usize {
        self.def.bones.len() * 4 + 3
    }
}

/// Clip file -> interleaved f32 frames, whatever the stored encoding.
pub fn decode_clip(def: &ClipDef, buf: &[u8]) -> Result<Vec<f32>> {
    let nb = def.bones.len();
    let n = def.frame_count;
    let stride = nb * 4 + 3;
    match def.encoding {
        ClipEncoding::F32 => {
            let data = crate::blob::f32s_at(buf, 0, buf.len() / 4, &def.file)?;
            if data.len() < n * stride {
                return Err(Error::format(format!("{}: clip is shorter than {n} frames", def.file)));
            }
            Ok(data)
        }
        ClipEncoding::I16 => {
            let q = crate::blob::i16s_at(buf, 0, n * nb * 4, &def.file)?;
            let root = crate::blob::f32s_at(buf, n * nb * 8, n * 3, &def.file)?;
            let mut out = vec![0f32; n * stride];
            for f in 0..n {
                for k in 0..nb * 4 {
                    out[f * stride + k] = (q[f * nb * 4 + k] as f64 / 32767.0) as f32;
                }
                out[f * stride + nb * 4..f * stride + stride].copy_from_slice(&root[f * 3..f * 3 + 3]);
            }
            Ok(out)
        }
    }
}

/// Inverse of [`decode_clip`] for [`ClipEncoding::I16`]: interleaved f32 frames -> stored bytes.
pub fn encode_clip_i16(bones: usize, frames: usize, data: &[f32]) -> Vec<u8> {
    let stride = bones * 4 + 3;
    let mut out = Vec::with_capacity(frames * bones * 8 + frames * 12);
    for f in 0..frames {
        for k in 0..bones * 4 {
            let v = (data[f * stride + k] as f64).clamp(-1.0, 1.0) * 32767.0;
            out.extend_from_slice(&(v.round() as i16).to_le_bytes());
        }
    }
    for f in 0..frames {
        for c in 0..3 {
            out.extend_from_slice(&data[f * stride + bones * 4 + c].to_le_bytes());
        }
    }
    out
}

/// Limb bones: their rest direction is turned onto the clip's before the motion is applied.
/// Limb bones run along the limb in every rig, so matching directions matches the anatomy
/// (a T-pose source onto an A-pose target). Torso, neck, head and clavicle bones are placed
/// differently per rig, so they only get the clip's change since its rest pose. Quadruped legs
/// (`Front_`/`Back_Leg_*`) count as limbs too.
pub fn is_limb_bone(name: &str) -> bool {
    fn side(s: &str, sides: &[&str]) -> bool {
        sides.contains(&s)
    }
    if let Some((stem, s)) = name.rsplit_once('_') {
        if side(s, &["l", "r"]) {
            if matches!(stem, "upperarm" | "lowerarm" | "hand" | "thigh" | "calf" | "foot" | "ball") {
                return true;
            }
            if let Some((finger, seg)) = stem.rsplit_once('_') {
                return matches!(finger, "index" | "middle" | "ring" | "pinky" | "thumb") && matches!(seg, "01" | "02" | "03");
            }
            return false;
        }
        if side(s, &["L", "R"]) {
            for leg in ["Front_Leg_", "Back_Leg_"] {
                if let Some(part) = stem.strip_prefix(leg) {
                    return matches!(part, "Upper" | "Lower" | "Ankle" | "Foot" | "Foot_1");
                }
            }
        }
    }
    false
}

/// How the root bone's horizontal motion is played.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum InPlace {
    /// Root motion as recorded.
    #[default]
    Off,
    /// No horizontal root motion at all.
    On,
    /// Only the steady travel over the loop is taken out (the hips keep their sway).
    Drift,
}

/// Picks the bones whose rest direction is turned onto the clip's.
pub type BoneFilter = Arc<dyn Fn(&str) -> bool + Send + Sync>;

/// Retargeting options.
#[derive(Clone, Default)]
pub struct RetargetOptions {
    pub in_place: InPlace,
    /// Bones whose rest direction is turned onto the clip's (default: [`is_limb_bone`]).
    pub align: Option<BoneFilter>,
}

impl std::fmt::Debug for RetargetOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RetargetOptions").field("in_place", &self.in_place).field("align", &self.align.is_some()).finish()
    }
}

/// A fixed-rate sampling of a clip on one skeleton, for keyframe renderers and glTF export.
#[derive(Clone, Debug)]
pub struct BakedClip {
    pub times: Vec<f32>,
    /// Per bone: x, y, z, w per frame (bone-local).
    pub rotations: Vec<Vec<f32>>,
    /// Local position of the root bone per frame.
    pub root_positions: Vec<f32>,
    pub root_index: usize,
}

/// Plays a retargetable clip on a fitted skeleton. Rebuild when the skeleton is re-fitted.
#[derive(Clone, Debug)]
pub struct Retargeter {
    clip: Arc<Clip>,
    in_place: InPlace,
    parents: Vec<i32>,
    local_rotations: Vec<Quat>,
    heads: Vec<Vec3>,
    /// Skeleton bone -> clip track index.
    track: Vec<Option<usize>>,
    world_ref: Vec<Quat>,
    bind_world: Vec<Quat>,
    root_index: usize,
    hip_height: f64,
    pub duration: f64,
    scratch: Vec<f64>,
}

impl Retargeter {
    pub fn new(skeleton: &FittedSkeleton, clip: Arc<Clip>, options: &RetargetOptions) -> Result<Self> {
        let def = &clip.def;
        let names = &skeleton.names;
        let mut track = vec![None; names.len()];
        for (k, b) in def.bones.iter().enumerate() {
            if let Some(i) = skeleton.index_of(b) {
                track[i] = Some(k);
            }
        }
        let bind_world: Vec<Quat> = skeleton.world_rotations.iter().map(quat_from_mat3).collect();
        // Reference pose: each animated limb bone turned (shortest arc) onto the clip's reference direction.
        let world_ref = names
            .iter()
            .enumerate()
            .map(|(i, name)| {
                let aligned = match &options.align {
                    Some(f) => f(name),
                    None => is_limb_bone(name),
                };
                match track[i] {
                    Some(k) if aligned => {
                        let bone_dir = quat_rotate(bind_world[i], [0.0, 1.0, 0.0]);
                        let r = normalize([def.ref_dirs[k * 3], def.ref_dirs[k * 3 + 1], def.ref_dirs[k * 3 + 2]]);
                        quat_mul(quat_from_to(bone_dir, r), bind_world[i])
                    }
                    _ => bind_world[i],
                }
            })
            .collect();
        let root_index = skeleton.index_of(&def.root_bone).ok_or_else(|| Error::unknown("root bone", &def.root_bone))?;
        let base = skeleton.parent(root_index).map_or([0.0; 3], |p| skeleton.heads[p]);
        let hip_height = 0.1f64.max(skeleton.heads[root_index][1] - base[1]);
        let duration = def.frame_count.saturating_sub(1) as f64 / def.fps;
        Ok(Self {
            in_place: options.in_place,
            parents: skeleton.parents.clone(),
            local_rotations: skeleton.local_rotations.clone(),
            heads: skeleton.heads.clone(),
            track,
            world_ref,
            bind_world,
            root_index,
            hip_height,
            duration,
            scratch: vec![0.0; names.len() * 4],
            clip,
        })
    }

    pub fn clip(&self) -> &Arc<Clip> {
        &self.clip
    }

    pub fn root_index(&self) -> usize {
        self.root_index
    }

    fn frame_root(&self, frame: usize) -> Vec3 {
        let o = frame * self.clip.stride() + self.clip.def.bones.len() * 4;
        let d = &self.clip.data;
        [d[o] as f64, d[o + 1] as f64, d[o + 2] as f64]
    }

    /// Root-motion bone's offset over the whole clip (last frame less first), in skeleton units.
    pub fn travel(&self) -> Vec3 {
        let a = self.frame_root(0);
        let b = self.frame_root(self.clip.def.frame_count.saturating_sub(1));
        scale(sub(b, a), self.hip_height)
    }

    /// A new pose sampled at `time` (seconds).
    pub fn sample(&mut self, time: f64) -> Pose {
        let mut pose = Pose::new(self.parents.len(), self.root_index);
        self.sample_into(time, &mut pose);
        pose
    }

    /// Samples into an existing pose without allocating (`out` needs one slot per bone).
    pub fn sample_into(&mut self, time: f64, out: &mut Pose) {
        let clip = &*self.clip;
        let def = &clip.def;
        let n = self.parents.len();
        let last = def.frame_count.saturating_sub(1);
        let lastf = last as f64;
        let mut t = time * def.fps;
        t = if def.looping && last > 0 { ((t % lastf) + lastf) % lastf } else { t.clamp(0.0, lastf) };
        let f0 = (t.floor() as usize).min(last);
        let f1 = (f0 + 1).min(last);
        let u = t - f0 as f64;
        let d = &clip.data;
        let stride = clip.stride();
        let nb4 = def.bones.len() * 4;
        let w = &mut self.scratch;
        let r = &mut out.rotations;
        r.resize(n * 4, 0.0);
        for i in 0..n {
            let p = self.parents[i];
            let o = i * 4;
            let world: Quat = if let Some(k) = self.track[i] {
                // Clip delta (slerp between frames), then onto the reference pose: world = delta · ref.
                let (a, b) = (f0 * stride + k * 4, f1 * stride + k * 4);
                let qa = [d[a] as f64, d[a + 1] as f64, d[a + 2] as f64, d[a + 3] as f64];
                let qb = [d[b] as f64, d[b + 1] as f64, d[b + 2] as f64, d[b + 3] as f64];
                quat_mul(quat_slerp(qa, qb, u), self.world_ref[i])
            } else if p >= 0 {
                // Not animated: keep the bind relationship to the parent.
                let po = p as usize * 4;
                quat_mul([w[po], w[po + 1], w[po + 2], w[po + 3]], self.local_rotations[i])
            } else {
                self.bind_world[i]
            };
            w[o..o + 4].copy_from_slice(&world);
            let local = if p >= 0 {
                let po = p as usize * 4;
                quat_mul([-w[po], -w[po + 1], -w[po + 2], w[po + 3]], world)
            } else {
                world
            };
            for c in 0..4 {
                r[o + c] = local[c] as f32;
            }
        }

        let (ri, hh) = (self.root_index, self.hip_height);
        let (ra, rb) = (f0 * stride + nb4, f1 * stride + nb4);
        let lerp = |c: usize| (d[ra + c] as f64 + (d[rb + c] as f64 - d[ra + c] as f64) * u) * hh;
        let (mut rx, ry, mut rz) = (lerp(0), lerp(1), lerp(2));
        match self.in_place {
            InPlace::Drift => {
                // Take out the steady travel over the loop, keep the sway around it.
                let end = last * stride + nb4;
                let k = t / 1f64.max(lastf);
                rx -= (d[end] as f64 - d[nb4] as f64) * hh * k;
                rz -= (d[end + 2] as f64 - d[nb4 + 2] as f64) * hh * k;
            }
            InPlace::On => {
                rx = 0.0;
                rz = 0.0;
            }
            InPlace::Off => {}
        }
        out.root_index = ri;
        let h = self.heads[ri];
        let root = match self.parents[ri] {
            pi if pi < 0 => [h[0] + rx, h[1] + ry, h[2] + rz],
            pi => {
                // Head relative to the parent, in the parent's (posed) frame.
                let (pi, po) = (pi as usize, pi as usize * 4);
                let ph = self.heads[pi];
                quat_rotate([-w[po], -w[po + 1], -w[po + 2], w[po + 3]], [h[0] + rx - ph[0], h[1] + ry - ph[1], h[2] + rz - ph[2]])
            }
        };
        out.root = [root[0] as f32, root[1] as f32, root[2] as f32];
    }

    /// Samples at a fixed rate (keyframe renderers, glTF export).
    pub fn bake(&mut self, fps: f64) -> BakedClip {
        let frames = 2usize.max((self.duration * fps).round() as usize + 1);
        let n = self.parents.len();
        let mut baked = BakedClip {
            times: Vec::with_capacity(frames),
            rotations: vec![Vec::with_capacity(frames * 4); n],
            root_positions: Vec::with_capacity(frames * 3),
            root_index: self.root_index,
        };
        let mut pose = Pose::new(n, self.root_index);
        for f in 0..frames {
            let t = f as f64 / (frames - 1) as f64 * self.duration;
            baked.times.push(t as f32);
            self.sample_into(t, &mut pose);
            for (i, track) in baked.rotations.iter_mut().enumerate() {
                track.extend_from_slice(&pose.rotations[i * 4..i * 4 + 4]);
            }
            baked.root_positions.extend_from_slice(&pose.root);
        }
        baked
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limb_bones() {
        for b in ["upperarm_l", "calf_r", "index_02_l", "thumb_01_r", "Front_Leg_Foot_1_L", "Back_Leg_Upper_R"] {
            assert!(is_limb_bone(b), "{b}");
        }
        for b in ["pelvis", "spine_01", "clavicle_l", "head", "index_04_l", "Front_Leg_Shoulder_L", "hand_x", "foot"] {
            assert!(!is_limb_bone(b), "{b}");
        }
    }

    #[test]
    fn i16_round_trip() {
        let def = ClipDef {
            name: "t".into(),
            file: "t.bin".into(),
            fps: 30.0,
            frame_count: 2,
            looping: true,
            bones: vec!["a".into()],
            ref_dirs: vec![0.0, 1.0, 0.0],
            root_bone: "a".into(),
            source: String::new(),
            category: None,
            description: None,
            encoding: ClipEncoding::I16,
        };
        let data = [0.0, 0.0, 0.0, 1.0, 0.1, 0.2, 0.3, 0.5, -0.5, 0.5, 0.7, 0.4, 0.5, 0.6];
        let back = decode_clip(&def, &encode_clip_i16(1, 2, &data)).unwrap();
        for (a, b) in data.iter().zip(&back) {
            assert!((a - b).abs() < 1e-4);
        }
    }
}
