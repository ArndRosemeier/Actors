import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { pickLibraryClip, type LibraryMotion } from "@actors/core";

/**
 * What happens to a clip's ground travel: the root motion baked into it, or, for clips made to play on the
 * spot (most library clips), the speed estimated from its feet (see `LibraryAnimal.speedOf`):
 * - "in-place" (default): the animal stays where its `object` is; `update` still reports how far it would have moved.
 * - "move": the travel is taken out of the clip (if baked in) and applied to `object` (turned by its rotation), so the
 *   animal walks through the world with its feet planted. `update` reports the step too.
 * - "keep": the clip plays as authored: the mesh walks away from `object` and jumps back when the clip loops.
 */
export type RootMotion = "in-place" | "move" | "keep";

export interface LibraryLoadOptions {
  /** URL of the folder that holds the animals: `<baseUrl>/<id>/<id>.glb` (e.g. "./wildmesh3d/" for PrivateAssets' folder served as is). */
  baseUrl: string;
  /** See `RootMotion` (default "in-place"). */
  rootMotion?: RootMotion;
  /** Meshes cast shadows (default true). */
  castShadow?: boolean;
  /** Meshes receive shadows (default false). */
  receiveShadow?: boolean;
  /** Loader to use (e.g. with your own LoadingManager or KTX2 setup). The meshopt decoder is set on it. */
  loader?: GLTFLoader;
  /** Multiplies the LOD switch distances (see `LibraryAnimal.lods`). Default: the animal's length, at least 1. */
  lodScale?: number;
}

/** A detail level of a library animal: from `distance` meters on, the animation is updated every `step` frames. */
export interface LibraryLod {
  name: string;
  distance: number;
  /** Update the animation on every `step`-th call of `update` (time is not lost, just applied in bigger steps). */
  step: number;
  castShadow: boolean;
}

/** Ground travel of one clip, in model space: the motion bone's x/z path, relative to its first key. */
interface Travel {
  times: Float32Array;
  /** x, z per key. */
  path: Float32Array;
  /** Travel over one full loop. */
  dx: number;
  dz: number;
}

interface Source {
  gltf: GLTF;
  clips: Map<string, THREE.AnimationClip>;
  travel: Map<string, Travel>;
  /** Bind-pose bounding box of the scene. */
  box: THREE.Box3;
}

const sources = new Map<string, Promise<Source>>();
let sharedLoader: GLTFLoader | undefined;

const libraryUrl = (baseUrl: string, id: string) => `${baseUrl.replace(/\/?$/, "/")}${id}/${id}.glb`;

/**
 * Loads an animal from the animal library (the WildMesh3D models in the private PrivateAssets
 * repository; ids and clip names are in `LIBRARY_ANIMALS` from `@actors/animal/library`).
 * The file is fetched once per URL and root-motion mode; every further call clones it (shared
 * geometry, textures and clips), so a herd of 30 deer costs one download.
 *
 * ```ts
 * const wolf = await loadLibraryAnimal("wolf", { baseUrl: "./wildmesh3d/", rootMotion: "move" });
 * scene.add(wolf.object);
 * wolf.play(wolf.clipFor("walk")!, { fade: 0.3 });
 * // every frame:
 * wolf.update(dt); // moves wolf.object along the walk, returns the step
 * ```
 */
export async function loadLibraryAnimal(id: string, options: LibraryLoadOptions): Promise<LibraryAnimal> {
  const url = libraryUrl(options.baseUrl, id);
  const mode = options.rootMotion ?? "in-place";
  const key = `${mode}|${url}`;
  let source = sources.get(key);
  if (!source) {
    const loader = options.loader ?? (sharedLoader ??= new GLTFLoader());
    loader.setMeshoptDecoder(MeshoptDecoder);
    source = loader.loadAsync(url).then((gltf) => prepareSource(gltf, mode));
    sources.set(key, source);
    source.catch(() => sources.delete(key));
  }
  const src = await source;
  return new LibraryAnimal(id, cloneSkinned(src.gltf.scene), src, mode, options);
}

/** Forgets the loaded library files (the next load fetches again). Animals already made keep working. */
export function clearLibraryCache(): void {
  sources.clear();
}

