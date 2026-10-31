import { type ActorPackManifest, type ClipDef, type ClipLibrary, type MeshDef, type ProxyDef, readBuffer } from "./format";
import type { Clip } from "./retarget";
import { computeNormals, hairShellNormals } from "./normals";
import { subdivideQuadMesh } from "./subdivide";
import { type ProxyBinding, fitProxy, proxySkin } from "./proxy";
import { type FittedSkeleton, fitSkeleton } from "./skeleton";
import { type ShapeOptions, applyBoneScales, applyScale, applyTip, hasShapeOptions, targetMask } from "./deform";
import { type MorphTarget, applyTarget, decodeTarget } from "./target";

export type Fetcher = (url: string) => Promise<ArrayBuffer>;

export const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.arrayBuffer();
};

let sharedRuntimes = new WeakMap<Fetcher, Map<string, Promise<ActorRuntime>>>();

/** Static, shape-independent data of one mesh. */
export interface MeshData {
  def: MeshDef;
  /** Render vertex -> source vertex (base vertex, or proxy vertex for garments). */
  map: Uint32Array;
  uv: Float32Array;
  indices: Uint32Array;
  /** Skin influences per render vertex. */
  joints?: Uint16Array;
  weights?: Float32Array;
  hidesBaseVertices?: Uint32Array;
  /** Per render vertex cut value (see MeshDef.clip). */
  clip?: Float32Array;
  /** For meshes with their own vertex space (e.g. subdivided): CSR map from base vertices. */
  stencil?: { rows: number; rowPtr: Uint32Array; cols: Uint32Array; weights: Float32Array };
  /**
   * Per source vertex: the base vertex that influences it most (largest stencil
   * or proxy binding weight), for hiding skin under garments.
   */
  dominant?: Uint32Array;
  /** Reduced triangle lists by detail level (see MeshDef.simplified and `lodIndices`). */
  simplified?: Map<number, Uint32Array>;
  /** Extra per render vertex attributes (see MeshDef.attributes). */
  attributes?: Record<string, { array: Float32Array; size: number }>;
}

/** Positions of a stencil mesh: out[r] = sum_k w_k * base[col_k]. */
export function applyStencil(stencil: NonNullable<MeshData["stencil"]>, base: Float32Array, out?: Float32Array): Float32Array {
  const { rows, rowPtr, cols, weights } = stencil;
  const result = out ?? new Float32Array(rows * 3);
  for (let r = 0; r < rows; r++) {
    let x = 0, y = 0, z = 0;
    for (let k = rowPtr[r]; k < rowPtr[r + 1]; k++) {
      const c = cols[k] * 3, w = weights[k];
      x += base[c] * w;
      y += base[c + 1] * w;
      z += base[c + 2] * w;
    }
    result[r * 3] = x;
    result[r * 3 + 1] = y;
    result[r * 3 + 2] = z;
  }
  return result;
}

/** Everything that changes when the shape changes. */
export interface ActorShape {
  /** Base shape positions and normals (per shape vertex). */
  positions: Float32Array;
  normals: Float32Array;
  /** Per proxy: fitted positions and normals (per proxy vertex). */
  proxies: Map<string, { positions: Float32Array; normals: Float32Array }>;
  /** Per stencil mesh (by mesh name): positions and normals in the mesh's own vertex space. */
  meshes: Map<string, { positions: Float32Array; normals: Float32Array }>;
  skeleton?: FittedSkeleton;
}

/** Per-vertex deltas on top of an ActorShape (same layout as ActorShape, without proxies). */
export interface SurfaceDelta {
  positions: Float32Array;
  normals: Float32Array;
  meshes: Map<string, { positions: Float32Array; normals: Float32Array }>;
}

/**
 * Loads an actor pack and turns target weights into a finished shape:
 * morphed body, refitted skeleton and refitted proxies (garments).
 * Renderer-free; safe to run in a Web Worker.
 */
