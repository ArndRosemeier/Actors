import type { ShapeOptions, Vec3 } from "@actors/core";
import { BONE_GROUPS, type BodyFeatures, type BoneGroup, type FaceFeatures, MAX_HEAD_SCALE, RACE_IDS, RACE_STYLES, type RaceId, type RaceStyle, YOUTH } from "./races";

/** Which race a body has: one race, or two blended (half-elves, half-orcs...). */
export interface RaceSettings {
  race: RaceId;
  /** Second race for mixed heritage, or null. */
  race2: RaceId | null;
  /** 0..1 share of race2. */
  mix: number;
  /** 0..1 position in the race's size range (0.5 = typical). */
  size: number;
  /** 0 = grown up .. 1 = a child of about five (see YOUTH). */
  youth?: number;
}

export const DEFAULT_RACE: RaceSettings = { race: "human", race2: null, mix: 0, size: 0.5 };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const isRace = (r: unknown): r is RaceId => RACE_IDS.includes(r as RaceId);

export function sanitizeRace(r: Partial<RaceSettings> | undefined): RaceSettings {
  const race = isRace(r?.race) ? r.race : "human";
  const race2 = isRace(r?.race2) && r.race2 !== race ? r.race2 : null;
  const youth = clamp(r?.youth ?? 0, 0, 1);
  return { race, race2, mix: race2 ? clamp(r?.mix ?? 0.5, 0, 1) : 0, size: clamp(r?.size ?? 0.5, 0, 1), ...(youth > 0 ? { youth } : {}) };
}

/** The two styles and the blend weight of the second. */
function styles(r: RaceSettings): [RaceStyle, RaceStyle, number] {
  const s = sanitizeRace(r);
  const a = RACE_STYLES[s.race];
  return s.race2 ? [a, RACE_STYLES[s.race2], s.mix] : [a, a, 0];
}

/**
 * Feature -> targets, as [bare target base, opposing pair, gain]. A value v
 * of the feature adds |v|·gain to `${base}-${v < 0 ? neg : pos}`.
 */
const PAIRS: [string, string][] = [["decr", "incr"], ["down", "up"], ["in", "out"], ["backward", "forward"], ["concave", "convex"]];
type Term = [base: string, pair: number, gain: number];
export const FEATURE_TARGETS: Record<keyof FaceFeatures | keyof BodyFeatures, Term[]> = {
  jaw: [["chin-bones", 0, 1], ["chin-width", 0, 0.6]],
  chin: [["chin-prominent", 0, 1], ["chin-height", 0, 0.35]],
  cheekbones: [["%-cheek-bones", 0, 1]],
  noseSize: [["nose-scale-vert", 0, 1], ["nose-scale-depth", 0, 0.6], ["nose-volume", 0, 0.3]],
  noseWidth: [["nose-scale-horiz", 0, 1], ["nose-nostrils-width", 0, 0.6]],
  noseBridge: [["nose-hump", 0, 1]],
  browRidge: [["eyebrows-trans", 3, 0.8], ["forehead-nubian", 0, 0.5]],
  eyeSize: [["%-eye-scale", 0, 1]],
  eyeSpacing: [["%-eye-trans", 2, 1]],
  mouthWidth: [["mouth-scale-horiz", 0, 1]],
  lipFullness: [["mouth-upperlip-volume", 0, 1], ["mouth-lowerlip-volume", 0, 1]],
  earSize: [["%-ear-scale", 0, 1]],
  earPoint: [], // special: pointed vs round ear shape (see featureWeights)
  headRound: [], // special: round vs rectangular head
  foreheadSlope: [["forehead-trans", 3, -1]],
  shoulders: [["measure-shoulder-dist", 0, 1]],
  chest: [["measure-bust-circ", 0, 0.35]],
  waist: [["measure-waist-circ", 0, 1]],
  hips: [["measure-hips-circ", 0, 1], ["hip-scale-horiz", 0, 0.35]],
  armLength: [["measure-upperarm-length", 0, 1], ["measure-lowerarm-length", 0, 1]],
  legLength: [["measure-upperleg-height", 0, 1], ["measure-lowerleg-height", 0, 1]],
  neck: [["measure-neck-circ", 0, 1], ["neck-scale-depth", 0, 0.5]],
  hands: [["%-hand-scale", 0, 1]],
  feet: [["%-foot-scale", 0, 1]],
  belly: [["stomach-pregnant", 0, 0.8]],
};

