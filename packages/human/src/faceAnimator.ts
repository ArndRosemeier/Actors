import type { UnitWeights } from "./expressions";

/**
 * Lip shapes for speech (the common 15-viseme set used by lip-sync tools), each a mix of
 * MakeHuman face units. Values are 0..1 unit weights.
 */
export const VISEMES: Record<string, UnitWeights> = {
  sil: {},
  PP: { "mouth-compression": 0.75 },
  FF: { "mouth-open": 0.06, "mouth-upward-retraction": 0.3, "mouth-depression": 0.25 },
  TH: { "mouth-open": 0.14, "mouth-parling": 0.25 },
  DD: { "mouth-open": 0.2, "mouth-retraction": 0.18 },
  kk: { "mouth-open": 0.26, "mouth-retraction": 0.12 },
  CH: { "mouth-open": 0.12, "mouth-pursing": 0.35, "mouth-protusion": 0.45, "mouth-eversion": 0.3 },
  SS: { "mouth-open": 0.05, "mouth-retraction": 0.35, "mouth-parling": 0.35 },
  nn: { "mouth-open": 0.14, "mouth-retraction": 0.1 },
  RR: { "mouth-open": 0.14, "mouth-pursing": 0.35, "mouth-protusion": 0.15 },
  aa: { "mouth-open": 0.55 },
  E: { "mouth-open": 0.3, "mouth-retraction": 0.4 },
  ih: { "mouth-open": 0.18, "mouth-retraction": 0.5 },
  oh: { "mouth-open": 0.4, "mouth-pursing": 0.5 },
  ou: { "mouth-open": 0.1, "mouth-pursing": 0.8, "mouth-protusion": 0.5 },
};

/** One step of a lip-sync track: a viseme (see `VISEMES`) starting at `time` seconds. */
export interface VisemeKey {
  time: number;
  viseme: string;
  /** 0..1, default 1. */
  weight?: number;
}

// Letter groups to visemes, digraphs first. A rough English reading: good enough for mouth movement, not a phonemiser.
const DIGRAPHS: [string, string][] = [
  ["th", "TH"], ["ch", "CH"], ["sh", "CH"], ["ph", "FF"], ["ng", "kk"], ["qu", "kk"], ["ee", "ih"], ["ea", "ih"],
  ["oo", "ou"], ["ou", "ou"], ["ow", "oh"], ["oa", "oh"], ["ai", "E"], ["ay", "E"], ["igh", "aa"], ["ck", "kk"],
];
const LETTERS: Record<string, string> = {
  a: "aa", e: "E", i: "ih", o: "oh", u: "ou", y: "ih",
  b: "PP", m: "PP", p: "PP", f: "FF", v: "FF", w: "ou",
  d: "DD", t: "DD", l: "nn", n: "nn", s: "SS", z: "SS", c: "kk", k: "kk", g: "kk", q: "kk", x: "kk", h: "sil",
  j: "CH", r: "RR",
};
const VOWELS = new Set(["aa", "E", "ih", "oh", "ou"]);

/**
 * Turns text into a viseme track (rough English letter rules), `rate` = speed factor (1 is about
 * 13 letters a second). Use a real phoneme or viseme stream from your TTS when you have one.
 */
export function textToVisemes(text: string, rate = 1): VisemeKey[] {
  const keys: VisemeKey[] = [];
  const s = text.toLowerCase();
  let t = 0;
  const push = (viseme: string, dur: number) => {
    const last = keys[keys.length - 1];
    if (last && last.viseme === viseme) {
      t += (dur / rate) * 0.5; // a doubled letter only lengthens the shape
      return;
    }
    keys.push({ time: t, viseme });
    t += dur / rate;
  };
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (/[.,;:!?]/.test(c)) {
      push("sil", c === "," ? 0.18 : 0.32);
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      push("sil", 0.04);
      i++;
      continue;
    }
    const di = DIGRAPHS.find(([d]) => s.startsWith(d, i));
    const v = di ? di[1] : LETTERS[c];
    i += di ? di[0].length : 1;
    if (!v) continue; // digits, symbols
    push(v, VOWELS.has(v) ? 0.11 : 0.065);
  }
  keys.push({ time: t, viseme: "sil" });
  return keys;
}

/** What `FaceAnimator.update` produces for one frame. */
export interface FaceFrame {
  /** Face units to add on top of the expression (unit name -> weight). Reused between frames. */
  units: Record<string, number>;
  /** Eyelid closure from blinking, 0..1 (already included in `units`; for faces without a rig). */
  blink: number;
  /** Eye offsets (radians) to add to the look direction: saccades and glances. */
  yaw: number;
  pitch: number;
}

