import { type ActorShape, ActorRuntime, type BoneScale, type Fetcher, type MessagePortLike, RemoteRuntime, type ShapeOptions } from "@actors/core";
import { BREEDS, type DogCoat, type DogShape, SHAPE_RANGES, breedParams, sanitizeShape } from "./breeds";
import { DEER_PRESETS, DEER_SHAPE_RANGES, type DeerCoat, type DeerShape, deerParams, deerShapeOptions, deerTargetWeights } from "./deer";

/** What the animal importer writes into `manifest.extra.animal`. */
export interface AnimalExtra {
  kind: string;
  /** Base vertices that are drawn; the rest are joint helpers. */
  visibleVertices: number;
  /** Morph target names. */
  morphs: string[];
}

const SIDES = ["L", "R"];
const each = (names: string[]) => names.flatMap((n) => SIDES.map((s) => `${n}_${s}`));

/** Morph weights for a shape (target name -> weight). */
export function dogTargetWeights(shape: DogShape): Map<string, number> {
  const s = sanitizeShape(shape);
  const w = new Map<string, number>();
  const set = (name: string, v: number) => {
    if (v > 1e-4) w.set(name, v);
  };
  // Big rotations go through an in-between target ("-half") so the flap keeps its shape on the way.
  const staged = (name: string, t: number) => {
    set(`${name}-half`, t <= 0.5 ? 2 * t : 2 - 2 * t);
    set(name, t <= 0.5 ? 0 : 2 * t - 1);
  };
  staged("ears-drop", s.earDrop);
  staged("ears-fold", s.earFold * (1 - s.earDrop));
  set("muzzle-short", -s.muzzle);
  set("muzzle-long", s.muzzle);
  set("muzzle-broad", s.muzzleBroad);
  set("muzzle-deep", s.muzzleDeep);
  set("stop", s.stop);
  set("skull-dome", s.skullDome);
  set("chest-deep", s.chestDeep);
  set("belly-tuck", s.bellyTuck);
  staged("tail-curl", s.tailCurl);
  // "bulk" adds 25 %; below 1 it runs backwards (slimmer).
  const bulk = (s.bulk - 1) / 0.25;
  if (Math.abs(bulk) > 1e-4) w.set("bulk", bulk);
  return w;
}

/** Bone proportions and overall size for a shape (see @actors/core applyBoneScales). */
export function dogShapeOptions(shape: DogShape, boneNames?: string[]): ShapeOptions {
  const s = sanitizeShape(shape);
  const bones: Record<string, BoneScale> = {};
  const put = (names: string[], scale: BoneScale) => {
    for (const n of names) bones[n] = { len: (bones[n]?.len ?? 1) * (scale.len ?? 1), girth: (bones[n]?.girth ?? 1) * (scale.girth ?? 1) };
  };
  // Leg length lives in the long bones; the shoulder blade and pelvis follow a little.
  // Short-legged breeds (chondrodysplasia) lose forearm and shank length; the upper bones, with the big
  // muscle masses around them, keep theirs (they only grow for long legs).
  put(each(["Front_Leg_Lower", "Back_Leg_Lower"]), { len: s.legs ** 1.4, girth: s.bone });
  put(each(["Back_Leg_Ankle"]), { len: s.legs ** 1.2, girth: s.bone });
  put(each(["Front_Leg_Upper", "Back_Leg_Upper"]), { len: Math.max(1, s.legs) ** 0.8, girth: s.bone });
  put(each(["Front_Leg_Ankle", "Front_Leg_Foot", "Front_Leg_Tip", "Back_Leg_Foot", "Back_Leg_Foot_1", "Back_Leg_Tip"]), { len: Math.sqrt(s.legs), girth: s.bone });
  put(each(["Front_Leg_Shoulder", "Back_Leg_Pelvis"]), { len: Math.max(1, s.legs) ** 0.3 });
  put(["Spine_1", "Spine_2"], { len: s.body });
  // Torso bulk is a morph ("bulk"): girth about the spine, which runs along the back, would bend the belly.
  put(["Spine_3", "Spine_4"], { len: s.neck });
  put(["Head", "Nose", "Head.tip", "Chin", "Chin_Tip"], { len: s.head, girth: s.head });
  put(each(["Ear", "Ear_Tip"]), { len: s.ears, girth: Math.sqrt(s.ears) });
  put(["Tail_Base", "Tail_Mid", "Tail_Mid.001", "Tail_End", "Tail_Tip"], { len: s.tail, girth: s.tail ** 0.3 });
  if (boneNames) {
    const known = new Set(boneNames);
    for (const n of Object.keys(bones)) if (!known.has(n)) delete bones[n];
  }
  return { bones, scale: s.size };
}

