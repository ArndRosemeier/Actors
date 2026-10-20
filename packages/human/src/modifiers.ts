/**
 * A detail slider (nose width, upper-arm length, ...). Value -1..1:
 * negative values blend in the `negative` targets, positive values the
 * `positive` ones. Left/right pairs share one slider (symmetric).
 */
export interface ModifierDef {
  id: string;
  group: string;
  label: string;
  negative: string[];
  positive: string[];
}

export function modifierTargetWeights(defs: ModifierDef[], values: Record<string, number>, out = new Map<string, number>()) {
  for (const def of defs) {
    const v = Math.max(-1, Math.min(1, values[def.id] ?? 0));
    if (v < 0) for (const t of def.negative) out.set(t, (out.get(t) ?? 0) - v);
    if (v > 0) for (const t of def.positive) out.set(t, (out.get(t) ?? 0) + v);
  }
  return out;
}
