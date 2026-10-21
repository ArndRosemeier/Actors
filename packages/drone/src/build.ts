/**
 * Turns a `DroneSpec` into a rigid node hierarchy, meshes per node and
 * material slot, glow points and baked looping clips (rotor spin, hover bob,
 * vectored thrust, sensor sweeps, arms, gear, blinking strobes). Built in
 * "units" (hull length about 1) and scaled to `spec.size` meters at the end.
 */
import {
  type Geom,
  type Section,
  type Xf,
  append,
  beam,
  box,
  cylinder,
  empty,
  lathe,
  plate,
  plume,
  raycast,
  roundedRect,
  superellipsoid,
  sweep,
  torus,
  tris,
} from "./geom";
import { DEG, type Q4, Q_ID, Rng, type V3, add, clamp, cross, lerp, mul, norm, qAxis, qFrame, qMul, qRot, smooth, sub } from "./math";
import type { DroneSpec, Mount, RGB } from "./spec";

/** Material slots; the adapter maps each to a material built from the palette. */
export type DroneSlot =
  | "primary"
  | "secondary"
  | "accent"
  | "metal"
  | "dark"
  | "glass"
  | "glow"
  | "hazard"
  | "exhaust"
  | "beam"
  | "blur"
  | "navRed"
  | "navGreen"
  | "white";

/** Slots drawn additively / transparently (left out of bounds and ground contact). */
export const EFFECT_SLOTS: readonly DroneSlot[] = ["exhaust", "beam", "blur"];

export interface DroneNode {
  name: string;
  /** Index of the parent node, -1 for the root. */
  parent: number;
  position: V3;
  quaternion: Q4;
  scale: V3;
}

export interface DroneMesh {
  node: number;
  slot: DroneSlot;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** 0 at the base of plumes and beams, 1 at the tip. */
  fade?: Float32Array;
}

export interface DroneTrack {
  node: number;
  path: "position" | "quaternion" | "scale";
  times: Float32Array;
  values: Float32Array;
  /** Hold each key (blinking lights). */
  step?: boolean;
}

export type DroneClipName = "hover" | "cruise" | "scan" | "land" | "work" | "attack";

export interface DroneClip {
  name: DroneClipName;
  duration: number;
  tracks: DroneTrack[];
}

/** A point that glows (lens, nav light, nozzle); the adapter draws a halo there. */
export interface DroneGlow {
  node: number;
  color: RGB;
  /** Halo diameter in meters. */
  size: number;
}

export interface DroneModel {
  spec: DroneSpec;
  nodes: DroneNode[];
  meshes: DroneMesh[];
  clips: DroneClip[];
  glows: DroneGlow[];
  /** Bounds of the rest pose (hovering) in meters. */
  bounds: { min: V3; max: V3 };
  /** Height of the body node while hovering and when landed (meters). */
  hoverHeight: number;
  landedHeight: number;
  triangles: number;
}

const NAV_RED: RGB = [1, 0.12, 0.08];
const NAV_GREEN: RGB = [0.15, 1, 0.35];
const WHITE: RGB = [1, 1, 1];
const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1];
const DURATION = 4;
const FPS = 30;

interface PoseCtx {
  clip: DroneClipName;
  /** Seconds and 0..1 phase of the loop. */
  t: number;
  u: number;
  /** sin over n whole cycles per loop (loops seamlessly). */
  wave(n: number, phase?: number): number;
  turn(node: number, axis: V3, angle: number): void;
  turnParent(node: number, axis: V3, angle: number): void;
  move(node: number, d: V3): void;
  grow(node: number, s: number | V3): void;
}
type Motion = (c: PoseCtx) => void;

