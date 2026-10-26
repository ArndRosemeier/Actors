import { type ActorShape, ActorRuntime, type BoneScale, type Fetcher, type MessagePortLike, RemoteRuntime, type ShapeOptions } from "@actors/core";
import { DEFAULT_PRESET, type DogCoat, type DogShape, SHAPE_RANGES, SQUIRRELS, BREEDS, CAT_BREEDS, breedParams, sanitizeShape } from "./breeds";
import { DEER_PRESETS, DEER_SHAPE_RANGES, type DeerCoat, type DeerShape, deerParams, deerShapeOptions, deerTargetWeights } from "./deer";
import { HORSE_PRESETS, HORSE_SHAPE_RANGES, type HorseCoat, type HorseShape, horseParams, horseShapeOptions, horseTargetWeights } from "./horse";
import { COW_PRESETS, COW_SHAPE_RANGES, type CowCoat, type CowShape, cowParams, cowShapeOptions, cowTargetWeights } from "./cow";

/** What the animal importer writes into `manifest.extra.animal`. */
export interface AnimalExtra {
  kind: string;
  /** Base vertices that are drawn; the rest are joint helpers. */
  visibleVertices: number;
  /** Morph target names. */
  morphs: string[];
  /** Where a rider sits (horses): a bone whose head is the lowest point of the saddle's seat. */
  seat?: { bone: string };
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
  set("tail-plume", s.tailPlume);
  set("cheeks", s.cheeks);
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

/** Morphs each morph-driven dog/squirrel shape value needs (a pack without them ignores the value). */
export const SHAPE_MORPHS: Partial<Record<keyof DogShape, string[]>> = {
  earDrop: ["ears-drop"],
  earFold: ["ears-fold"],
  muzzle: ["muzzle-short", "muzzle-long"],
  muzzleBroad: ["muzzle-broad"],
  muzzleDeep: ["muzzle-deep"],
  stop: ["stop"],
  skullDome: ["skull-dome"],
  chestDeep: ["chest-deep"],
  bellyTuck: ["belly-tuck"],
  tailCurl: ["tail-curl"],
  bulk: ["bulk"],
  tailPlume: ["tail-plume"],
  cheeks: ["cheeks"],
};

/** What an animal kind brings: presets, slider ranges, and how a shape becomes morph weights and bone scales. */
export interface Species<S extends object, C extends object> {
  kind: string;
  /** Default preset (the one the base body is modelled on). */
  base: string;
  presets: Record<string, { name: string; shape: Partial<S>; coat: Partial<C> }>;
  ranges: Record<keyof S, [number, number]>;
  /** Morphs each morph-driven shape value needs; values not listed are proportions and always work. */
  morphs?: Partial<Record<keyof S, string[]>>;
  params(id: string): { shape: S; coat: C };
  targetWeights(shape: S): Map<string, number>;
  shapeOptions(shape: S, boneNames?: string[]): ShapeOptions;
}

export const DOG: Species<DogShape, DogCoat> = {
  kind: "dog",
  base: DEFAULT_PRESET.dog,
  presets: BREEDS,
  ranges: SHAPE_RANGES,
  morphs: SHAPE_MORPHS,
  params: (id) => breedParams(id, "dog"),
  targetWeights: dogTargetWeights,
  shapeOptions: dogShapeOptions,
};

/** Squirrels share the dog's rig, bones, shape values and morph names. */
export const SQUIRREL: Species<DogShape, DogCoat> = {
  ...DOG,
  kind: "squirrel",
  base: DEFAULT_PRESET.squirrel,
  presets: SQUIRRELS,
  params: (id) => breedParams(id, "squirrel"),
};

/** Cats share the dog's rig, bones and shape values too (morphs the cat pack lacks are hidden by `supports`). */
export const CAT: Species<DogShape, DogCoat> = {
  ...DOG,
  kind: "cat",
  base: DEFAULT_PRESET.cat,
  presets: CAT_BREEDS,
  params: (id) => breedParams(id, "cat"),
};

export const DEER: Species<DeerShape, DeerCoat> = {
  kind: "deer",
  base: DEFAULT_PRESET.deer,
  presets: DEER_PRESETS,
  ranges: DEER_SHAPE_RANGES,
  params: deerParams,
  targetWeights: deerTargetWeights,
  shapeOptions: deerShapeOptions,
};

export const HORSE: Species<HorseShape, HorseCoat> = {
  kind: "horse",
  base: DEFAULT_PRESET.horse,
  presets: HORSE_PRESETS,
  ranges: HORSE_SHAPE_RANGES,
  params: horseParams,
  targetWeights: horseTargetWeights,
  shapeOptions: horseShapeOptions,
};

export const COW: Species<CowShape, CowCoat> = {
  kind: "cow",
  base: DEFAULT_PRESET.cow,
  presets: COW_PRESETS,
  ranges: COW_SHAPE_RANGES,
  params: cowParams,
  targetWeights: cowTargetWeights,
  shapeOptions: cowShapeOptions,
};

/** Species by pack kind (`manifest.extra.animal.kind`). */
export const SPECIES: Record<string, Species<object, object>> = { dog: DOG as never, squirrel: SQUIRREL as never, cat: CAT as never, deer: DEER as never, horse: HORSE as never, cow: COW as never };

/**
 * An animal actor: shape parameters -> target weights and bone scales -> shape.
 * The species (dog, squirrel, cat, deer, horse, cow) comes from the pack; the type parameters only give
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

  /** The presets for this kind of animal (dog breeds, squirrel or deer species). */
  get presets(): Record<string, { name: string; shape: Partial<S>; coat: Partial<C> }> {
    return this.species.presets;
  }

  /** Whether a shape value does anything on this pack (its morphs are there, or it is a proportion). */
  supports(key: keyof S): boolean {
    const need = this.species.morphs?.[key];
    if (!need) return true;
    const have = new Set(this.runtime.manifest.targets.map((t) => t.name));
    return need.some((n) => have.has(n));
  }

  /**
   * Loads the pack once per page: later calls with the same URL (and fetcher)
   * reuse the loaded data, so only the first one downloads anything.
   * `fresh` loads a private copy instead.
   */
  static async load<S extends object = DogShape, C extends object = DogCoat>(manifestUrl: string, fetcher?: Fetcher, fresh = false): Promise<Animal<S, C>> {
    return new Animal<S, C>(await (fresh ? ActorRuntime.load(manifestUrl, fetcher) : ActorRuntime.shared(manifestUrl, fetcher)));
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

  /** Applies a preset (dog or cat breed, squirrel or deer species; see `presets`). */
  setPreset(id: string): void {
    this.params = this.species.params(id);
  }

  /** Applies a preset; the same as setPreset. */
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

/** A horse actor (see HORSE). Its tack meshes (`saddlecloth`, `saddle`, `stirrups`, `bridle`, `bit`) are optional: show them with `ThreeActor.setVisible`. */
export type Horse = Animal<HorseShape, HorseCoat>;