/** Adds a bare target weight ("%" = both sides). */
function add(out: Map<string, number>, name: string, w: number) {
  if (!w) return;
  for (const n of name.includes("%") ? [name.replace("%", "l"), name.replace("%", "r")] : [name]) out.set(n, (out.get(n) ?? 0) + w);
}

function featureWeights(features: Record<string, number>, out: Map<string, number>, male: number) {
  for (const [key, v] of Object.entries(features)) {
    if (!v) continue;
    if (key === "earPoint") {
      if (v > 0) add(out, "%-ear-shape-pointed", Math.min(1, v));
      else add(out, "%-ear-shape-round", -v);
      continue;
    }
    if (key === "headRound") {
      add(out, v > 0 ? "head-round" : "head-rectangular", Math.abs(v) * 0.8);
      continue;
    }
    if (key === "chest" && male > 0.5) add(out, `torso-muscle-pectoral-${v < 0 ? "decr" : "incr"}`, Math.abs(v * male));
    for (const [base, pair, gain] of FEATURE_TARGETS[key as keyof typeof FEATURE_TARGETS] ?? []) {
      const s = v * gain;
      if (!s) continue;
      add(out, `${base}-${PAIRS[pair][s < 0 ? 0 : 1]}`, Math.abs(s));
    }
  }
}

/** Opposing pairs (…-decr and …-incr both present) collapse into their net effect. */
function netPairs(map: Map<string, number>) {
  for (const [neg, pos] of PAIRS) {
    for (const [name, w] of [...map]) {
      if (!name.endsWith("-" + neg) || !map.has(name)) continue;
      const other = name.slice(0, -neg.length) + pos;
      const wo = map.get(other);
      if (wo === undefined) continue;
      map.delete(name);
      map.delete(other);
      if (wo > w) map.set(other, wo - w);
      else if (w > wo) map.set(name, w - wo);
    }
  }
}

/** Race shaping as bare MakeHuman target names (before resolving them against a pack). */
export function raceBareTargetWeights(race: RaceSettings, gender = 0.5): Map<string, number> {
  const [A, B, mix] = styles(race);
  const out = new Map<string, number>();
  for (const [n, w] of Object.entries(A.targets)) add(out, n, w * (1 - mix));
  if (mix) for (const [n, w] of Object.entries(B.targets)) add(out, n, w * mix);
  const keys = new Set([...Object.keys(A.face), ...Object.keys(B.face), ...Object.keys(A.body), ...Object.keys(B.body)]);
  const features: Record<string, number> = {};
  const get = (s: RaceStyle, k: string) => ((s.face as Record<string, number>)[k] ?? (s.body as Record<string, number>)[k] ?? 0);
  for (const k of keys) features[k] = lerp(get(A, k), get(B, k), mix);
  const y = sanitizeRace(race).youth ?? 0;
  // The face turns young early (a ten-year-old already has most of a child's face); the build follows the size.
  if (y) {
    for (const [k, v] of Object.entries(YOUTH.face)) features[k] = (features[k] ?? 0) + v * Math.min(1, 1.5 * y);
    for (const [k, v] of Object.entries(YOUTH.body)) features[k] = (features[k] ?? 0) + v * y;
  }
  featureWeights(features, out, gender);
  netPairs(out);
  return out;
}

/** Maps bare target names ("l-ear-wing-incr") to a pack's names ("ears/l-ear-wing-incr"). */
export function targetResolver(names: Iterable<string>): (bare: string) => string | undefined {
  const map = new Map<string, string>();
  for (const n of names) {
    const base = n.slice(n.lastIndexOf("/") + 1);
    if (!n.startsWith("macro/") && !map.has(base)) map.set(base, n);
  }
  return (bare) => map.get(bare);
}

