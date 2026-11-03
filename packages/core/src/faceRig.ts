/**
 * Face rig: every face unit (brow raiser, lid closure, mouth corner puller ...) as its own GPU
 * morph, so a face can be animated by changing a few dozen weights per frame.
 *
 * The deltas are kept sparse: only vertices that some unit moves get a "slot". A renderer stores
 * `data` in one texture (RGBA half floats, `width` texels per row); texel
 * `(slot * units.length + u) * 2` holds unit u's position delta for that slot, the next texel its
 * normal delta. Each drawn vertex carries its slot + 1 (0: no unit moves it), looked up from
 * `slots` by its vertex space and source index.
 *
 * Renderer-free; built in the shape worker (see ActorRuntime.surfaceDelta).
 */
import type { ActorRuntime, ActorShape, MeshData } from "./runtime";

/** The base mesh's vertex space in `FaceRig.slots`. */
export const BASE_SPACE = "";

export interface FaceRig {
  /** Unit names, in texture order. */
  units: string[];
  /** Per vertex space (BASE_SPACE or a stencil mesh's name): slot + 1 of each source vertex, 0 where no unit moves it. */
  slots: Map<string, Uint32Array>;
  slotCount: number;
  /** Texture size in texels. */
  width: number;
  height: number;
  /** RGBA half floats, `width * height * 4` values. */
  data: Uint16Array;
}

/** Texture width of a face rig (rows are padded to it). */
export const FACE_RIG_WIDTH = 2048;

/** Smallest delta kept (metres; normal deltas are unitless). */
const EPS_POSITION = 2e-6;
const EPS_NORMAL = 2e-4;

/** Triangles around each vertex of a vertex space: `tris` holds 3 vertices per triangle, `list[ptr[v]..ptr[v+1]]` the triangles at v. */
interface Topology {
  tris: Uint32Array;
  ptr: Uint32Array;
  list: Uint32Array;
}

function topology(count: number, lists: Iterable<{ indices: Uint32Array; map: Uint32Array }>): Topology {
  let n = 0;
  for (const l of lists) n += l.indices.length;
  const tris = new Uint32Array(n);
  let o = 0;
  for (const { indices, map } of lists) for (let i = 0; i < indices.length; i++) tris[o++] = map[indices[i]];
  const ptr = new Uint32Array(count + 1);
  for (let i = 0; i < n; i++) ptr[tris[i] + 1]++;
  for (let v = 0; v < count; v++) ptr[v + 1] += ptr[v];
  const fill = ptr.slice(0, count);
  const list = new Uint32Array(n);
  for (let i = 0; i < n; i++) list[fill[tris[i]]++] = (i / 3) | 0;
  return { tris, ptr, list };
}

/** Rows of a stencil that read each base vertex (the stencil transposed). */
function transpose(st: NonNullable<MeshData["stencil"]>, baseCount: number): { ptr: Uint32Array; rows: Uint32Array } {
  const ptr = new Uint32Array(baseCount + 1);
  for (let k = 0; k < st.cols.length; k++) ptr[st.cols[k] + 1]++;
  for (let v = 0; v < baseCount; v++) ptr[v + 1] += ptr[v];
  const fill = ptr.slice(0, baseCount);
  const rows = new Uint32Array(st.cols.length);
  for (let r = 0; r < st.rows; r++) for (let k = st.rowPtr[r]; k < st.rowPtr[r + 1]; k++) rows[fill[st.cols[k]]++] = r;
  return { ptr, rows };
}

/** Smooth normal of vertex v (as computeNormals: area-weighted face normals, normalized), into out[o..o+2]. */
function vertexNormal(p: Float32Array, t: Topology, v: number, out: Float32Array, o: number): void {
  let x = 0, y = 0, z = 0;
  for (let k = t.ptr[v]; k < t.ptr[v + 1]; k++) {
    const f = t.list[k] * 3;
    const a = t.tris[f] * 3, b = t.tris[f + 1] * 3, c = t.tris[f + 2] * 3;
    const abx = p[b] - p[a], aby = p[b + 1] - p[a + 1], abz = p[b + 2] - p[a + 2];
    const acx = p[c] - p[a], acy = p[c + 1] - p[a + 1], acz = p[c + 2] - p[a + 2];
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    // A triangle counts once per corner at v (as in computeNormals).
    const m = (t.tris[f] === v ? 1 : 0) + (t.tris[f + 1] === v ? 1 : 0) + (t.tris[f + 2] === v ? 1 : 0);
    x += nx * m;
    y += ny * m;
    z += nz * m;
  }
  const l = Math.hypot(x, y, z) || 1;
  out[o] = x / l;
  out[o + 1] = y / l;
  out[o + 2] = z / l;
}

/** One vertex space of the rig: its topology, the shape's positions there, and (stencils) how it reads the base. */
interface Space {
  name: string;
  count: number;
  topo: Topology;
  positions: Float32Array;
  normals: Float32Array;
  stencil?: { st: NonNullable<MeshData["stencil"]>; byBase: { ptr: Uint32Array; rows: Uint32Array } };
}

