/**
 * Crowd figures: many people drawn from a few baked bodies.
 *
 * A full `ThreeActor` keeps its own vertex buffers for every mesh and level (several MB a person),
 * which is right for the few people near the camera and far too much for two ships' crews. A crowd
 * figure is the crowd level's merged mesh (`LodDef.merge`: body, garments and hair in one draw)
 * baked once per *kind* (a build in an outfit) in its bind pose, and drawn as instances:
 *
 * - **Builds** (`addBuild`): a body shape. Its clips are baked once into a pose atlas (a float
 *   array texture: per frame, the skinning matrix of each bone the crowd level keeps), so every man
 *   of every kind on that build animates on the GPU from the same rows, at no CPU cost a man.
 *   The bones and clips are the full character's own (`ThreeActor.toThreeClip`), so a full
 *   character and a crowd figure playing the same clip at the same time stand in the same pose.
 * - **Kinds** (`addKind`): the merged mesh of a build in an outfit, garment colours baked into its
 *   vertices, plus optional pieces each man shows or not (hats, hairstyles: `CrowdKindOptions.options`).
 *   One draw call and one shadow draw per kind, whatever the number of men.
 * - **Men** (`add`): an instance of a kind with its own place, height (the matrix's scale), skin,
 *   hair and up to three garment-group colours, the pieces it shows, its clip and phase, a
 *   cross-fade between two clips, and an opacity for handing over to a full character (dithered,
 *   so nothing is sorted). A man can also take a pose from outside (`pose`, `poseFrom`: a procedural
 *   climb, a full character's skeleton) through a few live rows of the atlas.
 *
 * Everything per man lives in one float texture (`TEXELS` texels a man), rewritten by `update` each
 * frame; the material (`createNodeCrowdFigureMaterial` in `@actors/three/webgpu`) reads the man's row
 * by instance index, the bones' rows from the atlas, and skins the figure itself.
 */
import * as THREE from "three";
import { lodBoneMap, type Pose } from "@actors/core";
import type { PlayableClip, ThreeActor } from "./index";

/** Texels (RGBA float) of one man in the instance texture. */
export const CROWD_TEXELS = 10;
/** Texel of each field in a man's row (see the material). */
export const CROWD_ROW = { matrix: 0, poseA: 3, poseB: 4, skin: 5, hair: 6, tints: 7 } as const;
/** Colour slot of a figure vertex (attribute `crowdFigure`.x): its baked colour, the man's skin, hair, or one of his three garment-group colours. */
export const CROWD_SLOT = { baked: 0, skin: 1, hair: 2, tint: 3 } as const;
/** Most garment groups a kind recolours per man. */
export const CROWD_TINTS = 3;
/** Most hair textures (alpha-cut cards) in one kind. */
export const CROWD_HAIR_MAPS = 4;
/** Most optional pieces in one kind (bits of a float, exact to 24). */
export const CROWD_OPTIONS = 20;
/** The bind pose, baked with every build as a one-frame clip (what a man playing nothing stands in). */
export const CROWD_BIND = "(bind)";
/** Frames (atlas rows) per layer of the pose atlas. */
export const CROWD_ATLAS_ROWS = 256;

/** One piece of a figure: a vertex range of a crowd mesh (or an extra mesh), in the bind pose of its build. */
export interface CrowdPiece {
  /** The pack mesh it came from (garment, hair, body or eyes). */
  name: string;
  role: string;
  positions: Float32Array;
  normals: Float32Array;
  uv: Float32Array;
  /** Linear RGB per vertex. */
  colors: Float32Array;
  /** 1 where the vertex shows the skin. */
  skin: Float32Array;
  /** Hem cut (cut away where the interpolated value is below 0). */
  clip: Float32Array;
  /** Pack bone indices and weights, four per vertex. */
  joints: Uint16Array;
  weights: Float32Array;
  indices: Uint32Array;
  /** Hair cards: the texture whose alpha cuts them. */
  hairMap: THREE.Texture | null;
}

/** A body shape and its clips baked into the pose atlas. */
export interface CrowdBuild {
  readonly name: string;
  /** Pack bone of each atlas bone (the crowd level's bones). */
  readonly bones: number[];
  /** Per pack bone: its atlas bone (itself or its nearest kept ancestor). */
  readonly boneOf: Int32Array;
  /** Pack skeleton: names and parents, bind-pose locals and inverse bind matrices (root space), for live poses. */
  readonly names: string[];
  readonly parents: Int32Array;
  readonly restPositions: Float32Array;
  readonly restRotations: Float32Array;
  readonly inverses: Float32Array;
  /** Lowest point of the body below the root: the figure's feet stand at the man's origin. */
  readonly ground: number;
  /** Clips by name: first atlas frame (set when the atlas is laid out), frame count and seconds. */
  readonly clips: Map<string, { frames: Float32Array; first: number; count: number; duration: number; loop: boolean }>;
}

