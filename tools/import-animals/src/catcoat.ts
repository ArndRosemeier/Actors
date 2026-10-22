/**
 * Coat data for the cat: the dog's coat regions (bodymesh.ts coatRegions),
 * with the channels the cat uses differently:
 * - coatC.z: paw pads only on the soles (the cat's toes are rounder)
 * - coatE: light mask, inside of the ears, where tabby stripes may show, unused
 * - coatF: stripe coordinates in stripe periods (trunk: along the body, legs: height, head: across the forehead), lower leg weight
 */
import { type CoatFunction, coatRegions } from "./bodymesh";

export const catCoat: CoatFunction = (body, P, N, W, B, regions, furLen) => {
  const out = coatRegions(body, P, N, W, B, regions, furLen);
  const { rig } = body;
  const u = body.unit ?? 1;
  const n = P.length / 3;
  const r = (name: Parameters<typeof regions.get>[0]) => regions.get(name) ?? new Float32Array(n);
  const leg = r("leg"), paw = r("paw"), head = r("head"), muzzle = r("muzzle"), jaw = r("jaw"), nose = r("nose"), ear = r("ear");
  const bone = (name: string) => rig.bones[rig.index.get(name)!];
  const elbowY = bone("Front_Leg_Lower_L").head[1];
  const spineY = bone("Spine_2").head[1];
  const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let v = 0; v < n; v++) {
    const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    const nn = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
    const legW = Math.min(1, leg[v] + paw[v]);
    const headW = Math.min(1, head[v] + muzzle[v] + jaw[v] + nose[v] + ear[v]);
    out.coatC[v * 4 + 2] = paw[v] * smoothstep(-0.55, -0.85, nn[1]) * smoothstep(0.02 * u, 0.008 * u, p[1]);
    // Inside of the ear: facing forward (and a little out).
    const innerEar = ear[v] * smoothstep(0.15, 0.6, (nn[2] + 0.4 * Math.sign(p[0]) * nn[0]) / Math.hypot(1, 0.4));
    // Stripes: rings on the lower legs, bars down the sides, lines across the forehead; none on the muzzle, chin and cheeks.
    const face = Math.min(1, muzzle[v] + jaw[v] + nose[v]);
    const forehead = smoothstep(0.1, 0.6, nn[1] + 0.6 * nn[2]) * smoothstep(0.75, 0.4, Math.abs(nn[0]));
    const stripeMask = (1 - face) * (1 - headW * (1 - forehead)) * (1 - 0.6 * ear[v]);
    const lowerLeg = legW * smoothstep(elbowY * 1.6, elbowY, p[1]);
    out.coatE.set([out.coatE[v * 4], innerEar, stripeMask, 0], v * 4);
    out.coatF.set([(p[2] - 0.25 * (p[1] - spineY)) / (0.055 * u), p[1] / (0.04 * u), p[0] / (0.016 * u), lowerLeg], v * 4);
  }
  return out;
};
