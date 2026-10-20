/**
 * Extra muscle shaping on top of the macro targets. MakeHuman's
 * min/max-muscle macros mostly redistribute torso fat and barely change the
 * limbs, so the muscle slider felt like a belly slider. These terms add limb,
 * shoulder, neck and chest bulk that follows the muscle value.
 */

/** [bare target base ("%" = both sides), gain, how much of the gain is male-only (0..1)]. */
type Term = [base: string, gain: number, maleOnly: number];

export const MUSCLE_TERMS: Term[] = [
  ["%-upperarm-muscle", 0.8, 0],
  ["%-upperarm-shoulder-muscle", 0.8, 0],
  ["%-lowerarm-muscle", 0.8, 0],
  ["measure-upperarm-circ", 0.3, 0],
  // Thickness of the limbs (the detail panel's scale sliders), not their length.
  ["%-upperarm-scale-depth", 0.4, 0],
  ["%-upperarm-scale-vert", 0.4, 0],
  ["%-lowerarm-scale-depth", 0.35, 0],
  ["%-lowerarm-scale-vert", 0.35, 0],
  ["%-upperleg-scale-depth", 0.2, 0],
  ["%-upperleg-scale-horiz", 0.15, 0],
  ["%-lowerleg-scale-depth", 0.3, 0],
  ["%-lowerleg-scale-horiz", 0.25, 0],
  ["%-upperleg-muscle", 0.6, 0],
  ["%-lowerleg-muscle", 0.8, 0],
  ["measure-thigh-circ", 0.1, 0],
  ["measure-calf-circ", 0.25, 0],
  ["measure-neck-circ", 0.5, 0.6],
  ["torso-muscle-pectoral", 0.7, 0.7],
  ["torso-muscle-dorsi", 0.5, 0.3],
];

/** Below average muscle thins the limbs a little less than above average bulks them. */
const LOSS = 0.7;

/**
 * Bare target weights for a muscle value (0..1, 0.5 = average; adds nothing)
 * and gender (0 = female, 1 = male).
 */
export function muscleBareTargetWeights(muscle: number, gender = 0.5): Map<string, number> {
  const out = new Map<string, number>();
  const m = Math.max(-1, Math.min(1, (muscle - 0.5) * 2)) || 0;
  if (!m) return out;
  const male = Math.max(0, Math.min(1, gender)) || 0;
  const amount = m > 0 ? m : -m * LOSS;
  const suffix = m > 0 ? "incr" : "decr";
  for (const [base, gain, maleOnly] of MUSCLE_TERMS) {
    const w = amount * gain * (1 - maleOnly + maleOnly * male);
    if (!w) continue;
    for (const n of base.includes("%") ? [base.replace("%", "l"), base.replace("%", "r")] : [base]) out.set(`${n}-${suffix}`, w);
  }
  return out;
}

/** Adds muscle shaping to a pack's target weights (unknown targets are skipped). */
export function muscleTargetWeights(muscle: number, gender: number, resolve: (bare: string) => string | undefined, out = new Map<string, number>()): Map<string, number> {
  for (const [bare, w] of muscleBareTargetWeights(muscle, gender)) {
    const name = resolve(bare);
    if (name) out.set(name, (out.get(name) ?? 0) + w);
  }
  return out;
}
