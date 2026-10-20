/**
 * The "actor pack" format: an engine-agnostic description of a morphable,
 * rigged character, produced offline by an importer (see tools/) and
 * consumed at runtime by @actors/core.
 *
 * A pack is a JSON manifest plus one binary blob for the base data and one
 * small binary file per morph target, so targets can be streamed on demand.
 * Meshes and proxies that are rarely shown (e.g. a large garment library) can
 * live in their own binary files (`blob`) and are loaded on first use.
 *
 * Conventions: meters, +Y up, character faces +Z (same as glTF).
 */

export type ScalarType = "f32" | "u32" | "u16" | "i16" | "u8";

/** A typed slice of the pack's base binary blob (or of the mesh's / proxy's own `blob`). */
export interface BufferRef {
  /** Byte offset into the blob. Always aligned to 4. */
  offset: number;
  /** Number of scalars (not bytes). */
  count: number;
  type: ScalarType;
}

export interface MaterialHint {
  /** Free-form material kind the renderer adapter maps to its own material. */
  kind: "skin" | "eye" | "cloth" | "hair" | "teeth" | "mouth" | "other";
  color?: [number, number, number];
  roughness?: number;
}

/** A renderable surface. Its vertices are split at UV seams; `baseIndex` maps each one back to a shape vertex. */
export interface MeshDef {
  name: string;
  /** Which shape this mesh follows: the actor's base shape, or a proxy (garment) by name. */
  source: { kind: "base" } | { kind: "proxy"; proxy: string };
  role: "body" | "eyes" | "garment" | "bodypart" | "hair";
  /** Render vertex -> source vertex index (u32). Absent for `subdivide` meshes. */
  baseIndex?: BufferRef;
  /** Render vertex UVs (f32, 2 per vertex). Absent for `subdivide` meshes. */
  uv?: BufferRef;
  /** Triangle list in render vertex indices (u32). Absent for `subdivide` meshes. */
  indices?: BufferRef;
  /**
   * Built at load time: one Catmull-Clark level of the named earlier mesh
   * (whose triangles come in quad pairs). The runtime fills in `stencil`.
   */
  subdivide?: { source: string };
  /** Not rendered; only the source of other meshes (e.g. for `subdivide`). */
  internal?: boolean;
  material: MaterialHint;
  /** Garments are optional and can be toggled. */
  optional?: boolean;
  /** Base vertices hidden while this mesh is shown (e.g. skin under a sock). */
  hidesBaseVertices?: BufferRef;
  /**
   * Optional sparse linear map (CSR) from base vertices to this mesh's own
   * vertices, e.g. a precomputed subdivision. When present, `baseIndex`
   * indexes the stencil rows instead of base vertices.
   */
  stencil?: { rows: number; rowPtr: BufferRef; cols: BufferRef; weights: BufferRef };
  /**
   * Per render vertex (f32): surface where the interpolated value is below 0
   * is cut away by the renderer. Gives smooth garment edges independent of
   * the mesh's face rows.
   */
  clip?: BufferRef;
  /** Push vertices out along their normal by this many meters (garment thickness). */
  inflate?: number;
  /** Mutually exclusive alternatives share a slot (e.g. "body" for low/high detail). */
  slot?: string;
  /** Textures shipped with the pack, relative to the manifest. */
  textures?: Partial<Record<"color" | "normal" | "maskA" | "maskB", string>>;
  /** Free-form hints for adapters (e.g. which gender a body part belongs to). */
  tags?: string[];
  /**
   * Own binary file (relative to the manifest) holding this mesh's buffers;
   * the mesh is loaded on demand (`ActorRuntime.loadMeshes`). A proxy mesh's
   * proxy then lives in the same file.
   */
  blob?: string;
}

/** A joint position: the mean of the given base vertices (after morphing). */
export interface JointRef {
  vertices: number[];
}

export interface BoneDef {
  name: string;
  /** Index into `bones`, or -1 for a root. Parents always come before children. */
  parent: number;
  head: JointRef;
  tail: JointRef;
  /**
   * Roll around the head->tail axis, in radians, using Blender's bone
   * convention (local Y along the bone). Kept so bone-local animation data
   * authored in Blender-style rigs stays compatible.
   */
  roll: number;
}

export interface SkeletonDef {
  name: string;
  bones: BoneDef[];
}

/** Per base-vertex skinning: 4 influences per vertex. */
export interface SkinDef {
  joints: BufferRef; // u16, 4 per base vertex
  weights: BufferRef; // f32, 4 per base vertex
}

export interface TargetRef {
  name: string;
  group: string;
  /** File name relative to the manifest. */
  file: string;
  /** Number of vertices the target moves. */
  count: number;
}