/** A baked figure: one draw per kind. */
export interface CrowdKind {
  readonly name: string;
  readonly build: CrowdBuild;
  readonly mesh: THREE.Mesh;
  /** Optional piece names: bit `i` of a man's `show` mask is `options[i]`. */
  readonly options: string[];
  /** Hair textures the figure's cards are cut by (`crowdFigure`.w - 1). */
  readonly hairMaps: THREE.Texture[];
  /** First row in the instance texture, and the most men of this kind. */
  readonly first: number;
  readonly max: number;
  /** Men of this kind, in row order. */
  readonly men: CrowdMan[];
  /** Bytes of its geometry. */
  readonly bytes: number;
}

/** What a man looks like within his kind. Colours are as `THREE.Color` takes them (hex strings are sRGB). */
export interface CrowdLook {
  skin?: THREE.ColorRepresentation;
  hair?: THREE.ColorRepresentation;
  /** Colours of the kind's garment groups (`CrowdKindOptions.tints`), in order. */
  tints?: THREE.ColorRepresentation[];
  /** Optional pieces he shows (names from the kind's `options`). */
  show?: readonly string[];
}

interface ClipState {
  name: string;
  time: number;
  speed: number;
}

/** What fades out: a clip, or the man's live pose ("live", whose slot is kept until the fade ends). */
type Fading = ClipState | "live";

/** One man of a kind (see `CrowdFigures.add`). */
export class CrowdMan {
  /** His place in the kind's mesh frame: position, turn and scale (a height 3 % above his build's is a scale of 1.03). Call `CrowdFigures.update` after changing it. */
  readonly matrix = new THREE.Matrix4();
  /** @internal Row within his kind. */
  row = 0;
  /** @internal The clip he plays (null while posed from outside). */
  clip: ClipState | null = null;
  /** @internal What fades out, and how far the fade has come (0..1) over `fadeTime`. */
  from: Fading | null = null;
  /** @internal */
  blend = 0;
  /** @internal */
  fadeTime = 0;
  /** @internal Live atlas slot, or -1. */
  live = -1;
  /** @internal Opacity now, where it goes, and its change a second. */
  opacity = 1;
  target = 1;
  rate = 0;
  /** @internal Linear colours: skin, hair, tints. */
  readonly colors = new Float32Array(3 * (2 + CROWD_TINTS));
  /** @internal */
  mask = 0;
  /** @internal */
  removed = false;

  constructor(readonly kind: CrowdKind) {}

  /** The clip he plays and how far into it (seconds), or null when posed from outside (`pose`). Start a full character there to hand him over. */
  get playing(): { clip: string; time: number } | null {
    return this.clip ? { clip: this.clip.name, time: this.clip.time } : null;
  }

  /** How much of him is drawn (0..1; see `CrowdFigures.fade`). */
  get shown(): number {
    return this.opacity;
  }
}

export interface CrowdFiguresOptions {
  /** Instance rows for all kinds together (each kind reserves `max` of them). Default 512. */
  capacity?: number;
  /** Atlas rows for poses set from outside (`pose`), one per posed man. Default 64. */
  liveSlots?: number;
  /** Clips are baked at this many frames a second; the GPU interpolates between them. Default 30. */
  fps?: number;
  /** The figures' material, shared by every kind (`createNodeCrowdFigureMaterial` from `@actors/three/webgpu`). */
  material: (figures: CrowdFigures) => THREE.Material;
}

export interface CrowdKindOptions {
  /** Pieces each man may show or not (hats, hairstyles; by piece name). Hidden unless a man's look shows them. */
  options?: readonly string[];
  /** Up to three groups of piece names whose colour each man sets (`CrowdLook.tints`). */
  tints?: readonly (readonly string[])[];
  /** Most men of this kind. Default 64. */
  max?: number;
  /** Casts the sun's shadow. Default true. */
  castShadow?: boolean;
}

const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();
const _box = new THREE.Box3();

/** Many people drawn from a few baked figures (see the file comment). */
export class CrowdFigures {
  /** Every kind's mesh is in here; move a kind's mesh elsewhere (a ship's group) to give its men that frame. */
  readonly object = new THREE.Group();
  readonly builds = new Map<string, CrowdBuild>();
  readonly kinds = new Map<string, CrowdKind>();
  /** Per man, `CROWD_TEXELS` texels: his place, poses, colours and pieces (see `CROWD_ROW`). */
  readonly instances: THREE.DataTexture;
  /** Bone matrices of every baked frame and live pose, three texels a bone (rows of a 3x4 matrix); `CROWD_ATLAS_ROWS` frames a layer. */
  atlas: THREE.DataArrayTexture;
  /** Atlas bones a frame (the most any build keeps). */
  atlasBones = 0;
  readonly fps: number;
  readonly capacity: number;
  readonly liveSlots: number;
  readonly material: THREE.Material;
  private rows = 0;
  private atlasDirty = true;
  private liveFirst = 0;
  private readonly freeLive: number[] = [];
  private readonly liveLayers = new Set<number>();

