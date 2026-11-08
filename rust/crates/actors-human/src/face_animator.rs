//! A living face, renderer-free: blinks, eye saccades and glances, idle micro-movement, lids that
//! follow the gaze, and lip-sync from text, a viseme track or a voice level. Port of
//! `FaceAnimator` in `packages/human/src/faceAnimator.ts`.
//!
//! Call [`FaceAnimator::update`] once a frame; it returns face-unit weights to add on top of the
//! expression (shown through a face rig, see [`crate::Human::face_rig`]) and eye offsets.

use crate::UnitWeights;
use std::f64::consts::PI;

/// Lip shapes for speech (the common 15-viseme set used by lip-sync tools), each a mix of
/// MakeHuman face units (0..1 unit weights).
pub const VISEMES: &[(&str, &[(&str, f64)])] = &[
    ("sil", &[]),
    ("PP", &[("mouth-compression", 0.75)]),
    ("FF", &[("mouth-open", 0.06), ("mouth-upward-retraction", 0.3), ("mouth-depression", 0.25)]),
    ("TH", &[("mouth-open", 0.14), ("mouth-parling", 0.25)]),
    ("DD", &[("mouth-open", 0.2), ("mouth-retraction", 0.18)]),
    ("kk", &[("mouth-open", 0.26), ("mouth-retraction", 0.12)]),
    ("CH", &[("mouth-open", 0.12), ("mouth-pursing", 0.35), ("mouth-protusion", 0.45), ("mouth-eversion", 0.3)]),
    ("SS", &[("mouth-open", 0.05), ("mouth-retraction", 0.35), ("mouth-parling", 0.35)]),
    ("nn", &[("mouth-open", 0.14), ("mouth-retraction", 0.1)]),
    ("RR", &[("mouth-open", 0.14), ("mouth-pursing", 0.35), ("mouth-protusion", 0.15)]),
    ("aa", &[("mouth-open", 0.55)]),
    ("E", &[("mouth-open", 0.3), ("mouth-retraction", 0.4)]),
    ("ih", &[("mouth-open", 0.18), ("mouth-retraction", 0.5)]),
    ("oh", &[("mouth-open", 0.4), ("mouth-pursing", 0.5)]),
    ("ou", &[("mouth-open", 0.1), ("mouth-pursing", 0.8), ("mouth-protusion", 0.5)]),
];

fn viseme(name: &str) -> Option<&'static [(&'static str, f64)]> {
    VISEMES.iter().find(|(n, _)| *n == name).map(|(_, s)| *s)
}

/// One step of a lip-sync track: a viseme (see [`VISEMES`]) starting at `time` seconds.
#[derive(Clone, Debug, PartialEq)]
pub struct VisemeKey {
    pub time: f64,
    pub viseme: String,
    /// 0..1.
    pub weight: f64,
}

// Letter groups to visemes, digraphs first. A rough English reading: good enough for mouth
// movement, not a phonemiser.
const DIGRAPHS: [(&str, &str); 16] = [
    ("th", "TH"),
    ("ch", "CH"),
    ("sh", "CH"),
    ("ph", "FF"),
    ("ng", "kk"),
    ("qu", "kk"),
    ("ee", "ih"),
    ("ea", "ih"),
    ("oo", "ou"),
    ("ou", "ou"),
    ("ow", "oh"),
    ("oa", "oh"),
    ("ai", "E"),
    ("ay", "E"),
    ("igh", "aa"),
    ("ck", "kk"),
];

fn letter(c: char) -> Option<&'static str> {
    Some(match c {
        'a' => "aa",
        'e' => "E",
        'i' | 'y' => "ih",
        'o' => "oh",
        'u' | 'w' => "ou",
        'b' | 'm' | 'p' => "PP",
        'f' | 'v' => "FF",
        'd' | 't' => "DD",
        'l' | 'n' => "nn",
        's' | 'z' => "SS",
        'c' | 'k' | 'g' | 'q' | 'x' => "kk",
        'h' => "sil",
        'j' => "CH",
        'r' => "RR",
        _ => return None,
    })
}

