/**
 * Coat data for the cow, per vertex (read by the fur material). The channels
 * keep the horse's meaning where they fit, so the shared shader code works:
 * - coatA: leg height (0 at the ground .. 1 a little above the knee/hock), head, muzzle (0 at the eyes .. 1 at the nose), tail (0 root .. 1 switch tips)
 * - coatB: ear, hair length factor, unused, dewlap and brisket (the `bib`)
 * - coatC: nose plate, lips, claws and dewclaws, eye rims (bare skin)
 * - coatD: back, underside and inner legs, muzzle (dark), face (1 down the front of the face, fading round the sides; the white face)
 * - coatE: pale ring round the nose plate and round the eyes, inside of the ears, switch hair, udder
 * - coatF: unused (0; the deer pattern code reads it)
 */
import type { Vec3 } from "@actors/core";
import type { CoatFunction } from "./bodymesh";
import { segmentDistance } from "./bodymesh";
import type { CowBody } from "./cow";
import { TAIL } from "./cow";

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const cowCoat: CoatFunction = (dogBody, P, N, W, B, regions, furLen) => {
  const body = dogBody as CowBody;
  const { rig, eyes, cow } = body;
  const n = P.length / 3;
  const coatA = new Float32Array(n * 4), coatB = new Float32Array(n * 4), coatC = new Float32Array(n * 4), coatD = new Float32Array(n * 4), coatE = new Float32Array(n * 4), coatF = new Float32Array(n * 4);
  const zero = new Float32Array(n);
  const r = (name: string) => regions.get(name as never) ?? zero;
  const leg = r("leg"), hoof = r("hoof"), head = r("head"), muzzle = r("muzzle"), jaw = r("jaw"), nose = r("nose"), ear = r("ear"), torso = r("torso"), neck = r("neck"), tail = r("tail"), hair = r("mane"), udder = r("udder");
  const bone = (name: string) => rig.bones[rig.index.get(name)!];
  const tailBones = TAIL.map((b) => rig.index.get(b)!);
  const eyeZ = Math.max(...eyes.map((e) => e.center[2]));
  const tip = cow.muzzle, poll = cow.poll;
  // The head axis (poll -> muzzle) and the forehead side, for the face marking.
  const axis: Vec3 = [0, tip[1] - poll[1], tip[2] - poll[2]];
  const axisLen = Math.hypot(axis[1], axis[2]);
  const front: Vec3 = [0, axis[2] / axisLen, -axis[1] / axisLen];
  const dockTop = bone("tail_1").head[1];
  const tailEnd = 0.35;
  // The nose plate: the front of the muzzle round the axis tip, above the lip line.
  const axisDir: Vec3 = [0, axis[1] / axisLen, axis[2] / axisLen];

  for (let v = 0; v < n; v++) {
    const p: Vec3 = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    const nn: Vec3 = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
    const fore = p[2] > 0;
    // Leg height: 0 at the ground, 1 a little above the knee (front) or the hock (hind).
    const jointY = fore ? cow.kneeY + 0.06 : cow.hockY + 0.08;
    const legW = Math.min(1, leg[v] + hoof[v]);
    const legT = 1 - legW * (1 - Math.min(1, p[1] / jointY));
    const headW = Math.min(1, head[v] + muzzle[v] + jaw[v] + nose[v] + ear[v]);
    const muzzleT = headW * Math.max(0, Math.min(1, (p[2] - eyeZ) / (tip[2] - eyeZ)));
    // Tail: along the tail bones, then down the switch to its tips.
    let tw = 0, tt = 0;
    tailBones.forEach((b, k) => {
      const w = W[v * B + b];
      if (!w) return;
      const { t } = segmentDistance(p, rig.bones[b].head, rig.bones[b].tail);
      tw += w;
      tt += w * ((k + t) / tailBones.length);
    });
    const tailW = Math.min(1, tail[v] + hair[v]);
    const tailT = tailW > 0.3 ? Math.max(tw > 0.3 ? (tt / tw) * 0.6 : 0, smoothstep(dockTop, tailEnd, p[1])) : 0;
    coatA.set([legT, headW, muzzleT, tailT], v * 4);

    // Dewlap, brisket and the underside of the neck (white on Herefords).
    const bib = Math.min(1, neck[v] + torso[v] * smoothstep(0.35, 0.6, p[2])) * smoothstep(0.15, -0.5, nn[1]) * smoothstep(0.3, 0.75, p[2]) * (1 - headW);
    coatB.set([ear[v], furLen[v], 0, bib], v * 4);

    // Bare skin: the nose plate, the lip line, the claws, the eye rims.
    const m = body.marks.mouth;
    const lipLine = m.y0 + ((m.y1 - m.y0) * (p[2] - m.z0)) / (m.z1 - m.z0);
    const q: Vec3 = [p[0] - tip[0], p[1] - tip[1], p[2] - tip[2]];
    const ax = q[1] * axisDir[1] + q[2] * axisDir[2];
    // Across the face (x) and up it (towards the forehead) from the tip: the plate is a wide oval.
    const up = q[1] * front[1] + q[2] * front[2];
    const oval = Math.hypot(q[0] / 0.076, (up - 0.028) / 0.062);
    const facesFront = nn[1] * axisDir[1] + nn[2] * axisDir[2];
    const plateW = headW * smoothstep(0.1, 0.4, facesFront) * smoothstep(1.0, 0.88, oval) * smoothstep(-0.08, -0.05, ax) * smoothstep(-0.004, 0.006, p[1] - lipLine);
    const lips = headW * smoothstep(m.z0 - 0.02, m.z0 + 0.01, p[2]) * smoothstep(0.014, 0.005, Math.abs(p[1] - lipLine)) * 0.8;
    const claws = smoothstep(0.35, 0.7, hoof[v]);
    const eyeD = Math.min(...eyes.map((e) => dist(p, e.center) - e.radius));
    const rim = headW * smoothstep(0.007, 0.002, eyeD);
    coatC.set([plateW, lips, claws, rim], v * 4);
    // Short hair on the muzzle, the lips, round the eyes and on the udder.
    coatB[v * 4 + 1] *= (1 - 0.8 * Math.max(lips, smoothstep(0.1, 0.6, muzzle[v] + nose[v]))) * (1 - 0.6 * smoothstep(0.012, 0.003, eyeD)) * (1 - 0.7 * udder[v]);

    const trunk = Math.min(1, torso[v] + neck[v] + leg[v] * smoothstep(0.85, 1, legT));
    const back = trunk * smoothstep(-0.35, 0.45, nn[1]);
    const inner = leg[v] * smoothstep(0.1, 0.6, -Math.sign(p[0]) * nn[0]) * smoothstep(0.45, 0.1, nn[1]);
    const under = Math.min(1, torso[v] * smoothstep(-0.2, -0.7, nn[1]) + inner * smoothstep(0.3, 0.6, p[1]) + udder[v]);
    // Muzzle: round the nose plate, fading out up the face.
    const muz = Math.min(1, muzzle[v] + jaw[v] * 0.7 + nose[v]) * smoothstep(0.6, 0.85, muzzleT);
    // Face: 1 down the middle of the front of the face, fading round the sides of the head (white faces).
    const rel: Vec3 = [p[0] - poll[0], p[1] - poll[1], p[2] - poll[2]];
    const t = (rel[1] * axis[1] + rel[2] * axis[2]) / (axisLen * axisLen);
    const facing = nn[1] * front[1] + nn[2] * front[2];
    const face = Math.min(1, head[v] + muzzle[v] + nose[v] + jaw[v] * 0.6) * (1 - ear[v]) * Math.exp(-((p[0] / 0.1) ** 2)) * smoothstep(-0.45, 0.35, facing) * smoothstep(-0.12, 0.05, t);
    coatD.set([back, under, muz, face], v * 4);

    // Pale (mealy) ring round the nose plate (and the lips), and lighter hair round the eyes.
    const ring = headW * (1 - plateW) * smoothstep(1.42, 1.22, oval) * smoothstep(-0.14, -0.1, ax);
    const eyeNear = headW * smoothstep(0.03, 0.008, eyeD);
    const pale = Math.max(ring, eyeNear * 0.35);
    let innerEar = 0;
    if (ear[v] > 0.2) {
      const s = p[0] > 0 ? "l" : "r";
      const a = bone(`ear_1_${s}`).head, b = bone(`ear_leaf_${s}`).tail;
      const { t: et } = segmentDistance(p, a, b);
      // The hollow faces forward and down.
      const fac = nn[2] - 0.35 * nn[1];
      innerEar = ear[v] * smoothstep(0.0, 0.5, fac) * (1 - 0.4 * smoothstep(0.5, 0.95, et));
    }
    // Pink skin on the lower udder and the teats (its attachment between the thighs has hair).
    coatE.set([pale, innerEar, hair[v], udder[v] * smoothstep(0.74, 0.66, p[1])], v * 4);
  }
  return { coatA, coatB, coatC, coatD, coatE, coatF };
};