export function buildDrone(spec: DroneSpec): DroneModel {
  const nodes: DroneNode[] = [];
  const parts = new Map<string, Geom>();
  const motions: Motion[] = [];
  const glows: DroneGlow[] = [];
  const steps = new Set<number>(); // nodes whose tracks hold keys
  const rng = new Rng(spec.seed).fork("build");

  const node = (name: string, parent: number, position: V3 = [0, 0, 0], quaternion: Q4 = Q_ID): number => {
    let n = name, k = 2;
    while (nodes.some((o) => o.name === n)) n = `${name}_${k++}`;
    nodes.push({ name: n, parent, position: [...position], quaternion: [...quaternion], scale: [1, 1, 1] });
    return nodes.length - 1;
  };
  const put = (at: number, slot: DroneSlot, g: Geom, xf?: Xf): void => {
    const key = `${at}|${slot}`;
    let dst = parts.get(key);
    if (!dst) parts.set(key, (dst = empty()));
    append(dst, g, xf);
  };
  const glow = (at: number, color: RGB, size: number) => glows.push({ node: at, color, size });

  const { hull: H, propulsion: P, palette } = spec;
  const L = H.length, W = H.width, HH = H.height;
  const hoverY = (1.0 + 0.2 * spec.size) / spec.size;
  const root = node("drone", -1);
  const body = node("body", root, [0, hoverY, 0]);

  // ---------------------------------------------------------------- hull
  const hullGeom = empty();
  const shell = (slot: DroneSlot, g: Geom, xf?: Xf, solid = true) => {
    put(body, slot, g, xf);
    if (solid) append(hullGeom, g, xf);
  };
  const sexp = clamp(2 / H.roundness, 1.4, 6);
  if (H.kind === "pod") {
    const e = clamp(H.roundness, 0.3, 1.4);
    shell("primary", superellipsoid(W / 2, HH / 2, L / 2, e, Math.max(0.45, e), 48, 24));
    if (H.belt) shell("secondary", superellipsoid(W / 2 + 0.008, HH / 2 + 0.008, L / 2 + 0.008, e, Math.max(0.45, e), 48, 4, -0.1, 0.1), {}, false);
  } else if (H.kind === "wedge" || H.kind === "manta") {
    const secs: Section[] = [];
    const n = 18;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const z = -L / 2 + L * t;
      let w: number, up: number, down: number, y = 0;
      if (H.kind === "wedge") {
        w = t < 0.42 ? lerp(0.62, 1, smooth(t / 0.42)) : lerp(1, 0.06, Math.pow((t - 0.42) / 0.58, 1.6 - 0.8 * H.nose));
        up = t < 0.45 ? lerp(0.75, 1, smooth(t / 0.45)) : lerp(1, 0.2, smooth((t - 0.45) / 0.55));
        down = up * 0.75;
        y = t > 0.55 ? -(t - 0.55) * 0.2 * HH : 0;
        secs.push({ o: [0, y, z], u: X, v: Y, w: (w * W) / 2, up: (up * HH) / 2, down: (down * HH) / 2, n: sexp });
      } else {
        w = t < 0.28 ? lerp(0.5, 1, smooth(t / 0.28)) : lerp(1, 0.05, Math.pow((t - 0.28) / 0.72, 0.85 + 0.4 * H.nose));
        up = 0.35 + 0.65 * Math.sin(Math.PI * clamp(t * 1.05, 0, 1));
        secs.push({ o: [0, 0, z], u: X, v: Y, w: (w * W) / 2, up: (up * HH) / 2, down: (up * HH * 0.55) / 2, n: 2.3 });
      }
    }
    shell("primary", sweep(secs, 40));
    if (H.kind === "manta") {
      // Raised centre fuselage.
      shell("secondary", superellipsoid(W * 0.13, HH * 0.75, L * 0.32, 0.8, 0.9, 32, 16), { p: [0, HH * 0.05, -L * 0.02] });
    }
  } else if (H.kind === "disc") {
    const R = W / 2;
    shell(
      "primary",
      lathe(
        [
          { r: 0, y: -0.4 * HH },
          { r: 0.45 * R, y: -0.34 * HH },
          { r: 0.85 * R, y: -0.15 * HH },
          { r: R, y: -0.03 * HH, sharp: true },
          { r: R, y: 0.03 * HH, sharp: true },
          { r: 0.82 * R, y: 0.16 * HH },
          { r: 0.48 * R, y: 0.33 * HH },
          { r: 0.2 * R, y: 0.46 * HH },
          { r: 0, y: 0.5 * HH },
        ],
        64,
      ),
    );
    if (H.belt) shell("secondary", lathe(roundedRect(R * 0.985, R * 1.035, -0.05 * HH, 0.05 * HH, 0.02 * HH), 64, true), {}, false);
    shell("dark", lathe(roundedRect(0.3 * R, 0.5 * R, -0.37 * HH, -0.3 * HH, 0.02 * HH), 48, true), {}, false);
  } else if (H.kind === "orb") {
    const R = W / 2;
    shell("dark", superellipsoid(R * 0.94, (HH / 2) * 0.94, R * 0.94, 1, 1, 48, 24));
    for (const sg of [1, -1]) {
      const prof = [] as { r: number; y: number }[];
      const a0 = 16 * DEG, a1 = 89 * DEG;
      for (let k = 0; k <= 12; k++) {
        const a = lerp(a0, a1, k / 12);
        prof.push({ r: R * Math.cos(a), y: (sg * HH * Math.sin(a)) / 2 });
      }
      for (let k = 12; k >= 0; k--) {
        const a = lerp(a0, a1, k / 12);
        prof.push({ r: R * 0.95 * Math.cos(a), y: (sg * HH * 0.95 * Math.sin(a)) / 2 });
      }
      if (sg < 0) prof.reverse();
      shell("primary", lathe(prof, 48, true));
    }
    shell("secondary", lathe(roundedRect(R * 0.9, R * 0.975, -HH * 0.05, HH * 0.05, HH * 0.02), 64, true), {}, false);
  } else {
    // frame: compact core box with a cover plate and a battery tray
    shell("primary", box(W, HH, L, Math.min(W, HH, L) * 0.22, 3));
    shell("secondary", box(W * 0.8, HH * 0.22, L * 0.86, HH * 0.08, 2), { p: [0, HH * 0.52, -L * 0.02] });
    shell("dark", box(W * 0.6, HH * 0.3, L * 0.7, HH * 0.06, 2), { p: [0, -HH * 0.55, 0] });
    shell("hazard", box(W * 0.62, HH * 0.06, L * 0.12, 0.01, 1), { p: [0, -HH * 0.55, L * 0.36] }, false);
  }

  const ext = bboxOf(hullGeom);
  const hit = (o: V3, d: V3) => raycast(hullGeom, o, norm(d));
  const fallback = (p: V3, n: V3) => ({ p, n, t: 0 });
  const top = (x: number, z: number) => hit([x, 10, z], [0, -1, 0]) ?? fallback([x, ext.max[1], z], Y);
  const bottom = (x: number, z: number) => hit([x, -10, z], [0, 1, 0]) ?? fallback([x, ext.min[1], z], [0, -1, 0]);
  const front = (x: number, y: number) => hit([x, y, 10], [0, 0, -1]) ?? fallback([x, y, ext.max[2]], Z);
  const rear = (x: number, y: number) => hit([x, y, -10], [0, 0, 1]) ?? fallback([x, y, ext.min[2]], [0, 0, -1]);
  const side = (sg: number, y: number, z: number) => hit([sg * 10, y, z], [-sg, 0, 0]) ?? fallback([sg * ext.max[0], y, z], [sg, 0, 0]);
  const toward = (from: V3, to: V3) => hit(from, sub(to, from));
  const flat = H.kind === "wedge" || H.kind === "manta";
  const topZ = { canopy: L * 0.16, sensor: -L * 0.1, weapon: -L * 0.3, antenna: -L * 0.36 };
  const bellyZ = { sensor: L * 0.24, tool: L * 0.02, weapon: -L * 0.24 };
  const S = Math.max(W, L) / 2; // hull radius

  // Hull dressing: canopy, spine, plates, vents, greebles.
  if (H.canopy) {
    const a = top(0, topZ.canopy);
    const rx = W * (flat ? 0.16 : 0.22), rz = L * (flat ? 0.2 : 0.18);
    put(body, "glass", superellipsoid(rx, HH * 0.22, rz, 0.7, 0.9, 32, 10, 0, 1), { p: sub(a.p, [0, HH * 0.03, 0]) });
    put(body, "secondary", superellipsoid(rx * 1.08, HH * 0.04, rz * 1.06, 0.4, 0.9, 32, 4, -1, 1), { p: sub(a.p, [0, HH * 0.03, 0]) });
  }
  if (H.spine) {
    const secs: Section[] = [];
    for (let k = 0; k <= 8; k++) {
      const z = lerp(-L * 0.45, H.canopy ? L * 0.0 : L * 0.25, k / 8);
      const a = top(0, z);
      const taper = Math.sin((Math.PI * (k + 0.5)) / 9.0);
      secs.push({ o: sub(a.p, [0, 0.004, 0]), u: X, v: Y, w: W * 0.035, up: HH * 0.09 * (0.3 + 0.7 * taper), down: 0.01, n: 3 });
    }
    put(body, "secondary", sweep(secs, 12));
  }
  const detail = H.detail;
  const rd = rng.fork("detail");
  const nPlates = Math.round(detail * (H.kind === "frame" ? 4 : 10));
  for (let k = 0; k < nPlates; k++) {
    const sg = rd.chance(0.5) ? 1 : -1;
    const az = rd.range(-0.4, 0.35) * L;
    const el = rd.range(-0.2, 0.9);
    const dir: V3 = norm([sg * Math.sqrt(Math.max(0, 1 - el * el)), el, rd.range(-0.3, 0.3)]);
    const h = toward(add([0, 0, az], mul(dir, 10)), [0, 0, az]);
    if (!h) continue;
    const pw = rd.range(0.07, 0.16) * S, pl = rd.range(0.07, 0.18) * S;
    const slot: DroneSlot = rd.chance(0.15) ? "accent" : rd.chance(0.5) ? "secondary" : "primary";
    const q = qFrame(h.n, Z);
    const g = box(pw, 0.012 * S, pl, 0.004 * S, 1);
    put(body, slot, g, { p: add(h.p, mul(h.n, 0.002)), q });
    // Mirror for symmetry.
    put(body, slot, g, { p: add([-h.p[0], h.p[1], h.p[2]], mul([-h.n[0], h.n[1], h.n[2]], 0.002)), q: qFrame([-h.n[0], h.n[1], h.n[2]], Z) });
  }
  if (detail > 0.3 && H.kind !== "orb") {
    // Cooling vents on the back.
    const nV = detail > 0.7 ? 2 : 1;
    for (let k = 0; k < nV; k++) {
      const x = nV === 2 ? (k ? -1 : 1) * W * 0.16 : 0;
      const a = top(x, -L * 0.22);
      const q = qFrame(a.n, Z);
      const vw = W * 0.14, vl = L * 0.14;
      put(body, "dark", box(vw, 0.02 * S, vl, 0.005 * S, 1), { p: a.p, q });
      for (let s = 0; s < 5; s++) {
        const off = qRot(q, [0, 0.01 * S, -vl / 2 + (vl * (s + 0.5)) / 5]);
        put(body, "metal", box(vw * 0.9, 0.008 * S, vl * 0.08, 0.002 * S, 1), { p: add(a.p, off), q: qMul(q, qAxis(X, -25 * DEG)) });
      }
    }
  }
  const nG = Math.round(detail * 10);
  for (let k = 0; k < nG; k++) {
    const sg = k % 2 ? 1 : -1;
    const az = rd.range(-0.45, 0.2) * L;
    const dir: V3 = norm([sg * rd.range(0.4, 1), rd.range(-0.8, 0.3), rd.range(-0.4, 0.2)]);
    const h = toward(add([0, 0, az], mul(dir, 10)), [0, 0, az]);
    if (!h) continue;
    const q = qFrame(h.n, Z);
    const s = rd.range(0.02, 0.05) * S;
    const g = rd.chance(0.5) ? box(s, s * 0.5, s * rd.range(1, 2.5), s * 0.1, 1) : cylinder(s * 0.4, s * 0.6, 12);
    put(body, rd.chance(0.6) ? "metal" : "dark", g, { p: h.p, q });
    put(body, rd.chance(0.6) ? "metal" : "dark", g, { p: [-h.p[0], h.p[1], h.p[2]], q: qFrame([-h.n[0], h.n[1], h.n[2]], Z) });
  }

  // ---------------------------------------------------------------- propulsion
  type Unit = { pos: V3; dir: V3; side: number; index: number };
  const units: Unit[] = [];
  const liftY = (P.lift * HH) / 2;
  const R = P.radius * (P.kind === "ring" ? 1 : 1);
  if (P.kind !== "ring") {
    if (P.layout === "under") {
      for (let i = 0; i < P.count; i++) {
        const a = Math.PI / P.count + (2 * Math.PI * i) / P.count;
        const x = Math.sin(a) * W * 0.3, z = Math.cos(a) * L * 0.3;
        const b = bottom(x, z);
        units.push({ pos: add(b.p, [0, 0.01, 0]), dir: norm([Math.sin(a), 0, Math.cos(a)]), side: Math.sign(x) || 1, index: i });
      }
    } else if (P.layout === "lateral") {
      const pairs = P.count / 2;
      for (let j = 0; j < pairs; j++) {
        const z = pairs === 1 ? -L * 0.05 : lerp(-L * 0.32, L * 0.28, j / (pairs - 1));
        const sx = side(1, liftY, z).p[0];
        for (const sg of [1, -1]) {
          const reach = P.kind === "jet" ? R * 1.25 : R * 1.12;
          units.push({ pos: [sg * (sx + reach + P.reach), liftY, z], dir: [sg, 0, 0], side: sg, index: units.length });
        }
      }
    } else {
      const phase = Math.PI / P.count;
      for (let i = 0; i < P.count; i++) {
        const a = phase + (2 * Math.PI * i) / P.count;
        const dir: V3 = [Math.sin(a), 0, Math.cos(a)];
        const re = 1 / Math.hypot(dir[0] / (ext.max[0] || 1), dir[2] / (ext.max[2] || 1));
        const reach = P.kind === "rotor" ? R * 1.04 : R * 1.15;
        units.push({ pos: [dir[0] * (re + reach + P.reach), liftY, dir[2] * (re + reach + P.reach)], dir, side: Math.sign(dir[0]) || 1, index: i });
      }
    }
  }

  // Arms from the hull to each unit.
  const ductT = R * 0.13;
  for (const u of units) {
    if (P.arm === "none" || P.layout === "under") continue;
    const inner = add([0, u.pos[1], 0], mul(u.dir, 0.02));
    const h = toward([u.pos[0], u.pos[1], u.pos[2]], inner);
    if (!h) continue;
    const start = sub(h.p, mul(u.dir, 0.03 * S));
    const endOff = P.kind === "ducted" ? R * 1.02 + ductT * 0.6 : P.kind === "jet" ? R * 0.95 : 0;
    const end = sub(u.pos, mul(u.dir, endOff));
    if (P.arm === "wing") {
      const perp: V3 = [u.dir[2], 0, -u.dir[0]];
      const c0 = Math.min(L * 0.45, 0.42 * S), c1 = R * (P.kind === "jet" ? 1.6 : 0.9);
      const sweepBack: V3 = [0, 0, -0.08 * S];
      const pts: V3[] = [add(start, mul(perp, c0 / 2)), add(add(end, mul(perp, c1 / 2)), sweepBack), add(add(end, mul(perp, -c1 / 2)), sweepBack), add(start, mul(perp, -c0 / 2))];
      put(body, "primary", plate(pts.map((p) => [p[0], p[2]] as [number, number]), 0.035 * S, 0.15), { p: [0, u.pos[1], 0] });
      put(body, "accent", plate(pts.map((p) => [p[0], p[2]] as [number, number]).map(([x, z], k) => (k === 1 || k === 2 ? [x, z] : [x * 0.9 + end[0] * 0.1, z * 0.9 + end[2] * 0.1]) as [number, number]), 0.004 * S), { p: [0, u.pos[1] + 0.019 * S, 0], s: [1, 1, 1] });
    } else if (P.arm === "boom") {
      put(body, "primary", beam(start, add(end, [0, 0.02 * S, 0]), 0.1 * S, 0.075 * S, 0.055 * S, 0.045 * S, 2.4));
      put(body, "dark", beam(lerp3v(start, end, 0.45), lerp3v(start, end, 0.55), 0.105 * S, 0.08 * S, 0.1 * S, 0.075 * S, 2.4));
    } else {
      put(body, "secondary", beam(start, end, 0.075 * S, 0.055 * S, 0.055 * S, 0.042 * S, 4));
      put(body, "metal", beam(lerp3v(start, end, 0.15), lerp3v(start, end, 0.85), 0.03 * S, 0.06 * S, 0.03 * S, 0.05 * S, 4));
    }
  }

  const spinRate = { ducted: 28, rotor: 24, jet: 20, ring: 1, ion: 0 } as const;
  const tiltBy = { ducted: 28, rotor: 0, jet: 82, ring: 0, ion: 32 } as const;
  const vectoring = P.vectoring && P.kind !== "rotor";
  const spin = (n: number, axis: V3, revs: number, dirSign: number) =>
    motions.push((c) => {
      const k = c.clip === "cruise" ? 1.3 : c.clip === "land" ? 0.2 : c.clip === "attack" ? 1.15 : 1;
      c.turn(n, axis, dirSign * 2 * Math.PI * Math.round(revs * k) * c.u);
    });
  const flicker = (n: number, base = 1) =>
    motions.push((c) => {
      const k = c.clip === "cruise" ? 1.6 : c.clip === "land" ? 0.15 : 1;
      const f = 1 + 0.12 * c.wave(23) + 0.07 * c.wave(37, 0.3);
      c.grow(n, [1 + 0.05 * c.wave(29), base * k * f, 1 + 0.05 * c.wave(31)]);
    });
  const blade = (r0: number, r1: number, c0: number, c1: number, p0: number, p1: number, th: number): Geom => {
    const secs: Section[] = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const p = lerp(p0, p1, t) * DEG;
      const chord = lerp(c0, c1, t) * (k === 6 ? 0.55 : 1);
      secs.push({ o: [lerp(r0, r1, t), 0, 0], u: [0, -Math.sin(p), Math.cos(p)], v: [0, Math.cos(p), Math.sin(p)], w: chord / 2, up: th / 2, down: th / 2, n: 2.6 });
    }
    return sweep(secs, 10);
  };
  const rotorBlades = (at: number, b: number, g: Geom, slot: DroneSlot) => {
    for (let j = 0; j < b; j++) put(at, slot, g, { q: qAxis(Y, (2 * Math.PI * j) / b) });
  };

  for (const u of units) {
    const pod = node(`prop${u.index}`, body, u.pos);
    const sgn = u.index % 2 ? -1 : 1;
    if (vectoring) {
      const tilt = tiltBy[P.kind] * DEG;
      motions.push((c) => {
        const a = c.clip === "cruise" ? tilt : c.clip === "land" ? 0 : c.clip === "scan" ? tilt * 0.12 * c.wave(1) : 0.04 * tilt * c.wave(2, u.index * 0.1);
        c.turn(pod, X, a);
      });
    }
    if (P.kind === "ducted") {
      const h = R * rng.range(0.38, 0.52);
      put(pod, "primary", lathe(roundedRect(R * 1.02, R * 1.02 + ductT, -h / 2, h / 2, ductT * 0.45), 48, true));
      put(pod, "accent", lathe(roundedRect(R * 1.02 + ductT * 0.9, R * 1.02 + ductT * 1.12, -h * 0.12, h * 0.16, ductT * 0.1), 48, true));
      put(pod, "metal", superellipsoid(R * 0.16, h * 0.36, R * 0.16, 0.6, 1, 20, 10), { p: [0, -h * 0.08, 0] });
      const nStat = P.blades % 2 ? 4 : 3;
      for (let k = 0; k < nStat; k++) {
        const a = (2 * Math.PI * (k + 0.5)) / nStat;
        const d: V3 = [Math.cos(a), 0, Math.sin(a)];
        put(pod, "dark", beam(mul(d, R * 0.12), add(mul(d, R * 1.04), [0, 0, 0]), R * 0.035, h * 0.22, R * 0.03, h * 0.18, 4, Y, 8), { p: [0, -h * 0.28, 0] });
      }
      const rot = node(`prop${u.index}_fan`, pod, [0, h * 0.1, 0]);
      rotorBlades(rot, P.blades, blade(R * 0.13, R * 0.98, R * 0.34, R * 0.2, 30, 14, R * 0.025), "metal");
      put(rot, "accent", lathe([{ r: 0, y: -h * 0.06 }, { r: R * 0.14, y: -h * 0.06, sharp: true }, { r: R * 0.12, y: h * 0.06 }, { r: 0, y: h * 0.16 }], 20));
      put(pod, "blur", lathe(roundedRect(R * 0.16, R * 0.98, h * 0.1 - 0.0015, h * 0.1 + 0.0015, 0.0005), 40, true));
      put(pod, "glow", torus(R * 1.0, R * 0.018, 48, 6), { p: [0, -h * 0.42, 0] });
      spin(rot, Y, spinRate.ducted, sgn);
    } else if (P.kind === "rotor") {
      put(pod, "metal", cylinder(R * 0.1, R * 0.14, 20), { p: [0, R * 0.01, 0] });
      put(pod, "secondary", cylinder(R * 0.13, R * 0.05, 20), { p: [0, -R * 0.07, 0] });
      put(pod, "glow", torus(R * 0.105, R * 0.008, 24, 5), { p: [0, R * 0.04, 0] });
      const rot = node(`prop${u.index}_rotor`, pod, [0, R * 0.1, 0]);
      put(rot, "accent", cylinder(R * 0.06, R * 0.04, 16));
      rotorBlades(rot, P.blades, blade(R * 0.05, R, R * 0.14, R * 0.07, 16, 6, R * 0.014), "dark");
      put(pod, "blur", lathe(roundedRect(R * 0.08, R, R * 0.1 - 0.001, R * 0.1 + 0.001, 0.0004), 40, true));
      spin(rot, Y, spinRate.rotor, sgn);
      if (P.coaxial) {
        put(pod, "metal", cylinder(R * 0.08, R * 0.12, 16), { p: [0, -R * 0.14, 0] });
        const rot2 = node(`prop${u.index}_rotor2`, pod, [0, -R * 0.2, 0]);
        rotorBlades(rot2, P.blades, blade(R * 0.05, R * 0.95, R * 0.14, R * 0.07, -16, -6, R * 0.014), "dark");
        put(pod, "blur", lathe(roundedRect(R * 0.08, R * 0.95, -R * 0.2 - 0.001, -R * 0.2 + 0.001, 0.0004), 40, true));
        spin(rot2, Y, spinRate.rotor, -sgn);
      }
      if (P.guard) {
        put(pod, "secondary", torus(R * 1.07, R * 0.025, 56, 8), { p: [0, R * 0.1, 0] });
        for (let k = 0; k < 3; k++) {
          const a = (2 * Math.PI * k) / 3 + Math.atan2(u.dir[2], u.dir[0]) + Math.PI;
          const d: V3 = [Math.cos(a), 0, Math.sin(a)];
          put(pod, "secondary", beam(add(mul(d, R * 0.12), [0, -R * 0.06, 0]), add(mul(d, R * 1.05), [0, R * 0.08, 0]), R * 0.03, R * 0.02, R * 0.025, R * 0.018, 4));
        }
      }
    } else if (P.kind === "jet") {
      const l = R * 4.2;
      put(
        pod,
        "primary",
        lathe(
          [
            { r: R * 0.72, y: -l / 2 },
            { r: R * 0.95, y: -l * 0.25 },
            { r: R, y: l * 0.2 },
            { r: R * 0.9, y: l * 0.46 },
            { r: R * 0.78, y: l * 0.5, sharp: true },
            { r: R * 0.7, y: l * 0.44, sharp: true },
            { r: R * 0.66, y: -l * 0.3 },
            { r: R * 0.6, y: -l * 0.47, sharp: true },
          ],
          40,
          true,
        ),
      );
      put(pod, "accent", lathe(roundedRect(R * 0.97, R * 1.02, l * 0.05, l * 0.12, R * 0.01), 40, true));
      put(pod, "metal", lathe(roundedRect(R * 0.6, R * 0.76, -l * 0.52, -l * 0.36, R * 0.03), 40, true));
      put(pod, "glow", cylinder(R * 0.6, R * 0.02, 32), { p: [0, -l * 0.4, 0] });
      put(pod, "dark", cylinder(R * 0.28, R * 0.6, 20), { p: [-u.side * R * 0.9, 0, 0], q: qAxis(Z, Math.PI / 2) });
      const fan = node(`prop${u.index}_fan`, pod, [0, l * 0.36, 0]);
      put(fan, "metal", lathe([{ r: 0, y: -R * 0.1 }, { r: R * 0.2, y: -R * 0.1, sharp: true }, { r: 0, y: R * 0.25 }], 20));
      rotorBlades(fan, 14, blade(R * 0.12, R * 0.68, R * 0.16, R * 0.12, 40, 30, R * 0.02), "metal");
      spin(fan, Y, spinRate.jet, u.side);
      const pl = node(`prop${u.index}_plume`, pod, [0, -l * 0.5, 0]);
      put(pl, "exhaust", plume(R * 0.55, R * 2.4, 24, R * 0.12));
      flicker(pl);
      glow(pl, palette.glow, R * 2.2 * spec.size);
    } else if (P.kind === "ion") {
      const r = R;
      put(pod, "secondary", box(r * 2, r * 0.6, r * 2, r * 0.2, 2), { p: [0, -r * 0.1, 0] });
      put(
        pod,
        "metal",
        lathe(
          [
            { r: r * 0.85, y: -r * 1.1 },
            { r: r * 0.55, y: -r * 0.35 },
            { r: r * 0.5, y: -r * 0.2, sharp: true },
            { r: r * 0.42, y: -r * 0.3, sharp: true },
            { r: r * 0.7, y: -r * 1.05, sharp: true },
          ],
          28,
          true,
        ),
      );
      put(pod, "glow", cylinder(r * 0.45, r * 0.02, 24), { p: [0, -r * 0.4, 0] });
      const pl = node(`prop${u.index}_plume`, pod, [0, -r * 1.05, 0]);
      put(pl, "exhaust", plume(r * 0.72, r * 4.5, 20, r * 0.2));
      flicker(pl);
      glow(pl, palette.glow, r * 2.5 * spec.size);
    }
  }

  if (P.kind === "ring") {
    const radii = [1.42, 1.28, 1.16];
    for (let k = 0; k < P.count; k++) {
      const rr = S * radii[k];
      const t = S * 0.08;
      const rest: Q4 = k === 0 ? Q_ID : k === 1 ? qAxis(X, 62 * DEG) : qAxis(Z, 62 * DEG);
      const ring = node(`ring${k}`, body, [0, 0, 0], rest);
      put(ring, "primary", lathe(roundedRect(rr - t / 2, rr + t / 2, -t * 0.4, t * 0.4, t * 0.2), 72, true));
      put(ring, "glow", lathe(roundedRect(rr - t / 2 - 0.004, rr - t / 2 + 0.002, -t * 0.12, t * 0.12, 0.001), 72, true));
      for (let j = 0; j < 6; j++) {
        const a = (2 * Math.PI * j) / 6;
        put(ring, "secondary", box(t * 0.9, t * 1.1, t * 1.6, t * 0.15, 2), { p: [Math.cos(a) * (rr + t * 0.4), 0, Math.sin(a) * (rr + t * 0.4)], q: qAxis(Y, -a) });
        put(ring, "accent", box(t * 0.3, t * 1.15, t * 0.3, t * 0.05, 1), { p: [Math.cos(a) * (rr + t * 0.85), 0, Math.sin(a) * (rr + t * 0.85)], q: qAxis(Y, -a) });
      }
      const dir = k % 2 ? -1 : 1;
      motions.push((c) => {
        const f = c.clip === "land" ? 0 : c.clip === "cruise" ? 2 : 1;
        if (k === 0) c.turn(ring, Y, dir * 2 * Math.PI * f * c.u);
        else c.turnParent(ring, Y, dir * 2 * Math.PI * f * c.u);
        if (c.clip === "land") c.move(ring, [0, -hoverY * 0 - 0.0, 0]);
      });
    }
    // Field emitter under the body.
    const b = bottom(0, 0);
    put(body, "metal", lathe(roundedRect(S * 0.18, S * 0.3, -0.02 * S, 0.02 * S, 0.008 * S), 40, true), { p: b.p });
    const field = node("field", body, b.p);
    put(field, "beam", plume(S * 0.32, hoverY * 0.9, 32, S * 0.55));
    motions.push((c) => c.grow(field, c.clip === "land" ? 0.001 : 1 + 0.06 * c.wave(5)));
  }

  // RCS thrusters on four corners.
  if (spec.rcs) {
    for (const [sx, sz] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const h = toward([sx * 10, 0, sz * 10 * (L / W)], [0, 0, 0]);
      if (!h) continue;
      const q = qFrame(h.n, [0, 0, sz]);
      const n = node("rcs", body, h.p, q);
      put(n, "metal", box(0.05 * S, 0.035 * S, 0.06 * S, 0.008 * S, 1));
      for (const d of [-1, 1]) {
        put(n, "dark", cylinder(0.009 * S, 0.02 * S, 10), { p: [d * 0.028 * S, 0.006 * S, 0], q: qAxis(Z, (d * Math.PI) / 2) });
        put(n, "glow", cylinder(0.006 * S, 0.002 * S, 10), { p: [d * 0.038 * S, 0.006 * S, 0], q: qAxis(Z, (d * Math.PI) / 2) });
      }
    }
  }

  // ---------------------------------------------------------------- sensors
  const anchor = (m: Mount, z?: number) => {
    if (m === "nose") return flat ? bottom(0, L * 0.3) : front(0, H.kind === "orb" ? 0 : -HH * 0.05);
    if (m === "top") return top(0, z ?? topZ.sensor);
    if (m === "belly") return bottom(0, z ?? bellyZ.sensor);
    if (m === "rear") return rear(0, 0);
    return side(1, 0, z ?? 0);
  };
  const facing = (n: V3) => qFrame(Y, Z); // sensors stay level and look forward
  for (const s of spec.sensors) {
    const k = s.size;
    if (s.kind === "eye") {
      const a = anchor(s.mount);
      const e = (H.kind === "orb" ? 0.17 : 0.085) * k * S * (H.kind === "orb" ? 1 : 1.4);
      const at = add(a.p, mul(Z, -e * 0.35));
      const fwd = qAxis(X, Math.PI / 2);
      put(body, "secondary", lathe(roundedRect(e * 0.82, e * 1.12, -e * 0.16, e * 0.16, e * 0.07), 40, true), { p: add(at, [0, 0, e * 0.55]), q: fwd });
      const eye = node("eye", body, at);
      put(eye, "dark", superellipsoid(e * 0.86, e * 0.86, e * 0.86, 1, 1, 32, 16));
      put(eye, "glass", superellipsoid(e * 0.62, e * 0.62, e * 0.3, 1, 1, 32, 12, 0, 1), { p: [0, 0, e * 0.62], q: qAxis(X, Math.PI / 2) });
      put(eye, "glow", lathe(roundedRect(e * 0.2, e * 0.42, -0.002, 0.002, 0.001), 32, true), { p: [0, 0, e * 0.86], q: fwd });
      put(eye, "white", superellipsoid(e * 0.12, e * 0.12, e * 0.05, 1, 1, 16, 8), { p: [0, 0, e * 0.88] });
      glow(eye, palette.glow, e * 2.2 * spec.size);
      motions.push((c) => {
        const sweepA = c.clip === "scan" ? 35 * DEG * c.wave(1) : c.clip === "attack" ? 12 * DEG * c.wave(3) : 10 * DEG * c.wave(1, 0.25);
        c.turn(eye, Y, sweepA);
        c.turn(eye, X, (c.clip === "scan" ? 8 : 4) * DEG * c.wave(2));
      });
    } else if (s.kind === "turret") {
      const a = anchor(s.mount, s.mount === "belly" ? bellyZ.sensor : undefined);
      const r = 0.07 * k * S;
      const below = s.mount === "belly" || flat;
      const yaw = node("cam_yaw", body, add(a.p, [0, below ? -r * 0.3 : 0, below ? 0 : -r * 0.5]));
      put(yaw, "secondary", cylinder(r * 0.7, r * 0.5, 24), { p: [0, below ? r * 0.15 : 0, 0], q: below ? Q_ID : qAxis(X, Math.PI / 2) });
      const pitch = node("cam_pitch", yaw, [0, below ? -r * 0.9 : 0, below ? 0 : r * 0.8]);
      put(pitch, "primary", superellipsoid(r, r, r, 1, 1, 32, 16));
      put(pitch, "dark", cylinder(r * 0.42, r * 0.5, 24), { p: [0, 0, r * 0.85], q: qAxis(X, Math.PI / 2) });
      put(pitch, "glass", superellipsoid(r * 0.36, r * 0.36, r * 0.12, 1, 1, 24, 8, 0, 1), { p: [0, 0, r * 1.1], q: qAxis(X, Math.PI / 2) });
      put(pitch, "glow", torus(r * 0.38, r * 0.03, 24, 5), { p: [0, 0, r * 1.1], q: qAxis(X, Math.PI / 2) });
      put(pitch, "dark", box(r * 0.25, r * 0.25, r * 0.5, r * 0.05, 1), { p: [r * 0.7, r * 0.45, 0.2 * r] });
      glow(pitch, palette.glow, r * 0.9 * spec.size);
      motions.push((c) => {
        const scan = c.clip === "scan";
        c.turn(yaw, Y, (scan ? 70 : 20) * DEG * c.wave(1, scan ? 0 : 0.6));
        c.turn(pitch, X, ((scan ? 25 : 15) + (scan ? 10 : 4) * c.wave(2)) * DEG);
      });
    } else if (s.kind === "lidar") {
      const a = anchor("top", topZ.sensor);
      const r = 0.06 * k * S;
      put(body, "secondary", cylinder(r * 1.1, r * 0.4, 24, r * 0.85), { p: add(a.p, [0, r * 0.1, 0]) });
      const head = node("lidar", body, add(a.p, [0, r * 0.3, 0]));
      put(head, "dark", cylinder(r * 0.8, r * 0.9, 28), { p: [0, r * 0.45, 0] });
      put(head, "glass", box(r * 0.7, r * 0.45, r * 0.2, r * 0.05, 1), { p: [0, r * 0.45, r * 0.72] });
      put(head, "glow", cylinder(r * 0.82, r * 0.06, 28), { p: [0, r * 0.2, 0] });
      put(head, "metal", cylinder(r * 0.6, r * 0.1, 24), { p: [0, r * 0.95, 0] });
      spin(head, Y, 4, 1);
    } else if (s.kind === "bar") {
      const a = anchor(s.mount);
      const bw = Math.min(W * 0.5, 0.45 * S) * k;
      const q = flat ? qFrame([0, 0.25, 1], Y) : qFrame(norm(add(a.n, [0, 0.0, 0])), Y);
      const qb = qMul(q, qAxis(X, -Math.PI / 2));
      put(body, "glass", box(bw, 0.05 * S, 0.035 * S, 0.012 * S, 2), { p: a.p, q: qb });
      put(body, "glow", box(bw * 0.92, 0.008 * S, 0.012 * S, 0.003 * S, 1), { p: add(a.p, qRot(qb, [0, 0, 0.016 * S])), q: qb });
      const dot = node("scanner_dot", body, add(a.p, qRot(qb, [0, 0, 0.02 * S])), qb);
      put(dot, "white", box(0.035 * S, 0.014 * S, 0.008 * S, 0.003 * S, 1));
      glow(dot, palette.glow, 0.09 * S * spec.size);
      const axis = qRot(qb, X);
      motions.push((c) => {
        const sp = c.clip === "scan" ? 2 : c.clip === "attack" ? 4 : 1;
        c.move(dot, mul(axis, 0.42 * bw * c.wave(sp)));
      });
    } else if (s.kind === "dish") {
      const a = anchor("top", topZ.sensor);
      const r = 0.13 * k * S;
      const mh = r * 0.6;
      put(body, "metal", cylinder(r * 0.06, mh, 12), { p: add(a.p, [0, mh / 2, 0]) });
      put(body, "secondary", cylinder(r * 0.2, r * 0.08, 20), { p: add(a.p, [0, r * 0.03, 0]) });
      const dish = node("dish", body, add(a.p, [0, mh, 0]));
      const prof = [];
      for (let j = 0; j <= 8; j++) {
        const rr = (r * j) / 8;
        prof.push({ r: rr, y: (rr * rr) / (2.4 * r) });
      }
      const outer = prof.map((p) => ({ r: p.r, y: p.y - r * 0.04 }));
      const dishG = lathe([...outer, ...prof.slice().reverse()], 32, true);
      const tilt = qAxis(X, 55 * DEG);
      put(dish, "primary", dishG, { q: tilt });
      put(dish, "metal", beam([0, 0, 0], qRot(tilt, [0, r * 0.55, 0]), r * 0.03, r * 0.03, r * 0.02, r * 0.02, 2));
      put(dish, "glow", superellipsoid(r * 0.06, r * 0.06, r * 0.06, 1, 1, 12, 6), { p: qRot(tilt, [0, r * 0.58, 0]) });
      put(dish, "dark", cylinder(r * 0.1, r * 0.12, 16), { p: [0, -r * 0.02, 0] });
      motions.push((c) => c.turn(dish, Y, 2 * Math.PI * (c.clip === "scan" ? 2 : 1) * c.u));
    } else if (s.kind === "array") {
      const a = anchor(s.mount, s.mount === "belly" ? bellyZ.sensor : undefined);
      const r = 0.028 * k * S;
      const q = s.mount === "belly" ? qMul(qFrame([0, -1, 0], Z), Q_ID) : qMul(qFrame(a.n, Y), Q_ID);
      const look = s.mount === "belly" ? qAxis(X, Math.PI / 2 + 0.6) : qAxis(X, Math.PI / 2);
      const n = node("sensor_array", body, a.p, s.mount === "belly" ? qAxis(X, 0) : Q_ID);
      const cols = rng.pick([2, 3]), rows = rng.pick([1, 2]);
      put(n, "secondary", box(cols * r * 2.6, rows * r * 2.6, r * 1.6, r * 0.4, 2), { q: s.mount === "belly" ? qAxis(X, Math.PI / 2 + 0.6) : qFrame(Z, Y), p: [0, 0, 0] });
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const lx = (i - (cols - 1) / 2) * r * 2.5, ly = (j - (rows - 1) / 2) * r * 2.5;
          const off = s.mount === "belly" ? qRot(qAxis(X, 0.6), [lx, -r * 0.9, ly]) : [lx, ly, r * 0.9];
          const sz = i === Math.floor(cols / 2) && j === 0 ? 1.15 : 0.8;
          put(n, "dark", cylinder(r * sz, r * 0.8, 20), { p: off as V3, q: look });
          put(n, "glass", superellipsoid(r * sz * 0.8, r * 0.25, r * sz * 0.8, 1, 1, 16, 6, 0, 1), { p: add(off as V3, qRot(look, [0, r * 0.4, 0])), q: look });
        }
      }
      glow(n, palette.glow, r * 2 * spec.size);
    }
    void facing;
  }

  // ---------------------------------------------------------------- tools
  const clawsNodes: number[] = [];
  for (const t of spec.tools) {
    const k = t.size;
    if (t.kind === "claws") {
      for (const sg of [1, -1]) {
        const b = bottom(sg * W * 0.18, bellyZ.tool + L * 0.08);
        const a = 0.2 * k * S, fl = 0.18 * k * S, w = 0.03 * k * S;
        const sh = node("claw_shoulder", body, add(b.p, [0, w * 0.5, 0]));
        put(body, "metal", cylinder(w * 1.2, w * 2.4, 16), { p: add(b.p, [0, w * 0.5, 0]), q: qAxis(Z, Math.PI / 2) });
        put(sh, "secondary", beam([0, 0, 0], [0, -a, 0], w * 1.4, w * 1.2, w * 1.1, w, 4, Z));
        put(sh, "hazard", beam([0, -a * 0.25, 0], [0, -a * 0.45, 0], w * 1.45, w * 1.25, w * 1.4, w * 1.2, 4, Z));
        const el = node("claw_elbow", sh, [0, -a, 0]);
        put(el, "metal", cylinder(w, w * 1.6, 16), { q: qAxis(Z, Math.PI / 2) });
        put(el, "primary", beam([0, 0, 0], [0, -fl, 0], w * 1.1, w, w * 0.9, w * 0.8, 4, Z));
        const wr = node("claw_wrist", el, [0, -fl, 0]);
        put(wr, "dark", box(w * 2.2, w * 0.8, w * 1.4, w * 0.2, 1));
        for (const fs of [1, -1]) {
          const f = node("claw_finger", wr, [fs * w * 0.8, -w * 0.3, 0]);
          put(f, "metal", beam([0, 0, 0], [fs * w * 0.5, -w * 1.6, 0], w * 0.5, w * 0.6, w * 0.35, w * 0.5, 4, Z));
          put(f, "metal", beam([fs * w * 0.5, -w * 1.6, 0], [-fs * w * 0.1, -w * 2.6, 0], w * 0.35, w * 0.5, w * 0.2, w * 0.35, 4, Z));
          motions.push((c) => {
            const open = c.clip === "work" ? 0.5 + 0.5 * Math.cos(2 * Math.PI * 2 * c.u) : 0.2;
            c.turn(f, Z, fs * open * 28 * DEG);
          });
        }
        motions.push((c) => {
          if (c.clip === "work") {
            c.turn(sh, X, (-15 + 25 * Math.cos(2 * Math.PI * c.u)) * DEG);
            c.turn(el, X, (-35 + 15 * Math.sin(2 * Math.PI * 2 * c.u)) * DEG);
            c.turn(wr, X, (20 + 10 * c.wave(2)) * DEG);
          } else {
            c.turn(sh, X, (72 + 2 * c.wave(1, sg * 0.2)) * DEG);
            c.turn(el, X, -150 * DEG);
            c.turn(wr, X, 70 * DEG);
          }
        });
        clawsNodes.push(sh);
      }
    } else if (t.kind === "spotlight") {
      const a = anchor(t.mount, t.mount === "belly" ? bellyZ.tool + L * 0.12 : undefined);
      const r = 0.045 * k * S;
      const below = t.mount === "belly" || flat;
      const yaw = node("spot_yaw", body, add(a.p, below ? [0, -r * 0.4, 0] : [0, 0, -r * 0.3]));
      put(yaw, "dark", box(r * 1.2, r * 0.8, r * 1.2, r * 0.2, 1), { p: [0, below ? r * 0.3 : 0, 0] });
      const pitch = node("spot_pitch", yaw, [0, below ? -r * 0.4 : 0, below ? 0 : r * 0.6]);
      put(pitch, "secondary", cylinder(r, r * 1.6, 24, r * 1.15), { q: qAxis(X, Math.PI / 2) });
      put(pitch, "metal", torus(r * 1.12, r * 0.08, 24, 5), { p: [0, 0, r * 0.8], q: qAxis(X, Math.PI / 2) });
      put(pitch, "white", cylinder(r * 1.0, r * 0.02, 24), { p: [0, 0, r * 0.81], q: qAxis(X, Math.PI / 2) });
      const beamN = node("spot_beam", pitch, [0, 0, r * 0.82], qAxis(X, -Math.PI / 2));
      put(beamN, "beam", plume(r, 1.4, 24, r * 6));
      glow(pitch, [1, 0.97, 0.9], r * 3 * spec.size);
      motions.push((c) => {
        const scan = c.clip === "scan";
        c.turn(yaw, Y, (scan ? 50 * c.wave(1) : 6 * c.wave(1)) * DEG);
        c.turn(pitch, X, (below ? 32 : 12) * DEG + (scan ? 10 * DEG * c.wave(2) : 0));
        c.grow(beamN, c.clip === "land" || c.clip === "cruise" ? 0.001 : 1);
      });
    } else if (t.kind === "cargo") {
      const b = bottom(0, bellyZ.tool);
      const cw = Math.min(W * 0.55, 0.5 * S) * k, ch = Math.max(HH * 0.45, 0.14 * S) * k, cl = Math.min(L * 0.55, 0.55 * S) * k;
      put(body, "metal", box(cw * 0.7, 0.03 * S, cl * 0.6, 0.008 * S, 1), { p: add(b.p, [0, -0.01 * S, 0]) });
      const winch = node("winch", body, add(b.p, [0, -0.02 * S, 0]));
      for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) put(winch, "dark", cylinder(0.004 * S, 1, 6), { p: [x * cw * 0.3, -0.5, z * cl * 0.3] });
      const crate = node("cargo", body, add(b.p, [0, -0.03 * S - ch / 2, 0]));
      put(crate, "secondary", box(cw, ch, cl, 0.02 * S, 2));
      put(crate, "hazard", box(cw * 1.01, ch * 0.18, cl * 1.01, 0.004 * S, 1), { p: [0, ch * 0.25, 0] });
      put(crate, "accent", box(cw * 0.3, ch * 0.3, 0.004 * S, 0.002 * S, 1), { p: [0, -ch * 0.1, cl / 2 + 0.002 * S] });
      for (const sx of [1, -1]) put(crate, "metal", box(0.025 * S, ch * 1.06, cl * 0.85, 0.006 * S, 1), { p: [sx * cw * 0.5, 0, 0] });
      put(crate, "glow", box(0.02 * S, 0.02 * S, 0.004 * S, 0.004 * S, 1), { p: [cw * 0.35, ch * 0.3, cl / 2 + 0.003 * S] });
      const ropeY = 0.03 * S;
      motions.push((c) => {
        const drop = c.clip === "work" ? 0.18 * S * (0.5 - 0.5 * Math.cos(2 * Math.PI * c.u)) : 0;
        const sway = c.clip === "cruise" ? -4 * DEG : 1.5 * DEG * c.wave(1);
        c.move(crate, [0, -drop, 0]);
        c.turn(crate, X, sway);
        c.grow(winch, [1, Math.max(0.001, ropeY + drop), 1]);
      });
    } else if (t.kind === "scanner") {
      const b = bottom(0, bellyZ.tool);
      const r = 0.1 * k * S;
      put(body, "dark", cylinder(r * 0.9, r * 0.2, 32), { p: add(b.p, [0, -r * 0.05, 0]) });
      const ring = node("scanner_ring", body, add(b.p, [0, -r * 0.22, 0]));
      put(ring, "metal", torus(r, r * 0.12, 40, 8));
      for (let j = 0; j < 4; j++) put(ring, "glow", box(r * 0.12, r * 0.08, r * 0.3, r * 0.03, 1), { p: [Math.cos((j * Math.PI) / 2) * r, -r * 0.1, Math.sin((j * Math.PI) / 2) * r], q: qAxis(Y, (-j * Math.PI) / 2) });
      spin(ring, Y, 2, 1);
      const sb = node("scanner_beam", body, add(b.p, [0, -r * 0.3, 0]));
      put(sb, "beam", plume(r * 0.8, hoverY * 0.92, 32, r * 2.4));
      motions.push((c) => c.grow(sb, c.clip === "scan" || c.clip === "work" ? [1, 0.6 + 0.4 * Math.abs(c.wave(2)), 1] : 0.001));
    } else if (t.kind === "probe") {
      const a = anchor("nose");
      const r = 0.012 * k * S;
      put(body, "dark", cylinder(r * 2, r * 4, 16), { p: a.p, q: qAxis(X, Math.PI / 2) });
      const p = node("probe", body, a.p);
      put(p, "metal", cylinder(r, 0.22 * k * S, 12), { p: [0, 0, 0.09 * k * S], q: qAxis(X, Math.PI / 2) });
      put(p, "metal", cylinder(r * 0.6, 0.18 * k * S, 10), { p: [0, 0, 0.26 * k * S], q: qAxis(X, Math.PI / 2) });
      put(p, "glow", superellipsoid(r * 1.4, r * 1.4, r * 1.4, 1, 1, 12, 6), { p: [0, 0, 0.35 * k * S] });
      glow(p, palette.glow, r * 4 * spec.size);
      motions.push((c) => c.move(p, [0, 0, c.clip === "scan" ? 0.08 * S * (0.5 + 0.5 * c.wave(1)) : c.clip === "land" ? -0.05 * S : 0]));
    }
  }

  // ---------------------------------------------------------------- weapons (optional)
  for (const wpn of spec.weapons) {
    const k = wpn.size;
    const mounts: { p: V3; n: V3; below: boolean }[] = [];
    if (wpn.mount === "sides") {
      for (const sg of [1, -1]) {
        const s = side(sg, -HH * 0.1, L * 0.05);
        mounts.push({ p: s.p, n: s.n, below: false });
      }
    } else if (wpn.mount === "top") {
      const a = top(0, topZ.weapon);
      mounts.push({ p: a.p, n: a.n, below: false });
    } else {
      const a = bottom(0, bellyZ.weapon);
      mounts.push({ p: a.p, n: a.n, below: true });
    }
    for (const m of mounts) {
      const r = 0.05 * k * S;
      const sideMount = wpn.mount === "sides";
      const out = sideMount ? Math.sign(m.p[0]) : 0;
      const base = sideMount ? add(m.p, [out * r * 0.9, 0, 0]) : add(m.p, [0, m.below ? -r * 0.35 : r * 0.35, 0]);
      if (sideMount) put(body, "dark", box(r * 1.2, r * 0.6, r * 1.6, r * 0.15, 1), { p: add(m.p, [out * r * 0.4, 0, 0]) });
      const yaw = node(`${wpn.kind}_yaw`, body, base);
      const pitch = node(`${wpn.kind}_pitch`, yaw, [0, 0, 0]);
      if (!sideMount) put(yaw, "secondary", superellipsoid(r * 1.2, r * 0.5, r * 1.2, 0.6, 1, 28, 10, m.below ? -1 : 0, m.below ? 0 : 1), { p: [0, m.below ? r * 0.3 : -r * 0.3, 0] });
      const flash = (at: V3, len: number) => {
        const f = node(`${wpn.kind}_flash`, pitch, at, qAxis(X, -Math.PI / 2));
        put(f, "exhaust", plume(r * 0.35, len, 12, r * 0.05));
        steps.add(f);
        motions.push((c) => c.grow(f, c.clip === "attack" && Math.floor(c.u * 24) % 3 === 0 ? 1 : 0.001));
      };
      if (wpn.kind === "cannons" || wpn.kind === "gatling") {
        put(pitch, "primary", box(r * 1.5, r * 0.8, r * 1.8, r * 0.2, 2), { p: [0, 0, r * 0.2] });
        if (wpn.kind === "cannons") {
          for (const bx of [1, -1]) {
            const barrel = node("barrel", pitch, [bx * r * 0.42, 0, 0]);
            put(barrel, "metal", cylinder(r * 0.13, r * 2.4, 14), { p: [0, 0, r * 1.6], q: qAxis(X, Math.PI / 2) });
            put(barrel, "dark", box(r * 0.36, r * 0.36, r * 0.4, r * 0.05, 1), { p: [0, 0, r * 2.8] });
            flash([bx * r * 0.42, 0, r * 3.05], r * 1.6);
            motions.push((c) => {
              if (c.clip !== "attack") return;
              const ph = (c.u * 24 + (bx > 0 ? 0 : 1.5)) % 3;
              c.move(barrel, [0, 0, -r * 0.35 * Math.max(0, 1 - ph)]);
            });
          }
        } else {
          const barrels = node("barrels", pitch, [0, 0, r * 1.1]);
          for (let j = 0; j < 6; j++) {
            const a = (2 * Math.PI * j) / 6;
            put(barrels, "metal", cylinder(r * 0.07, r * 2.2, 10), { p: [Math.cos(a) * r * 0.22, Math.sin(a) * r * 0.22, r * 1.1], q: qAxis(X, Math.PI / 2) });
          }
          put(barrels, "dark", cylinder(r * 0.34, r * 0.15, 16), { p: [0, 0, r * 1.8], q: qAxis(X, Math.PI / 2) });
          put(barrels, "dark", cylinder(r * 0.34, r * 0.15, 16), { p: [0, 0, r * 0.5], q: qAxis(X, Math.PI / 2) });
          flash([0, 0, r * 3.3], r * 1.4);
          motions.push((c) => c.turn(barrels, Z, c.clip === "attack" ? 2 * Math.PI * 36 * c.u : 0));
        }
      } else if (wpn.kind === "laser") {
        put(pitch, "primary", box(r * 1.1, r * 0.9, r * 1.6, r * 0.3, 2), { p: [0, 0, r * 0.1] });
        put(pitch, "metal", cylinder(r * 0.2, r * 2.4, 16, r * 0.14), { p: [0, 0, r * 1.8], q: qAxis(X, Math.PI / 2) });
        const coils = node("laser_coils", pitch, [0, 0, 0]);
        for (let j = 0; j < 3; j++) put(coils, "glow", torus(r * 0.24, r * 0.05, 16, 5), { p: [0, 0, r * (1.2 + j * 0.5)], q: qAxis(X, Math.PI / 2) });
        put(pitch, "glass", superellipsoid(r * 0.14, r * 0.14, r * 0.1, 1, 1, 12, 6), { p: [0, 0, r * 3.0] });
        motions.push((c) => c.grow(coils, c.clip === "attack" ? 1 + 0.25 * Math.max(0, c.wave(4)) : 1));
        const bm = node("laser_beam", pitch, [0, 0, r * 3.05], qAxis(X, -Math.PI / 2));
        put(bm, "exhaust", plume(r * 0.06, 2.5, 8, r * 0.06));
        steps.add(bm);
        motions.push((c) => c.grow(bm, c.clip === "attack" && Math.floor(c.u * 8) % 2 === 1 ? 1 : 0.001));
        glow(pitch, palette.glow, r * 1.2 * spec.size);
      } else {
        // Missile pod: a box with a grid of missile tips.
        const cols = 2, rows = rng.pick([2, 3]);
        put(pitch, "secondary", box(r * 1.1 * cols, r * 1.1 * rows, r * 3, r * 0.15, 2), { p: [0, 0, r * 0.6] });
        put(pitch, "hazard", box(r * 1.12 * cols, r * 1.12 * rows, r * 0.4, r * 0.05, 1), { p: [0, 0, -r * 0.7] });
        for (let i = 0; i < cols; i++)
          for (let j = 0; j < rows; j++) {
            const off: V3 = [(i - (cols - 1) / 2) * r * 1.05, (j - (rows - 1) / 2) * r * 1.05, r * 2.1];
            put(pitch, "dark", cylinder(r * 0.4, r * 0.06, 16), { p: off, q: qAxis(X, Math.PI / 2) });
            put(pitch, "accent", lathe([{ r: 0, y: -r * 0.2 }, { r: r * 0.3, y: -r * 0.2, sharp: true }, { r: r * 0.28, y: r * 0.05 }, { r: 0, y: r * 0.35 }], 14), { p: off, q: qAxis(X, Math.PI / 2) });
          }
        flash([0, -r * 0.5, -r * 0.9], r * 0.8);
      }
      motions.push((c) => {
        if (c.clip === "attack") {
          c.turn(yaw, Y, (sideMount ? 6 : 30) * DEG * c.wave(1));
          c.turn(pitch, X, (m.below ? 10 : -4) * DEG + 5 * DEG * c.wave(2));
        } else if (c.clip === "scan" && !sideMount) c.turn(yaw, Y, 25 * DEG * c.wave(1, 0.5));
      });
    }
  }

  // ---------------------------------------------------------------- antennae
  const ra = rng.fork("antennae");
  spec.antennae.forEach((a, ai) => {
    for (let j = 0; j < a.count; j++) {
      const x = a.count === 2 ? (j ? -1 : 1) * W * 0.18 : ai % 2 ? W * 0.12 : 0;
      const z = topZ.antenna - ai * L * 0.06;
      const t = top(x, z);
      const len = 0.28 * a.size * S;
      const n = node("antenna", body, t.p, qFrame(t.n, Z));
      if (a.kind === "whip") {
        put(n, "dark", cylinder(0.012 * S, 0.02 * S, 12), { p: [0, 0.01 * S, 0] });
        put(n, "metal", beam([0, 0, 0], [0, len, -len * 0.25], 0.008 * S, 0.008 * S, 0.003 * S, 0.003 * S, 2, Z, 8));
        put(n, "navRed", superellipsoid(0.01 * S, 0.01 * S, 0.01 * S, 1, 1, 10, 6), { p: [0, len, -len * 0.25] });
        const tip = node("antenna_tip", n, [0, len, -len * 0.25]);
        glow(tip, NAV_RED, 0.05 * S * spec.size);
        steps.add(tip);
        motions.push((c) => c.grow(tip, Math.floor(c.u * 8 + ai) % 4 === 0 ? 1 : 0.001));
      } else if (a.kind === "blade") {
        put(n, "secondary", plate([[0, 0.05 * S], [0, -0.06 * S], [len * 0.6, -0.12 * S], [len * 0.6, -0.07 * S]], 0.008 * S, 0.2), { q: qAxis(Z, Math.PI / 2) });
      } else {
        put(n, "metal", cylinder(0.008 * S, len, 10), { p: [0, len / 2, 0] });
        for (let r = 0; r < 3; r++) put(n, r === 2 ? "accent" : "dark", torus(0.02 * S * (1 - r * 0.2), 0.004 * S, 20, 5), { p: [0, len * (0.45 + r * 0.2), 0] });
        put(n, "white", superellipsoid(0.008 * S, 0.008 * S, 0.008 * S, 1, 1, 8, 6), { p: [0, len, 0] });
      }
      const ph = ra.next();
      motions.push((c) => {
        const k = c.clip === "cruise" ? -8 : 0;
        c.turn(n, X, (k + 2 * c.wave(2, ph)) * DEG);
        c.turn(n, Z, 1.5 * DEG * c.wave(3, ph));
      });
    }
  });

  // ---------------------------------------------------------------- fins
  const F = spec.fins;
  const wingTips: V3[] = [];
  if (F.wings) {
    for (const sg of [1, -1]) {
      const s = side(sg, 0, -L * 0.1);
      const span = 0.45 * F.span * S;
      const root0 = s.p[0] - sg * 0.04 * S;
      const pts: [number, number][] = [
        [root0, L * 0.12],
        [root0 + sg * span, -L * 0.18],
        [root0 + sg * span, -L * 0.3],
        [root0, -L * 0.36],
      ];
      put(body, "primary", plate(pts, 0.03 * S, 0.2), { p: [0, s.p[1] - 0.01 * S, 0], q: qAxis(Z, sg * 6 * DEG) });
      put(body, "accent", plate([[root0 + sg * span * 0.82, -L * 0.14], [root0 + sg * span, -L * 0.18], [root0 + sg * span, -L * 0.3], [root0 + sg * span * 0.82, -L * 0.3]], 0.032 * S), { p: [0, s.p[1] - 0.01 * S, 0], q: qAxis(Z, sg * 6 * DEG) });
      wingTips.push(qRot(qAxis(Z, sg * 6 * DEG), [root0 + sg * span, s.p[1] - 0.01 * S, -L * 0.24]));
    }
  }
  if (F.canards) {
    for (const sg of [1, -1]) {
      const s = side(sg, 0, L * 0.25);
      const span = 0.16 * F.span * S;
      put(body, "secondary", plate([[s.p[0] - sg * 0.02, L * 0.32], [s.p[0] + sg * span, L * 0.22], [s.p[0] + sg * span, L * 0.17], [s.p[0] - sg * 0.02, L * 0.18]], 0.02 * S, 0.2), { p: [0, s.p[1], 0] });
    }
  }
  if (F.tail > 0) {
    const fins = F.tail === 1 ? [0] : [1, -1];
    for (const sg of fins) {
      const t = top(sg * W * 0.2, -L * 0.36);
      const hgt = 0.22 * F.span * S;
      const outline: [number, number][] = [
        [0, L * 0.12],
        [hgt, -L * 0.02],
        [hgt, -L * 0.1],
        [0, -L * 0.12],
      ];
      const q = qMul(qAxis(Z, -sg * 18 * DEG), qAxis(Z, Math.PI / 2));
      put(body, "primary", plate(outline, 0.022 * S, 0.2), { p: sub(t.p, [0, 0.01 * S, 0]), q });
      put(body, "accent", plate([[hgt * 0.8, -L * 0.005], [hgt, -L * 0.02], [hgt, -L * 0.1], [hgt * 0.8, -L * 0.1]], 0.024 * S), { p: sub(t.p, [0, 0.01 * S, 0]), q });
    }
  }

  // ---------------------------------------------------------------- landing gear
  const gearNodes: number[] = [];
  let gearMin = Infinity;
  if (spec.gear === "skids") {
    const gx = Math.max(W * 0.32, 0.2 * S);
    const drop = Math.max(0.16 * S, HH * 0.4);
    for (const sg of [1, -1]) {
      const by = bottom(sg * gx * 0.6, 0).p[1];
      const y = by - drop;
      const secs: Section[] = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        const z = lerp(-L * 0.38, L * 0.42, t);
        const lift = t > 0.85 ? Math.pow((t - 0.85) / 0.15, 2) * 0.05 * S : 0;
        secs.push({ o: [sg * gx, y + lift, z], u: X, v: Y, w: 0.014 * S, up: 0.014 * S, down: 0.014 * S, n: 2 });
      }
      put(body, "dark", sweep(secs, 12));
      for (const z of [-L * 0.22, L * 0.22]) {
        const b = bottom(sg * gx * 0.5, z);
        put(body, "metal", beam(add(b.p, [0, 0.01, 0]), [sg * gx, y, z], 0.02 * S, 0.03 * S, 0.016 * S, 0.024 * S, 4, Z));
      }
      gearMin = Math.min(gearMin, y - 0.014 * S);
    }
  } else if (spec.gear === "legs") {
    const n = H.kind === "disc" ? 3 : 4;
    for (let i = 0; i < n; i++) {
      const a = n === 3 ? Math.PI + (2 * Math.PI * i) / 3 : Math.PI / 4 + (Math.PI / 2) * i;
      const lx = Math.sin(a) * W * 0.3, lz = Math.cos(a) * L * 0.3;
      const b = bottom(lx, lz);
      const out = norm([Math.sin(a), 0, Math.cos(a)]);
      const axis = norm(cross(Y, out)); // fold outwards around this
      const hip = node("leg", body, add(b.p, [0, 0.01 * S, 0]));
      const ll = Math.max(0.24 * S, HH * 0.6);
      put(body, "dark", superellipsoid(0.035 * S, 0.03 * S, 0.035 * S, 0.6, 1, 16, 8), { p: add(b.p, [0, 0.01 * S, 0]) });
      put(hip, "secondary", beam([0, 0, 0], [0, -ll * 0.55, 0], 0.04 * S, 0.035 * S, 0.032 * S, 0.03 * S, 4, out));
      put(hip, "metal", beam([0, -ll * 0.5, 0], [0, -ll * 0.95, 0], 0.02 * S, 0.02 * S, 0.018 * S, 0.018 * S, 2, out));
      put(hip, "hazard", beam([0, -ll * 0.42, 0], [0, -ll * 0.5, 0], 0.042 * S, 0.037 * S, 0.042 * S, 0.037 * S, 4, out));
      put(hip, "dark", cylinder(0.045 * S, 0.02 * S, 20, 0.035 * S), { p: [0, -ll, 0] });
      gearNodes.push(hip);
      motions.push((c) => {
        const folded = c.clip === "land" ? 12 : c.clip === "work" ? 35 : 82;
        c.turn(hip, axis, folded * DEG);
      });
      gearMin = Math.min(gearMin, -ll - 0.01 * S);
    }
  }

  // ---------------------------------------------------------------- lights
  if (spec.lights.nav) {
    const tips = wingTips.length
      ? wingTips
      : units.length && P.layout !== "under"
        ? [1, -1].map((sg) => units.filter((u) => Math.sign(u.pos[0]) === sg).sort((a, b) => sg * (b.pos[0] - a.pos[0]))[0]).filter(Boolean).map((u) => add(u.pos, [Math.sign(u.pos[0]) * (P.kind === "ducted" ? R * 1.02 + ductT : P.kind === "jet" ? R : R * 0.15), P.kind === "rotor" ? -0.05 * S : 0, 0]))
        : [side(1, 0, 0).p, side(-1, 0, 0).p];
    tips.forEach((p, k) => {
      const left = p[0] > 0;
      const slot: DroneSlot = left ? "navRed" : "navGreen";
      put(body, "dark", box(0.03 * S, 0.02 * S, 0.04 * S, 0.006 * S, 1), { p });
      put(body, slot, superellipsoid(0.012 * S, 0.012 * S, 0.016 * S, 1, 1, 12, 6), { p: add(p, [0, 0.012 * S, 0]) });
      const n = node(left ? "nav_left" : "nav_right", body, add(p, [0, 0.014 * S, 0]));
      glow(n, left ? NAV_RED : NAV_GREEN, 0.08 * S * spec.size);
      void k;
    });
    const r = rear(0, 0);
    put(body, "white", superellipsoid(0.01 * S, 0.01 * S, 0.01 * S, 1, 1, 10, 6), { p: r.p });
    glow(node("nav_tail", body, r.p), WHITE, 0.06 * S * spec.size);
  }
  if (spec.lights.strobe) {
    for (const [p, ph] of [
      [add(top(0, -L * 0.02).p, [0, 0.008 * S, 0]), 0],
      [add(bottom(0, -L * 0.12).p, [0, -0.008 * S, 0]), 0.5],
    ] as [V3, number][]) {
      put(body, "dark", cylinder(0.014 * S, 0.008 * S, 12), { p });
      const n = node("strobe", body, p);
      put(n, "white", superellipsoid(0.01 * S, 0.008 * S, 0.01 * S, 1, 1, 10, 6));
      glow(n, WHITE, 0.14 * S * spec.size);
      steps.add(n);
      motions.push((c) => {
        const f = (c.u * 4 + ph) % 1;
        c.grow(n, f < 0.06 ? 1 : 0.001);
      });
    }
  }
  if (spec.lights.underglow) {
    const b = bottom(0, 0);
    put(body, "glow", lathe(roundedRect(S * 0.12, S * 0.2, -0.004 * S, 0.004 * S, 0.002 * S), 40, true), { p: add(b.p, [0, -0.003 * S, 0]) });
    glow(node("underglow", body, add(b.p, [0, -0.01 * S, 0])), palette.glow, 0.5 * S * spec.size);
  }

  // ---------------------------------------------------------------- body motion and clips
  const hasWork = spec.tools.some((t) => t.kind === "claws" || t.kind === "cargo");
  const clipNames: DroneClipName[] = ["hover", "cruise", "scan", "land", ...(hasWork ? (["work"] as const) : []), ...(spec.weapons.length ? (["attack"] as const) : [])];
  let landY = 0;
  const forwardPitch = vectoring || P.kind === "ring" ? 3 : P.kind === "ion" ? 6 : 12;
  motions.unshift((c) => {
    if (c.clip === "land") {
      c.move(body, [0, landY - hoverY, 0]);
      c.turn(body, X, 0.2 * DEG * c.wave(9));
      return;
    }
    const amp = 0.025 * S;
    const bob = c.clip === "cruise" ? 0.4 : 1;
    c.move(body, [0.006 * S * c.wave(1, 0.3), amp * bob * c.wave(2) + (c.clip === "work" ? -0.25 * hoverY : 0), 0]);
    if (c.clip === "cruise") {
      c.turn(body, X, forwardPitch * DEG + 1 * DEG * c.wave(2));
      c.turn(body, Z, 7 * DEG * c.wave(1));
    } else {
      c.turn(body, Y, (c.clip === "scan" ? 15 : 3) * DEG * c.wave(1, 0.1));
      c.turn(body, X, 1.5 * DEG * c.wave(1, 0.4));
      c.turn(body, Z, 2 * DEG * c.wave(1, 0.15) + (c.clip === "attack" ? 1.5 * DEG * c.wave(6) : 0));
    }
  });

  // Meshes in node space (units).
  const meshes = [...parts.entries()].map(([key, g]) => {
    const [n, slot] = key.split("|");
    return { node: Number(n), slot: slot as DroneSlot, g };
  });
  const rig = { nodes, motions, hoverY };
  // Landed height: lowest gear point (or lowest solid point) in the land pose.
  {
    const pose = evaluate(rig, "land", 0, 0);
    let min = Infinity;
    for (const m of meshes) {
      if (EFFECT_SLOTS.includes(m.slot)) continue;
      if (spec.gear !== "none" && gearMin < Infinity && !isUnder(nodes, m.node, gearNodes) && !(m.node === body && m.slot === "dark")) continue;
      for (let k = 0; k < m.g.p.length; k += 3) {
        const w = toWorld(nodes, pose, m.node, [m.g.p[k], m.g.p[k + 1], m.g.p[k + 2]]);
        min = Math.min(min, w[1]);
      }
    }
    // `min` is relative to body y = 0 (landY starts at 0).
    landY = -min + 0.002;
    if (!Number.isFinite(landY)) landY = HH / 2;
  }
  const clips = bakeAll(rig, clipNames, steps);
  // The bind pose is the first hover frame (legs and arms folded), so the model looks right without a clip.
  const restPose = evaluate(rig, "hover", 0, 0);
  nodes.forEach((n, i) => {
    n.position = restPose.p[i];
    n.quaternion = restPose.q[i];
    n.scale = restPose.s[i];
  });

  // Scale to meters.
  const s = spec.size;
  const outNodes = nodes.map((n) => ({ ...n, position: mul(n.position, s) as V3 }));
  for (const c of clips) for (const t of c.tracks) if (t.path === "position") for (let k = 0; k < t.values.length; k++) t.values[k] *= s;
  const outMeshes: DroneMesh[] = meshes.map(({ node: n, slot, g }) => ({
    node: n,
    slot,
    positions: Float32Array.from(g.p, (v) => v * s),
    normals: Float32Array.from(g.n),
    indices: Uint32Array.from(g.i),
    ...(g.f ? { fade: Float32Array.from(g.f) } : {}),
  }));
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    if (EFFECT_SLOTS.includes(m.slot)) continue;
    for (let k = 0; k < m.g.p.length; k += 3) {
      const w = toWorld(nodes, restPose, m.node, [m.g.p[k], m.g.p[k + 1], m.g.p[k + 2]]);
      for (let d = 0; d < 3; d++) {
        min[d] = Math.min(min[d], w[d] * s);
        max[d] = Math.max(max[d], w[d] * s);
      }
    }
  }
  return {
    spec,
    nodes: outNodes,
    meshes: outMeshes,
    clips,
    glows,
    bounds: { min, max },
    hoverHeight: hoverY * s,
    landedHeight: landY * s,
    triangles: meshes.reduce((n, m) => n + tris(m.g), 0),
  };
}

