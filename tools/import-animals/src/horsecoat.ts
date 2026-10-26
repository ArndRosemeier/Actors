/**
 * Coat data for the horse, per vertex (read by the fur material). The channels
 * keep the dog's meaning where they fit, so the shared shader code works:
 * - coatA: leg height (0 at the ground .. 1 a little above the knee/hock), head, muzzle (0 at the eyes .. 1 at the nose), tail (0 dock .. 1 hair tips)
 * - coatB: ear, hair length factor, unused, unused
 * - coatC: nostrils, lips, hooves, eye rims (bare skin)
 * - coatD: back, underside and inner legs, muzzle (dark or mealy), face stripe (star, strip, blaze: 1 on the midline of the face)
 * - coatE: pale muzzle and eye surroundings, inside of the ears, mane and tail hair, unused
 * - coatF: unused (0; the deer pattern code reads it)
 */
import type { Vec3 } from "@actors/core";
import type { CoatFunction } from "./bodymesh";
import { segmentDistance } from "./bodymesh";
import type { HorseBody } from "./horse";
import { TAIL } from "./horse";

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const horseCoat: CoatFunction = (dogBody, P, N, W, B, regions, furLen) => {
  const body = dogBody as HorseBody;
  const { rig, eyes, horse } = body;
  const n = P.length / 3;
  const coatA = new Float32Array(n * 4), coatB = new Float32Array(n * 4), coatC = new Float32Array(n * 4), coatD = new Float32Array(n * 4), coatE = new Float32Array(n * 4), coatF = new Float32Array(n * 4);
  const zero = new Float32Array(n);
  const r = (name: string) => regions.get(name as never) ?? zero;
  const leg = r("leg"), hoof = r("hoof"), head = r("head"), muzzle = r("muzzle"), jaw = r("jaw"), nose = r("nose"), ear = r("ear"), torso = r("torso"), neck = r("neck"), tail = r("tail"), mane = r("mane");
  const bone = (name: string) => rig.bones[rig.index.get(name)!];
  const tailBones = TAIL.map((b) => rig.index.get(b)!);
  const eyeZ = Math.max(...eyes.map((e) => e.center[2]));
  const tip = horse.muzzle;
  const poll = bone("head").head;
  // The face's front line (forehead to muzzle) and its outward direction, for the white face markings.
  const faceDir: Vec3 = [0, tip[1] - poll[1], tip[2] - poll[2]];
  const faceLen = Math.hypot(faceDir[1], faceDir[2]);
  const tailEnd = Math.min(...[...Array(n).keys()].filter((v) => tail[v] > 0.5).map((v) => P[v * 3 + 1]), 10);
  const dockTop = bone("tail_1").head[1];

  for (let v = 0; v < n; v++) {
    const p: Vec3 = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    const nn: Vec3 = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
    const front = p[2] > 0;
    // Leg height: 0 at the ground, 1 a little above the knee (front) or the hock (hind).
    const jointY = front ? horse.kneeY + 0.06 : horse.hockY + 0.08;
    const legW = Math.min(1, leg[v] + hoof[v]);
    const legT = 1 - legW * (1 - Math.min(1, p[1] / jointY));
    const headW = Math.min(1, head[v] + muzzle[v] + jaw[v] + nose[v] + ear[v]);
    const muzzleT = headW * Math.max(0, Math.min(1, (p[2] - eyeZ) / (tip[2] - eyeZ)));
    // Tail: along the dock bones, then down the hair to its tips.
    let tw = 0, tt = 0;
    tailBones.forEach((b, k) => {
      const w = W[v * B + b];
      if (!w) return;
      const { t } = segmentDistance(p, rig.bones[b].head, rig.bones[b].tail);
      tw += w;
      tt += w * ((k + t) / tailBones.length);
    });
    const tailT = tail[v] > 0.3 ? Math.max(tw > 0.3 ? (tt / tw) * 0.4 : 0, smoothstep(dockTop, tailEnd, p[1])) : 0;
    coatA.set([legT, headW, muzzleT, tailT], v * 4);
    coatB.set([ear[v], furLen[v], 0, 0], v * 4);

    // Bare skin: inside the nostrils, the lip line, the hooves, the eye rims.
    const noseW = smoothstep(0.35, 0.7, nose[v]);
    const m = body.marks.mouth;
    const lipLine = m.y0 + ((m.y1 - m.y0) * (p[2] - m.z0)) / (m.z1 - m.z0);
    const lips = headW * smoothstep(m.z0 - 0.02, m.z0 + 0.01, p[2]) * smoothstep(0.012, 0.004, Math.abs(p[1] - lipLine)) * 0.8;
    const hooves = smoothstep(0.35, 0.7, hoof[v]);
    const eyeD = Math.min(...eyes.map((e) => dist(p, e.center) - e.radius));
    const rim = headW * smoothstep(0.007, 0.002, eyeD);
    coatC.set([noseW, lips, hooves, rim], v * 4);
    // Short hair on the lips and around the eyes.
    coatB[v * 4 + 1] *= (1 - 0.8 * Math.max(lips, noseW)) * (1 - 0.6 * smoothstep(0.012, 0.003, eyeD));

    const trunk = Math.min(1, torso[v] + neck[v] + leg[v] * smoothstep(0.85, 1, legT));
    const back = trunk * smoothstep(-0.35, 0.45, nn[1]);
    const inner = leg[v] * smoothstep(0.1, 0.6, -Math.sign(p[0]) * nn[0]) * smoothstep(0.45, 0.1, nn[1]);
    const under = Math.min(1, torso[v] * smoothstep(-0.2, -0.7, nn[1]) + inner * smoothstep(0.3, 0.6, p[1]));
    // Muzzle: the soft nose and lips (dark on bays, mealy on some), fading out up the face.
    const muz = Math.min(1, muzzle[v] + jaw[v] * 0.7 + nose[v]) * smoothstep(0.55, 0.85, muzzleT);
    // Face stripe: 1 along the midline of the front of the face, from the forehead to the nose, widening towards the nose.
    const along = ((p[1] - poll[1]) * faceDir[1] + (p[2] - poll[2]) * faceDir[2]) / (faceLen * faceLen);
    const facing = nn[2] * 0.8 + nn[1] * 0.45;
    const stripe = headW * (1 - ear[v]) * Math.exp(-((p[0] / (0.012 + 0.026 * Math.max(0, Math.min(1, along)) ** 1.5)) ** 2)) * smoothstep(0.1, 0.45, facing) * smoothstep(0.12, 0.22, along) * (1 - smoothstep(0.4, 0.8, mane[v]));
    coatD.set([back, under, muz, stripe], v * 4);

    // Pale (mealy) areas: muzzle and around the eyes.
    const eyeNear = headW * smoothstep(0.05, 0.015, eyeD);
    const pale = Math.max(muz, eyeNear * 0.8) * (1 - noseW);
    let innerEar = 0;
    if (ear[v] > 0.2) {
      const s = p[0] > 0 ? "l" : "r";
      const a = bone(`ear_1_${s}`).head, b = bone(`ear_leaf_${s}`).tail;
      const { t } = segmentDistance(p, a, b);
      const fac = (Math.sign(p[0]) * 0.5 * nn[0] + 0.1 * nn[1] + nn[2]) / 1.1;
      innerEar = ear[v] * smoothstep(0, 0.45, fac) * (1 - 0.5 * smoothstep(0.4, 0.95, t));
    }
    // Long hair: the mane and forelock, the tail hair (and the dock's hair).
    const hair = Math.min(1, mane[v] + tail[v]);
    coatE.set([pale, innerEar, hair, 0], v * 4);
  }
  return { coatA, coatB, coatC, coatD, coatE, coatF };
};