export class ActorRuntime {
  readonly targets = new Map<string, MorphTarget>();
  private readonly pending = new Map<string, Promise<MorphTarget>>();
  /** Loaded meshes. Meshes with their own `blob` join this list once `loadMeshes` has loaded them. */
  readonly meshes: MeshData[] = [];
  /** Loaded proxies (see `meshes`). */
  readonly proxies = new Map<string, ProxyBinding>();
  readonly basePositions: Float32Array;
  /** See `ActorPackManifest.garmentVertexOf`. */
  readonly garmentVertexOf?: Uint32Array;
  private readonly baseJoints?: Uint16Array;
  private readonly baseWeights?: Float32Array;
  private readonly proxySkins = new Map<string, { joints: Uint16Array; weights: Float32Array }>();
  private readonly loadingMeshes = new Map<string, Promise<MeshData>>();
  private readonly masks = new Map<string, Float32Array>();

  private constructor(
    readonly manifestUrl: string,
    readonly manifest: ActorPackManifest,
    blob: ArrayBuffer,
    private readonly baseUrl: string,
    private readonly fetcher: Fetcher,
  ) {
    this.basePositions = readBuffer(blob, { ...manifest.basePositions, type: "f32" });
    if (manifest.garmentVertexOf) this.garmentVertexOf = readBuffer(blob, { ...manifest.garmentVertexOf, type: "u32" });
    for (const p of manifest.proxies) if (!p.blob) this.bindProxy(p, blob);
    this.baseJoints = manifest.skin ? readBuffer(blob, { ...manifest.skin.joints, type: "u16" }) : undefined;
    this.baseWeights = manifest.skin ? readBuffer(blob, { ...manifest.skin.weights, type: "f32" }) : undefined;
    for (const def of manifest.meshes) if (!def.blob) this.meshes.push(this.buildMesh(def, blob));
  }

  private bindProxy(p: ProxyDef, blob: ArrayBuffer): void {
    this.proxies.set(p.name, {
      def: p,
      refs: readBuffer(blob, { ...p.refs, type: "u32" }),
      weights: readBuffer(blob, { ...p.weights, type: "f32" }),
      offsets: readBuffer(blob, { ...p.offsets, type: "f32" }),
    });
  }

  private buildMesh(def: MeshDef, blob: ArrayBuffer): MeshData {
    const { baseJoints, baseWeights, manifest } = this;
    let map: Uint32Array, uv: Float32Array, indices: Uint32Array;
    let stencil: MeshData["stencil"];
    if (def.subdivide) {
      const src = this.meshes.find((m) => m.def.name === def.subdivide!.source);
      if (!src) throw new Error(`${def.name}: subdivision source ${def.subdivide.source} must come first`);
      ({ map, uv, indices, stencil } = subdivideQuadMesh(src));
    } else {
      map = readBuffer(blob, { ...def.baseIndex!, type: "u32" });
      uv = readBuffer(blob, { ...def.uv!, type: "f32" });
      indices = readBuffer(blob, { ...def.indices!, type: "u32" });
    }
    const mesh: MeshData = {
      def,
      map,
      uv,
      indices,
      hidesBaseVertices: def.hidesBaseVertices ? readBuffer(blob, { ...def.hidesBaseVertices, type: "u32" }) : undefined,
      clip: def.clip ? readBuffer(blob, { ...def.clip, type: "f32" }) : undefined,
    };
    if (def.attributes)
      mesh.attributes = Object.fromEntries(Object.entries(def.attributes).map(([k, a]) => [k, { array: readBuffer(blob, { ...a.data, type: "f32" }), size: a.size }]));
    if (def.simplified?.length) mesh.simplified = new Map(def.simplified.map((s) => [s.level, readBuffer(blob, { ...s.indices, type: "u32" })]));
    if (stencil) {
      mesh.stencil = stencil;
      mesh.dominant = dominantColumns(stencil);
    } else if (def.stencil) {
      const st = {
        rows: def.stencil.rows,
        rowPtr: readBuffer(blob, { ...def.stencil.rowPtr, type: "u32" }),
        cols: readBuffer(blob, { ...def.stencil.cols, type: "u32" }),
        weights: readBuffer(blob, { ...def.stencil.weights, type: "f32" }),
      };
      mesh.stencil = st;
      mesh.dominant = dominantColumns(st);
    } else if (def.source.kind === "proxy") {
      const binding = this.proxies.get(def.source.proxy);
      if (binding) mesh.dominant = dominantRefs(binding);
    }
    if (baseJoints && baseWeights) {
      let srcJ = baseJoints;
      let srcW = baseWeights;
      if (mesh.stencil) ({ joints: srcJ, weights: srcW } = stencilSkin(mesh.stencil, baseJoints, baseWeights));
      else if (def.source.kind === "proxy") {
        const name = def.source.proxy;
        if (!this.proxySkins.has(name)) this.proxySkins.set(name, proxySkin(this.proxies.get(name)!, baseJoints, baseWeights, manifest.skeleton?.bones.map((b) => b.name)));
        ({ joints: srcJ, weights: srcW } = this.proxySkins.get(name)!);
      }
      mesh.joints = new Uint16Array(map.length * 4);
      mesh.weights = new Float32Array(map.length * 4);
      for (let i = 0; i < map.length; i++) {
        mesh.joints.set(srcJ.subarray(map[i] * 4, map[i] * 4 + 4), i * 4);
        mesh.weights.set(srcW.subarray(map[i] * 4, map[i] * 4 + 4), i * 4);
      }
    }
    return mesh;
  }