export interface FaceAnimatorOptions {
  /** Natural blinking: varied timing and speed, double and partial blinks. Default true. */
  blink?: boolean;
  /** Small eye jumps while fixating, and now and then a glance away. Default true. */
  saccades?: boolean;
  /** Slow, small movement of brows, mouth corners and nostrils. Default true. */
  idle?: boolean;
  /** Upper lids follow the eyes up and down. Default true. */
  lidFollow?: boolean;
  /** Random source (0..1), e.g. a seeded one for repeatable motion. Default Math.random. */
  random?: () => number;
}

const LIDS = ["eye-left-closure", "eye-right-closure"] as const;
const OPEN = ["eye-left-opened-up", "eye-right-opened-up"] as const;
// Idle drift: unit, amplitude, slow frequency (Hz). Paired units (left/right) move together but not quite in step.
const IDLE: [string, number, number][] = [
  ["eyebrows-left-up", 0.1, 0.05], ["eyebrows-right-up", 0.1, 0.05],
  ["eyebrows-left-inner-up", 0.06, 0.037], ["eyebrows-right-inner-up", 0.06, 0.037],
  ["mouth-corner-puller", 0.08, 0.029], ["mouth-compression", 0.07, 0.043],
  ["nose-left-dilatation", 0.1, 0.23], ["nose-right-dilatation", 0.1, 0.23],
  ["eye-left-slit", 0.06, 0.06], ["eye-right-slit", 0.06, 0.06],
];

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * A living face, renderer-free: blinks, eye saccades and glances, idle micro-movement, lids that
 * follow the gaze, and lip-sync from text, a viseme track or a voice level. Call `update` once a
 * frame; it returns face-unit weights to add on top of the expression (needs a face rig to show
 * them) and eye offsets for the renderer to apply.
 */
export class FaceAnimator {
  readonly options: Required<Omit<FaceAnimatorOptions, "random">>;
  private readonly random: () => number;
  private readonly frame: FaceFrame = { units: {}, blink: 0, yaw: 0, pitch: 0 };
  private time = 0;
  // Blinks
  private nextBlink: number;
  private blinkAt = -1;
  private blinkClose = 0.08;
  private blinkOpen = 0.16;
  private blinkDepth = 1;
  private doubleBlink = false;
  // Saccades: fixation offset (radians) and when it changes.
  private fixYaw = 0;
  private fixPitch = 0;
  private nextSaccade = 0.5;
  private glanceUntil = -1;
  // Idle phases
  private readonly phases: number[];
  // Speech
  private track: VisemeKey[] | null = null;
  private trackTime = 0;
  private voice = 0;
  private voiceTarget = 0;
  private readonly mouth: Record<string, number> = {};
  /** Overall strength of the lip shapes (0..1). */
  speechIntensity = 1;

  constructor(options: FaceAnimatorOptions = {}) {
    this.options = { blink: options.blink ?? true, saccades: options.saccades ?? true, idle: options.idle ?? true, lidFollow: options.lidFollow ?? true };
    this.random = options.random ?? Math.random;
    this.nextBlink = 1 + this.random() * 3;
    this.phases = IDLE.map(() => this.random() * Math.PI * 2);
    // Paired units share most of their phase.
    for (let i = 0; i < IDLE.length; i++) if (IDLE[i][0].includes("right")) this.phases[i] = this.phases[i - 1] + 0.3;
  }

  /** True while a text or viseme track is playing. */
  get speaking(): boolean {
    return this.track !== null;
  }

  /** Speaks a text (rough letter-to-viseme rules). Returns its duration in seconds. */
  say(text: string, rate = 1): number {
    return this.speak(textToVisemes(text, rate));
  }

  /** Plays a viseme track (times in seconds from now), e.g. from a TTS engine. Returns its duration. */
  speak(track: VisemeKey[]): number {
    this.track = track.length ? [...track].sort((a, b) => a.time - b.time) : null;
    this.trackTime = 0;
    return track.length ? track[track.length - 1].time : 0;
  }

  /** Stops text or track speech. */
  stopSpeaking(): void {
    this.track = null;
  }

  /** Voice loudness 0..1 (e.g. from an audio analyser), opening the jaw; 0 when silent. */
  setVoiceLevel(level: number): void {
    this.voiceTarget = Math.max(0, Math.min(1, level));
  }