/// Turns text into a viseme track (rough English letter rules), `rate` = speed factor (1 is about
/// 13 letters a second). Use a real phoneme or viseme stream from your TTS when you have one.
pub fn text_to_visemes(text: &str, rate: f64) -> Vec<VisemeKey> {
    let mut keys: Vec<VisemeKey> = Vec::new();
    let s: Vec<char> = text.to_lowercase().chars().collect();
    let mut t = 0.0;
    let mut push = |keys: &mut Vec<VisemeKey>, viseme: &str, dur: f64| {
        if keys.last().is_some_and(|k| k.viseme == viseme) {
            t += dur / rate * 0.5; // a doubled letter only lengthens the shape
            return;
        }
        keys.push(VisemeKey { time: t, viseme: viseme.into(), weight: 1.0 });
        t += dur / rate;
    };
    let mut i = 0;
    while i < s.len() {
        let c = s[i];
        if ".,;:!?".contains(c) {
            push(&mut keys, "sil", if c == ',' { 0.18 } else { 0.32 });
            i += 1;
            continue;
        }
        if c.is_whitespace() {
            push(&mut keys, "sil", 0.04);
            i += 1;
            continue;
        }
        let di = DIGRAPHS.iter().find(|(d, _)| d.chars().enumerate().all(|(k, dc)| s.get(i + k) == Some(&dc)));
        let v = di.map(|d| d.1).or_else(|| letter(c));
        i += di.map_or(1, |d| d.0.len());
        let Some(v) = v else { continue }; // digits, symbols
        push(&mut keys, v, if matches!(v, "aa" | "E" | "ih" | "oh" | "ou") { 0.11 } else { 0.065 });
    }
    keys.push(VisemeKey { time: t, viseme: "sil".into(), weight: 1.0 });
    keys
}

/// What [`FaceAnimator::update`] produces for one frame.
#[derive(Clone, Debug, Default)]
pub struct FaceFrame {
    /// Face units to add on top of the expression (unit name -> weight). Reused between frames.
    pub units: UnitWeights,
    /// Eyelid closure from blinking, 0..1 (already included in `units`).
    pub blink: f64,
    /// Eye offsets (radians) to add to the look direction: saccades and glances.
    pub yaw: f64,
    pub pitch: f64,
}

/// What a [`FaceAnimator`] does.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FaceAnimatorOptions {
    /// Natural blinking: varied timing and speed, double and partial blinks.
    pub blink: bool,
    /// Small eye jumps while fixating, and now and then a glance away.
    pub saccades: bool,
    /// Slow, small movement of brows, mouth corners and nostrils.
    pub idle: bool,
    /// Upper lids follow the eyes up and down.
    pub lid_follow: bool,
    /// Seed of the random timing (same seed, same motion).
    pub seed: u64,
}

impl Default for FaceAnimatorOptions {
    fn default() -> Self {
        Self { blink: true, saccades: true, idle: true, lid_follow: true, seed: 1 }
    }
}

const LIDS: [&str; 2] = ["eye-left-closure", "eye-right-closure"];
const OPEN: [&str; 2] = ["eye-left-opened-up", "eye-right-opened-up"];
// Idle drift: unit, amplitude, slow frequency (Hz). Paired units (left/right) move together but
// not quite in step.
const IDLE: [(&str, f64, f64); 10] = [
    ("eyebrows-left-up", 0.1, 0.05),
    ("eyebrows-right-up", 0.1, 0.05),
    ("eyebrows-left-inner-up", 0.06, 0.037),
    ("eyebrows-right-inner-up", 0.06, 0.037),
    ("mouth-corner-puller", 0.08, 0.029),
    ("mouth-compression", 0.07, 0.043),
    ("nose-left-dilatation", 0.1, 0.23),
    ("nose-right-dilatation", 0.1, 0.23),
    ("eye-left-slit", 0.06, 0.06),
    ("eye-right-slit", 0.06, 0.06),
];

fn smooth(x: f64) -> f64 {
    if x <= 0.0 {
        0.0
    } else if x >= 1.0 {
        1.0
    } else {
        x * x * (3.0 - 2.0 * x)
    }
}

