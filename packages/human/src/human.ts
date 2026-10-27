import { type ActorShape, ActorRuntime, type Fetcher, type MeshData, type MessagePortLike, type PartMesh, RemoteRuntime, type ShapeOptions, type SurfaceDelta } from "@actors/core";
import { type UnitWeights, expressionTargetWeights } from "./expressions";
import { type MacroTargetDef, macroTargetWeights } from "./macro";
import { type ModifierDef, modifierTargetWeights } from "./modifiers";
import { muscleTargetWeights } from "./muscle";
import { DEFAULT_PARAMS, type HumanParams, sanitizeParams } from "./params";
import { type SkinTextureDef, skinTextureWeights } from "./skins";
import { DEFAULT_RACE, EAR_MASKS, type RaceSettings, raceHeadScale, raceScale, raceShapeOptions, raceTargetWeights, sanitizeRace, targetResolver } from "./raceshape";
import { type PartsConfig, hasParts } from "./parts";
import { EXTRAS_TASK, type Extras, type ExtrasArgs, type PartTargets, partsFor } from "./extras";
import { ROBOT_TASK, type RobotConfig, type RobotParts, buildRobot, robotBody } from "./robot";
import { SKELETAL_TASK, type SkeletalConfig, type SkeletalParts, buildSkeletal } from "./skeletal";

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

  /**
   * Loads the pack once per page: later calls with the same URL (and fetcher)
   * reuse the loaded data, so only the first one downloads anything.
   * `fresh` loads a private copy instead.
   */
  static async load(manifestUrl: string, fetcher?: Fetcher, fresh = false): Promise<Human> {
    return new Human(await (fresh ? ActorRuntime.load(manifestUrl, fetcher) : ActorRuntime.shared(manifestUrl, fetcher)));
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
    const cfg = this.partsConfig(config);
    if (!hasParts(cfg)) return [];
    const made = this.made;
    if (made?.shape === shape && made.parts && made.partsKey === JSON.stringify(cfg)) {
      const parts = made.parts;
      made.parts = null; // handed over once (the caller owns the buffers)
      return parts;
    }
    return partsFor(this.runtime, shape, cfg, this.partTargets());
  }

  private partsConfig(config: Omit<PartsConfig, "scale">): PartsConfig {
    return { ...config, scale: raceScale(sanitizeRace(this.race)) };
  }

  private partTargets(): PartTargets {
    return { l: this.resolveTarget(EAR_MASKS.l), r: this.resolveTarget(EAR_MASKS.r), lip: this.resolveTarget("mouth-upperlip-volume-incr") };
  }

  /**
   * Parts and face deltas the next shapes will be asked for (`parts`, `faceDelta` with these
   * arguments): with a worker they are built there together with each shape from `evaluate`, so
   * asking for them then costs the main thread nothing. Null: none ahead. Set it, like `params`,
   * before `evaluate`.
   */
  extras: { parts: Omit<PartsConfig, "scale"> | null; faces: { units: UnitWeights; scale?: number }[] } | null = null;
  /** What the worker built with the last shape (see `extras`). */
  private made: { shape: ActorShape; partsKey: string; parts: PartMesh[] | null; faces: Map<string, SurfaceDelta> } | null = null;

  /** Pack target weights of face units, for this body and race (see `faceDelta`). */
  private faceWeights(units: UnitWeights, scale: number): Map<string, number> {
    const available = new Set(this.runtime.manifest.targets.map((t) => t.name));
    return expressionTargetWeights(units, this.params, scale * this.faceScale, available);
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
   * Skeleton (undead) parts for a shape from `evaluate`: every bone, skinned
   * rigidly to the pack skeleton (see skeletal.ts). Draw them instead of the
   * body's own meshes.
   */
  skeletal(shape: ActorShape, config: Partial<SkeletalConfig>): SkeletalParts {
    const body = robotBody(shape, this.runtime.meshes);
    return body ? buildSkeletal(body, config) : { parts: [], lift: 0 };
  }

  /** Skeleton build options: while set, every `evaluate` also builds the skeleton's parts (see `robotConfig`). */
  skeletalConfig: Partial<SkeletalConfig> | null = null;
  /** Skeleton parts of the last evaluated shape (see `skeletalConfig`). */
  skeletalParts: SkeletalParts | null = null;

  /**
   * Meshes the next shapes are needed for (e.g. the body and what is worn): only their
   * garments and hair are fitted (see ActorRuntime.evaluateLoaded). Null: every loaded mesh.
   */
  fit: string[] | null = null;

  async evaluate(previous?: ActorShape): Promise<ActorShape> {
    const robot = this.robotConfig;
    const fit = this.fit ?? undefined;
    const skeletal = robot ? null : this.skeletalConfig;
    if (this.remote && robot) {
      const { shape, task } = await this.remote.evaluateWith<RobotParts>(this.targetWeights(), this.shapeOptions(), { name: ROBOT_TASK, args: robot }, fit);
      this.robotParts = task;
      this.skeletalParts = null;
      return shape;
    }
    if (this.remote && skeletal) {
      const { shape, task } = await this.remote.evaluateWith<SkeletalParts>(this.targetWeights(), this.shapeOptions(), { name: SKELETAL_TASK, args: skeletal }, fit);
      this.skeletalParts = task;
      this.robotParts = null;
      return shape;
    }
    const extras = this.remote && !robot && !skeletal ? this.extrasArgs() : null;
    if (this.remote && extras) {
      const { shape, task } = await this.remote.evaluateWith<Extras>(this.targetWeights(), this.shapeOptions(), { name: EXTRAS_TASK, args: extras.args }, fit);
      this.made = { shape, partsKey: extras.partsKey, parts: task.parts, faces: new Map(task.faces) };
      this.robotParts = null;
      this.skeletalParts = null;
      return shape;
    }
    const shape = this.remote ? await this.remote.evaluate(this.targetWeights(), this.shapeOptions(), fit) : await this.runtime.evaluate(this.targetWeights(), previous, this.shapeOptions(), fit);
    this.robotParts = robot ? this.robot(shape, robot) : null;
    this.skeletalParts = skeletal ? this.skeletal(shape, skeletal) : null;
    return shape;
  }

  /** The worker task's arguments for `extras` (null: nothing asked ahead). */
  private extrasArgs(): { args: ExtrasArgs; partsKey: string } | null {
    const x = this.extras;
    if (!x) return null;
    const cfg = x.parts ? this.partsConfig(x.parts) : null;
    const parts = cfg && hasParts(cfg) ? { cfg, names: this.partTargets() } : null;
    const faces = x.faces.map(({ units, scale }) => [...this.faceWeights(units, scale ?? 1)]).filter((w) => w.length);
    if (!parts && !faces.length) return null;
    return { args: { parts, faces: faces.map((w) => [JSON.stringify(w), w]) }, partsKey: JSON.stringify(cfg) };
  }

  /**
   * Surface deltas for face units on top of a shape, e.g. an expression or a
   * blink, for GPU morph targets (see ThreeActor.setMorph).
   */
  async faceDelta(shape: ActorShape, units: UnitWeights, scale = 1): Promise<SurfaceDelta> {
    const weights = this.faceWeights(units, scale);
    const made = this.made, key = JSON.stringify([...weights]);
    const ahead = made?.shape === shape ? made.faces.get(key) : undefined;
    if (ahead) {
      made!.faces.delete(key); // handed over once (the caller owns the buffers)
      return ahead;
    }
    await this.runtime.ensureTargets(weights.keys());
    return this.runtime.surfaceDelta(shape, weights);
  }
}