  /** Whether a mesh's data is loaded (always true for meshes without their own `blob`). */
  isLoaded(name: string): boolean {
    return this.meshes.some((m) => m.def.name === name);
  }

  /**
   * Loads meshes that live in their own binary file (`MeshDef.blob`), with
   * their proxies. Already loaded meshes are skipped. Resolves to the meshes
   * this call (or a concurrent one) loaded; shapes evaluated afterwards
   * include their proxies.
   */
  async loadMeshes(names: Iterable<string>): Promise<MeshData[]> {
    const jobs: Promise<MeshData>[] = [];
    for (const name of new Set(names)) {
      if (this.isLoaded(name)) continue;
      let job = this.loadingMeshes.get(name);
      if (!job) {
        const def = this.manifest.meshes.find((m) => m.name === name);
        if (!def) throw new Error(`Unknown mesh ${name}`);
        if (!def.blob) throw new Error(`${name}: not a lazily loaded mesh`);
        job = this.fetcher(this.baseUrl + def.blob).then((blob) => {
          if (def.source.kind === "proxy" && !this.proxies.has(def.source.proxy)) {
            const proxy = this.manifest.proxies.find((p) => p.name === (def.source as { proxy: string }).proxy);
            if (!proxy) throw new Error(`${name}: unknown proxy`);
            this.bindProxy(proxy, blob);
          }
          const mesh = this.buildMesh(def, blob);
          this.meshes.push(mesh);
          this.loadingMeshes.delete(name);
          return mesh;
        });
        this.loadingMeshes.set(name, job);
      }
      jobs.push(job);
    }
    return Promise.all(jobs);
  }

  private readonly libraryClips = new Map<string, ClipDef[]>();

  /** Clips listed in the manifest plus those of every loaded clip library. */
  get clipDefs(): ClipDef[] {
    return [...(this.manifest.clips ?? []), ...[...this.libraryClips.values()].flat()];
  }

  /** Loads a clip library's index (see `manifest.clipLibraries`), so its clips can be played. */
  async loadClipLibrary(name: string): Promise<ClipDef[]> {
    const ref = this.manifest.clipLibraries?.find((l) => l.name === name);
    if (!ref) throw new Error(`Unknown clip library ${name}`);
    if (!this.libraryClips.has(name)) {
      const lib = JSON.parse(new TextDecoder().decode(await this.fetcher(this.baseUrl + ref.file))) as ClipLibrary;
      const dir = ref.file.slice(0, ref.file.lastIndexOf("/") + 1);
      this.libraryClips.set(
        name,
        lib.clips.map(({ rig, ...c }) => ({ ...lib.rigs[rig], ...c, file: dir + c.file })),
      );
    }
    return this.libraryClips.get(name)!;
  }

  private readonly clipJobs = new Map<string, Promise<Clip>>();

  /** Loads a motion clip listed in the manifest or a loaded clip library (once; later calls get the same clip, so treat it as read-only). */
  loadClip(name: string): Promise<Clip> {
    let job = this.clipJobs.get(name);
    if (!job) {
      const def = this.clipDefs.find((c) => c.name === name);
      if (!def) return Promise.reject(new Error(`Unknown clip ${name}`));
      job = this.fetcher(this.baseUrl + def.file).then((buf) => ({ def, data: decodeClip(def, buf) }));
      job.catch(() => this.clipJobs.delete(name));
      this.clipJobs.set(name, job);
    }
    return job;
  }