/** Topologies and transposed stencils only depend on the pack: kept per runtime and set of meshes. */
const cache = new WeakMap<ActorRuntime, Map<string, { topo: Topology; byBase?: { ptr: Uint32Array; rows: Uint32Array } }>>();

/** A unit's sparse deltas in one space: moved vertices and their position and normal deltas. */
interface SparseDelta {
  verts: Uint32Array;
  dp: Float32Array;
  dn: Float32Array;
}

/**
 * Builds a face rig on top of `shape`: `units` are pairs of a unit name and its pack target
 * weights. `spaces`: stencil meshes to include besides the base mesh (null: all of the shape's).
 * All weighted targets must already be loaded.
 *
 * Works locally: a unit's targets move a few hundred vertices, so only those, the normals around
 * them and the stencil rows that read them are computed (the same results as
 * `ActorRuntime.surfaceDelta`, at a fraction of the cost).
 */
export function buildFaceRig(runtime: ActorRuntime, shape: ActorShape, units: [string, Map<string, number>][], spaces?: Iterable<string> | null): FaceRig {
  const wanted = spaces ? new Set(spaces) : null;
  const baseCount = shape.positions.length / 3;
  const baseLists = runtime.meshes.filter((m) => m.def.source.kind === "base" && !m.stencil);
  let perRuntime = cache.get(runtime);
  if (!perRuntime) cache.set(runtime, (perRuntime = new Map()));
  const baseKey = `${BASE_SPACE}|${baseLists.map((m) => m.def.name).join(",")}`;
  let base = perRuntime.get(baseKey);
  if (!base) perRuntime.set(baseKey, (base = { topo: topology(baseCount, baseLists) }));
  const all: Space[] = [{ name: BASE_SPACE, count: baseCount, topo: base.topo, positions: shape.positions, normals: shape.normals }];
  for (const m of runtime.meshes) {
    const cur = m.stencil && shape.meshes.get(m.def.name);
    if (!m.stencil || !cur || (wanted && !wanted.has(m.def.name))) continue;
    let c = perRuntime.get(m.def.name);
    if (!c) perRuntime.set(m.def.name, (c = { topo: topology(m.stencil.rows, [m]), byBase: transpose(m.stencil, baseCount) }));
    all.push({ name: m.def.name, count: m.stencil.rows, topo: c.topo, positions: cur.positions, normals: cur.normals, stencil: { st: m.stencil, byBase: c.byBase! } });
  }

  // Scratch per space: positions with one unit applied (restored after each unit), its position
  // deltas, and marks (the unit that last moved / touched a vertex).
  const scratch = all.map((s) => Float32Array.from(s.positions));
  const delta = all.map((s) => new Float32Array(s.count * 3));
  const movedBy = all.map((s) => new Int32Array(s.count).fill(-1));
  const touchedBy = all.map((s) => new Int32Array(s.count).fill(-1));
  const n = new Float32Array(3);
  const deltas: SparseDelta[][] = [];
  const small = (a: Float32Array, o: number, eps: number) => Math.abs(a[o]) <= eps && Math.abs(a[o + 1]) <= eps && Math.abs(a[o + 2]) <= eps;
  for (let u = 0; u < units.length; u++) {
    const out: SparseDelta[] = [];
    // Base vertices moved by the unit's targets.
    const dB = delta[0], mB = movedBy[0];
    const baseMoved: number[] = [];
    for (const [name, w] of units[u][1]) {
      const t = runtime.targets.get(name);
      if (!t) throw new Error(`Target ${name} not loaded; call ensureTargets first`);
      const k = w * t.scale;
      for (let i = 0; i < t.count; i++) {
        const v = t.indices ? t.indices[i] : i;
        if (mB[v] !== u) {
          mB[v] = u;
          dB[v * 3] = dB[v * 3 + 1] = dB[v * 3 + 2] = 0;
          baseMoved.push(v);
        }
        dB[v * 3] += t.deltas[i * 3] * k;
        dB[v * 3 + 1] += t.deltas[i * 3 + 1] * k;
        dB[v * 3 + 2] += t.deltas[i * 3 + 2] * k;
      }
    }
    for (let si = 0; si < all.length; si++) {
      const sp = all[si], p = scratch[si], d = delta[si], mv = movedBy[si], tc = touchedBy[si];
      // Vertices of this space the unit moves, with their position deltas.
      let moved = baseMoved;
      if (sp.stencil) {
        const { st, byBase } = sp.stencil;
        moved = [];
        for (const v of baseMoved)
          for (let k = byBase.ptr[v]; k < byBase.ptr[v + 1]; k++) {
            const r = byBase.rows[k];
            if (mv[r] === u) continue;
            mv[r] = u;
            moved.push(r);
            let x = 0, y = 0, z = 0;
            for (let j = st.rowPtr[r]; j < st.rowPtr[r + 1]; j++) {
              const b = st.cols[j];
              if (mB[b] !== u) continue;
              const w = st.weights[j];
              x += dB[b * 3] * w;
              y += dB[b * 3 + 1] * w;
              z += dB[b * 3 + 2] * w;
            }
            d[r * 3] = x;
            d[r * 3 + 1] = y;
            d[r * 3 + 2] = z;
          }
      }
      if (!moved.length) continue;
      for (const v of moved) {
        p[v * 3] += d[v * 3];
        p[v * 3 + 1] += d[v * 3 + 1];
        p[v * 3 + 2] += d[v * 3 + 2];
      }
      // Vertices whose normal changes: the moved ones and their triangle neighbours.
      const verts: number[] = [], dp: number[] = [], dn: number[] = [];
      const keep = (v: number, nx: number, ny: number, nz: number) => {
        const isMoved = mv[v] === u;
        if (Math.abs(nx) <= EPS_NORMAL && Math.abs(ny) <= EPS_NORMAL && Math.abs(nz) <= EPS_NORMAL && (!isMoved || small(d, v * 3, EPS_POSITION))) return;
        verts.push(v);
        if (isMoved) dp.push(d[v * 3], d[v * 3 + 1], d[v * 3 + 2]);
        else dp.push(0, 0, 0);
        dn.push(nx, ny, nz);
      };
      for (const v of moved)
        for (let k = sp.topo.ptr[v]; k < sp.topo.ptr[v + 1]; k++) {
          const f = sp.topo.list[k] * 3;
          for (let c = 0; c < 3; c++) {
            const x = sp.topo.tris[f + c];
            if (tc[x] === u) continue;
            tc[x] = u;
            vertexNormal(p, sp.topo, x, n, 0);
            keep(x, n[0] - sp.normals[x * 3], n[1] - sp.normals[x * 3 + 1], n[2] - sp.normals[x * 3 + 2]);
          }
        }
      // A moved vertex outside every triangle still moves.
      for (const v of moved) if (tc[v] !== u) keep(v, 0, 0, 0);
      for (const v of moved) {
        p[v * 3] = sp.positions[v * 3];
        p[v * 3 + 1] = sp.positions[v * 3 + 1];
        p[v * 3 + 2] = sp.positions[v * 3 + 2];
      }
      out[si] = { verts: Uint32Array.from(verts), dp: Float32Array.from(dp), dn: Float32Array.from(dn) };
    }
    deltas.push(out);
  }

  // Slots: the vertices any unit moves, space after space.
  const slots = new Map<string, Uint32Array>();
  let slotCount = 0;
  for (let si = 0; si < all.length; si++) {
    const s = new Uint32Array(all[si].count);
    for (const unit of deltas) {
      const d = unit[si];
      if (d) for (const v of d.verts) s[v] ||= ++slotCount;
    }
    if (s.some((x) => x)) slots.set(all[si].name, s);
  }
  const u = units.length;
  const width = FACE_RIG_WIDTH;
  const height = Math.max(1, Math.ceil((slotCount * u * 2) / width));
  const data = new Uint16Array(width * height * 4);
  for (let k = 0; k < u; k++)
    for (let si = 0; si < all.length; si++) {
      const d = deltas[k][si], s = slots.get(all[si].name);
      if (!d || !s) continue;
      for (let i = 0; i < d.verts.length; i++) {
        const t = ((s[d.verts[i]] - 1) * u + k) * 8;
        data[t] = toHalf(d.dp[i * 3]);
        data[t + 1] = toHalf(d.dp[i * 3 + 1]);
        data[t + 2] = toHalf(d.dp[i * 3 + 2]);
        data[t + 4] = toHalf(d.dn[i * 3]);
        data[t + 5] = toHalf(d.dn[i * 3 + 1]);
        data[t + 6] = toHalf(d.dn[i * 3 + 2]);
      }
    }
  return { units: units.map(([n]) => n), slots, slotCount, width, height, data };
}

/** The buffers of a face rig, to transfer it to another thread. */
export function faceRigBuffers(rig: FaceRig): ArrayBuffer[] {
  return [rig.data.buffer as ArrayBuffer, ...[...rig.slots.values()].map((s) => s.buffer as ArrayBuffer)];
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** A float as an IEEE half float (rounded to nearest; tiny values flush to zero). */
export function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (exp >= 31) return sign | 0x7c00; // too large (and inf/NaN): infinity
  if (exp <= 0) {
    if (exp < -10) return sign; // too small: zero
    mant |= 0x800000; // subnormal
    const shift = 14 - exp;
    return sign | ((mant + (1 << (shift - 1))) >>> shift);
  }
  const h = sign | (exp << 10) | (mant >>> 13);
  return mant & 0x1000 ? h + 1 : h; // round (a carry into the exponent is still correct)
}

/** An IEEE half float as a number. */
export function fromHalf(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >>> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 31) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}