  constructor(options: CrowdFiguresOptions) {
    this.capacity = options.capacity ?? 512;
    this.liveSlots = options.liveSlots ?? 64;
    this.fps = options.fps ?? 30;
    this.object.name = "crowd figures";
    const data = new Float32Array(CROWD_TEXELS * this.capacity * 4);
    this.instances = new THREE.DataTexture(data, CROWD_TEXELS, this.capacity, THREE.RGBAFormat, THREE.FloatType);
    nearest(this.instances);
    this.instances.needsUpdate = true;
    this.atlas = emptyAtlas();
    for (let i = this.liveSlots - 1; i >= 0; i--) this.freeLive.push(i);
    this.material = options.material(this);
  }

  /**
   * Bakes a build from `actor` as it is shaped now: its crowd level's bones, its inverse bind
   * matrices and `clips` (by the names men will play them by), each sampled at `fps`.
   * `loop`: clips that play once and hold their last frame are listed in `once`.
   */
  addBuild(name: string, actor: ThreeActor, clips: Record<string, PlayableClip>, options: { once?: readonly string[] } = {}): CrowdBuild {
    const fitted = actor.fittedSkeleton;
    const skeleton = actor.skeleton;
    const def = actor.runtime.manifest.skeleton;
    if (!fitted || !skeleton || !def) throw new Error("addBuild: the actor has no fitted skeleton yet (apply a shape first)");
    const level = actor.lods.findIndex((l) => l.merge);
    const map = lodBoneMap(def, actor.lods[level]);
    const n = fitted.names.length;
    const bones: number[] = [];
    const boneOf = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const to = map ? map[i] : i;
      if (to === i) {
        boneOf[i] = bones.length;
        bones.push(i);
      } else boneOf[i] = boneOf[to];
    }
    const restPositions = new Float32Array(n * 3), restRotations = new Float32Array(n * 4), inverses = new Float32Array(n * 16);
    for (let i = 0; i < n; i++) {
      restPositions.set(fitted.localPositions[i], i * 3);
      restRotations.set(fitted.localRotations[i], i * 4);
      skeleton.boneInverses[i].toArray(inverses, i * 16);
    }
    const build: CrowdBuild = {
      name, bones, boneOf, names: [...fitted.names], parents: Int32Array.from(fitted.parents), restPositions, restRotations, inverses,
      ground: actor.groundOffset(), clips: new Map(),
    };
    // Sample each clip with a mixer of our own, then put the actor's bones back as they were.
    const saved = actor.bones.slice(0, n).map((b) => [b.position.clone(), b.quaternion.clone()] as const);
    const root = actor.object;
    const mixer = new THREE.AnimationMixer(root);
    const rootInverse = new THREE.Matrix4();
    const bind = new Float32Array(bones.length * 12);
    _m.identity();
    _m.elements[13] = build.ground;
    for (let b = 0; b < bones.length; b++) writeRows(_m, bind, b * 12);
    build.clips.set(CROWD_BIND, { frames: bind, first: 0, count: 1, duration: 0, loop: true });
    for (const [clipName, clip] of Object.entries(clips)) {
      const three = actor.toThreeClip(clip);
      const action = mixer.clipAction(three);
      action.play();
      const loop = !options.once?.includes(clipName);
      const count = Math.max(1, Math.round(three.duration * this.fps) + (loop ? 0 : 1));
      const frames = new Float32Array(count * bones.length * 12);
      for (let f = 0; f < count; f++) {
        action.time = Math.min(three.duration, f / this.fps);
        mixer.update(0);
        root.updateMatrixWorld(true);
        rootInverse.copy(root.matrixWorld).invert();
        bones.forEach((i, b) => {
          // Root space, feet on the man's origin: lift by the ground offset.
          _m.multiplyMatrices(rootInverse, actor.bones[i].matrixWorld).multiply(skeleton.boneInverses[i]);
          _m.elements[13] += build.ground;
          writeRows(_m, frames, (f * bones.length + b) * 12);
        });
      }
      action.stop();
      mixer.uncacheClip(three);
      build.clips.set(clipName, { frames, first: 0, count, duration: three.duration, loop });
    }
    actor.bones.slice(0, n).forEach((b, i) => {
      b.position.copy(saved[i][0]);
      b.quaternion.copy(saved[i][1]);
    });
    root.updateMatrixWorld(true);
    this.builds.set(name, build);
    this.atlasDirty = true;
    return build;
  }

  /**
   * Adds a kind: `pieces` (from `crowdPieces`, all of one build's shape) merged into one mesh.
   * Pieces named in `options` are shown per man; the body's skin, the hair and the `tints` groups
   * take each man's colours, every other piece keeps its baked colour.
   */
  addKind(name: string, build: string | CrowdBuild, pieces: readonly CrowdPiece[], options: CrowdKindOptions = {}): CrowdKind {
    const b = typeof build === "string" ? this.builds.get(build) : build;
    if (!b) throw new Error(`addKind: no build ${String(build)}`);
    const max = options.max ?? 64;
    if (this.rows + max > this.capacity) throw new Error(`addKind: ${name} needs ${max} rows, ${this.capacity - this.rows} are left (raise capacity)`);
    const optionNames = [...(options.options ?? [])].filter((o) => pieces.some((p) => p.name === o));
    if (optionNames.length > CROWD_OPTIONS) throw new Error(`addKind: at most ${CROWD_OPTIONS} options`);
    const hairMaps: THREE.Texture[] = [];
    let vertices = 0, indexCount = 0;
    for (const p of pieces) {
      vertices += p.positions.length / 3;
      indexCount += p.indices.length;
      if (p.hairMap && !hairMaps.includes(p.hairMap)) hairMaps.push(p.hairMap);
    }
    if (hairMaps.length > CROWD_HAIR_MAPS) throw new Error(`addKind: at most ${CROWD_HAIR_MAPS} hair textures in a kind`);
    const position = new Float32Array(vertices * 3), normal = new Float32Array(vertices * 3), uv = new Float32Array(vertices * 2);
    const color = new Uint8Array(vertices * 4), joints = new Uint16Array(vertices * 4), weights = new Float32Array(vertices * 4);
    const info = new Float32Array(vertices * 4);
    const index = vertices > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    let at = 0, ai = 0;
    for (const p of pieces) {
      const count = p.positions.length / 3;
      position.set(p.positions, at * 3);
      normal.set(p.normals, at * 3);
      uv.set(p.uv, at * 2);
      const group = (options.tints ?? []).findIndex((g) => g.includes(p.name));
      const option = optionNames.indexOf(p.name);
      const hair = p.hairMap ? hairMaps.indexOf(p.hairMap) + 1 : 0;
      for (let i = 0; i < count; i++) {
        const v = at + i;
        for (let k = 0; k < 3; k++) color[v * 4 + k] = Math.round(THREE.MathUtils.clamp(linearToSrgb(p.colors[i * 3 + k]), 0, 1) * 255);
        color[v * 4 + 3] = 255;
        const slot = p.skin[i] > 0.5 ? CROWD_SLOT.skin : p.role === "hair" ? CROWD_SLOT.hair : group >= 0 && group < CROWD_TINTS ? CROWD_SLOT.tint + group : CROWD_SLOT.baked;
        info[v * 4] = slot;
        info[v * 4 + 1] = option + 1;
        info[v * 4 + 2] = p.clip[i];
        info[v * 4 + 3] = hair;
        for (let k = 0; k < 4; k++) {
          const j = p.joints[i * 4 + k];
          // Bones the pack skeleton does not have (eye bones, add-on chains) follow the head.
          joints[v * 4 + k] = j < b.boneOf.length ? b.boneOf[j] : b.boneOf[Math.max(0, b.names.indexOf("head"))];
          weights[v * 4 + k] = p.weights[i * 4 + k];
        }
      }
      for (let i = 0; i < p.indices.length; i++) index[ai++] = p.indices[i] + at;
      at += count;
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(position, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    // sRGB bytes, read back as linear in the shader (sRGB keeps the dark cloth colours apart in 8 bits).
    g.setAttribute("color", new THREE.BufferAttribute(color, 4, true));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(joints, 4));
    g.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4));
    g.setAttribute("crowdFigure", new THREE.BufferAttribute(info, 4));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
    g.boundingBox = new THREE.Box3();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.name = `crowd figure ${name}`;
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    const bytes = [position, normal, uv, color, joints, weights, info, index].reduce((s, a) => s + a.byteLength, 0);
    const kind: CrowdKind = { name, build: b, mesh, options: optionNames, hairMaps, first: this.rows, max, men: [], bytes };
    // What the shared material reads per draw (see createNodeCrowdFigureMaterial): its first row and hair textures.
    mesh.userData.crowdFigure = kind;
    this.rows += max;
    this.kinds.set(name, kind);
    this.object.add(mesh);
    return kind;
  }

  /** A new man of `kind` (playing nothing until `play` or `pose`), at the origin until his `matrix` is set. */
  add(kind: string | CrowdKind, look: CrowdLook = {}): CrowdMan {
    const k = typeof kind === "string" ? this.kinds.get(kind) : kind;
    if (!k) throw new Error(`add: no kind ${String(kind)}`);
    if (k.men.length >= k.max) throw new Error(`add: kind ${k.name} is full (${k.max} men)`);
    const man = new CrowdMan(k);
    man.row = k.men.length;
    k.men.push(man);
    k.mesh.visible = true;
    this.setLook(man, { skin: "#c89a7a", hair: "#3b2417", ...look });
    return man;
  }

  /** Takes a man away (the last man of his kind takes his row). */
  remove(man: CrowdMan): void {
    if (man.removed) return;
    const men = man.kind.men;
    const last = men.pop()!;
    if (last !== man) {
      men[man.row] = last;
      last.row = man.row;
    }
    this.freeSlot(man);
    man.removed = true;
    if (!men.length) man.kind.mesh.visible = false;
  }

  /** Changes how a man looks (fields left out keep their values). */
  setLook(man: CrowdMan, look: CrowdLook): void {
    const put = (c: THREE.ColorRepresentation | undefined, at: number) => {
      if (c === undefined) return;
      _c.set(c);
      man.colors[at] = _c.r;
      man.colors[at + 1] = _c.g;
      man.colors[at + 2] = _c.b;
    };
    put(look.skin, 0);
    put(look.hair, 3);
    look.tints?.slice(0, CROWD_TINTS).forEach((c, i) => put(c, 6 + i * 3));
    if (look.show) {
      man.mask = 0;
      for (const s of look.show) {
        const i = man.kind.options.indexOf(s);
        if (i >= 0) man.mask += 2 ** i;
      }
    }
  }

  /** Clip names a man of `kind` can play. */
  clipsOf(kind: string | CrowdKind): string[] {
    const k = typeof kind === "string" ? this.kinds.get(kind) : kind;
    return k ? [...k.build.clips.keys()].filter((c) => c !== CROWD_BIND) : [];
  }

  /**
   * Plays a baked clip, from `time` seconds (default: where the clip he plays now is, as a share of
   * its length: a walk goes into a run step for step). `fade` seconds cross-fades from what he
   * plays now (a clip, or a pose from outside). `speed` scales its rate (default 1).
   */
  play(man: CrowdMan, clip: string, options: { time?: number; fade?: number; speed?: number } = {}): void {
    const c = man.kind.build.clips.get(clip);
    if (!c) throw new Error(`play: ${man.kind.build.name} has no clip ${clip}`);
    const before = man.clip;
    const beforeLen = before ? man.kind.build.clips.get(before.name)!.duration : 0;
    const time = options.time ?? (before && beforeLen > 0 ? ((before.time % beforeLen) / beforeLen) * c.duration : 0);
    const now: Fading | null = before ?? (man.live >= 0 ? "live" : null);
    this.startFade(man, now, options.fade ?? 0);
    if (man.from !== "live") this.freeSlot(man);
    man.clip = { name: clip, time, speed: options.speed ?? 1 };
  }

  /** Jumps a man's clip to `time` seconds (e.g. to match a full character he takes over from). */
  seek(man: CrowdMan, time: number): void {
    if (man.clip) man.clip.time = time;
  }

  /**
   * Poses a man from outside, once (call again whenever the pose changes): `pose` on his build's
   * skeleton (`Retargeter.sampleInto`, a `PoseMixer`...), or another actor's bones as they are now
   * (`ThreeActor`: a full character handing him over in the same pose). Uses one of `liveSlots`.
   */
  pose(man: CrowdMan, source: Pose | ThreeActor, options: { fade?: number } = {}): void {
    if (man.live < 0) {
      const slot = this.freeLive.pop();
      if (slot === undefined) throw new Error(`pose: all ${this.liveSlots} live slots are in use`);
      man.live = slot;
      this.startFade(man, man.clip, options.fade ?? 0);
    } else if (man.from === "live") man.from = null;
    man.clip = null;
    this.ensureAtlas();
    const b = man.kind.build;
    const actor = "bones" in source ? source : null;
    const pose = actor ? null : (source as Pose);
    const world = livePose(b, (i, pos, rot) => {
      if (actor) {
        pos.copy(actor.bones[i].position);
        rot.copy(actor.bones[i].quaternion);
        return;
      }
      rot.fromArray(pose!.rotations, i * 4);
      if (i === pose!.rootIndex) pos.fromArray(pose!.root);
      else pos.fromArray(b.restPositions, i * 3);
    });
    const data = this.atlas.image.data as unknown as Float32Array;
    const frame = this.liveFirst + man.live;
    b.bones.forEach((i, k) => {
      _m.fromArray(world, i * 16).multiply(_r.fromArray(b.inverses, i * 16));
      _m.elements[13] += b.ground;
      writeRows(_m, data, (frame * this.atlasBones + k) * 12);
    });
    this.liveLayers.add(Math.floor(frame / CROWD_ATLAS_ROWS));
  }

  /** Copies a full character's pose onto a man (see `pose`), e.g. right before it hands him back to the crowd. */
  poseFrom(man: CrowdMan, actor: ThreeActor): void {
    this.pose(man, actor);
  }

  /** Fades a man in or out (opacity 0..1) over `seconds` (0: at once). The fade is dithered, so it costs no sorting. */
  fade(man: CrowdMan, opacity: number, seconds = 0): void {
    man.target = THREE.MathUtils.clamp(opacity, 0, 1);
    if (seconds <= 0) {
      man.opacity = man.target;
      man.rate = 0;
    } else man.rate = Math.abs(man.target - man.opacity) / seconds;
  }

  /** Advances every man's clip and fades by `dt` seconds and writes their rows (once a frame, after placing them). */
  update(dt: number): void {
    this.ensureAtlas();
    const data = this.instances.image.data as unknown as Float32Array;
    for (const kind of this.kinds.values()) {
      const g = kind.mesh.geometry as THREE.InstancedBufferGeometry;
      g.instanceCount = kind.men.length;
      _box.makeEmpty();
      for (const man of kind.men) {
        this.step(man, dt);
        this.write(man, data, (kind.first + man.row) * CROWD_TEXELS * 4);
        _box.expandByPoint(_p.setFromMatrixPosition(man.matrix));
      }
      // Culling: a sphere round every man (a body reaches about 1.2 m from its feet, more with arms up).
      if (!_box.isEmpty()) {
        _box.expandByVector(_p.set(1.2, 2.2, 1.2));
        _box.getBoundingSphere(g.boundingSphere!);
        g.boundingBox!.copy(_box);
      }
    }
    this.instances.needsUpdate = true;
    if (this.liveLayers.size) {
      for (const l of this.liveLayers) this.atlas.addLayerUpdate(l);
      this.liveLayers.clear();
      this.atlas.needsUpdate = true;
    }
  }

  /** Bytes the figures hold: kinds' geometry, the atlas, the instance rows (textures the hair cards share with full characters are not counted). */
  memory(): { geometry: number; atlas: number; instances: number } {
    this.ensureAtlas();
    let geometry = 0;
    for (const k of this.kinds.values()) geometry += k.bytes;
    return { geometry, atlas: (this.atlas.image.data as unknown as Float32Array).byteLength, instances: (this.instances.image.data as unknown as Float32Array).byteLength };
  }

  /** Frees the GPU side (geometries, textures, the material). */
  dispose(): void {
    for (const k of this.kinds.values()) k.mesh.geometry.dispose();
    this.atlas.dispose();
    this.instances.dispose();
    this.material.dispose();
  }

  /** Atlas frame of a clip time (fractional: the material interpolates). */
  private frameAt(build: CrowdBuild, s: ClipState): [number, number, number] {
    const c = build.clips.get(s.name)!;
    let f = c.count > 1 ? s.time * this.fps : 0;
    if (c.loop) f = ((f % c.count) + c.count) % c.count;
    else f = THREE.MathUtils.clamp(f, 0, c.count - 1);
    const f0 = Math.floor(f);
    const f1 = c.loop ? (f0 + 1) % c.count : Math.min(c.count - 1, f0 + 1);
    return [c.first + f0, c.first + f1, f - f0];
  }

  private step(man: CrowdMan, dt: number): void {
    if (man.clip) man.clip.time += dt * man.clip.speed;
    if (man.from) {
      if (man.from !== "live") man.from.time += dt * man.from.speed;
      man.blend += man.fadeTime > 0 ? dt / man.fadeTime : 1;
      if (man.blend >= 1) {
        // A live pose that faded out gives its slot back (unless he is posed from outside again).
        if (man.from === "live" && man.clip) this.freeSlot(man);
        man.from = null;
        man.blend = 0;
      }
    }
    if (man.opacity !== man.target) {
      const d = man.rate * dt;
      man.opacity = man.opacity < man.target ? Math.min(man.target, man.opacity + d) : Math.max(man.target, man.opacity - d);
      if (!man.rate) man.opacity = man.target;
    }
  }

  private write(man: CrowdMan, data: Float32Array, o: number): void {
    const e = man.matrix.elements;
    // Rows of the 3x4 placement (three stores columns).
    for (let r = 0; r < 3; r++) {
      data[o + r * 4] = e[r];
      data[o + r * 4 + 1] = e[4 + r];
      data[o + r * 4 + 2] = e[8 + r];
      data[o + r * 4 + 3] = e[12 + r];
    }
    const b = man.kind.build;
    const live = (slot: number): [number, number, number] => [this.liveFirst + slot, this.liveFirst + slot, 0];
    // Pose A is what he plays now, pose B what fades out (weight 1 - blend).
    const none = this.frameAt(b, { name: CROWD_BIND, time: 0, speed: 0 });
    const a = man.clip ? this.frameAt(b, man.clip) : man.live >= 0 ? live(man.live) : none;
    const bf = man.from === "live" ? live(man.live) : man.from ? this.frameAt(b, man.from) : none;
    const pa = o + CROWD_ROW.poseA * 4, pb = o + CROWD_ROW.poseB * 4;
    data[pa] = a[0];
    data[pa + 1] = a[1];
    data[pa + 2] = a[2];
    data[pa + 3] = man.from ? 1 - man.blend : 0;
    data[pb] = bf[0];
    data[pb + 1] = bf[1];
    data[pb + 2] = bf[2];
    data[pb + 3] = man.opacity;
    const c = man.colors;
    const ps = o + CROWD_ROW.skin * 4;
    data[ps] = c[0];
    data[ps + 1] = c[1];
    data[ps + 2] = c[2];
    data[ps + 3] = man.mask;
    const ph = o + CROWD_ROW.hair * 4;
    data[ph] = c[3];
    data[ph + 1] = c[4];
    data[ph + 2] = c[5];
    data[ph + 3] = 0;
    for (let t = 0; t < CROWD_TINTS; t++) {
      const pt = o + (CROWD_ROW.tints + t) * 4;
      data[pt] = c[6 + t * 3];
      data[pt + 1] = c[7 + t * 3];
      data[pt + 2] = c[8 + t * 3];
      data[pt + 3] = 0;
    }
  }

  /** Starts fading out `now` (what he shows) over `seconds`; 0 or nothing to fade cuts. */
  private startFade(man: CrowdMan, now: Fading | null, seconds: number): void {
    man.from = seconds > 0 && now ? (now === "live" ? "live" : { ...now }) : null;
    man.blend = 0;
    man.fadeTime = man.from ? seconds : 0;
  }

  /** Frees a man's live slot. */
  private freeSlot(man: CrowdMan): void {
    if (man.live < 0) return;
    this.freeLive.push(man.live);
    man.live = -1;
  }

  /** Lays the atlas out again after builds were added: every clip's frames, then the live rows. */
  private ensureAtlas(): void {
    if (!this.atlasDirty) return;
    this.atlasDirty = false;
    let bones = 0, frames = 0;
    for (const b of this.builds.values()) {
      bones = Math.max(bones, b.bones.length);
      for (const c of b.clips.values()) {
        c.first = frames;
        frames += c.count;
      }
    }
    this.atlasBones = bones;
    const bakedLayers = Math.ceil(frames / CROWD_ATLAS_ROWS);
    this.liveFirst = bakedLayers * CROWD_ATLAS_ROWS;
    const layers = bakedLayers + Math.ceil(this.liveSlots / CROWD_ATLAS_ROWS);
    const width = Math.max(1, bones * 3);
    const data = new Float32Array(width * CROWD_ATLAS_ROWS * Math.max(1, layers) * 4);
    for (const b of this.builds.values()) {
      for (const c of b.clips.values()) {
        for (let f = 0; f < c.count; f++) data.set(c.frames.subarray(f * b.bones.length * 12, (f + 1) * b.bones.length * 12), (c.first + f) * bones * 12);
      }
    }
    // Live rows start in the bind pose (identity skinning, lifted to the feet) of the first build.
    const ground = this.builds.values().next().value?.ground ?? 0;
    _m.identity();
    _m.elements[13] = ground;
    for (let f = 0; f < this.liveSlots; f++) for (let k = 0; k < bones; k++) writeRows(_m, data, ((this.liveFirst + f) * bones + k) * 12);
    const old = this.atlas;
    this.atlas = new THREE.DataArrayTexture(data, width, CROWD_ATLAS_ROWS, Math.max(1, layers));
    this.atlas.format = THREE.RGBAFormat;
    this.atlas.type = THREE.FloatType;
    nearest(this.atlas);
    this.atlas.needsUpdate = true;
    this.liveLayers.clear();
    // The material's atlas node (see createNodeCrowdFigureMaterial) follows the new texture.
    const node = this.material.userData.crowdAtlas as { value: THREE.Texture } | undefined;
    if (node) node.value = this.atlas;
    old.dispose();
  }
}