/// A small seeded random source (xorshift64*), 0..1.
#[derive(Clone, Debug)]
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1)
    }
    fn next(&mut self) -> f64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        (x.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// Blinks, saccades, idle movement, lid follow and lip-sync for one face.
#[derive(Clone, Debug)]
pub struct FaceAnimator {
    pub options: FaceAnimatorOptions,
    /// Overall strength of the lip shapes (0..1).
    pub speech_intensity: f64,
    rng: Rng,
    frame: FaceFrame,
    time: f64,
    next_blink: f64,
    blink_at: f64,
    blink_close: f64,
    blink_open: f64,
    blink_depth: f64,
    double_blink: bool,
    fix_yaw: f64,
    fix_pitch: f64,
    next_saccade: f64,
    glance_until: f64,
    phases: [f64; 10],
    track: Option<Vec<VisemeKey>>,
    track_time: f64,
    voice: f64,
    voice_target: f64,
    mouth: UnitWeights,
}

impl FaceAnimator {
    pub fn new(options: FaceAnimatorOptions) -> Self {
        let mut rng = Rng::new(options.seed);
        let next_blink = 1.0 + rng.next() * 3.0;
        let mut phases = [0.0; 10];
        for p in &mut phases {
            *p = rng.next() * PI * 2.0;
        }
        // Paired units share most of their phase.
        for i in 0..IDLE.len() {
            if IDLE[i].0.contains("right") {
                phases[i] = phases[i - 1] + 0.3;
            }
        }
        Self {
            options,
            speech_intensity: 1.0,
            rng,
            frame: FaceFrame::default(),
            time: 0.0,
            next_blink,
            blink_at: -1.0,
            blink_close: 0.08,
            blink_open: 0.16,
            blink_depth: 1.0,
            double_blink: false,
            fix_yaw: 0.0,
            fix_pitch: 0.0,
            next_saccade: 0.5,
            glance_until: -1.0,
            phases,
            track: None,
            track_time: 0.0,
            voice: 0.0,
            voice_target: 0.0,
            mouth: UnitWeights::new(),
        }
    }

    /// True while a text or viseme track is playing.
    pub fn speaking(&self) -> bool {
        self.track.is_some()
    }

    /// Speaks a text (rough letter-to-viseme rules). Returns its duration in seconds.
    pub fn say(&mut self, text: &str, rate: f64) -> f64 {
        self.speak(text_to_visemes(text, rate))
    }

    /// Plays a viseme track (times in seconds from now), e.g. from a TTS engine. Returns its duration.
    pub fn speak(&mut self, mut track: Vec<VisemeKey>) -> f64 {
        track.sort_by(|a, b| a.time.total_cmp(&b.time));
        let duration = track.last().map_or(0.0, |k| k.time);
        self.track = (!track.is_empty()).then_some(track);
        self.track_time = 0.0;
        duration
    }

    /// Stops text or track speech.
    pub fn stop_speaking(&mut self) {
        self.track = None;
    }

    /// Voice loudness 0..1 (e.g. from an audio analyser), opening the jaw; 0 when silent.
    pub fn set_voice_level(&mut self, level: f64) {
        self.voice_target = if level.is_finite() { level.clamp(0.0, 1.0) } else { 0.0 };
    }

    /// Advances the face by `dt` seconds. `eye_pitch` is where the eyes look now (radians, up
    /// positive), for the lids to follow.
    pub fn update(&mut self, dt: f64, eye_pitch: f64) -> &FaceFrame {
        let o = self.options;
        self.time += dt;
        let t = self.time;
        for v in self.frame.units.values_mut() {
            *v = 0.0;
        }
        // Blink: fast close, short hold, slower open; sometimes double, sometimes partial.
        let mut blink = 0.0;
        if o.blink {
            if self.blink_at < 0.0 && t >= self.next_blink {
                self.start_blink();
            }
            if self.blink_at >= 0.0 {
                let (s, hold) = (t - self.blink_at, 0.03);
                blink = if s < self.blink_close {
                    smooth(s / self.blink_close)
                } else if s < self.blink_close + hold {
                    1.0
                } else {
                    1.0 - smooth((s - self.blink_close - hold) / self.blink_open)
                };
                blink *= self.blink_depth;
                if s >= self.blink_close + hold + self.blink_open {
                    self.blink_at = -1.0;
                    if self.double_blink {
                        self.double_blink = false;
                        self.next_blink = t + 0.08;
                    } else {
                        let r = &mut self.rng;
                        let a = 1.5 + r.next() * 2.5;
                        let extra = if r.next() < 0.2 { r.next() * 4.0 } else { 0.0 };
                        self.next_blink = t + a + extra;
                    }
                }
            }
        }
        self.frame.blink = blink;
        // Saccades: a new fixation point now and then; sometimes a glance away and back.
        if o.saccades {
            if t >= self.next_saccade {
                if self.glance_until < 0.0 && self.rng.next() < 0.12 {
                    let (a, m) = (self.rng.next() * PI * 2.0, 0.1 + self.rng.next() * 0.15);
                    self.fix_yaw = a.cos() * m;
                    self.fix_pitch = a.sin() * m * 0.6;
                    self.glance_until = t + 0.4 + self.rng.next() * 1.2;
                    self.next_saccade = self.glance_until;
                    // Big eye moves often come with a blink.
                    if self.rng.next() < 0.35 && self.blink_at < 0.0 {
                        self.start_blink();
                    }
                } else {
                    // Micro-saccade around the target (a degree or two).
                    self.fix_yaw = (self.rng.next() - 0.5) * 0.05;
                    self.fix_pitch = (self.rng.next() - 0.5) * 0.035;
                    self.glance_until = -1.0;
                    self.next_saccade = t + 0.4 + self.rng.next() * 1.8;
                }
            }
        } else {
            self.fix_yaw = 0.0;
            self.fix_pitch = 0.0;
        }
        self.frame.yaw = self.fix_yaw;
        self.frame.pitch = self.fix_pitch;
        let u = &mut self.frame.units;
        // Idle drift: slow sines, never negative (units only push one way).
        if o.idle {
            for (i, (unit, amp, hz)) in IDLE.iter().enumerate() {
                let p = self.phases[i];
                let w = 0.5 + 0.35 * (t * hz * PI * 2.0 + p).sin() + 0.15 * (t * hz * 5.3 + p * 1.7).sin();
                *u.entry(unit.to_string()).or_insert(0.0) += amp * w;
            }
        }
        // Lids: follow the gaze, then the blink closes what's left.
        let (mut lid, mut open) = (0.0, 0.0);
        if o.lid_follow {
            let p = eye_pitch + self.frame.pitch;
            lid = ((-p).max(0.0) * 0.9).min(0.4);
            open = (p.max(0.0) * 0.9).min(0.35);
        }
        for s in 0..2 {
            u.insert(LIDS[s].into(), lid + (1.0 - lid) * blink);
            u.insert(OPEN[s].into(), open * (1.0 - blink));
        }
        self.speech(dt);
        for (k, v) in &self.mouth {
            *self.frame.units.entry(k.clone()).or_insert(0.0) += v * self.speech_intensity;
        }
        &self.frame
    }

    fn start_blink(&mut self) {
        let r = &mut self.rng;
        self.blink_at = self.time;
        self.blink_close = 0.06 + r.next() * 0.04;
        self.blink_open = 0.12 + r.next() * 0.1;
        self.blink_depth = if r.next() < 0.12 { 0.55 + r.next() * 0.3 } else { 1.0 };
        self.double_blink = self.blink_depth == 1.0 && r.next() < 0.08;
    }

    /// Mouth shape from the speech track and the voice level, eased so lips don't snap.
    fn speech(&mut self, dt: f64) {
        for v in self.mouth.values_mut() {
            *v = 0.0;
        }
        if let Some(tr) = &self.track {
            self.track_time += dt;
            let time = self.track_time;
            let mut i = 0;
            while i + 1 < tr.len() && tr[i + 1].time <= time {
                i += 1;
            }
            let (a, b) = (&tr[i], tr.get(i + 1));
            // Coarticulation: blend into the next shape over the second half of each step.
            let s = b.map_or(0.0, |b| smooth(((time - a.time) / (b.time - a.time).max(1e-3) - 0.4) / 0.6));
            let m = &mut self.mouth;
            let mut add = |key: Option<&VisemeKey>, w: f64| {
                let Some(key) = key.filter(|_| w > 0.0) else { return };
                let Some(shape) = viseme(&key.viseme) else { return };
                for (unit, v) in shape {
                    *m.entry(unit.to_string()).or_insert(0.0) += v * w * key.weight;
                }
            };
            add(Some(a), 1.0 - s);
            add(b, s);
            if b.is_none() && time > a.time + 0.2 {
                self.track = None;
            }
        }
        // Voice level: quick attack, slower release, like a jaw following syllables.
        let rate = if self.voice_target > self.voice { 25.0 } else { 10.0 };
        self.voice += (self.voice_target - self.voice) * (1.0 - (-rate * dt).exp());
        if self.voice > 0.005 {
            let open = self.mouth.entry("mouth-open".into()).or_insert(0.0);
            *open = open.max(self.voice * 0.5);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_becomes_visemes() {
        let keys = text_to_visemes("Hello, the moon", 1.0);
        let names: Vec<&str> = keys.iter().map(|k| k.viseme.as_str()).collect();
        assert_eq!(names, ["sil", "E", "nn", "oh", "sil", "TH", "E", "sil", "PP", "ou", "nn", "sil"]);
        assert!(keys.windows(2).all(|w| w[0].time <= w[1].time));
    }

    #[test]
    fn blinks_and_speaks() {
        let mut f = FaceAnimator::new(FaceAnimatorOptions { seed: 3, ..Default::default() });
        let (mut closed, mut open_mouth) = (0.0f64, 0.0f64);
        let d = f.say("Good morning to you", 1.0);
        assert!(d > 1.0 && f.speaking());
        for _ in 0..600 {
            let fr = f.update(1.0 / 60.0, 0.0);
            closed = closed.max(fr.units["eye-left-closure"]);
            open_mouth = open_mouth.max(fr.units.get("mouth-open").copied().unwrap_or(0.0));
        }
        assert!(closed > 0.5, "blinked: {closed}");
        assert!(open_mouth > 0.2, "talked: {open_mouth}");
        assert!(!f.speaking(), "speech ends");
        // Same seed, same motion.
        let mut a = FaceAnimator::new(FaceAnimatorOptions { seed: 9, ..Default::default() });
        let mut b = FaceAnimator::new(FaceAnimatorOptions { seed: 9, ..Default::default() });
        for _ in 0..100 {
            assert_eq!(a.update(0.02, 0.0).units, b.update(0.02, 0.0).units);
        }
    }
}
