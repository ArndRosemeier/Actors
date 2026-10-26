/**
 * Coat (plumage) data for the chicken, per vertex (read by the fur material,
 * whose chicken code draws feathers on these packs):
 * - coatA: leg height (0 at the ground .. 1 at the hock and above), head, unused, tail (0 root .. 1 tip)
 * - coatB: unused, feather length factor, unused, unused
 * - coatC: beak, unused, bare legs and feet, red skin (comb, wattles, earlobes, face) — all bare
 * - coatD: back, underside, unused, unused
 * - coatE: unused, unused, tail feathers, unused
 * - coatF: hackles (neck), wing, fluff (under the tail and round the vent), feather size (relative to the body's)
 */
import type { Vec3 } from "@actors/core";
import type { CoatFunction } from "./bodymesh";
import { segmentDistance } from "./bodymesh";
import { type ChickenBody, TAIL } from "./chicken";

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const chickenCoat: CoatFunction = (dogBody, P, N, W, B, regions, furLen) => {
  const body = dogBody as ChickenBody;
  const { rig, face } = body;
  const n = P.length / 3;
  const coatA = new Float32Array(n * 4), coatB = new Float32Array(n * 4), coatC = new Float32Array(n * 4), coatD = new Float32Array(n * 4), coatE = new Float32Array(n * 4), coatF = new Float32Array(n * 4);
  const zero = new Float32Array(n);
  const r = (name: string) => regions.get(name as never) ?? zero;
  const torso = r("torso"), neck = r("neck"), head = r("head"), jaw = r("jaw"), nose = r("nose"), comb = r("comb"), wing = r("wing"), leg = r("leg"), paw = r("paw"), tail = r("tail"), fluff = r("fluff");
  const bone = (name: string) => rig.bones[rig.index.get(name)!];
  const hockY = bone("AnkleLeg_L").head[1];
  const tailBones = TAIL.map((b) => rig.index.get(b)!);
  const skullTop = bone("head").head[1];

  for (let v = 0; v < n; v++) {
    const p: Vec3 = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    const nn: Vec3 = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
    const legW = Math.min(1, leg[v] + paw[v]);
    const legT = 1 - legW * (1 - Math.min(1, p[1] / (hockY + 0.01)));
    const headW = Math.min(1, head[v] + comb[v] + nose[v] + jaw[v]);
    let tw = 0, tt = 0;
    tailBones.forEach((b, k) => {
      const w = W[v * B + b];
      if (!w) return;
      const { t } = segmentDistance(p, rig.bones[b].head, rig.bones[b].tail);
      tw += w;
      tt += w * ((k + t) / tailBones.length);
    });
    const tailT = tw > 0.2 ? (tt / tw) * Math.min(1, tail[v] * 1.5) : 0;
    coatA.set([legT, headW, 0, tailT], v * 4);
    coatB.set([0, furLen[v], 0, 0], v * 4);

    // Bare red face: round the eye and down the cheek to the wattles, on the sides of the head.
    const fz = (p[2] - face.center[2]) / face.radii[0], fy = (p[1] - face.center[1]) / face.radii[1];
    const faceSkin = head[v] * smoothstep(1.1, 0.75, Math.hypot(fz, fy)) * smoothstep(0.004, 0.009, Math.abs(p[0]));
    const red = Math.min(1, comb[v] + faceSkin);
    coatC.set([Math.min(1, nose[v] + jaw[v]), 0, paw[v], red], v * 4);

    const trunk = Math.min(1, torso[v] + neck[v] + tail[v] + wing[v] + fluff[v]);
    const back = trunk * smoothstep(-0.3, 0.5, nn[1]);
    const inner = leg[v] * smoothstep(0.1, 0.6, -Math.sign(p[0]) * nn[0]);
    const under = Math.min(1, (torso[v] + neck[v] * 0.5 + fluff[v]) * smoothstep(0, -0.6, nn[1]) + inner * 0.6 + fluff[v] * 0.5);
    coatD.set([back, under, 0, 0], v * 4);
    coatE.set([0, 0, Math.min(1, tail[v]), 0], v * 4);

    // Hackles: the neck and the back of the head; smaller feathers towards the head.
    const hackle = Math.min(1, neck[v] + head[v] * smoothstep(skullTop + 0.01, skullTop - 0.012, p[1]) * 0.6);
    const size = 0.32 * headW + 0.62 * neck[v] + 1 * torso[v] + 1.25 * wing[v] + 1.7 * tail[v] + 1.1 * fluff[v] + 0.8 * leg[v];
    const total = headW + neck[v] + torso[v] + wing[v] + tail[v] + fluff[v] + leg[v];
    coatF.set([hackle, Math.min(1, wing[v]), Math.min(1, fluff[v]), total > 0 ? size / total : 1], v * 4);
  }
  return { coatA, coatB, coatC, coatD, coatE, coatF };
};