  /** Loads a texture file shipped with the pack (as raw bytes). */
  loadFile(file: string): Promise<ArrayBuffer> {
    return this.fetcher(this.baseUrl + file);
  }

  get url(): string {
    return this.baseUrl;
  }

  /**
   * The pack at `manifestUrl`, loaded once per page and fetcher: every later
   * call gets the same runtime (with its morph targets, garments and clips
   * already loaded). Use `load` for a private copy.
   */
  static shared(manifestUrl: string, fetcher: Fetcher = defaultFetcher): Promise<ActorRuntime> {
    let byUrl = sharedRuntimes.get(fetcher);
    if (!byUrl) sharedRuntimes.set(fetcher, (byUrl = new Map()));
    const key = typeof location !== "undefined" ? new URL(manifestUrl, location.href).href : manifestUrl;
    let job = byUrl.get(key);
    if (!job) {
      job = ActorRuntime.load(manifestUrl, fetcher);
      job.catch(() => byUrl.delete(key));
      byUrl.set(key, job);
    }
    return job;
  }

  /** Forgets the runtimes `shared` handed out (the next call loads the pack again). */
  static clearShared(): void {
    sharedRuntimes = new WeakMap();
  }

  static async load(manifestUrl: string, fetcher: Fetcher = defaultFetcher): Promise<ActorRuntime> {
    const manifestBuf = await fetcher(manifestUrl);
    const manifest = JSON.parse(new TextDecoder().decode(manifestBuf)) as ActorPackManifest;
    if (manifest.format !== "actors-pack" || manifest.version !== 1) throw new Error("Unsupported actor pack");
    const baseUrl = manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1);
    const blob = await fetcher(baseUrl + manifest.blob);
    return new ActorRuntime(manifestUrl, manifest, blob, baseUrl, fetcher);
  }

  /** Loads the given targets (once each). Targets stream in on demand rather than all up front. */
  async ensureTargets(names: Iterable<string>): Promise<void> {
    const refs = new Map(this.manifest.targets.map((t) => [t.name, t]));
    const jobs: Promise<MorphTarget>[] = [];
    for (const name of names) {
      if (this.targets.has(name)) continue;
      let job = this.pending.get(name);
      if (!job) {
        const ref = refs.get(name);
        if (!ref) throw new Error(`Unknown target ${name}`);
        job = this.fetcher(this.baseUrl + ref.file).then((buf) => {
          const t = decodeTarget(buf);
          this.targets.set(name, t);
          this.pending.delete(name);
          return t;
        });
        this.pending.set(name, job);
      }
      jobs.push(job);
    }
    await Promise.all(jobs);
  }

  /** Base positions plus the weighted sum of the given targets. Missing targets must be loaded first. */
  morph(weights: Map<string, number>, out?: Float32Array): Float32Array {
    const positions = out ?? new Float32Array(this.basePositions.length);
    positions.set(this.basePositions);
    for (const [name, w] of weights) {
      if (Math.abs(w) < 1e-5) continue;
      const t = this.targets.get(name);
      if (!t) throw new Error(`Target ${name} not loaded; call ensureTargets first`);
      applyTarget(positions, t, w);
    }
    return positions;
  }

  /**
   * Full update: morph, shape passes (see ShapeOptions: proportions, tips,
   * scale), normals, skeleton, proxies.
   */
  async evaluate(weights: Map<string, number>, previous?: ActorShape, options?: ShapeOptions, fit?: Iterable<string>): Promise<ActorShape> {
    const active = [...weights].filter(([, w]) => Math.abs(w) >= 1e-5).map(([n]) => n);
    await this.ensureTargets([...active, ...(options?.tips ?? []).map((t) => t.mask)]);
    return this.evaluateLoaded(weights, previous, options, fit);
  }

  /** Per base vertex 0..1 weights of a loaded target's region (see TipDeform). */
  targetMask(name: string): Float32Array {
    let m = this.masks.get(name);
    if (!m) {
      const t = this.targets.get(name);
      if (!t) throw new Error(`Target ${name} not loaded; call ensureTargets first`);
      m = targetMask(t, this.manifest.vertexCount);
      this.masks.set(name, m);
    }
    return m;
  }

  /** Applies the shape passes to morphed positions, in place. */
  private deform(positions: Float32Array, options: ShapeOptions): void {
    for (const tip of options.tips ?? []) applyTip(positions, this.targetMask(tip.mask), tip.amount, tip.direction);
    const bones = options.bones ?? {};
    if (this.manifest.skeleton && this.baseJoints && this.baseWeights && Object.keys(bones).length)
      applyBoneScales(positions, fitSkeleton(this.manifest.skeleton, positions), this.baseJoints, this.baseWeights, bones);
    if (options.scale !== undefined) applyScale(positions, options.scale);
  }

  /**
   * Synchronous version of evaluate(); all weighted targets (and tip masks) must already be loaded.
   *
   * `fit`: names of the meshes the shape is needed for. Only their proxies (garments, hair) and
   * stencil meshes (e.g. the subdivided body) are fitted, which saves most of the work once many
   * garments are loaded but few are worn. Absent: every loaded mesh.
   */
  evaluateLoaded(weights: Map<string, number>, previous?: ActorShape, options?: ShapeOptions, fit?: Iterable<string>): ActorShape {
    const positions = this.morph(weights, previous?.positions);
    if (hasShapeOptions(options)) this.deform(positions, options);
    const baseLists = this.meshes.filter((m) => m.def.source.kind === "base" && !m.stencil);
    const normals = computeNormals(positions, this.manifest.vertexCount, baseLists, previous?.normals);
    const wanted = fit ? new Set(fit) : null;
    const used = wanted ? new Set(this.meshes.filter((m) => wanted.has(m.def.name) && m.def.source.kind === "proxy").map((m) => (m.def.source as { proxy: string }).proxy)) : null;
    const skeleton = this.manifest.skeleton ? fitSkeleton(this.manifest.skeleton, positions) : undefined;
    // Scalp hair lights as one mass: its card normals are bent outward from the middle of the head.
    const head = skeleton ? skeleton.names.indexOf("head") : -1;
    const headCentre = skeleton && head >= 0 ? ([0, 1, 2].map((k) => skeleton.heads[head][k] + 0.45 * (skeleton.tails[head][k] - skeleton.heads[head][k])) as [number, number, number]) : null;
    const proxies = new Map<string, { positions: Float32Array; normals: Float32Array }>();
    for (const [name, binding] of this.proxies) {
      if (used && !used.has(name)) continue;
      const prev = previous?.proxies.get(name);
      const p = fitProxy(binding, positions, prev?.positions);
      const lists = this.meshes.filter((m) => m.def.source.kind === "proxy" && m.def.source.proxy === name);
      const n = computeNormals(p, binding.def.vertexCount, lists, prev?.normals);
      if (headCentre && lists.some((m) => m.def.role === "hair" && m.def.tags?.includes("scalp"))) hairShellNormals(p, n, binding.def.vertexCount, headCentre);
      proxies.set(name, { positions: p, normals: n });
    }
    const meshes = new Map<string, { positions: Float32Array; normals: Float32Array }>();
    for (const m of this.meshes) {
      if (!m.stencil || (wanted && !wanted.has(m.def.name))) continue;
      const prev = previous?.meshes.get(m.def.name);
      const p = applyStencil(m.stencil, positions, prev?.positions);
      meshes.set(m.def.name, { positions: p, normals: computeNormals(p, m.stencil.rows, [m], prev?.normals) });
    }
    return { positions, normals, proxies, meshes, skeleton };
  }

  /**
   * How base-shape surfaces change when extra targets are added on top of a
   * shape: position and normal deltas for the base shape and every stencil
   * mesh. Meant for GPU morph targets (facial expressions, blinking) that are
   * blended every frame without re-evaluating the whole shape. Proxies and the
   * skeleton are not affected. All weighted targets must already be loaded.
   */
  surfaceDelta(shape: ActorShape, weights: Map<string, number>): SurfaceDelta {
    const positions = Float32Array.from(shape.positions);
    for (const [name, w] of weights) {
      if (Math.abs(w) < 1e-5) continue;
      const t = this.targets.get(name);
      if (!t) throw new Error(`Target ${name} not loaded; call ensureTargets first`);
      applyTarget(positions, t, w);
    }
    const sub = (a: Float32Array, b: Float32Array) => {
      for (let i = 0; i < a.length; i++) a[i] -= b[i];
      return a;
    };
    const baseLists = this.meshes.filter((m) => m.def.source.kind === "base" && !m.stencil);
    const normals = computeNormals(positions, this.manifest.vertexCount, baseLists);
    const meshes = new Map<string, { positions: Float32Array; normals: Float32Array }>();
    for (const m of this.meshes) {
      const cur = m.stencil && shape.meshes.get(m.def.name);
      if (!m.stencil || !cur) continue;
      const p = applyStencil(m.stencil, positions);
      const n = computeNormals(p, m.stencil.rows, [m]);
      meshes.set(m.def.name, { positions: sub(p, cur.positions), normals: sub(n, cur.normals) });
    }
    return { positions: sub(positions, shape.positions), normals: sub(normals, shape.normals), meshes };
  }
}

