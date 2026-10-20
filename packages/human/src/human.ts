import { type ActorShape, ActorRuntime, type Fetcher } from "@actors/core";
import { type MacroTargetDef, macroTargetWeights } from "./macro";
import { type ModifierDef, modifierTargetWeights } from "./modifiers";
import { DEFAULT_PARAMS, type HumanParams, sanitizeParams } from "./params";

export interface HumanExtra {
  macroTargets: MacroTargetDef[];
  modifiers: ModifierDef[];
  adultMinAge: number;
}

/** A human actor: parameters + detail sliders -> target weights -> shape. */
export class Human {
  params: HumanParams = { ...DEFAULT_PARAMS };
  modifierValues: Record<string, number> = {};
  readonly extra: HumanExtra;

  private constructor(readonly runtime: ActorRuntime) {
    const extra = runtime.manifest.extra?.human as HumanExtra | undefined;
    if (!extra) throw new Error("Pack has no human data");
    this.extra = extra;
  }

  static async load(manifestUrl: string, fetcher?: Fetcher): Promise<Human> {
    return new Human(await ActorRuntime.load(manifestUrl, fetcher));
  }

  get modifiers(): ModifierDef[] {
    return this.extra.modifiers;
  }

  targetWeights(): Map<string, number> {
    const weights = macroTargetWeights(this.extra.macroTargets, sanitizeParams(this.params));
    return modifierTargetWeights(this.extra.modifiers, this.modifierValues, weights);
  }

  evaluate(previous?: ActorShape): Promise<ActorShape> {
    return this.runtime.evaluate(this.targetWeights(), previous);
  }
}