/** World (root-space) matrices of a build's pack bones for a pose given bone by bone (`set` fills each bone's local position and rotation). */
function livePose(b: CrowdBuild, set: (i: number, pos: THREE.Vector3, rot: THREE.Quaternion) => void): Float32Array {
  const n = b.names.length;
  const world = new Float32Array(n * 16);
  for (let i = 0; i < n; i++) {
    set(i, _p, _q);
    _m.compose(_p, _q, _s);
    const parent = b.parents[i];
    if (parent >= 0) _m.premultiply(_r.fromArray(world, parent * 16));
    _m.toArray(world, i * 16);
  }
  return world;
}

/** Writes a matrix's top three rows (12 floats) at `o`. */
function writeRows(m: THREE.Matrix4, out: Float32Array, o: number): void {
  const e = m.elements;
  for (let r = 0; r < 3; r++) {
    out[o + r * 4] = e[r];
    out[o + r * 4 + 1] = e[4 + r];
    out[o + r * 4 + 2] = e[8 + r];
    out[o + r * 4 + 3] = e[12 + r];
  }
}

function nearest(t: THREE.Texture): void {
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
}

function emptyAtlas(): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(new Float32Array(4), 1, 1, 1);
  t.type = THREE.FloatType;
  nearest(t);
  t.needsUpdate = true;
  return t;
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * The pieces of `actor`'s crowd mesh as it is dressed now (body, garments, textured hair), plus its
 * eyes, each in the bind pose with its colour (garment tint or mean colour, flat eye colour) baked
 * in. The actor must be shaped and drawn at a merging level (see `LodDef.merge`); turn on
 * `crowdSkirts` first so coat tails and skirts are merged too.
 */