/** Per stencil row: the column (base vertex) with the largest weight. */
function dominantColumns(st: NonNullable<MeshData["stencil"]>): Uint32Array {
  const out = new Uint32Array(st.rows);
  for (let r = 0; r < st.rows; r++) {
    let best = st.rowPtr[r];
    for (let k = st.rowPtr[r]; k < st.rowPtr[r + 1]; k++) if (st.weights[k] > st.weights[best]) best = k;
    out[r] = st.cols[best];
  }
  return out;
}

/** Per proxy vertex: the bound base vertex with the largest weight. */
function dominantRefs(b: ProxyBinding): Uint32Array {
  const out = new Uint32Array(b.def.vertexCount);
  for (let i = 0; i < out.length; i++) {
    let k = 0;
    if (b.weights[i * 3 + 1] > b.weights[i * 3 + k]) k = 1;
    if (b.weights[i * 3 + 2] > b.weights[i * 3 + k]) k = 2;
    out[i] = b.refs[i * 3 + k];
  }
  return out;
}

/** Skin weights for stencil rows: weighted sum of base influences, top 4 renormalized. */
function stencilSkin(st: NonNullable<MeshData["stencil"]>, baseJoints: Uint16Array, baseWeights: Float32Array) {
  const joints = new Uint16Array(st.rows * 4);
  const weights = new Float32Array(st.rows * 4);
  const acc = new Map<number, number>();
  for (let r = 0; r < st.rows; r++) {
    acc.clear();
    for (let k = st.rowPtr[r]; k < st.rowPtr[r + 1]; k++) {
      const v = st.cols[k], w = st.weights[k];
      for (let j = 0; j < 4; j++) {
        const bw = baseWeights[v * 4 + j] * w;
        if (bw > 0) acc.set(baseJoints[v * 4 + j], (acc.get(baseJoints[v * 4 + j]) ?? 0) + bw);
      }
    }
    const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
    top.forEach(([j, w], i) => {
      joints[r * 4 + i] = j;
      weights[r * 4 + i] = w / sum;
    });
  }
  return { joints, weights };
}

