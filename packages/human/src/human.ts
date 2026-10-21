import { type ActorShape, ActorRuntime, type Fetcher, type MeshData, type MessagePortLike, type PartMesh, RemoteRuntime, type ShapeOptions, type SurfaceDelta } from "@actors/core";
import { type UnitWeights, expressionTargetWeights } from "./expressions";
import { type MacroTargetDef, macroTargetWeights } from "./macro";
import { type ModifierDef, modifierTargetWeights } from "./modifiers";
import { muscleTargetWeights } from "./muscle";
import { DEFAULT_PARAMS, type HumanParams, sanitizeParams } from "./params";
import { type SkinTextureDef, skinTextureWeights } from "./skins";
import { DEFAULT_RACE, EAR_MASKS, type RaceSettings, raceHeadScale, raceScale, raceShapeOptions, raceTargetWeights, sanitizeRace, targetResolver } from "./raceshape";
import { type PartsConfig, buildParts, hasParts, partsBody } from "./parts";
import { ROBOT_TASK, type RobotConfig, type RobotParts, buildRobot, robotBody } from "./robot";

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
  /** Author, pack and licence of the community hairstyles (CC-BY ones must be credited). */
  hairCredits?: Record<string, string>;
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
  /** Author to credit, for CC-BY assets. */
  author?: string;
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

  /** Another human on the same loaded pack (and worker): for crowds, each actor needs no download of its own. */
  static share(other: Human): Human {
    const h = new Human(other.runtime);
    h.remote = other.remote;
    return h;
  }

  get modifiers(): ModifierDef[] {
    return this.extra.modifiers;
  }

  /** Skin textures to blend for the current parameters (empty if the pack has none). */
  skinTextures(max = 4): { file: string; weight: number }[] {
    return this.extra.skins?.length ? skinTextureWeights(this.extra.skins, this.params, max) : [];
  }

  /** Mean sRGB colour of the blended photo skin (see skinTextures), or null if the pack has no tones. */
  skinTextureTone(params: HumanParams = this.params, max = 4): [number, number, number] | null {
    const skins = this.extra.skins ?? [];
    const out: [number, number, number] = [0, 0, 0];
    for (const { file, weight } of skins.length ? skinTextureWeights(skins, params, max) : []) {
      const tone = skins.find((s) => s.file === file)?.tone;
      if (!tone) return null;
      for (let c = 0; c < 3; c++) out[c] += tone[c] * weight;
    }
    return out[0] + out[1] + out[2] > 0 ? out : null;
  }

  targetWeights(): Map<string, number> {
    const params = sanitizeParams(this.params);
    const weights = macroTargetWeights(this.extra.macroTargets, params);
    modifierTargetWeights(this.extra.modifiers, this.modifierValues, weights);
    muscleTargetWeights(params.muscle, params.gender, this.resolveTarget, weights);
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
    // The worker is asked even when the main thread has them: another human sharing this pack
    // through its own worker may have loaded them (each worker skips what it already has).
    const [loaded] = await Promise.all([missing.length ? this.runtime.loadMeshes(missing) : [], names.length ? this.remote?.loadMeshes(names) : undefined]);
    return loaded;
  }

  /**
   * Horns, tusks, tail, beard and procedural hair for a shape from `evaluate`
   * (see parts.ts). Skinned to the pack skeleton, in the shape's model space.
   */
  async parts(shape: ActorShape, config: Omit<PartsConfig, "scale">): Promise<PartMesh[]> {
    const cfg = { ...config, scale: raceScale(sanitizeRace(this.race)) };
    if (!hasParts(cfg)) return [];
    const names = { l: this.resolveTarget(EAR_MASKS.l), r: this.resolveTarget(EAR_MASKS.r), lip: this.resolveTarget("mouth-upperlip-volume-incr") };
    const wanted = Object.values(names).filter((n): n is string => !!n);
    await this.runtime.ensureTargets(wanted);
    const mask = (n?: string) => (n ? this.runtime.targetMask(n) : null);
    const ears = names.l && names.r ? ([mask(names.l)!, mask(names.r)!] as [Float32Array, Float32Array]) : null;
    const body = partsBody(shape, this.runtime.meshes, ears, mask(names.lip));
    return body ? buildParts(body, cfg) : [];
  }

  /**
   * Robot parts for a shape from `evaluate`: plates, frame, joints, head and
   * lights, skinned to the pack skeleton (see robot.ts). Draw them instead of
   * the body's own meshes.
   */
  robot(shape: ActorShape, config: Partial<RobotConfig>): RobotParts {
    const body = robotBody(shape, this.runtime.meshes);
    return body ? buildRobot(body, config) : { parts: [], lift: 0 };
  }

  /**
   * Robot build options: while set, every `evaluate` also builds the robot's
   * parts for the new shape (in the worker when one is used); read them from
   * `robotParts`. Null: no robot parts.
   */
  robotConfig: Partial<RobotConfig> | null = null;
  /** Robot parts of the last evaluated shape (see `robotConfig`). */
  robotParts: RobotParts | null = null;

  /**
   * Meshes the next shapes are needed for (e.g. the body and what is worn): only their
   * garments and hair are fitted (see ActorRuntime.evaluateLoaded). Null: every loaded mesh.
   */
  fit: string[] | null = null;

  async evaluate(previous?: ActorShape): Promise<ActorShape> {
    const robot = this.robotConfig;
    const fit = this.fit ?? undefined;
    if (this.remote && robot) {
      const { shape, task } = await this.remote.evaluateWith<RobotParts>(this.targetWeights(), this.shapeOptions(), { name: ROBOT_TASK, args: robot }, fit);
      this.robotParts = task;
      return shape;
    }
    const shape = this.remote ? await this.remote.evaluate(this.targetWeights(), this.shapeOptions(), fit) : await this.runtime.evaluate(this.targetWeights(), previous, this.shapeOptions(), fit);
    this.robotParts = robot ? this.robot(shape, robot) : null;
    return shape;
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