function prepareSource(gltf: GLTF, mode: RootMotion): Source {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const clips = new Map<string, THREE.AnimationClip>();
  const travel = new Map<string, Travel>();
  const box = new THREE.Box3().setFromObject(scene);
  const tips = mode === "keep" ? [] : footBones(scene);
  for (const clip of gltf.animations) {
    if (mode !== "keep") {
      const t = extractTravel(scene, clip) ?? estimateTravel(scene, clip, tips, box.max.y - box.min.y);
      if (t) travel.set(clip.name, t);
    }
    clips.set(clip.name, clip);
  }
  return { gltf, clips, travel, box };
}

/**
 * Takes the ground travel (x/z in model space) out of a clip: the topmost bone with a position track
 * (the root, or the pelvis on rigs without one) keeps its height and sway but stays over its first
 * key's spot. Changes the clip's track in place; returns the travel taken out, or undefined when the
 * clip doesn't travel.
 */
export function extractTravel(model: THREE.Object3D, clip: THREE.AnimationClip): Travel | undefined {
  const depth = (o: THREE.Object3D) => {
    let d = 0;
    for (let p = o.parent; p && p !== model; p = p.parent) d++;
    return d;
  };
  const candidates: { track: THREE.KeyframeTrack; node: THREE.Object3D; depth: number }[] = [];
  for (const track of clip.tracks) {
    if (!track.name.endsWith(".position") || track.getInterpolation() === THREE.InterpolateSmooth) continue;
    if (track.ValueTypeName !== "vector" || track.times.length < 2) continue;
    const node = model.getObjectByName(track.name.slice(0, -".position".length));
    if (node?.parent) candidates.push({ track, node, depth: depth(node) });
  }
  candidates.sort((a, b) => a.depth - b.depth);
  model.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  // The topmost bone that travels (some rigs have a root that stays put and move the pelvis instead).
  for (const { track, node, depth: d } of candidates) {
    if (d > candidates[0].depth + 2) break;
    const n = track.times.length;
    // Parent space -> model space, from the bind pose (the bones above the motion bone don't animate).
    const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert().multiply(node.parent!.matrixWorld);
    const values = track.values;
    const path = new Float32Array(n * 2);
    let x0 = 0, z0 = 0, far = 0;
    for (let i = 0; i < n; i++) {
      v.fromArray(values, i * 3).applyMatrix4(toModel);
      if (i === 0) (x0 = v.x), (z0 = v.z);
      path[i * 2] = v.x - x0;
      path[i * 2 + 1] = v.z - z0;
      far = Math.max(far, Math.hypot(path[i * 2], path[i * 2 + 1]));
    }
    // Sway that comes back (clips made to play on the spot) is not travel: those get the feet's speed.
    const net = Math.hypot(path[(n - 1) * 2], path[(n - 1) * 2 + 1]);
    if (far < 0.05 || net < 0.25 * far) continue;
    const toParent = toModel.clone().invert();
    const out = new Float32Array(values.length);
    for (let i = 0; i < n; i++) {
      v.fromArray(values, i * 3).applyMatrix4(toModel);
      v.x = x0;
      v.z = z0;
      v.applyMatrix4(toParent).toArray(out, i * 3);
    }
    track.values = out;
    return { times: Float32Array.from(track.times), path, dx: path[(n - 1) * 2], dz: path[(n - 1) * 2 + 1] };
  }
  return undefined;
}

/** Bone tips that can be feet (toes, hooves, paws, bird feet): leaf bones, without tails and IK helpers. */
export function footBones(model: THREE.Object3D): THREE.Object3D[] {
  const feet: THREE.Object3D[] = [];
  model.traverse((o) => {
    if (!(o as THREE.Bone).isBone || o.children.some((c) => (c as THREE.Bone).isBone)) return;
    if (/tail|ik|target|ref|helper|twist|ear|tongue|jaw|lip|trunk|eye|wing|feather/i.test(o.name)) return;
    feet.push(o);
  });
  return feet;
}

/**
 * Ground speed of a clip, estimated from its feet (for clips made to play on the spot, which most library
 * clips are). The feet are the bone tips that come lowest during the clip; whichever is lowest at a time
 * is on the ground and slides backward under the body as fast as the animal would move forward. A clip
 * whose feet don't come back to their start also moves (its root motion was lost): that drift counts too.
 * Returns the travel as a straight line at that speed (in model space), or undefined when the animal stays
 * put (idles, flying, swimming). The model is put back into the pose it had. `height`: the animal's
 * height, for telling feet from the rest.
 */
