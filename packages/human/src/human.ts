import { type ActorShape, ActorRuntime, type Fetcher, type MessagePortLike, RemoteRuntime, type SurfaceDelta } from "@actors/core";
import { type UnitWeights, expressionTargetWeights } from "./expressions";
import { type MacroTargetDef, macroTargetWeights } from "./macro";
import { type ModifierDef, modifierTargetWeights } from "./modifiers";
import { DEFAULT_PARAMS, type HumanParams, sanitizeParams } from "./params";

export interface HumanExtra {
  macroTargets: MacroTargetDef[];
  modifiers: ModifierDef[];
  adultMinAge: number;
  expressionUnits?: string[];
  garmentLabels?: Record<string, string>;
  /** UV box [u0, v0, u1, v1] of the genital region on the body texture. */
  anatomy?: { genitalsUV: [number, number, number, number] };
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

  private remote?: RemoteRuntime;

  /**
   * Evaluate shapes in a Web Worker (running `@actors/human/worker`) so slider
   * drags never block rendering. The main-thread runtime is still used for
   * mesh data, clips and expression deltas.
   */
  async useWorker(worker: MessagePortLike): Promise<void> {
    const url = typeof location !== "undefined" ? new URL(this.runtime.manifestUrl, location.href).href : this.runtime.manifestUrl;
    this.remote = await RemoteRuntime.connect(worker, url);
  }

  get usesWorker(): boolean {
    return !!this.remote;
  }

  evaluate(previous?: ActorShape): Promise<ActorShape> {
    if (this.remote) return this.remote.evaluate(this.targetWeights());
    return this.runtime.evaluate(this.targetWeights(), previous);
  }

  /**
   * Surface deltas for face units on top of a shape, e.g. an expression or a
   * blink, for GPU morph targets (see ThreeActor.setMorph).
   */
  async faceDelta(shape: ActorShape, units: UnitWeights, scale = 1): Promise<SurfaceDelta> {
    const available = new Set(this.runtime.manifest.targets.map((t) => t.name));
    const weights = expressionTargetWeights(units, this.params, scale, available);
    await this.runtime.ensureTargets(weights.keys());
    return this.runtime.surfaceDelta(shape, weights);
  }
}