/** Race shaping as target weights of a pack (unknown targets are skipped). */
export function raceTargetWeights(race: RaceSettings, resolve: (bare: string) => string | undefined, gender = 0.5, out = new Map<string, number>()): Map<string, number> {
  for (const [bare, w] of raceBareTargetWeights(race, gender)) {
    const name = resolve(bare);
    if (name) out.set(name, (out.get(name) ?? 0) + w);
  }
  return out;
}

/** Overall scale of a race at `size` (0..1 within the race's range). */
export function raceScale(race: RaceSettings): number {
  const s = sanitizeRace(race);
  const [A, B, mix] = styles(s);
  return lerp(lerp(A.scale[0], A.scale[1], s.size), lerp(B.scale[0], B.scale[1], s.size), mix) * lerp(1, YOUTH.scale, s.youth ?? 0);
}

/** Head scale relative to the body: the race's (capped at MAX_HEAD_SCALE), and a child's bigger head on top. */
export function raceHeadScale(race: RaceSettings): number {
  const [A, B, mix] = styles(race);
  return Math.min(MAX_HEAD_SCALE, lerp(A.headScale, B.headScale, mix)) * lerp(1, YOUTH.head, sanitizeRace(race).youth ?? 0);
}

/** Ear masks: the ear-scale targets cover each whole ear. "l" is the actor's left (+X). */
export const EAR_MASKS = { l: "l-ear-scale-incr", r: "r-ear-scale-incr" };

/**
 * The race's proportion passes: bone scales (by bone name), head scale,
 * pointed ear tips and overall scale, for ActorRuntime.evaluate.
 */
export function raceShapeOptions(race: RaceSettings, boneNames: string[], resolve: (bare: string) => string | undefined): ShapeOptions {
  const [A, B, mix] = styles(race);
  const bones: Record<string, { len: number; girth: number }> = {};
  const groups = new Set([...Object.keys(A.bones), ...Object.keys(B.bones)] as BoneGroup[]);
  for (const g of groups) {
    const sa = A.bones[g] ?? {}, sb = B.bones[g] ?? {};
    const len = lerp(sa.len ?? 1, sb.len ?? 1, mix), girth = lerp(sa.girth ?? 1, sb.girth ?? 1, mix);
    for (const name of boneNames) {
      if (!BONE_GROUPS[g].test(name)) continue;
      const b = (bones[name] ??= { len: 1, girth: 1 });
      b.len *= len;
      b.girth *= girth;
    }
  }
  // A child's proportions (see YOUTH).
  const y = sanitizeRace(race).youth ?? 0;
  if (y) for (const [g, sc] of Object.entries(YOUTH.bones) as [BoneGroup, { len?: number; girth?: number }][]) {
    for (const name of boneNames) {
      if (!BONE_GROUPS[g].test(name)) continue;
      const b = (bones[name] ??= { len: 1, girth: 1 });
      b.len *= lerp(1, sc.len ?? 1, y);
      b.girth *= lerp(1, sc.girth ?? 1, y);
    }
  }
  const head = raceHeadScale(race);
  if (Math.abs(head - 1) > 1e-4 && boneNames.includes("head")) {
    const b = (bones.head ??= { len: 1, girth: 1 });
    b.len *= head;
    b.girth *= head;
  }
  // Ear tips: stronger on races with pointed ears (as in Norgo: tip × ear point, plus a boost for very pointed ears).
  const earPoint = lerp(A.face.earPoint ?? 0, B.face.earPoint ?? 0, mix);
  const tip = Math.max(0, lerp(A.earTip, B.earTip, mix)) * clamp(earPoint, 0, 1.3) + Math.max(0, earPoint - 0.6) * 0.8;
  const side = lerp(A.earSideways, B.earSideways, mix);
  const tips: ShapeOptions["tips"] = [];
  if (tip > 0.01) {
    for (const [s, bare] of [[1, EAR_MASKS.l], [-1, EAR_MASKS.r]] as const) {
      const mask = resolve(bare);
      // Up and back for elves, out to the side for goblins (+Z is forward).
      const direction: Vec3 = [s * (0.25 + 0.75 * side), 1 - 0.75 * side, -(0.55 - 0.35 * side)];
      if (mask) tips.push({ mask, amount: 0.05 * tip, direction });
    }
  }
  return { bones, tips, scale: raceScale(race) };
}