/**
 * A proxy is a separate mesh (garment, body part) whose vertices are bound to
 * triangles of the base shape, so it follows every morph. Each proxy vertex =
 * w0*V[r0] + w1*V[r1] + w2*V[r2] + offset * scale, where scale per axis is the
 * current distance between two reference vertices divided by its rest length.
 */
export interface ProxyDef {
  name: string;
  vertexCount: number;
  refs: BufferRef; // u32, 3 per proxy vertex
  weights: BufferRef; // f32, 3 per proxy vertex
  offsets: BufferRef; // f32, 3 per proxy vertex (meters)
  /** Per axis [vertexA, vertexB, restLength in meters]. */
  scaleRefs: [[number, number, number], [number, number, number], [number, number, number]];
  /**
   * Skirt-style skinning: weights of lower bones are moved to their upper bone
   * (`remap`, e.g. calf -> thigh), each left/right pair is averaged, and
   * `hipShare` of the leg weight goes to `hip`. The garment then hangs between
   * the legs instead of splitting into two tubes.
   */
  legBlend?: { remap: Record<string, string>; pairs: [string, string][]; hip: string; hipShare: number };
  /** Own binary file holding this proxy's buffers (see MeshDef.blob). */
  blob?: string;
}

/**
 * A retargetable motion clip. Instead of bone-local rotations (which only fit
 * one skeleton), each track stores the bone's *world-space rotation change*
 * relative to a reference pose, plus the direction the bone pointed in that
 * reference pose. Any skeleton with matching bone names can play it: the
 * runtime first turns each bone to the reference direction, then applies the
 * deltas. Root motion is stored in units of hip height.
 */
export interface ClipDef {
  name: string;
  /** File name relative to the manifest: f32 per frame = bones x quat (xyzw), then root translation xyz. */
  file: string;
  fps: number;
  frameCount: number;
  loop: boolean;
  bones: string[];
  /** Reference-pose direction (head -> tail, model space) per bone, 3 floats each. */
  refDirs: number[];
  /** Bone whose position carries the root motion (usually the pelvis). */
  rootBone: string;
  /** Attribution for the motion data. */
  source: string;
  /** Group for menus, e.g. "Locomotion" or "Combat". */
  category?: string;
  /** Longer human-readable description (e.g. the mocap session notes). */
  description?: string;
  /**
   * Data layout. "f32" (default): interleaved per frame as described at `file`.
   * "i16": all frames' quaternions as int16 (value / 32767), followed by all
   * frames' root translations as f32.
   */
  encoding?: "f32" | "i16";
}

/** A large clip collection kept out of the manifest, loaded on demand (see ActorRuntime.loadClipLibrary). */
export interface ClipLibraryRef {
  name: string;
  /** Index file (a ClipLibrary as JSON), relative to the manifest. */
  file: string;
  count: number;
  source: string;
  license: string;
}

/** Clip library index: clips share bone lists and reference directions through named rigs. */
export interface ClipLibrary {
  name: string;
  rigs: Record<string, Pick<ClipDef, "bones" | "refDirs" | "rootBone">>;
  clips: (Omit<ClipDef, "bones" | "refDirs" | "rootBone"> & { rig: string })[];
}

export interface ActorPackManifest {
  format: "actors-pack";
  version: 1;
  id: string;
  species: string;
  units: "meters";
  source: { name: string; license: string; url: string };
  /** Base blob file name, relative to the manifest. */
  blob: string;
  vertexCount: number;
  basePositions: BufferRef; // f32, 3 per vertex
  meshes: MeshDef[];
  proxies: ProxyDef[];
  skeleton?: SkeletonDef;
  skin?: SkinDef;
  targets: TargetRef[];
  clips?: ClipDef[];
  /** Larger clip collections, loaded on demand. */
  clipLibraries?: ClipLibraryRef[];
  /** Species-specific data (e.g. how sliders map to targets for humans). */
  extra?: Record<string, unknown>;
}

export const TARGET_MAGIC = 0x54474141; // "AAGT" little-endian
export const TARGET_FLAG_DENSE = 1;

const CTORS = {
  f32: Float32Array,
  u32: Uint32Array,
  u16: Uint16Array,
  i16: Int16Array,
  u8: Uint8Array,
} as const;

export type TypedArrayFor<T extends ScalarType> = InstanceType<(typeof CTORS)[T]>;

export function readBuffer<T extends ScalarType>(blob: ArrayBuffer, ref: BufferRef & { type: T }): TypedArrayFor<T> {
  const Ctor = CTORS[ref.type];
  return new Ctor(blob, ref.offset, ref.count) as TypedArrayFor<T>;
}
