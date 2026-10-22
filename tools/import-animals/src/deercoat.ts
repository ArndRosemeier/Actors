/**
 * Coat data for the deer, per vertex (read by the fur material). The channels
 * keep the dog's meaning where they fit, so the shared shader code works:
 * - coatA: leg height (0 at the ground .. 1 at the carpus/hock and above), head, muzzle (0 at the eyes .. 1 at the nose), tail (0 base .. 1 tip)
 * - coatB: ear, hair length factor, eye ring, throat patch (bib)
 * - coatC: nose pad, lips, hooves, eye rims and preorbital glands (bare skin)
 * - coatD: back, underside and inner legs, face (forehead and bridge of the nose), rump patch border
 * - coatE: light chin, lips and muzzle band; inside of the ears; metatarsal gland tufts; tail's outer face
 * - coatF: rump patch, position along the body (0.65 - z, m), distance from the spine line in the cross-section (m), where spots grow
 */
import type { Vec3 } from "@actors/core";
import type { CoatFunction } from "./bodymesh";
import { segmentDistance } from "./bodymesh";
import type { DeerBody } from "./deer";

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const deerCoat: CoatFunction = (dogBody, P, N, W, B, regions, furLen) => {
  const body = dogBody as DeerBody;
  const { rig, eyes, marks, deer } = body;
  const n = P.length / 3;
  const coatA = new Float32Array(n * 4), coatB = new Float32Array(n * 4), coatC = new Float32Array(n * 4), coatD = new Float32Array(n * 4), coatE = new Float32Array(n * 4), coatF = new Float32Array(n * 4);
  const zero = new Float32Array(n);
  const r = (name: string) => regions.get(name as never) ?? zero;
  const leg = r("leg"), hoof = r("hoof"), head = r("head"), muzzle = r("muzzle"), jaw = r("jaw"), nose = r("nose"), ear = r("ear"), torso = r("torso"), neck = r("neck"), tail = r("tail");
  const bone = (name: string) => rig.bones[rig.index.get(name)!];
  const tailBones = ["Tail1", "Tail2", "Tail3"].map((b) => rig.index.get(b)!);
  const eyeZ = Math.max(...eyes.map((e) => e.center[2])), tip = marks.nose;
  // Spine line height by z (poll -> tail), for the stripe and the spot rows.
  const spine = [...deer.spine].sort((a, b) => a[2] - b[2]);
  const spineY = (z: number) => {
    if (z <= spine[0][2]) return spine[0][1];
    for (let i = 1; i < spine.length; i++)
      if (z <= spine[i][2]) return spine[i - 1][1] + ((spine[i][1] - spine[i - 1][1]) * (z - spine[i - 1][2])) / (spine[i][2] - spine[i - 1][2]);
    return spine[spine.length - 1][1];
  };
  const withersZ = 0.24;

  for (let v = 0; v < n; v++) {
    const p: Vec3 = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    const nn: Vec3 = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
    const front = p[2] > 0;
    // Leg height: lower legs 0 at the ground, 1 from the carpus (front) or a little above the hock (hind).
    const jointY = front ? deer.carpusY + 0.03 : deer.hockY + 0.05;
    const legW = Math.min(1, leg[v] + hoof[v]);
    const legT = 1 - legW * (1 - Math.min(1, p[1] / jointY));
    const headW = Math.min(1, head[v] + muzzle[v] + jaw[v] + nose[v] + ear[v]);
    const muzzleT = headW * Math.max(0, Math.min(1, (p[2] - eyeZ) / (tip[2] - eyeZ)));
    let tw = 0, tt = 0;
    tailBones.forEach((b, k) => {
      const w = W[v * B + b];
      if (!w) return;
      const { t } = segmentDistance(p, rig.bones[b].head, rig.bones[b].tail);
      tw += w;
      tt += w * ((k + t) / tailBones.length);
    });
    const tailT = tw > 0.3 ? tt / tw : 0;
    coatA.set([legT, headW, muzzleT, tailT], v * 4);

    // Eye ring: a pale ring of short hair a little outside the lids.
    const eyeD = Math.min(...eyes.map((e) => dist(p, e.center) - e.radius));
    const ring = headW * smoothstep(0.012, 0.007, eyeD) * smoothstep(0.002, 0.004, eyeD);
    // Throat patch: the lighter front of the neck under the jaw.
    const throat = Math.min(1, neck[v] + jaw[v] * 0.6) * smoothstep(0.1, 0.55, nn[2] * 0.7 - nn[1] * 0.7) * smoothstep(0.62, 0.8, p[1]);
    coatB.set([ear[v], furLen[v], ring, throat], v * 4);

    const noseW = smoothstep(0.3, 0.6, nose[v]) * smoothstep(-0.2, 0.25, nn[2] + nn[1] * 0.3);
    // Lips: along the groove from the corner of the mouth, and the front of the upper lip under the nose pad.
    const lipLine = 0.94 + ((p[2] - 0.64) * 0.004) / 0.078;
    const lips = headW * smoothstep(0.62, 0.66, p[2]) * smoothstep(0.006, 0.0025, Math.abs(p[1] - lipLine)) * smoothstep(-0.2, 0.3, Math.abs(nn[0]) + nn[2]);
    const hooves = smoothstep(0.35, 0.7, hoof[v]);
    const rim = Math.max(...eyes.map((e) => smoothstep(e.radius + 0.0035, e.radius + 0.001, dist(p, e.center))));
    const gland = Math.max(...deer.glands.map((g) => Math.exp(-(((p[1] - g[1]) / 0.003) ** 2 + ((p[2] - g[2]) / 0.009) ** 2)) * smoothstep(0.012, 0.004, Math.abs(Math.abs(p[0]) - Math.abs(g[0])))));
    coatC.set([noseW, lips, hooves, Math.max(rim, gland * 0.9)], v * 4);
    // Short hair at the lips, nose pad and around the eyes.
    coatB[v * 4 + 1] *= (1 - 0.8 * Math.max(lips, noseW)) * (1 - 0.6 * smoothstep(0.008, 0.002, eyeD));

    const trunk = Math.min(1, torso[v] + neck[v] + tail[v] + leg[v] * smoothstep(0.85, 1, legT) * smoothstep(0.5, 0.62, p[1]));
    const back = trunk * smoothstep(-0.35, 0.45, nn[1]);
    const inner = leg[v] * smoothstep(0.1, 0.6, -Math.sign(p[0]) * nn[0]) * smoothstep(0.45, 0.1, nn[1]);
    // Underside: belly and chest floor, the inside of the legs, and the hams' back face around the rump.
    const under = Math.min(1, (torso[v] + neck[v] * 0.4) * smoothstep(-0.15, -0.65, nn[1]) + inner * smoothstep(0.1, 0.35, p[1]));
    // Face: the darker forehead and bridge of the nose (between the eyes and down the front).
    const face = headW * (1 - ear[v]) * smoothstep(0.2, 0.7, nn[1] + 0.4 * nn[2]) * smoothstep(0.035, 0.012, Math.abs(p[0])) * smoothstep(0.46, 0.52, p[2]) * (1 - smoothstep(0.3, 0.6, nose[v]));

    // Light chin, lower lip and a band behind the nose pad.
    const chin = Math.min(1, jaw[v] + head[v] * 0.5 + muzzle[v]) * smoothstep(0.6, 0.68, p[2]) * smoothstep(0.952, 0.935, p[1]);
    const band = headW * smoothstep(tip[2] - 0.035, tip[2] - 0.022, p[2]) * smoothstep(0.3, 0.05, nose[v]) * smoothstep(0.93, 0.955, p[1]);
    const pale = Math.max(chin, band * 0.85);
    // Inside of the ears: the cupped front face, pale near the base.
    const earAxis = (side: number) => {
      const s = side > 0 ? "L" : "R";
      return { a: bone(`Ear2.${s}`).head, b: bone(`Ear4.${s}`).tail };
    };
    let innerEar = 0;
    if (ear[v] > 0.2) {
      const { a, b } = earAxis(p[0]);
      const { t } = segmentDistance(p, a, b);
      const facing = (Math.sign(p[0]) * 0.45 * nn[0] + 0.1 * nn[1] + nn[2]) / 1.1;
      innerEar = ear[v] * smoothstep(0.0, 0.45, facing) * (1 - 0.7 * smoothstep(0.35, 0.95, t));
    }
    const meta = Math.max(...deer.metatarsal.map((g) => Math.exp(-(((p[1] - g[1]) / 0.022) ** 2 + ((p[2] - g[2]) / 0.008) ** 2)) * smoothstep(0, 0.5, Math.sign(g[0]) * nn[0]) * (Math.sign(p[0]) === Math.sign(g[0]) ? 1 : 0)));
    // Tail: dark along the middle of its outer (back) face, white at the edges and underneath.
    const tailOut = Math.min(1, tail[v]) * smoothstep(-0.1, -0.6, nn[2]) * smoothstep(0.016, 0.006, Math.abs(p[0]));
    coatE.set([pale, innerEar, meta * leg[v], tailOut], v * 4);

    // Rump patch: a heart-shaped white disc around the tail root on the back of the buttocks, and the tail's underside.
    const rp = deer.rump;
    const ell = (p[0] / 0.07) ** 2 + ((p[1] - rp[1]) / (p[1] > rp[1] ? 0.075 : 0.11)) ** 2;
    const rump = Math.min(1, torso[v] + leg[v] + tail[v]) * smoothstep(1.15, 0.8, ell) * smoothstep(-0.05, -0.45, nn[2]) * smoothstep(-0.33, -0.39, p[2]);
    // Black border: a band just outside the patch's upper half.
    const border = Math.min(1, torso[v] + leg[v]) * smoothstep(0.9, 1.15, ell) * smoothstep(1.75, 1.3, ell) * smoothstep(-0.05, -0.4, nn[2]) * smoothstep(rp[1] - 0.03, rp[1] + 0.01, p[1]) * smoothstep(-0.28, -0.34, p[2]);
    coatD.set([back, under, face, border], v * 4);
    // Spot-row coordinates: along the body (0.65 - z, so it grows towards the tail and is about 0.4 at
    // the withers), and the distance from the spine line within the vertex's own cross-section.
    // (Distances to the nearest point of a polyline smear spots into rings around its ends and corners.)
    const along = 0.65 - p[2];
    const best = Math.hypot(p[0], spineY(p[2]) - p[1]);
    // Spots: on the sides and back of the trunk and haunches, fading on the neck, belly and legs.
    // (Not in front of the shoulders: the crest climbs steeply there and would stretch the rows.)
    const spotty = Math.min(1, torso[v] + leg[v] * smoothstep(0.55, 0.62, p[1]) + neck[v] * 0.3) * smoothstep(withersZ + 0.1, withersZ + 0.02, p[2]) * (1 - smoothstep(0.25, 0.65, under)) * (1 - rump);
    coatF.set([rump, along, best, spotty], v * 4);
  }
  return { coatA, coatB, coatC, coatD, coatE, coatF };
};
