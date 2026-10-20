import { type ActorShape, ActorRuntime, type Fetcher, type MeshData, type MessagePortLike, RemoteRuntime, type ShapeOptions, type SurfaceDelta } from "@actors/core";
import { type UnitWeights, expressionTargetWeights } from "./expressions";
import { type MacroTargetDef, macroTargetWeights } from "./macro";
import { type ModifierDef, modifierTargetWeights } from "./modifiers";
import { DEFAULT_PARAMS, type HumanParams, sanitizeParams } from "./params";
import { type SkinTextureDef, skinTextureWeights } from "./skins";
import { DEFAULT_RACE, type RaceSettings, raceHeadScale, raceScale, raceShapeOptions, raceTargetWeights, sanitizeRace, targetResolver } from "./raceshape";

export interface HumanExtra {
  macroTargets: MacroTargetDef[];
  modifiers: ModifierDef[];
  adultMinAge: number;
  expressionUnits?: string[];
  garmentLabels?: Record<string, string>;
  /** UI and outfit info per garment mesh (labels, groups, body layers). */
  garments?: Record<string, GarmentInfo>;
  /** UV box [u0, v0, u1, v1] of the genital region on the body texture. */
  anatomy?: { genitalsUV: [number, number, number, number] };
  /** Photographic skin textures, blended by gender, age and ethnicity (see skinTextureWeights). */
  skins?: SkinTextureDef[];
  /** Display names of the hair meshes. */
  hairLabels?: Record<string, string>;
  /** Display names of the eyebrow meshes (slot "brows"). */
  browLabels?: Record<string, string>;
}

/** Per-garment info written by the importer. */
export interface GarmentInfo {
  label?: string;
  /** UI group, e.g. "Tops", "Shoes". */
  category?: string;
  /** Body layers the garment takes ("top", "bottom", "shoes", …); garments sharing a layer replace each other. */
  occupies?: string[];
  /** Typical wearer (only used to pick random outfits). */
  gender?: "female" | "male";
  /** Where the asset came from (author, pack, licence). */
  credit?: string;
}

/** A human actor: parameters + detail sliders -> target weights -> shape. */
export class Human {
  params: HumanParams = { ...DEFAULT_PARAMS };
  modifierValues: Record<string, number> = {};
  /** Race (fantasy races and mixes; see races.ts). */
  race: RaceSettings = { ...DEFAULT_RACE };
  readonly extra: HumanExtra;
  /** Bare MakeHuman target name -> this pack's target name. */
  readonly resolveTarget: (bare: string) => string | undefined;

  private constructor(readonly runtime: ActorRuntime) {
    const extra = runtime.manifest.extra?.human as HumanExtra | undefined;
    if (!extra) throw new Error("Pack has no human data");
    this.extra = extra;
    this.resolveTarget = targetResolver(runtime.manifest.targets.map((t) => t.name));
  }

  static async load(manifestUrl: string, fetcher?: Fetcher): Promise<Human> {
    return new Human(await ActorRuntime.load(manifestUrl, fetcher));
  }

  get modifiers(): ModifierDef[] {
    return this.extra.modifiers;
  }

  /** Skin textures to blend for the current parameters (empty if the pack has none). */
  skinTextures(max = 4): { file: string; weight: number }[] {
    return this.extra.skins?.length ? skinTextureWeights(this.extra.skins, this.params, max) : [];
  }

  targetWeights(): Map<string, number> {
    const params = sanitizeParams(this.params);
    const weights = macroTargetWeights(this.extra.macroTargets, params);
    modifierTargetWeights(this.extra.modifiers, this.modifierValues, weights);
    return raceTargetWeights(sanitizeRace(this.race), this.resolveTarget, params.gender, weights);
  }

  /** Proportion passes for the race (bone scales, head scale, ear tips, overall scale). */
  shapeOptions(): ShapeOptions {
    return raceShapeOptions(sanitizeRace(this.race), this.runtime.manifest.skeleton?.bones.map((b) => b.name) ?? [], this.resolveTarget);
  }

  /** How much bigger the face is than on a plain human body (overall scale × head scale), for expression deltas. */
  get faceScale(): number {
    const r = sanitizeRace(this.race);
    return raceScale(r) * raceHeadScale(r);
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

  /**
   * Loads on-demand meshes (e.g. garments with their own data file) on the
   * main thread and in the worker. Evaluate the shape again afterwards so it
   * includes them. Returns the newly loaded meshes.
   */
  async loadMeshes(names: string[]): Promise<MeshData[]> {
    const missing = names.filter((n) => !this.runtime.isLoaded(n));
    if (!missing.length) return [];
    const [loaded] = await Promise.all([this.runtime.loadMeshes(missing), this.remote?.loadMeshes(missing)]);
    return loaded;
  }

  evaluate(previous?: ActorShape): Promise<ActorShape> {
    if (this.remote) return this.remote.evaluate(this.targetWeights(), this.shapeOptions());
    return this.runtime.evaluate(this.targetWeights(), previous, this.shapeOptions());
  }

  /**
   * Surface deltas for face units on top of a shape, e.g. an expression or a
   * blink, for GPU morph targets (see ThreeActor.setMorph).
   */
  async faceDelta(shape: ActorShape, units: UnitWeights, scale = 1): Promise<SurfaceDelta> {
    const available = new Set(this.runtime.manifest.targets.map((t) => t.name));
    const weights = expressionTargetWeights(units, this.params, scale * this.faceScale, available);
    await this.runtime.ensureTargets(weights.keys());
    return this.runtime.surfaceDelta(shape, weights);
  }
}