export function estimateTravel(model: THREE.Object3D, clip: THREE.AnimationClip, tips: THREE.Object3D[], height: number): Travel | undefined {
  if (tips.length < 2 || clip.duration < 0.2 || !(height > 0)) return undefined;
  const saved: [THREE.Object3D, THREE.Vector3, THREE.Quaternion, THREE.Vector3][] = [];
  model.traverse((o) => saved.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.play();
  const steps = Math.max(8, Math.min(90, Math.round(clip.duration * 30)));
  const dt = clip.duration / steps;
  model.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const at: THREE.Vector3[][] = [];
  for (let k = 0; k <= steps; k++) {
    action.time = k * dt;
    mixer.update(0);
    model.updateMatrixWorld(true);
    at.push(tips.map((f) => new THREE.Vector3().setFromMatrixPosition(f.matrixWorld).applyMatrix4(inverse)));
  }
  action.stop();
  mixer.uncacheRoot(model);
  for (const [o, pos, quat, scale] of saved) {
    o.position.copy(pos);
    o.quaternion.copy(quat);
    o.scale.copy(scale);
  }
  model.updateMatrixWorld(true);
  // Feet: tips that reach within 8% of the animal's height of the lowest point, and move.
  let ground = Infinity;
  for (const frame of at) for (const p of frame) ground = Math.min(ground, p.y);
  const feet: number[] = [];
  tips.forEach((_, f) => {
    let low = Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const frame of at) {
      low = Math.min(low, frame[f].y);
      minZ = Math.min(minZ, frame[f].z);
      maxZ = Math.max(maxZ, frame[f].z);
    }
    if (low <= ground + 0.08 * height && maxZ - minZ > 0.01 * height) feet.push(f);
  });
  if (feet.length < 2) return undefined;
  const vx: number[] = [], vz: number[] = [];
  for (let k = 0; k < steps; k++) {
    let low = feet[0];
    for (const f of feet) if (at[k][f].y < at[k][low].y) low = f;
    vx.push((at[k][low].x - at[k + 1][low].x) / dt);
    vz.push((at[k][low].z - at[k + 1][low].z) / dt);
  }
  const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];
  let sx = median(vx), sz = median(vz);
  // Drift: feet that end up ahead of where they started (a clip whose root motion was lost).
  let driftX = 0, driftZ = 0;
  for (const f of feet) {
    driftX += at[steps][f].x - at[0][f].x;
    driftZ += at[steps][f].z - at[0][f].z;
  }
  sx += driftX / feet.length / clip.duration;
  sz += driftZ / feet.length / clip.duration;
  // Slower than 5 cm/s (or 3% of the height a second, for small animals) is shuffling on the spot.
  if (Math.hypot(sx, sz) < Math.min(0.05, 0.03 * height)) return undefined;
  const d = clip.duration;
  return { times: Float32Array.from([0, d]), path: Float32Array.from([0, 0, sx * d, sz * d]), dx: sx * d, dz: sz * d };
}

/** Travel along a clip between two times of one pass (t0 <= t1). */
function travelBetween(t: Travel, t0: number, t1: number, out: THREE.Vector2): THREE.Vector2 {
  const a = sampleTravel(t, t0), ax = a.x, az = a.y;
  const b = sampleTravel(t, t1);
  return out.set(b.x - ax, b.y - az);
}

const tmp2 = new THREE.Vector2();
function sampleTravel(t: Travel, time: number): THREE.Vector2 {
  const { times, path } = t;
  const n = times.length;
  if (time <= times[0]) return tmp2.set(path[0], path[1]);
  if (time >= times[n - 1]) return tmp2.set(path[(n - 1) * 2], path[(n - 1) * 2 + 1]);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid;
    else hi = mid;
  }
  const f = (time - times[lo]) / (times[hi] - times[lo]);
  return tmp2.set(path[lo * 2] + (path[hi * 2] - path[lo * 2]) * f, path[lo * 2 + 1] + (path[hi * 2 + 1] - path[lo * 2 + 1]) * f);
}

export interface LibraryPlayOptions {
  /** Seconds to cross-fade from the clip playing now (default 0: cut). */
  fade?: number;
  /** Loop (default true). With false the clip plays once and holds its last frame (e.g. death). */
  loop?: boolean;
  /** Playback speed (default 1). */
  speed?: number;
}