const lerp3v = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function bboxOf(g: Geom): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < g.p.length; k += 3)
    for (let d = 0; d < 3; d++) {
      min[d] = Math.min(min[d], g.p[k + d]);
      max[d] = Math.max(max[d], g.p[k + d]);
    }
  return { min, max };
}

function isUnder(nodes: DroneNode[], n: number, roots: number[]): boolean {
  for (let k = n; k >= 0; k = nodes[k].parent) if (roots.includes(k)) return true;
  return false;
}

interface Rig {
  nodes: DroneNode[];
  motions: Motion[];
  hoverY: number;
}
interface Pose {
  p: V3[];
  q: Q4[];
  s: V3[];
}

/** Pose of every node at time t of a clip. `rest` skips the motions (bind pose). */
function evaluate(rig: Rig, clip: DroneClipName, t: number, _unused: number, rest = false): Pose {
  const pose: Pose = { p: rig.nodes.map((n) => [...n.position]), q: rig.nodes.map((n) => [...n.quaternion]), s: rig.nodes.map((n) => [...n.scale]) };
  if (rest) return pose;
  const u = t / DURATION;
  const ctx: PoseCtx = {
    clip,
    t,
    u,
    wave: (n, phase = 0) => Math.sin(2 * Math.PI * (n * u + phase)),
    turn: (n, axis, a) => (pose.q[n] = qMul(pose.q[n], qAxis(axis, a))),
    turnParent: (n, axis, a) => (pose.q[n] = qMul(qAxis(axis, a), pose.q[n])),
    move: (n, d) => (pose.p[n] = add(pose.p[n], d)),
    grow: (n, s) => {
      const v: V3 = typeof s === "number" ? [s, s, s] : s;
      pose.s[n] = [pose.s[n][0] * v[0], pose.s[n][1] * v[1], pose.s[n][2] * v[2]];
    },
  };
  for (const m of rig.motions) m(ctx);
  return pose;
}

