import { type ActorShape, ActorRuntime, type BoneScale, type Fetcher, type MessagePortLike, RemoteRuntime, type ShapeOptions } from "@actors/core";
import { type BreedPreset, DEFAULT_COAT, DEFAULT_SHAPE, type DogCoat, type DogParams, type DogShape, breedParams, presetsFor, sanitizeShape } from "./breeds";

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

/** The morph targets each shape value drives; the other values are bone proportions and work on every pack. */
export const SHAPE_TARGETS: Partial<Record<keyof DogShape, string[]>> = {
  earDrop: ["ears-drop", "ears-drop-half"],
  earFold: ["ears-fold", "ears-fold-half"],
  muzzle: ["muzzle-short", "muzzle-long"],
  muzzleBroad: ["muzzle-broad"],
  muzzleDeep: ["muzzle-deep"],
  stop: ["stop"],
  skullDome: ["skull-dome"],
  chestDeep: ["chest-deep"],
  bellyTuck: ["belly-tuck"],
  tailCurl: ["tail-curl", "tail-curl-half"],
  bulk: ["bulk"],
};

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

/** An animal actor (dogs, cats): breed parameters -> target weights and bone scales -> shape. */
export class Animal {
  shape: DogShape = { ...DEFAULT_SHAPE };
  coat: DogCoat = { ...DEFAULT_COAT };
  readonly extra: AnimalExtra;
  private remote?: RemoteRuntime;

  private constructor(readonly runtime: ActorRuntime) {
    const extra = runtime.manifest.extra?.animal as AnimalExtra | undefined;
    if (!extra) throw new Error("Pack has no animal data");
    this.extra = extra;
  }

  static async load(manifestUrl: string, fetcher?: Fetcher): Promise<Animal> {
    return new Animal(await ActorRuntime.load(manifestUrl, fetcher));
  }

  /** Another animal on the same loaded pack (and worker), e.g. for a pack of dogs. */
  static share(other: Animal): Animal {
    const a = new Animal(other.runtime);
    a.remote = other.remote;
    return a;
  }

  get params(): DogParams {
    return { shape: this.shape, coat: this.coat };
  }

  set params(p: DogParams) {
    this.shape = { ...p.shape };
    this.coat = { ...p.coat };
  }

  /** The breed presets for this pack's species (BREEDS for dogs, CAT_BREEDS for cats). */
  get presets(): Record<string, BreedPreset> {
    return presetsFor(this.extra.kind);
  }

  /** Applies a breed preset (see BREEDS and CAT_BREEDS). */
  setBreed(id: string): void {
    this.params = breedParams(id);
  }

  /** Whether a shape value changes this pack (morph-driven values need the pack's targets). */
  supports(key: keyof DogShape): boolean {
    const targets = SHAPE_TARGETS[key];
    if (!targets) return true;
    const available = new Set(this.runtime.manifest.targets.map((t) => t.name));
    return targets.some((t) => available.has(t));
  }

  targetWeights(): Map<string, number> {
    const available = new Set(this.runtime.manifest.targets.map((t) => t.name));
    const w = dogTargetWeights(this.shape);
    for (const k of [...w.keys()]) if (!available.has(k)) w.delete(k);
    return w;
  }

  shapeOptions(): ShapeOptions {
    return dogShapeOptions(this.shape, this.runtime.manifest.skeleton?.bones.map((b) => b.name));
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