/**
 * An animal from the library: a skinned glTF model with its clips, in the same shape as the
 * generated actors where it makes sense (`object`, `mixer`, `play`, `update`, `lods`/`setLod`/`updateLod`,
 * `height`, `dispose`). Made by `loadLibraryAnimal`.
 */
export class LibraryAnimal {
  /** Add this to your scene. Position and rotate it; the animal faces +Z. */
  readonly object = new THREE.Group();
  readonly mixer: THREE.AnimationMixer;
  /** Names of every clip, in the file's order. */
  readonly clipNames: readonly string[];
  readonly lods: LibraryLod[];
  /** Total ground travel reported by `update` since the animal was made (meters, parent space of `object`). */
  readonly travelled = new THREE.Vector3();
  private readonly clips: Map<string, THREE.AnimationClip>;
  private readonly travel: Map<string, Travel>;
  private readonly box: THREE.Box3;
  private action?: THREE.AnimationAction;
  private fading: THREE.AnimationAction[] = [];
  private level = 0;
  private frame = 0;
  private pending = 0;
  private readonly step = new THREE.Vector3();
  private readonly castShadow: boolean;

  constructor(
    readonly id: string,
    /** The cloned glTF scene inside `object`. */
    readonly model: THREE.Object3D,
    source: Pick<Source, "clips" | "travel" | "box">,
    readonly rootMotion: RootMotion = "in-place",
    options: Pick<LibraryLoadOptions, "castShadow" | "receiveShadow" | "lodScale"> = {},
  ) {
    this.object.name = id;
    this.object.add(model);
    this.clips = source.clips;
    this.travel = source.travel;
    this.box = source.box;
    this.clipNames = [...source.clips.keys()];
    this.mixer = new THREE.AnimationMixer(model);
    this.castShadow = options.castShadow ?? true;
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = this.castShadow;
      mesh.receiveShadow = options.receiveShadow ?? false;
      // Clips that keep their travel move the mesh far from its bind-pose bounds.
      if (rootMotion === "keep") mesh.frustumCulled = false;
    });
    const scale = options.lodScale ?? Math.max(1, this.size.z);
    this.lods = [
      { name: "Full", distance: 0, step: 1, castShadow: this.castShadow },
      { name: "Half rate", distance: 25 * scale, step: 2, castShadow: this.castShadow },
      { name: "Quarter rate", distance: 60 * scale, step: 4, castShadow: false },
    ];
  }

  /** Bind-pose size in meters (x width, y height, z length). */
  get size(): THREE.Vector3 {
    return this.box.getSize(new THREE.Vector3());
  }

  /** Height in the bind pose, in meters. */
  height(): number {
    return this.box.max.y - this.box.min.y;
  }

  /** The three.js clip by name (undefined if there is none). */
  clip(name: string): THREE.AnimationClip | undefined {
    return this.clips.get(name);
  }

  /**
   * Ground speed of a clip in meters per second: from the clip's own root motion, or, for clips made to
   * play on the spot, estimated from how fast the planted foot slides back. 0 for clips that don't go
   * anywhere (idles) and with rootMotion "keep".
   */
  speedOf(name: string): number {
    const t = this.travel.get(name);
    const clip = this.clips.get(name);
    return t && clip && clip.duration > 0 ? Math.hypot(t.dx, t.dz) / clip.duration : 0;
  }

  /**
   * The clip that best plays a common motion ("idle", "walk", "run", "eat", "death", ...), guessed from the
   * clip names (they differ between rigs: "WalkFast_F", "G0_Walk", "walk"). See `pickLibraryClip` (`@actors/core`); pass the name to `play`.
   */
  clipFor(motion: LibraryMotion): string | undefined {
    return pickLibraryClip([...this.clips.values()].map((c) => ({ name: c.name, seconds: c.duration, tracks: c.tracks.length })), motion);
  }

  /** The action playing now (for seeking or reading its time). */
  get currentAction(): THREE.AnimationAction | undefined {
    return this.action;
  }

  /** Plays a clip by name (see `clipNames`, `clipFor`). Null stops every clip (bind pose). */
  play(name: string | null, options: LibraryPlayOptions = {}): THREE.AnimationAction | undefined {
    const prev = this.action;
    if (name === null) {
      this.mixer.stopAllAction();
      this.action = undefined;
      this.fading = [];
      return undefined;
    }
    const clip = this.clips.get(name);
    if (!clip) throw new Error(`${this.id} has no clip "${name}" (it has ${this.clipNames.slice(0, 12).join(", ")}${this.clipNames.length > 12 ? ", ..." : ""})`);
    const action = this.mixer.clipAction(clip);
    if (action === prev && action.isRunning()) {
      action.timeScale = options.speed ?? 1;
      return action;
    }
    action.reset();
    action.setLoop(options.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = options.loop === false;
    action.timeScale = options.speed ?? 1;
    action.setEffectiveWeight(1);
    action.play();
    const fade = prev ? (options.fade ?? 0) : 0;
    if (prev && fade > 0) {
      action.crossFadeFrom(prev, fade, false);
      this.fading.push(prev);
    } else {
      for (const a of [prev, ...this.fading]) if (a && a !== action) a.stop();
      this.fading = [];
    }
    this.action = action;
    return action;
  }

  /**
   * Advances the animation by `dt` seconds. Returns this frame's ground travel (meters, in the parent
   * space of `object`, so already turned by its rotation): with rootMotion "move" it has been added to
   * `object.position`; with "in-place" it is only reported (move the animal yourself, or ignore it).
   * Zero with "keep". The vector is reused: copy it to keep it.
   */
  update(dt: number): THREE.Vector3 {
    this.step.set(0, 0, 0);
    this.pending += dt;
    if (++this.frame < this.lods[this.level].step) return this.step;
    this.frame = 0;
    const delta = this.pending;
    this.pending = 0;
    const actions = [this.action, ...this.fading].filter((a): a is THREE.AnimationAction => !!a);
    // Times before the update, and how far each action's clock will run (to count loop wraps).
    const before = actions.map((a) => ({ a, time: a.time, run: a.isRunning() ? delta * a.getEffectiveTimeScale() : 0 }));
    this.mixer.update(delta);
    const d = new THREE.Vector2();
    let x = 0, z = 0;
    for (const { a, time, run } of before) {
      // The weight after the update: right for small steps, and a fresh action's weight is only known after one.
      const weight = a.getEffectiveWeight();
      const t = this.travel.get(a.getClip().name);
      if (!t || weight <= 0 || run <= 0) continue;
      const duration = a.getClip().duration;
      const wraps = a.loop === THREE.LoopRepeat && duration > 0 ? Math.floor((time + run) / duration) : 0;
      if (wraps > 0) {
        // To the end of this pass, whole passes, then from the start to where it is now.
        travelBetween(t, time, duration, d);
        x += (d.x + t.dx * (wraps - 1)) * weight;
        z += (d.y + t.dz * (wraps - 1)) * weight;
        travelBetween(t, 0, a.time, d);
      } else travelBetween(t, time, Math.max(time, a.time), d);
      x += d.x * weight;
      z += d.y * weight;
    }
    this.fading = this.fading.filter((a) => a.getEffectiveWeight() > 0 && a.isRunning());
    if (x !== 0 || z !== 0) {
      this.step.set(x, 0, z).multiply(this.model.scale).applyQuaternion(this.model.quaternion);
      this.step.multiply(this.object.scale).applyQuaternion(this.object.quaternion);
      if (this.rootMotion === "move") this.object.position.add(this.step);
      this.travelled.add(this.step);
    }
    return this.step;
  }

  /** The current detail level (index into `lods`). */
  get lod(): number {
    return this.level;
  }

  /** Switches the detail level (0 = full). Farther levels update the animation less often and drop shadows. */
  setLod(level: number): void {
    level = Math.max(0, Math.min(this.lods.length - 1, Math.round(level)));
    if (level === this.level) return;
    this.level = level;
    const cast = this.lods[level].castShadow;
    this.model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = cast;
    });
  }

  /** Picks the detail level from the camera's distance; `bias` > 1 keeps detail longer. Call once a frame or less. */
  updateLod(camera: THREE.Camera, bias = 1): number {
    const a = new THREE.Vector3().setFromMatrixPosition(this.object.matrixWorld);
    const b = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const distance = a.distanceTo(b);
    let level = 0;
    this.lods.forEach((l, i) => {
      if (distance >= l.distance * bias) level = i;
    });
    this.setLod(level);
    return this.level;
  }

  /** Stops the animation and frees this animal's mixer state. The shared geometry and textures stay loaded for other animals of the same kind. */
  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.object.removeFromParent();
  }
}