function toWorld(nodes: DroneNode[], pose: Pose, n: number, v: V3): V3 {
  let p = v;
  for (let k = n; k >= 0; k = nodes[k].parent) {
    const s = pose.s[k];
    p = add(qRot(pose.q[k], [p[0] * s[0], p[1] * s[1], p[2] * s[2]]), pose.p[k]);
  }
  return p;
}

function sample(rig: Rig, name: DroneClipName): Pose[] {
  const frames = Math.round(DURATION * FPS);
  const poses: Pose[] = [];
  for (let f = 0; f <= frames; f++) poses.push(evaluate(rig, name, (f / frames) * DURATION, 0));
  return poses;
}

type Path = "position" | "quaternion" | "scale";
const field = (p: Pose, path: Path, i: number): number[] => (path === "position" ? p.p[i] : path === "quaternion" ? p.q[i] : p.s[i]);

/**
 * Bakes every clip. A node property animated in any clip gets a track in all
 * of them, so switching clips never leaves a part where another clip put it.
 */
function bakeAll(rig: Rig, names: DroneClipName[], steps: Set<number>): DroneClip[] {
  const sampled = names.map((n) => sample(rig, n));
  const animated: [number, Path][] = [];
  rig.nodes.forEach((n, i) => {
    for (const path of ["position", "quaternion", "scale"] as Path[]) {
      const rest = path === "position" ? n.position : path === "quaternion" ? n.quaternion : n.scale;
      const moves = sampled.some((poses) =>
        poses.some((p) => {
          const v = field(p, path, i);
          if (path === "quaternion") return Math.abs(Math.abs(v[0] * rest[0] + v[1] * rest[1] + v[2] * rest[2] + v[3] * (rest[3] ?? 0)) - 1) > 1e-9;
          return v.some((x, d) => Math.abs(x - rest[d]) > 1e-6);
        }),
      );
      if (moves) animated.push([i, path]);
    }
  });
  const frames = Math.round(DURATION * FPS);
  const times = Float32Array.from({ length: frames + 1 }, (_, f) => (f / frames) * DURATION);
  return names.map((name, c) => {
    const poses = sampled[c];
    const tracks: DroneTrack[] = animated.map(([i, path]) => {
      const vals: number[] = [];
      let prev: number[] | null = null;
      for (const p of poses) {
        let v = field(p, path, i);
        // Keep consecutive quaternion keys in one hemisphere so interpolation takes the short way.
        if (path === "quaternion" && prev && v[0] * prev[0] + v[1] * prev[1] + v[2] * prev[2] + v[3] * prev[3] < 0) v = v.map((x) => -x);
        vals.push(...v);
        prev = v;
      }
      return { node: i, path, times, values: Float32Array.from(vals), ...(path === "scale" && steps.has(i) ? { step: true } : {}) };
    });
    return { name, duration: DURATION, tracks };
  });
}
