import { type HumanParams, ageYearsToValue, sanitizeParams } from "./params";

/**
 * MakeHuman-style macro targets are named by the variable values they
 * represent, e.g. "female-young-maxmuscle-averageweight-maxheight". The
 * importer splits names into tokens; a target's weight is the product of its
 * tokens' weights. This reimplements the documented MakeHuman interpolation
 * scheme; no MakeHuman code is used.
 */
export interface MacroTargetDef {
  name: string;
  tokens: string[];
}

/** Linear blend between named breakpoints; "" marks an average with no target. */
function axis(value: number, breaks: number[], names: string[], out: Record<string, number>): void {
  for (const n of names) if (n) out[n] = 0;
  const v = Math.min(breaks[breaks.length - 1], Math.max(breaks[0], value));
  for (let i = 0; i < breaks.length - 1; i++) {
    if (v <= breaks[i + 1] || i === breaks.length - 2) {
      const t = (v - breaks[i]) / (breaks[i + 1] - breaks[i]);
      if (names[i]) out[names[i]] += 1 - t;
      if (names[i + 1]) out[names[i + 1]] += t;
      return;
    }
  }
}

/** Weight of each macro token (female, young, maxmuscle, african, ...) for the given parameters. */
export function macroTokenWeights(params: HumanParams): Record<string, number> {
  const p = sanitizeParams(params);
  const w: Record<string, number> = {};
  axis(p.gender, [0, 1], ["female", "male"], w);
  // Baby targets are never shipped; adults never reach that range anyway.
  axis(ageYearsToValue(p.ageYears), [0, 0.1875, 0.5, 1], ["baby", "child", "young", "old"], w);
  axis(p.muscle, [0, 0.5, 1], ["minmuscle", "averagemuscle", "maxmuscle"], w);
  axis(p.weight, [0, 0.5, 1], ["minweight", "averageweight", "maxweight"], w);
  axis(p.height, [0, 0.5, 1], ["minheight", "", "maxheight"], w);
  axis(p.proportions, [0, 0.5, 1], ["uncommonproportions", "", "idealproportions"], w);
  axis(p.cupSize, [0, 0.5, 1], ["mincup", "averagecup", "maxcup"], w);
  axis(p.firmness, [0, 0.5, 1], ["minfirmness", "averagefirmness", "maxfirmness"], w);
  w.african = p.african;
  w.asian = p.asian;
  w.caucasian = p.caucasian;
  return w;
}

export function macroTargetWeights(defs: MacroTargetDef[], params: HumanParams): Map<string, number> {
  const tw = macroTokenWeights(params);
  const out = new Map<string, number>();
  for (const def of defs) {
    let w = 1;
    for (const token of def.tokens) {
      const v = tw[token];
      if (v === undefined) throw new Error(`Unknown macro token "${token}" in ${def.name}`);
      w *= v;
      if (w === 0) break;
    }
    if (w > 1e-5) out.set(def.name, w);
  }
  return out;
}