  /**
   * Advances the face by `dt` seconds. `eyePitch` is where the eyes look now (radians, up
   * positive), for the lids to follow.
   */
  update(dt: number, eyePitch = 0): FaceFrame {
    const o = this.options, f = this.frame, u = f.units, r = this.random;
    this.time += dt;
    const t = this.time;
    for (const k in u) u[k] = 0;
    // Blink: fast close, short hold, slower open; sometimes double, sometimes partial.
    let blink = 0;
    if (o.blink) {
      if (this.blinkAt < 0 && t >= this.nextBlink) this.startBlink();
      if (this.blinkAt >= 0) {
        const s = t - this.blinkAt, hold = 0.03;
        if (s < this.blinkClose) blink = smooth(s / this.blinkClose);
        else if (s < this.blinkClose + hold) blink = 1;
        else blink = 1 - smooth((s - this.blinkClose - hold) / this.blinkOpen);
        blink *= this.blinkDepth;
        if (s >= this.blinkClose + hold + this.blinkOpen) {
          this.blinkAt = -1;
          if (this.doubleBlink) {
            this.doubleBlink = false;
            this.nextBlink = t + 0.08;
          } else this.nextBlink = t + 1.5 + r() * 2.5 + (r() < 0.2 ? r() * 4 : 0);
        }
      }
    }
    f.blink = blink;
    // Saccades: a new fixation point now and then; sometimes a glance away and back.
    if (o.saccades) {
      if (t >= this.nextSaccade) {
        if (this.glanceUntil < 0 && r() < 0.12) {
          const a = r() * Math.PI * 2, m = 0.1 + r() * 0.15;
          this.fixYaw = Math.cos(a) * m;
          this.fixPitch = Math.sin(a) * m * 0.6;
          this.glanceUntil = t + 0.4 + r() * 1.2;
          this.nextSaccade = this.glanceUntil;
          if (r() < 0.35 && this.blinkAt < 0) this.startBlink(); // big eye moves often come with a blink
        } else {
          // Micro-saccade around the target (a degree or two).
          this.fixYaw = (r() - 0.5) * 0.05;
          this.fixPitch = (r() - 0.5) * 0.035;
          this.glanceUntil = -1;
          this.nextSaccade = t + 0.4 + r() * 1.8;
        }
      }
    } else this.fixYaw = this.fixPitch = 0;
    f.yaw = this.fixYaw;
    f.pitch = this.fixPitch;
    // Idle drift: slow sines, never negative (units only push one way).
    if (o.idle)
      for (let i = 0; i < IDLE.length; i++) {
        const [unit, amp, hz] = IDLE[i];
        const p = this.phases[i];
        const w = 0.5 + 0.35 * Math.sin(t * hz * Math.PI * 2 + p) + 0.15 * Math.sin(t * hz * 5.3 + p * 1.7);
        u[unit] = (u[unit] ?? 0) + amp * w;
      }
    // Lids: follow the gaze, then the blink closes what's left.
    let lid = 0, open = 0;
    if (o.lidFollow) {
      const p = eyePitch + f.pitch;
      lid = Math.min(0.4, Math.max(0, -p) * 0.9);
      open = Math.min(0.35, Math.max(0, p) * 0.9);
    }
    for (let s = 0; s < 2; s++) {
      u[LIDS[s]] = lid + (1 - lid) * blink;
      u[OPEN[s]] = open * (1 - blink);
    }
    this.speech(dt);
    for (const k in this.mouth) u[k] = (u[k] ?? 0) + this.mouth[k] * this.speechIntensity;
    return f;
  }

  private startBlink(): void {
    const r = this.random;
    this.blinkAt = this.time;
    this.blinkClose = 0.06 + r() * 0.04;
    this.blinkOpen = 0.12 + r() * 0.1;
    this.blinkDepth = r() < 0.12 ? 0.55 + r() * 0.3 : 1;
    this.doubleBlink = this.blinkDepth === 1 && r() < 0.08;
  }

  /** Mouth shape from the speech track and the voice level, eased so lips don't snap. */
  private speech(dt: number): void {
    const m = this.mouth;
    for (const k in m) m[k] = 0;
    const tr = this.track;
    if (tr) {
      this.trackTime += dt;
      const time = this.trackTime;
      let i = 0;
      while (i + 1 < tr.length && tr[i + 1].time <= time) i++;
      const a = tr[i], b = tr[i + 1];
      // Coarticulation: blend into the next shape over the second half of each step.
      const s = b ? smooth(((time - a.time) / Math.max(1e-3, b.time - a.time) - 0.4) / 0.6) : 0;
      const add = (key: VisemeKey | undefined, w: number) => {
        if (!key || w <= 0) return;
        const shape = VISEMES[key.viseme];
        if (!shape) return;
        const k = w * (key.weight ?? 1);
        for (const unit in shape) m[unit] = (m[unit] ?? 0) + shape[unit] * k;
      };
      add(a, 1 - s);
      add(b, s);
      if (!b && time > a.time + 0.2) this.track = null;
    }
    // Voice level: quick attack, slower release, like a jaw following syllables.
    const rate = this.voiceTarget > this.voice ? 25 : 10;
    this.voice += (this.voiceTarget - this.voice) * (1 - Math.exp(-rate * dt));
    if (this.voice > 0.005) m["mouth-open"] = Math.max(m["mouth-open"] ?? 0, this.voice * 0.5);
  }
}
