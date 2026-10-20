import { type ActorPackManifest, type MeshDef, readBuffer } from "./format";
import { computeNormals } from "./normals";
import { type ProxyBinding, fitProxy, proxySkin } from "./proxy";
import { type FittedSkeleton, fitSkeleton } from "./skeleton";
import { type MorphTarget, applyTarget, decodeTarget } from "./target";

export type Fetcher = (url: string) => Promise<ArrayBuffer>;

export const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.arrayBuffer();
};

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
}

/** Everything that changes when the shape changes. */
export interface ActorShape {
  /** Base shape positions and normals (per shape vertex). */
  positions: Float32Array;
  normals: Float32Array;
  /** Per proxy: fitted positions and normals (per proxy vertex). */
  proxies: Map<string, { positions: Float32Array; normals: Float32Array }>;
  skeleton?: FittedSkeleton;
}

/**
 * Loads an actor pack and turns target weights into a finished shape:
 * morphed body, refitted skeleton and refitted proxies (garments).
 * Renderer-free; safe to run in a Web Worker.
 */
export class ActorRuntime {
  readonly targets = new Map<string, MorphTarget>();
  private readonly pending = new Map<string, Promise<MorphTarget>>();
  readonly meshes: MeshData[];
  readonly proxies = new Map<string, ProxyBinding>();
  readonly basePositions: Float32Array;

  private constructor(
    readonly manifest: ActorPackManifest,
    private readonly blob: ArrayBuffer,
    private readonly baseUrl: string,
    private readonly fetcher: Fetcher,
  ) {
    this.basePositions = readBuffer(blob, { ...manifest.basePositions, type: "f32" });
    for (const p of manifest.proxies) {
      this.proxies.set(p.name, {
        def: p,
        refs: readBuffer(blob, { ...p.refs, type: "u32" }),
        weights: readBuffer(blob, { ...p.weights, type: "f32" }),
        offsets: readBuffer(blob, { ...p.offsets, type: "f32" }),
      });
    }
    const baseJoints = manifest.skin ? readBuffer(blob, { ...manifest.skin.joints, type: "u16" }) : undefined;
    const baseWeights = manifest.skin ? readBuffer(blob, { ...manifest.skin.weights, type: "f32" }) : undefined;
    const proxySkins = new Map<string, { joints: Uint16Array; weights: Float32Array }>();

    this.meshes = manifest.meshes.map((def) => {
      const map = readBuffer(blob, { ...def.baseIndex, type: "u32" });
      const mesh: MeshData = {
        def,
        map,
        uv: readBuffer(blob, { ...def.uv, type: "f32" }),
        indices: readBuffer(blob, { ...def.indices, type: "u32" }),
        hidesBaseVertices: def.hidesBaseVertices ? readBuffer(blob, { ...def.hidesBaseVertices, type: "u32" }) : undefined,
      };
      if (baseJoints && baseWeights) {
        let srcJ = baseJoints;
        let srcW = baseWeights;
        if (def.source.kind === "proxy") {
          const name = def.source.proxy;
          if (!proxySkins.has(name)) proxySkins.set(name, proxySkin(this.proxies.get(name)!, baseJoints, baseWeights));
          ({ joints: srcJ, weights: srcW } = proxySkins.get(name)!);
        }
        mesh.joints = new Uint16Array(map.length * 4);
        mesh.weights = new Float32Array(map.length * 4);
        for (let i = 0; i < map.length; i++) {
          mesh.joints.set(srcJ.subarray(map[i] * 4, map[i] * 4 + 4), i * 4);
          mesh.weights.set(srcW.subarray(map[i] * 4, map[i] * 4 + 4), i * 4);
        }
      }
      return mesh;
    });
  }

  static async load(manifestUrl: string, fetcher: Fetcher = defaultFetcher): Promise<ActorRuntime> {
    const manifestBuf = await fetcher(manifestUrl);
    const manifest = JSON.parse(new TextDecoder().decode(manifestBuf)) as ActorPackManifest;
    if (manifest.format !== "actors-pack" || manifest.version !== 1) throw new Error("Unsupported actor pack");
    const baseUrl = manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1);
    const blob = await fetcher(baseUrl + manifest.blob);
    return new ActorRuntime(manifest, blob, baseUrl, fetcher);
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

  /** Full update: morph, normals, skeleton, proxies. */
  async evaluate(weights: Map<string, number>, previous?: ActorShape): Promise<ActorShape> {
    const active = [...weights].filter(([, w]) => Math.abs(w) >= 1e-5).map(([n]) => n);
    await this.ensureTargets(active);
    return this.evaluateLoaded(weights, previous);
  }

  /** Synchronous version of evaluate(); all weighted targets must already be loaded. */
  evaluateLoaded(weights: Map<string, number>, previous?: ActorShape): ActorShape {
    const positions = this.morph(weights, previous?.positions);
    const baseLists = this.meshes.filter((m) => m.def.source.kind === "base");
    const normals = computeNormals(positions, this.manifest.vertexCount, baseLists, previous?.normals);
    const proxies = new Map<string, { positions: Float32Array; normals: Float32Array }>();
    for (const [name, binding] of this.proxies) {
      const prev = previous?.proxies.get(name);
      const p = fitProxy(binding, positions, prev?.positions);
      const lists = this.meshes.filter((m) => m.def.source.kind === "proxy" && m.def.source.proxy === name);
      proxies.set(name, { positions: p, normals: computeNormals(p, binding.def.vertexCount, lists, prev?.normals) });
    }
    const skeleton = this.manifest.skeleton ? fitSkeleton(this.manifest.skeleton, positions) : undefined;
    return { positions, normals, proxies, skeleton };
  }
}