export function crowdPieces(actor: ThreeActor, options: { eyeColor?: THREE.ColorRepresentation } = {}): CrowdPiece[] {
  const crowd = actor.crowdMesh();
  if (!crowd) throw new Error("crowdPieces: the actor is not drawn at a merging level");
  const g = crowd.mesh.geometry;
  const pos = g.getAttribute("position").array as Float32Array, nor = g.getAttribute("normal").array as Float32Array;
  const uv = g.getAttribute("uv").array as Float32Array, col = g.getAttribute("color").array as Float32Array;
  const skinAttr = g.getAttribute("crowdSkin") as THREE.InterleavedBufferAttribute, clipAttr = g.getAttribute("crowdClip") as THREE.InterleavedBufferAttribute;
  const hairAttr = g.getAttribute("crowdHair") as THREE.InterleavedBufferAttribute;
  const joints = g.getAttribute("skinIndex").array as Uint16Array, weights = g.getAttribute("skinWeight").array as Float32Array;
  const index = g.index!.array as Uint32Array;
  const out: CrowdPiece[] = [];
  for (const part of crowd.parts) {
    const { offset, count } = part;
    const tris: number[] = [];
    for (let t = 0; t < index.length; t += 3) if (index[t] >= offset && index[t] < offset + count) tris.push(index[t] - offset, index[t + 1] - offset, index[t + 2] - offset);
    const skin = new Float32Array(count), clip = new Float32Array(count);
    let hair = 0;
    for (let i = 0; i < count; i++) {
      skin[i] = skinAttr.getX(offset + i);
      clip[i] = clipAttr.getX(offset + i);
      hair = Math.max(hair, hairAttr.getX(offset + i));
    }
    out.push({
      name: part.name, role: part.role,
      positions: pos.slice(offset * 3, (offset + count) * 3), normals: nor.slice(offset * 3, (offset + count) * 3),
      uv: uv.slice(offset * 2, (offset + count) * 2), colors: col.slice(offset * 3, (offset + count) * 3), skin, clip,
      joints: joints.slice(offset * 4, (offset + count) * 4), weights: weights.slice(offset * 4, (offset + count) * 4),
      indices: Uint32Array.from(tris), hairMap: hair > 0 ? actor.crowdHairMaps[hair - 1] ?? null : null,
    });
  }
  // The eyes are their own mesh even at the crowd level (the crowd body has open sockets).
  const eye = new THREE.Color(options.eyeColor ?? "#3a302a");
  for (const [name, mesh] of actor.meshes) {
    if (!mesh.visible || mesh === crowd.mesh || !mesh.geometry.index) continue;
    if (actor.runtime.meshes.find((m) => m.def.name === name)?.def.role !== "eyes") continue;
    const eg = mesh.geometry;
    const n = eg.getAttribute("position").count;
    const sj = eg.getAttribute("skinIndex"), sw = eg.getAttribute("skinWeight");
    if (!sj || !sw) continue;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([eye.r, eye.g, eye.b], i * 3);
    out.push({
      name, role: "eyes",
      positions: (eg.getAttribute("position").array as Float32Array).slice(), normals: (eg.getAttribute("normal").array as Float32Array).slice(),
      uv: (eg.getAttribute("uv")?.array as Float32Array | undefined)?.slice() ?? new Float32Array(n * 2), colors,
      skin: new Float32Array(n), clip: new Float32Array(n).fill(1),
      joints: Uint16Array.from(sj.array as ArrayLike<number>), weights: Float32Array.from(sw.array as ArrayLike<number>),
      indices: Uint32Array.from(eg.index!.array as ArrayLike<number>), hairMap: null,
    });
  }
  return out;
}