/** Clip file -> interleaved f32 frames (bones x quat, then root xyz), whatever the stored encoding. */
export function decodeClip(def: ClipDef, buf: ArrayBuffer): Float32Array {
  if (def.encoding !== "i16") return new Float32Array(buf);
  const nb = def.bones.length, n = def.frameCount;
  const q = new Int16Array(buf, 0, n * nb * 4);
  const root = new Float32Array(buf, n * nb * 8, n * 3);
  const stride = nb * 4 + 3;
  const out = new Float32Array(n * stride);
  for (let f = 0; f < n; f++) {
    for (let k = 0; k < nb * 4; k++) out[f * stride + k] = q[f * nb * 4 + k] / 32767;
    out.set(root.subarray(f * 3, f * 3 + 3), f * stride + nb * 4);
  }
  return out;
}

/** Inverse of decodeClip for "i16": interleaved f32 frames -> stored bytes. */
export function encodeClipI16(bones: number, frames: number, data: Float32Array): Uint8Array {
  const stride = bones * 4 + 3;
  const out = new ArrayBuffer(frames * bones * 8 + frames * 12);
  const q = new Int16Array(out, 0, frames * bones * 4);
  const root = new Float32Array(out, frames * bones * 8, frames * 3);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < bones * 4; k++) q[f * bones * 4 + k] = Math.round(Math.max(-1, Math.min(1, data[f * stride + k])) * 32767);
    root.set(data.subarray(f * stride + bones * 4, f * stride + stride), f * 3);
  }
  return new Uint8Array(out);
}
