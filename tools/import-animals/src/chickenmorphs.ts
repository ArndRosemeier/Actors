/**
 * Chicken morphs: shape changes that bone proportions can't express, used by
 * the breed presets (a big comb and long wattles for Leghorns, a heavy fluffy
 * body for Orpingtons, a small comb for rose-combed breeds).
 */
import type { Vec3 } from "@actors/core";
import type { ChickenBody } from "./chicken";
import { P } from "./chicken";
import { type Morph, type MorphInput, morph } from "./targets";

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function chickenMorphs(input: MorphInput, body: ChickenBody): Morph[] {
  const { weight } = input;
  const sum = (v: number, names: string[]) => names.reduce((a, b) => a + weight(v, b), 0);
  const sides = (names: string[]) => names.flatMap((n) => [`${n}_L`, `${n}_R`]);
  const near = (p: Vec3, prims: ChickenBody["comb"], within: number) => {
    let d = Infinity;
    for (const c of prims) d = Math.min(d, c.distance(p));
    return smoothstep(within, within * 0.3, d);
  };
  const out: Morph[] = [];

  // Bulk: a wider, deeper body; the folded wings move out with it.
  const barrelY = P(330, 360)[1];
  const trunk = ["hips", "spine_0", "spine_1"];
  const wings = sides(["wing_1", "wing_2", "wing_3", "wing_4", "wing_5", "wing_tip", "wing_feather_1_1", "wing_feather_1_2", "wing_feather_2_1", "wing_feather_2_2", "wing_feather_3_1", "wing_feather_3_2", "wing_feather_4_1", "wing_feather_4_2"]);
  out.push(
    morph("bulk", "body", input, (p, v) => {
      const t = Math.min(1, sum(v, trunk) + sum(v, wings) + sum(v, sides(["UpperLeg"])) * 0.6 + weight(v, "spine_2") * 0.5 + sum(v, ["tail_1"]) * 0.4);
      if (t <= 0) return p;
      return [p[0] * (1 + 0.18 * t), barrelY + (p[1] - barrelY) * (1 + 0.07 * t), p[2]];
    }),
  );

  // Fluff: the soft feathers of heavy breeds (Orpington, Cochin): fuller rear, thighs and underside.
  const rear = P(395, 395);
  out.push(
    morph("fluff", "body", input, (p, v) => {
      const t = Math.min(1, sum(v, ["hips", "spine_0", "tail_1"]) + sum(v, sides(["UpperLeg", "LowerLeg"]))) * smoothstep(P(0, 330)[1], P(0, 400)[1], p[1]);
      if (t <= 0) return p;
      return [p[0] + p[0] * 0.18 * t, p[1] + (p[1] - rear[1]) * 0.16 * t, p[2] + (p[2] - rear[2]) * 0.14 * t * smoothstep(rear[2] + 0.04, rear[2] - 0.02, p[2])];
    }),
  );

  // Comb: larger (a Leghorn's tall single comb) or smaller (a rose or pea comb's low profile), from its base on the crown.
  const baseY = P(0, 147)[1];
  const combZ = P(174, 0)[2];
  const combW = (p: Vec3) => near(p, body.comb, 0.004) * smoothstep(baseY - 0.004, baseY + 0.003, p[1]);
  out.push(
    morph("comb-large", "head", input, (p) => {
      const t = combW(p);
      if (t <= 0) return p;
      return [p[0] * (1 + 0.35 * t), baseY + (p[1] - baseY) * (1 + 1.0 * t), combZ + (p[2] - combZ) * (1 + 0.35 * t)];
    }),
    morph("comb-small", "head", input, (p) => {
      const t = combW(p);
      if (t <= 0) return p;
      return [p[0], baseY + (p[1] - baseY) * (1 - 0.65 * t), combZ + (p[2] - combZ) * (1 - 0.3 * t)];
    }),
  );

  // Wattles: longer or smaller, hanging from their top.
  const wattleTop = P(164, 181);
  const wattleW = (p: Vec3) => near(p, body.wattles, 0.004) * smoothstep(wattleTop[1] + 0.002, wattleTop[1] - 0.004, p[1]);
  out.push(
    morph("wattles-large", "head", input, (p) => {
      const t = wattleW(p);
      if (t <= 0) return p;
      return [p[0] * (1 + 0.25 * t), wattleTop[1] + (p[1] - wattleTop[1]) * (1 + 0.9 * t), wattleTop[2] + (p[2] - wattleTop[2]) * (1 + 0.35 * t)];
    }),
    morph("wattles-small", "head", input, (p) => {
      const t = wattleW(p);
      if (t <= 0) return p;
      return [p[0], wattleTop[1] + (p[1] - wattleTop[1]) * (1 - 0.6 * t), wattleTop[2] + (p[2] - wattleTop[2]) * (1 - 0.35 * t)];
    }),
  );
  return out;
}