/** What an animal kind brings: presets, slider ranges, and how a shape becomes morph weights and bone scales. */
export interface Species<S extends object, C extends object> {
  kind: string;
  /** Default preset (the one the base body is modelled on). */
  base: string;
  presets: Record<string, { name: string; shape: Partial<S>; coat: Partial<C> }>;
  ranges: Record<keyof S, [number, number]>;
  params(id: string): { shape: S; coat: C };
  targetWeights(shape: S): Map<string, number>;
  shapeOptions(shape: S, boneNames?: string[]): ShapeOptions;
}

export const DOG: Species<DogShape, DogCoat> = {
  kind: "dog",
  base: "wolfdog",
  presets: BREEDS,
  ranges: SHAPE_RANGES,
  params: breedParams,
  targetWeights: dogTargetWeights,
  shapeOptions: dogShapeOptions,
};

export const DEER: Species<DeerShape, DeerCoat> = {
  kind: "deer",
  base: "sika",
  presets: DEER_PRESETS,
  ranges: DEER_SHAPE_RANGES,
  params: deerParams,
  targetWeights: deerTargetWeights,
  shapeOptions: deerShapeOptions,
};

/** Species by pack kind (`manifest.extra.animal.kind`). */
export const SPECIES: Record<string, Species<object, object>> = { dog: DOG as never, deer: DEER as never };

/**
 * An animal actor: shape parameters -> target weights and bone scales -> shape.
 * The species (dog, deer) comes from the pack; the type parameters only give
 * `shape` and `coat` their types, e.g. `Animal.load<DeerShape, DeerCoat>(url)`.
 */
export class Animal<S extends object = DogShape, C extends object = DogCoat> {
  shape: S;
  coat: C;
  readonly extra: AnimalExtra;
  readonly species: Species<S, C>;
  private remote?: RemoteRuntime;

  private constructor(readonly runtime: ActorRuntime) {
    const extra = runtime.manifest.extra?.animal as AnimalExtra | undefined;
    if (!extra) throw new Error("Pack has no animal data");
    this.extra = extra;
    const species = SPECIES[extra.kind];
    if (!species) throw new Error(`Unknown animal kind ${extra.kind}`);
    this.species = species as unknown as Species<S, C>;
    ({ shape: this.shape, coat: this.coat } = this.species.params(this.species.base));
  }

  static async load<S extends object = DogShape, C extends object = DogCoat>(manifestUrl: string, fetcher?: Fetcher): Promise<Animal<S, C>> {
    return new Animal<S, C>(await ActorRuntime.load(manifestUrl, fetcher));
  }

  /** Another animal on the same loaded pack (and worker), e.g. for a herd. */
  static share<S extends object, C extends object>(other: Animal<S, C>): Animal<S, C> {
    const a = new Animal<S, C>(other.runtime);
    a.remote = other.remote;
    return a;
  }

  get kind(): string {
    return this.extra.kind;
  }

  get params(): { shape: S; coat: C } {
    return { shape: this.shape, coat: this.coat };
  }

  set params(p: { shape: S; coat: C }) {
    this.shape = { ...p.shape };
    this.coat = { ...p.coat };
  }

  /** Applies a preset (dog breed, deer species; see `species.presets`). */
  setPreset(id: string): void {
    this.params = this.species.params(id);
  }

  /** Applies a breed preset (see BREEDS); the same as setPreset. */
  setBreed(id: string): void {
    this.setPreset(id);
  }

  targetWeights(): Map<string, number> {
    const available = new Set(this.runtime.manifest.targets.map((t) => t.name));
    const w = this.species.targetWeights(this.shape);
    for (const k of [...w.keys()]) if (!available.has(k)) w.delete(k);
    return w;
  }

  shapeOptions(): ShapeOptions {
    return this.species.shapeOptions(this.shape, this.runtime.manifest.skeleton?.bones.map((b) => b.name));
  }

  /** Evaluate shapes in a Web Worker running `@actors/animal/worker`. */
  async useWorker(worker: MessagePortLike): Promise<void> {
    const url = typeof location !== "undefined" ? new URL(this.runtime.manifestUrl, location.href).href : this.runtime.manifestUrl;
    this.remote = await RemoteRuntime.connect(worker, url);
  }

  get usesWorker(): boolean {
    return !!this.remote;
  }

  async evaluate(previous?: ActorShape): Promise<ActorShape> {
    return this.remote ? this.remote.evaluate(this.targetWeights(), this.shapeOptions()) : this.runtime.evaluate(this.targetWeights(), previous, this.shapeOptions());
  }
}

/** A deer actor (see DEER). */
export type Deer = Animal<DeerShape, DeerCoat>;
