/**
 * Converts MakeHuman/MPFB2 CC0 assets (plus Quaternius CC0 animations) into an actor pack.
 *
 *   npm run import:human [-- --mpfb <path to mpfb2 checkout>] [--out <dir>]
 *
 * Without --mpfb, the MPFB2 repository is shallow-cloned into .cache/mpfb2.
 * A few extra CC0 files (eyes) come from the MakeHuman repository and motion
 * clips from Quaternius' Universal Animation Library (CC0); all are cached in .cache/.
 * Only data is used; no MakeHuman/MPFB code is copied.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ActorPackManifest,
  type BoneDef,
  type ClipDef,
  type MeshDef,
  type ProxyDef,
  type TargetRef,
  encodeTarget,
  fitProxy,
} from "@actors/core";
import { BlobWriter } from "./blob";
import { fetchCached, fetchText, fetchZipEntry, fetchZipText } from "./fetch";
import { GARMENTS, garmentCut, insideFaces, selectGarmentFaces } from "./garments";
import { orbitalHalo } from "./future-accessories";
import { shapedGarment } from "./shaped-garment";
import { type Gray, blankGray, blurGray, loadGray, maxGray, meanColor, rasterizeUV, resizeGray, writeJpeg, writeRgbaDownsampled, writeRgbaPng, tintPng } from "./image";
import { type Mhclo, parseMhclo } from "./mhclo";
import { type ObjData, type ObjFace, buildRenderMesh, parseObj } from "./obj";
import { CLIP_SPECS, UAL_ARCHIVES, type UalArchive, importClip } from "./clips";
import { type Gltf, parseGlb } from "./gltf";
import { readZip } from "./zip";
import { CMU_URL, importCmu } from "./cmu";
import type { GarmentInfo, SkinTextureDef } from "@actors/human";
import { WARDROBE } from "./wardrobe";
import { type Vec3, closestOnTriangle } from "./geometry";
import { HAIRSTYLES, PACK_LICENCE } from "./hairstyles";
import { GARMENT_LODS, HAIR_LODS, type LodSteps, SMALL_LODS, humanLods, ready as meshoptReady, simplifyLevels } from "./lod";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CACHE = join(ROOT, ".cache");
const SCALE = 0.1; // MakeHuman units are decimeters
const RIG = "game_engine";
const ADULT_MIN_AGE = 18;
const MASK_SIZE = 2048;
const MH_RAW = "https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data";
/** MakeHuman's CC0 asset packs; only the files used are fetched (HTTP range requests). */
const MH_PACKS = "https://files.makehumancommunity.org/asset_packs";
const SYSTEM_ASSETS = `${MH_PACKS}/makehuman_system_assets/makehuman_system_assets_cc0.zip`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function mpfbDir(): string {
  const given = arg("mpfb");
  if (given) return resolve(given);
  const dir = join(CACHE, "mpfb2");
  if (!existsSync(join(dir, "src/mpfb/data"))) {
    console.log("Cloning makehumancommunity/mpfb2 (shallow) into .cache/mpfb2 ...");
    mkdirSync(CACHE, { recursive: true });
    execFileSync("git", ["clone", "--depth", "1", "https://github.com/makehumancommunity/mpfb2", dir], {
      stdio: "inherit",
      env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "1" },
    });
  }
  return dir;
}

const BROW_LIFT = Number(process.env.BROW_LIFT ?? 1.05);

function readTarget(file: string): { indices: number[]; deltas: number[] } {
  const text = gunzipSync(readFileSync(file)).toString("utf8");
  const indices: number[] = [];
  const deltas: number[] = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [i, x, y, z] = line.trim().split(/\s+/);
    indices.push(+i);
    deltas.push(+x * SCALE, +y * SCALE, +z * SCALE);
  }
  return { indices, deltas };
}

/** Normalizes a mesh's UVs to its own 0..1 bounding box (helpers live in a tiny atlas corner). */
function normalizeUV(uv: number[]): number[] {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < uv.length; i += 2) {
    u0 = Math.min(u0, uv[i]); u1 = Math.max(u1, uv[i]);
    v0 = Math.min(v0, uv[i + 1]); v1 = Math.max(v1, uv[i + 1]);
  }
  return uv.map((x, i) => (i % 2 ? (x - v0) / (v1 - v0 || 1) : (x - u0) / (u1 - u0 || 1)));
}

async function main() {
  await meshoptReady;
  const src = mpfbDir();
  const data = join(src, "src/mpfb/data");
  const out = resolve(arg("out") ?? join(ROOT, "apps/viewer/public/packs/human"));
  // Clear generated subfolders but keep the folder itself (a running dev server keeps watching it).
  for (const d of ["targets", "textures", "clips", "garments"]) {
    rmSync(join(out, d), { recursive: true, force: true });
    mkdirSync(join(out, d), { recursive: true });
  }

  // --- Base mesh ---------------------------------------------------------
  const obj = parseObj(readFileSync(join(data, "3dobjs/base.obj"), "utf8"));
  const vertexCount = obj.positions.length / 3;
  const P = obj.positions.map((v) => v * SCALE);
  const blob = new BlobWriter();
  const basePositions = blob.add("f32", P);

  const groupVerts = new Map<string, number[]>();
  const groupFaces = new Map<string, ObjFace[]>();
  for (const f of obj.faces) {
    if (!groupFaces.has(f.group)) groupFaces.set(f.group, []);
    groupFaces.get(f.group)!.push(f);
    const set = groupVerts.get(f.group) ?? [];
    for (const v of f.v) if (!set.includes(v)) set.push(v);
    groupVerts.set(f.group, set);
  }
  const facesOf = (...groups: string[]) => groups.flatMap((g) => groupFaces.get(g) ?? []);

  // --- Skeleton -------------------------------------------------------------
  type RigJoint = { strategy: string; cube_name?: string; vertex_indices?: number[]; default_position: number[] };
  type RigBone = { parent: string; roll: number; head: RigJoint; tail: RigJoint };
  const rig = JSON.parse(readFileSync(join(data, `rigs/standard/rig.${RIG}.json`), "utf8")) as Record<string, RigBone>;
  const order: string[] = [];
  const visit = (name: string) => {
    if (order.includes(name)) return;
    if (rig[name].parent) visit(rig[name].parent);
    order.push(name);
  };
  Object.keys(rig).forEach(visit);
  const jointVerts = (j: RigJoint): number[] => {
    if (j.strategy === "CUBE") {
      const v = groupVerts.get(j.cube_name!);
      if (!v) throw new Error(`Missing joint cube ${j.cube_name}`);
      return v;
    }
    if (j.strategy === "MEAN" || j.strategy === "VERTEX") return j.vertex_indices!;
    throw new Error(`Unsupported joint strategy ${j.strategy}`);
  };
  const jointPos = (j: RigJoint): [number, number, number] => {
    const vs = jointVerts(j);
    return [0, 1, 2].map((c) => vs.reduce((s, v) => s + P[v * 3 + c], 0) / vs.length) as [number, number, number];
  };
  const bones: BoneDef[] = order.map((name) => ({
    name,
    parent: rig[name].parent ? order.indexOf(rig[name].parent) : -1,
    head: { vertices: jointVerts(rig[name].head) },
    tail: { vertices: jointVerts(rig[name].tail) },
    roll: rig[name].roll ?? 0,
  }));

  const weightsJson = JSON.parse(readFileSync(join(data, `rigs/standard/weights.${RIG}.json`), "utf8")).weights as Record<string, [number, number][]>;
  const perVertex: [number, number][][] = Array.from({ length: vertexCount }, () => []);
  for (const [bone, list] of Object.entries(weightsJson)) {
    const bi = order.indexOf(bone);
    if (bi < 0) continue;
    for (const [v, w] of list) if (w > 0) perVertex[v].push([bi, w]);
  }
  const skinJ = new Uint16Array(vertexCount * 4);
  const skinW = new Float32Array(vertexCount * 4);
  const rootIndex = order.indexOf("Root");
  perVertex.forEach((list, v) => {
    const top = list.sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, [, w]) => s + w, 0);
    if (!sum) {
      skinJ[v * 4] = rootIndex;
      skinW[v * 4] = 1;
      return;
    }
    top.forEach(([b, w], k) => {
      skinJ[v * 4 + k] = b;
      skinW[v * 4 + k] = w / sum;
    });
  });
  const skin = { joints: blob.add("u16", skinJ), weights: blob.add("f32", skinW) };
  const dominantBone = (v: number) => order[skinJ[v * 4]];
  console.log(`Skeleton: ${bones.length} bones (${RIG})`);

  // --- Mesh helpers -------------------------------------------------------------
  const meshes: MeshDef[] = [];
  const addBaseMesh = (
    name: string,
    faces: ObjFace[],
    def: Omit<MeshDef, "name" | "source" | "baseIndex" | "uv" | "indices">,
    uvTransform?: (uv: number[]) => number[],
    clipOf?: (baseVertex: number) => number,
    lodSteps?: LodSteps,
  ) => {
    if (!faces.length) throw new Error(`No faces for ${name}`);
    const m = buildRenderMesh(obj, faces);
    const clip = clipOf ? m.map.map(clipOf) : undefined;
    const simplified = lodSteps ? simplifyLevels(blob, P, m, lodSteps, clip) : undefined;
    meshes.push({
      name,
      source: { kind: "base" },
      baseIndex: blob.add("u32", m.map),
      uv: blob.add("f32", uvTransform ? uvTransform(m.uv) : m.uv),
      indices: blob.add("u32", m.indices),
      ...(clip ? { clip: blob.add("f32", clip) } : {}),
      ...(simplified ? { simplified } : {}),
      ...def,
    });
  };

  /** Catmull-Clark subdivided version of an earlier (quad) mesh; the runtime builds it at load time. */
  const addSubdividedMesh = (name: string, source: string, def: Omit<MeshDef, "name" | "source" | "baseIndex" | "uv" | "indices" | "stencil" | "subdivide">) => {
    meshes.push({ name, source: { kind: "base" }, subdivide: { source }, ...def });
  };

  /**
   * A MakeHuman garment as the runtime places it on the base shape (its binding to the body). The
   * garment's .obj can sit centimetres away from that, so skin hiding must not measure against it.
   */
  const fittedOnBase = (clo: Mhclo): number[] =>
    Array.from(
      fitProxy(
        {
          def: { vertexCount: clo.refs.length / 3, scaleRefs: clo.scale.map(([a, b, l]) => [a, b, l * SCALE]) } as ProxyDef,
          refs: Uint32Array.from(clo.refs),
          weights: Float32Array.from(clo.weights),
          offsets: Float32Array.from(clo.offsets.map((v) => v * SCALE)),
        },
        Float32Array.from(P),
      ),
    );
  // The tights helper vertex at each skin vertex (within 3 cm), so fitted garments can sit on top of body-cut ones.
  // MakeHuman clothes are bound to skin or helper vertices.
  const garmentVertexOf = new Uint32Array(vertexCount).fill(0xffffffff);
  {
    const cell = 0.03;
    const key = (v: number) => [0, 1, 2].map((c) => Math.floor(P[v * 3 + c] / cell));
    const grid = new Map<string, number[]>();
    for (const v of groupVerts.get("helper-tights") ?? []) {
      garmentVertexOf[v] = v; // garments bound to the helper itself
      const k = key(v).join(",");
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k)!.push(v);
    }
    for (const v of groupVerts.get("body")!) {
      const [x, y, z] = key(v);
      let best = cell;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++)
            for (const t of grid.get(`${x + dx},${y + dy},${z + dz}`) ?? []) {
              const d = Math.hypot(P[t * 3] - P[v * 3], P[t * 3 + 1] - P[v * 3 + 1], P[t * 3 + 2] - P[v * 3 + 2]);
              if (d < best) {
                best = d;
                garmentVertexOf[v] = t;
              }
            }
    }
  }
  /**
   * Base vertices hidden while a garment is worn: skin and body-cut garments
   * (tights helper: briefs, bra, …) within `radius` of the garment's surface,
   * and not near its edges (so no holes show at hems). Renderers hide them
   * only under garments on a higher layer, so underwear disappears under a
   * shirt but not the other way round.
   */
  // Vertex normals of the tights helper (area-weighted), to tell "under a garment" from "beside its hem".
  const tightsNormals = new Float32Array(P.length);
  for (const f of facesOf("helper-tights"))
    for (let i = 1; i + 1 < f.v.length; i++) {
      const [a, b, c] = [f.v[0], f.v[i], f.v[i + 1]];
      const u = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), w = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      for (const v of [a, b, c]) for (let k = 0; k < 3; k++) tightsNormals[v * 3 + k] += n[k];
    }
  const coveredBody = (gPos: number[], gFaces: number[][], radius = 0.015, margin = 0.035): number[] => {
    const edges = new Map<string, number>();
    for (const f of gFaces)
      f.forEach((a, i) => {
        const b = f[(i + 1) % f.length];
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
        edges.set(k, (edges.get(k) ?? 0) + 1);
      });
    const boundary = new Set<number>();
    for (const [k, n] of edges) if (n === 1) k.split("_").forEach((x) => boundary.add(+x));
    const cell = Math.max(radius, margin);
    const cellOf = (t: number) => Math.floor(t / cell);
    // Triangles and edge vertices, each in every grid cell it can reach within `cell`.
    const tris: [number, number, number][] = [];
    for (const f of gFaces) for (let i = 1; i + 1 < f.length; i++) tris.push([f[0], f[i], f[i + 1]]);
    const triGrid = new Map<string, number[]>();
    tris.forEach((t, ti) => {
      const lo = [0, 1, 2].map((c) => cellOf(Math.min(...t.map((v) => gPos[v * 3 + c])) - cell));
      const hi = [0, 1, 2].map((c) => cellOf(Math.max(...t.map((v) => gPos[v * 3 + c])) + cell));
      for (let x = lo[0]; x <= hi[0]; x++)
        for (let y = lo[1]; y <= hi[1]; y++)
          for (let z = lo[2]; z <= hi[2]; z++) {
            const k = `${x},${y},${z}`;
            if (!triGrid.has(k)) triGrid.set(k, []);
            triGrid.get(k)!.push(ti);
          }
    });
    const edgeGrid = new Map<string, number[]>();
    for (const i of boundary) {
      const k = `${cellOf(gPos[i * 3])},${cellOf(gPos[i * 3 + 1])},${cellOf(gPos[i * 3 + 2])}`;
      if (!edgeGrid.has(k)) edgeGrid.set(k, []);
      edgeGrid.get(k)!.push(i);
    }
    const out: number[] = [];
    // Body-cut garments (tights helper) need no edge margin: hiding them near a hem only shows the skin
    // under them, and MakeHuman clothes have many inner boundaries (pockets, collars) that a margin would spare.
    const tightsVerts = new Set(groupVerts.get("helper-tights") ?? []);
    for (const v of [...groupVerts.get("body")!, ...tightsVerts]) {
      const garmentLayer = tightsVerts.has(v);
      const p: Vec3 = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
      const [cx, cy, cz] = p.map(cellOf);
      let near = Infinity;
      // For body-cut garments: is the closest garment point on its rim? Then the vertex sits beside the
      // garment (e.g. briefs above low-rise trousers), not under it, and stays visible.
      let onRim = false;
      let along = 1; // how straight out from the body the closest garment point lies (1 = along the normal)
      for (const ti of triGrid.get(`${cx},${cy},${cz}`) ?? []) {
        const t = tris[ti];
        const hit = closestOnTriangle(p, t.map((i) => [gPos[i * 3], gPos[i * 3 + 1], gPos[i * 3 + 2]] as Vec3) as [Vec3, Vec3, Vec3]);
        if (hit.distance < near) {
          near = hit.distance;
          const f = hit.feature.map((k) => t[k]);
          onRim = f.length === 1 ? boundary.has(f[0]) : f.length === 2 && edges.get(f[0] < f[1] ? `${f[0]}_${f[1]}` : `${f[1]}_${f[0]}`) === 1;
          if (garmentLayer && near > 0.005) {
            const n = [0, 1, 2].map((k) => tightsNormals[v * 3 + k]);
            along = Math.abs(n.reduce((s, x, k) => s + x * (hit.point[k] - p[k]), 0)) / (near * (Math.hypot(n[0], n[1], n[2]) || 1));
          } else along = 1;
        }
        if (!garmentLayer && near < radius * 0.25) break;
      }
      if (near >= (garmentLayer ? Math.max(radius, 0.035) : radius)) continue;
      if (garmentLayer) {
        // Only what lies under the garment, not beside its hem (e.g. jeans below a T-shirt's hem).
        if (!onRim && along > 0.7) out.push(v);
        continue;
      }
      let nearEdge = Infinity;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++)
            for (const i of edgeGrid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) nearEdge = Math.min(nearEdge, Math.hypot(gPos[i * 3] - p[0], gPos[i * 3 + 1] - p[1], gPos[i * 3 + 2] - p[2]));
      if (nearEdge > margin) out.push(v);
    }
    return out;
  };

  // --- Body, face parts, anatomy ----------------------------------------------
  const skinMaterial: MeshDef["material"] = { kind: "skin", color: [0.8, 0.62, 0.52], roughness: 0.5 };
  // Detail levels: the subdivided body at full detail, the base mesh at "Medium" (and as the
  // low-detail option at full), MakeHuman's 741-vertex proxy body for crowds (below).
  addBaseMesh("body-low", facesOf("body"), {
    role: "body",
    slot: "body",
    optional: true,
    lods: [0, 1],
    lodOf: "body",
    material: skinMaterial,
    textures: { maskA: "textures/skin_mask_a.png", maskB: "textures/skin_mask_b.png" },
  });
  addSubdividedMesh("body", "body-low", {
    role: "body",
    slot: "body",
    lods: [0],
    material: skinMaterial,
    textures: { maskA: "textures/skin_mask_a.png", maskB: "textures/skin_mask_b.png" },
  });
  addBaseMesh("genitals-male-low", facesOf("helper-genital"), {
    role: "bodypart",
    optional: true,
    lods: [1],
    lodOf: "genitals-male",
    material: skinMaterial,
    tags: ["anatomy", "male"],
    textures: { maskA: "textures/skin_mask_a.png", maskB: "textures/skin_mask_b.png" },
  });
  addSubdividedMesh("genitals-male", "genitals-male-low", {
    role: "bodypart",
    lods: [0],
    material: skinMaterial,
    tags: ["anatomy", "male"],
    textures: { maskA: "textures/skin_mask_a.png", maskB: "textures/skin_mask_b.png" },
  });
  addBaseMesh("teeth", facesOf("helper-upper-teeth", "helper-lower-teeth"), { role: "bodypart", lods: [0], material: { kind: "teeth", color: [0.92, 0.9, 0.84], roughness: 0.25 } });
  addBaseMesh("tongue", facesOf("helper-tongue"), { role: "bodypart", lods: [0], material: { kind: "mouth", color: [0.62, 0.3, 0.3], roughness: 0.35 } });
  addBaseMesh(
    "eyelashes",
    facesOf("helper-l-eyelashes-1", "helper-l-eyelashes-2", "helper-r-eyelashes-1", "helper-r-eyelashes-2"),
    { role: "hair", lods: [0], material: { kind: "hair", color: [0.05, 0.04, 0.035], roughness: 0.6 }, tags: ["lashes"] },
    normalizeUV,
  );

  // Eyes: MakeHuman's CC0 high-poly eye proxy with its brown iris texture.
  const eyeClo = parseMhclo(fetchText(CACHE, `${MH_RAW}/eyes/high-poly/high-poly.mhclo`));
  const eyeObj = parseObj(fetchText(CACHE, `${MH_RAW}/eyes/high-poly/high-poly.obj`));
  copyFileSync(fetchCached(CACHE, `${MH_RAW}/eyes/materials/brown_eye.png`), join(out, "textures/eye_brown.png"));
  const proxies: ProxyDef[] = [];
  const addProxy = (name: string, clo: ReturnType<typeof parseMhclo>, cloObj: ObjData, faces = cloObj.faces, legBlend?: ProxyDef["legBlend"], own?: { writer: BlobWriter; file: string }) => {
    const n = cloObj.positions.length / 3;
    if (clo.refs.length / 3 !== n) throw new Error(`${name}: mhclo/obj vertex count mismatch`);
    if (clo.scale.filter(Boolean).length !== 3) throw new Error(`${name}: needs x/y/z scale references`);
    const w = own?.writer ?? blob;
    proxies.push({
      name,
      vertexCount: n,
      refs: w.add("u32", clo.refs),
      weights: w.add("f32", clo.weights),
      offsets: w.add("f32", clo.offsets.map((v) => v * SCALE)),
      scaleRefs: clo.scale.map(([a, b, l]) => [a, b, l * SCALE]) as ProxyDef["scaleRefs"],
      ...(legBlend ? { legBlend } : {}),
      ...(own ? { blob: own.file } : {}),
    });
    return buildRenderMesh(cloObj, faces);
  };
  // The eye model has an outer cornea shell mapped to the blue disc in the texture's corner. Drop it:
  // the eyeball material's clear coat gives the wet cornea look without hiding the iris.
  const isCornea = (f: ObjData["faces"][number]) => f.vt.every((t) => eyeObj.uvs[t * 2] > 0.85 && eyeObj.uvs[t * 2 + 1] < 0.15);
  const eyes = addProxy("eyes", eyeClo, eyeObj, eyeObj.faces.filter((f) => !isCornea(f)));
  meshes.push({
    name: "eyes",
    source: { kind: "proxy", proxy: "eyes" },
    role: "eyes",
    baseIndex: blob.add("u32", eyes.map),
    uv: blob.add("f32", eyes.uv),
    indices: blob.add("u32", eyes.indices),
    lods: [0, 1],
    simplified: simplifyLevels(blob, eyeObj.positions.map((v) => v * SCALE), eyes, SMALL_LODS),
    material: { kind: "eye", color: [1, 1, 1], roughness: 0.05 },
    textures: { color: "textures/eye_brown.png" },
  });

  // Crowd body: MakeHuman's CC0 741-vertex proxy, bound to the base mesh like a garment (so it
  // follows every morph) and sharing the skin's UV layout (photo skins and masks still apply).
  const crowdDir = "proxymeshes/proxy741";
  const crowdClo = parseMhclo(fetchZipText(CACHE, SYSTEM_ASSETS, `${crowdDir}/proxy741.proxy`));
  const crowdObj = parseObj(fetchZipText(CACHE, SYSTEM_ASSETS, `${crowdDir}/${crowdClo.objFile || "proxy741.obj"}`));
  const crowd = addProxy("body-crowd", crowdClo, crowdObj);
  meshes.push({
    name: "body-crowd",
    source: { kind: "proxy", proxy: "body-crowd" },
    role: "body",
    optional: true,
    lods: [2],
    lodOf: "body",
    baseIndex: blob.add("u32", crowd.map),
    uv: blob.add("f32", crowd.uv),
    indices: blob.add("u32", crowd.indices),
    material: skinMaterial,
    textures: { maskA: "textures/skin_mask_a.png", maskB: "textures/skin_mask_b.png" },
  });
  console.log(`Crowd body: ${crowdObj.positions.length / 3} vertices, ${crowd.indices.length / 3} triangles`);

  // --- Garments -------------------------------------------------------------------
  const tightsFaces = facesOf("helper-tights");
  const genitalVerts = [...new Set(facesOf("helper-genital").flatMap((f) => f.v))];
  const genitalCenter = [0, 1, 2].map((c) => genitalVerts.reduce((s, v) => s + P[v * 3 + c], 0) / genitalVerts.length);
  const garmentCtx = {
    positions: P,
    dominantBone,
    joint: (bone: string, end: "head" | "tail" = "head") => jointPos(rig[bone][end]),
  };
  const garmentLabels: Record<string, string> = {};
  // Garments cut from the body already have the base mesh's density, which suits the medium level.
  const BASE_GARMENT_LODS: LodSteps = [[2, 0.25, 0.03]];
  for (const spec of GARMENTS) {
    const cut = garmentCut(tightsFaces, spec, garmentCtx);
    const faces = selectGarmentFaces(tightsFaces, cut, spec.minIsland);
    // Does it cover the genitals? Then adapters hide genital geometry while it is worn.
    const coversGenitals = insideFaces(faces, cut).some((f) => f.v.some((v) => Math.hypot(P[v * 3] - genitalCenter[0], P[v * 3 + 1] - genitalCenter[1], P[v * 3 + 2] - genitalCenter[2]) < 0.06));
    const garmentDef: Omit<MeshDef, "name" | "source" | "baseIndex"> = {
        role: "garment",
        optional: true,
        inflate: spec.inflate,
        material: { kind: "cloth", color: spec.color, roughness: spec.roughness },
        tags: [`fabric:${spec.fabric}`, ...(spec.offset ? ["tucked"] : []), ...(coversGenitals ? ["covers:anatomy"] : [])],
        hidesBaseVertices: blob.add("u32", coveredBody(P, insideFaces(faces, cut).map((f) => f.v))),
      };
    if (spec.offset) {
      const m = buildRenderMesh(obj, faces);
      const vertices = [...new Set(m.map)];
      const local = new Map(vertices.map((v, i) => [v, i]));
      const { proxy, positions } = shapedGarment(blob, vertices, spec, garmentCtx);
      const clip = m.map.map((v) => cut.get(v)!);
      m.map = m.map.map((v) => local.get(v)!);
      m.uv = normalizeUV(m.uv);
      proxies.push(proxy);
      meshes.push({ ...garmentDef, name: spec.name, source: { kind: "proxy", proxy: spec.name },
        baseIndex: blob.add("u32", m.map), uv: blob.add("f32", m.uv), indices: blob.add("u32", m.indices),
        clip: blob.add("f32", clip), simplified: simplifyLevels(blob, positions, m, BASE_GARMENT_LODS, clip) });
    } else {
      addBaseMesh(spec.name, faces, garmentDef, normalizeUV, (v) => cut.get(v)!, BASE_GARMENT_LODS);
    }
    garmentLabels[spec.name] = spec.label;
    console.log(`Garment ${spec.name}: ${faces.length} faces`);
  }
  addBaseMesh("tights", tightsFaces, { role: "garment", optional: true, inflate: 0.001, material: { kind: "cloth", color: [0.08, 0.08, 0.1], roughness: 0.6 }, tags: ["fabric:knit", "covers:anatomy"] }, normalizeUV, undefined, BASE_GARMENT_LODS);
  garmentLabels.tights = "Tights";

  // A real .mhclo garment, fitted by triangle binding (CC0 MPFB test asset).
  const testdata = join(src, "test/testdata");
  const sockClo = parseMhclo(readFileSync(join(testdata, "better_socks_low.mhclo"), "utf8"));
  const sockObj = parseObj(readFileSync(join(testdata, sockClo.objFile), "utf8"));
  const socks = addProxy("socks", sockClo, sockObj);
  meshes.push({
    name: "socks",
    source: { kind: "proxy", proxy: "socks" },
    role: "garment",
    baseIndex: blob.add("u32", socks.map),
    uv: blob.add("f32", socks.uv),
    indices: blob.add("u32", socks.indices),
    simplified: simplifyLevels(blob, sockObj.positions.map((v) => v * SCALE), socks, GARMENT_LODS),
    material: { kind: "cloth", color: [0.85, 0.85, 0.82], roughness: 0.9 },
    optional: true,
    inflate: 0.002,
    tags: ["fabric:knit"],
    // The asset's own delete list is a placeholder (mostly face vertices), so derive one.
    hidesBaseVertices: blob.add("u32", coveredBody(fittedOnBase(sockClo), sockObj.faces.map((f) => f.v), 0.03, 0.03)),
  });
  garmentLabels.socks = "Socks";

  // Skirts: CC0 garments from MakeHuman's skirts01 asset pack. Skirt skinning hangs them
  // between the legs (averaged thigh weights) so a stride doesn't split or pierce them.
  const SKIRTS_PACK = `${MH_PACKS}/skirts01/skirts01_cc0.zip`;
  const SKIRT_BLEND: ProxyDef["legBlend"] = {
    remap: { calf_l: "thigh_l", calf_r: "thigh_r", foot_l: "thigh_l", foot_r: "thigh_r", ball_l: "thigh_l", ball_r: "thigh_r" },
    pairs: [["thigh_l", "thigh_r"]],
    hip: "pelvis",
    hipShare: 0.35,
  };
  const SKIRTS: [string, string, string, number][] = [
    ["skirt", "toigo_long_full_skirt", "Long skirt", 0.004],
    ["skirt-mini", "frankyaye_mini_skirt_01", "Mini skirt", 0.004],
  ];
  for (const [name, id, label, inflate] of SKIRTS) {
    const clo = parseMhclo(fetchZipText(CACHE, SKIRTS_PACK, `clothes/${id}/${id}.mhclo`));
    const cloObj = parseObj(fetchZipText(CACHE, SKIRTS_PACK, `clothes/${id}/${clo.objFile}`));
    const mhmat = fetchZipText(CACHE, SKIRTS_PACK, `clothes/${id}/${clo.material}`);
    const diffuse = mhmat.match(/^diffuseTexture\s+(\S+)/m)?.[1];
    const file = `textures/${name}.png`;
    const mean = diffuse ? writeRgbaDownsampled(fetchZipEntry(CACHE, SKIRTS_PACK, `clothes/${id}/${diffuse}`), join(out, file), 1024) : [0.4, 0.2, 0.2];
    const m = addProxy(name, clo, cloObj, cloObj.faces, SKIRT_BLEND);
    meshes.push({
      name,
      source: { kind: "proxy", proxy: name },
      role: "garment",
      baseIndex: blob.add("u32", m.map),
      uv: blob.add("f32", m.uv),
      indices: blob.add("u32", m.indices),
      simplified: simplifyLevels(blob, cloObj.positions.map((v) => v * SCALE), m, GARMENT_LODS),
      material: { kind: "cloth", color: mean as [number, number, number], roughness: 0.8 },
      ...(diffuse ? { textures: { color: file } } : {}),
      optional: true,
      inflate,
      slot: "skirt",
      tags: ["fabric:smooth"],
    });
    garmentLabels[name] = label;
  }

  // Body layers and UI groups of the garments above (the wardrobe below brings its own).
  const garmentInfo: Record<string, GarmentInfo> = {
    briefs: { category: "Underwear", occupies: ["briefs"] },
    bra: { category: "Underwear", occupies: ["bra"], gender: "female" },
    tshirt: { category: "Tops", occupies: ["top"] },
    longsleeve: { category: "Tops", occupies: ["top"] },
    shorts: { category: "Bottoms", occupies: ["bottom"] },
    jeans: { category: "Bottoms", occupies: ["bottom"] },
    tights: { category: "Socks & hosiery", occupies: ["legwear"] },
    socks: { category: "Socks & hosiery", occupies: ["socks"] },
    skirt: { category: "Bottoms", occupies: ["bottom"], gender: "female" },
    "skirt-mini": { category: "Bottoms", occupies: ["bottom"], gender: "female" },
    ...Object.fromEntries(GARMENTS.filter((g) => g.info).map((g) => [g.name, g.info!])),
  };

  const headVertices = [...new Set(facesOf("body").flatMap((f) => f.v))].filter((v) => dominantBone(v) === "head");
  const halo = orbitalHalo(blob, P, headVertices);
  proxies.push(halo.proxy);
  meshes.push(halo.mesh);
  garmentLabels[halo.mesh.name] = "3026 · Orbital halo";
  garmentInfo[halo.mesh.name] = { category: "Future · accessories", occupies: ["halo"] };

  // --- Wardrobe: CC0 and CC-BY garments from MakeHuman asset packs, each in its own file, loaded when worn ---
  mkdirSync(join(out, "garments"), { recursive: true });
  let wardrobeBytes = 0;
  for (const item of WARDROBE) {
    const cc = item.license === "CC-BY" ? "cc-by" : "cc0";
    const pack = `${MH_PACKS}/${item.pack}/${item.pack}_${cc}.zip`;
    const dir = `clothes/${item.id}`;
    const clo = parseMhclo(fetchZipText(CACHE, pack, `${dir}/${item.id}.mhclo`));
    const cloObj = parseObj(fetchZipText(CACHE, pack, `${dir}/${clo.objFile}`));
    let mhmat = "";
    try {
      mhmat = fetchZipText(CACHE, pack, `${dir}/${clo.material ?? `${item.id}.mhmat`}`);
    } catch {
      console.warn(`${item.name}: no material, using a plain colour`);
    }
    const writer = new BlobWriter();
    const file = `garments/${item.name}.bin`;
    const m = addProxy(item.name, clo, cloObj, cloObj.faces, item.skirt ? SKIRT_BLEND : undefined, { writer, file });
    // Mean texture colour over the texels the garment uses (vertex UVs + triangle centres).
    const samples = [...m.uv];
    for (let t = 0; t < m.indices.length; t += 3) for (const c of [0, 1]) samples.push((m.uv[m.indices[t] * 2 + c] + m.uv[m.indices[t + 1] * 2 + c] + m.uv[m.indices[t + 2] * 2 + c]) / 3);
    const textures: MeshDef["textures"] = {};
    const size = item.texSize ?? 1024;
    const diffuse = mhmat.match(/^diffuseTexture\s+(\S+)/m)?.[1];
    let color: [number, number, number] = [0.45, 0.45, 0.47];
    if (diffuse) {
      textures.color = `textures/garment_${item.name}.png`;
      color = writeRgbaDownsampled(fetchZipEntry(CACHE, pack, `${dir}/${diffuse}`), join(out, textures.color), size, samples);
    }
    const normal = mhmat.match(/^normalmapTexture\s+(\S+)/m)?.[1];
    if (normal) {
      textures.normal = `textures/garment_${item.name}_normal.png`;
      writeRgbaDownsampled(fetchZipEntry(CACHE, pack, `${dir}/${normal}`), join(out, textures.normal), Math.min(size, 512));
    }
    const gPos = cloObj.positions.map((v) => v * SCALE);
    meshes.push({
      name: item.name,
      source: { kind: "proxy", proxy: item.name },
      role: "garment",
      blob: file,
      baseIndex: writer.add("u32", m.map),
      uv: writer.add("f32", m.uv),
      indices: writer.add("u32", m.indices),
      simplified: simplifyLevels(writer, gPos, m, GARMENT_LODS),
      material: { kind: "cloth", color, roughness: 0.8 },
      ...(Object.keys(textures).length ? { textures } : {}),
      optional: true,
      // MakeHuman clothes already sit off the skin; a little extra keeps them above the base garments.
      inflate: 0.002,
      tags: [`fabric:${item.fabric ?? "smooth"}`, ...(item.coversAnatomy ? ["covers:anatomy"] : []), ...(item.hidesHair ? ["covers:hair"] : []), ...(item.tucked ? ["tucked"] : []), `license:${item.license ?? "CC0"}`],
      hidesBaseVertices: writer.add("u32", coveredBody(fittedOnBase(clo), cloObj.faces.map((f) => f.v), item.hideRadius ?? 0.015)),
    });
    const bin = writer.toBuffer();
    writeFileSync(join(out, file), bin);
    wardrobeBytes += bin.byteLength;
    garmentLabels[item.name] = item.label;
    garmentInfo[item.name] = { label: item.label, category: item.category, occupies: item.occupies, ...(item.gender ? { gender: item.gender } : {}), ...(item.license === "CC-BY" ? { credit: `${item.id} by ${item.author} (MakeHuman ${item.pack} pack, CC-BY)`, author: item.author } : { credit: `${item.id} (MakeHuman ${item.pack} pack, CC0)` }) };
  }
  console.log(`Wardrobe: ${WARDROBE.length} garments, ${(wardrobeBytes / 1e6).toFixed(1)} MB of mesh data (loaded when worn)`);

  // --- Hair: MakeHuman system hairstyles (CC0 .mhclo proxies with alpha-card textures) ---
  const HAIRS: [string, string][] = [
    ["short02", "Short"],
    ["short03", "Short, side part"],
    ["short04", "Buzz cut"],
    ["bob01", "Bob"],
    ["bob02", "Bob, curled"],
    ["long01", "Long"],
    ["ponytail01", "Ponytail"],
    ["braid01", "Braid"],
    ["afro01", "Afro"],
  ];
  const hairLabels: Record<string, string> = {};
  const browLabels: Record<string, string> = {};
  /** A MakeHuman hair-like proxy (hair, eyebrows) with its alpha texture. */
  const addHairProxy = (dir: string, id: string, slot: string, texSize: number, optional: boolean) => {
    const clo = parseMhclo(fetchZipText(CACHE, SYSTEM_ASSETS, `${dir}/${id}/${id}.mhclo`));
    const cloObj = parseObj(fetchZipText(CACHE, SYSTEM_ASSETS, `${dir}/${id}/${clo.objFile}`));
    const mhmat = fetchZipText(CACHE, SYSTEM_ASSETS, `${dir}/${id}/${clo.material ?? `${id}.mhmat`}`);
    const diffuse = mhmat.match(/^diffuseTexture\s+(\S+)/m)?.[1];
    if (!diffuse) throw new Error(`${dir}/${id}: no diffuse texture`);
    const file = `textures/${slot}_${id}.png`;
    const mean = writeRgbaDownsampled(fetchZipEntry(CACHE, SYSTEM_ASSETS, `${dir}/${id}/${diffuse}`), join(out, file), texSize);
    const name = `${slot}-${id}`;
    const m = addProxy(name, clo, cloObj);
    meshes.push({
      name,
      source: { kind: "proxy", proxy: name },
      role: "hair",
      slot,
      optional,
      baseIndex: blob.add("u32", m.map),
      uv: blob.add("f32", m.uv),
      indices: blob.add("u32", m.indices),
      // Brows are too small to see in a crowd; hair keeps the silhouette at every level.
      ...(slot === "brows" ? { lods: [0, 1] } : {}),
      simplified: simplifyLevels(blob, cloObj.positions.map((v) => v * SCALE), m, slot === "brows" ? SMALL_LODS : HAIR_LODS),
      // Mean colour of the texture, so adapters can recolour it.
      material: { kind: "hair", color: mean, roughness: 0.45 },
      textures: { color: file },
      tags: [slot === "hair" ? "scalp" : "brows"],
    });
    return name;
  };
  for (const [id, label] of HAIRS) hairLabels[addHairProxy("hair", id, "hair", 1024, true)] = label;
  // Community hair packs: each style in its own file, loaded the first time it is shown.
  const hairCredits: Record<string, string> = {};
  mkdirSync(join(out, "hair"), { recursive: true });
  let hairBytes = 0;
  const HEAD_SCALE: [number, number, number][] = [[5399, 11998, 1.398], [791, 881, 2.2028], [962, 5320, 1.8441]];
  const packInfo = new Map<string, Record<string, { source?: string }>>();
  for (const style of HAIRSTYLES) {
    const licence = PACK_LICENCE[style.pack];
    const pack = `${MH_PACKS}/${style.pack}/${style.pack}_${licence}.zip`;
    if (!packInfo.has(pack)) packInfo.set(pack, JSON.parse(fetchZipText(CACHE, pack, `packs/${style.pack}.json`)));
    const source = packInfo.get(pack)![style.id]?.source;
    const licenceName = licence === "cc0" ? "CC0" : "CC-BY";
    const dir = `hair/${style.id}`;
    const clo = parseMhclo(fetchZipText(CACHE, pack, `${dir}/${style.id}.mhclo`));
    // A few styles have no scale references; use the head box most hair proxies use.
    HEAD_SCALE.forEach((ref, k) => (clo.scale[k] ??= ref));
    const cloObj = parseObj(fetchZipText(CACHE, pack, `${dir}/${clo.objFile}`));
    const mhmat = fetchZipText(CACHE, pack, `${dir}/${clo.material ?? `${style.id}.mhmat`}`);
    const diffuse = mhmat.match(/^diffuseTexture\s+(\S+)/m)?.[1];
    if (!diffuse) throw new Error(`${style.name}: no diffuse texture`);
    const writer = new BlobWriter();
    const file = `hair/${style.name}.bin`;
    const m = addProxy(style.name, clo, cloObj, cloObj.faces, undefined, { writer, file });
    const tex = `textures/${style.name}.png`;
    let mean = writeRgbaDownsampled(fetchZipEntry(CACHE, pack, `${dir}/${diffuse}`), join(out, tex), 1024, m.uv);
    if (style.tint) {
      mean = [1, 3, 5].map((k) => parseInt(style.tint!.slice(k, k + 2), 16) / 255) as [number, number, number];
      tintPng(join(out, tex), mean);
    }
    meshes.push({
      name: style.name,
      source: { kind: "proxy", proxy: style.name },
      role: "hair",
      slot: "hair",
      optional: true,
      blob: file,
      baseIndex: writer.add("u32", m.map),
      uv: writer.add("f32", m.uv),
      indices: writer.add("u32", m.indices),
      simplified: simplifyLevels(writer, cloObj.positions.map((v) => v * SCALE), m, HAIR_LODS),
      material: { kind: "hair", color: mean, roughness: 0.45 },
      textures: { color: tex },
      tags: ["scalp", `license:${licenceName}`],
    });
    const bin = writer.toBuffer();
    writeFileSync(join(out, file), bin);
    hairBytes += bin.byteLength;
    hairLabels[style.name] = style.label;
    hairCredits[style.name] = `${style.id} by ${style.author} (MakeHuman ${style.pack} pack, ${licenceName}${source ? `, ${source}` : ""})`;
  }
  // Eyebrows: MakeHuman's CC0 eyebrow proxies; the first one is shown by default.
  const BROWS: [string, string][] = [
    ["eyebrow001", "Natural"],
    ["eyebrow003", "Thin"],
    ["eyebrow006", "Arched"],
    ["eyebrow009", "Bushy"],
    ["eyebrow011", "Straight"],
  ];
  BROWS.forEach(([id, label], i) => (browLabels[addHairProxy("eyebrows", id, "brows", 512, i > 0)] = label));
  console.log(`Hair: ${HAIRS.length + HAIRSTYLES.length} styles (${(hairBytes / 1e6).toFixed(1)} MB of community hair, loaded when shown)`);

  // --- Skin region masks -------------------------------------------------------------
  const tex = join(data, "textures");
  const mask = (n: string) => resizeGray(loadGray(join(tex, `mpfb_${n}.jpg`)), MASK_SIZE);
  // Eyebrows: an arch above each eye, drawn per texel from the 3D position the texel maps to.
  // Eye centre and width come from the eyelash helper geometry.
  const bodyTris = (value: (v: number) => number) =>
    facesOf("body").flatMap((f) => {
      const uv = f.vt.map((t) => [obj.uvs[t * 2], obj.uvs[t * 2 + 1]] as [number, number]);
      const out: { uv: [number, number][]; value: number[] }[] = [];
      for (let i = 1; i + 1 < f.v.length; i++) out.push({ uv: [uv[0], uv[i], uv[i + 1]], value: [value(f.v[0]), value(f.v[i]), value(f.v[i + 1])] });
      return out;
    });
  // rasterizeUV keeps the max per texel, so shift coordinates positive.
  const posImg = [0, 1, 2].map((c) => rasterizeUV(MASK_SIZE, bodyTris((v) => P[v * 3 + c] + 10)));
  const eyeSpots = ["l", "r"].map((side) => {
    const verts = new Set(facesOf(`helper-${side}-eyelashes-1`, `helper-${side}-eyelashes-2`).flatMap((f) => f.v));
    const c = [0, 0, 0];
    let minX = Infinity, maxX = -Infinity;
    for (const v of verts) {
      for (let k = 0; k < 3; k++) c[k] += P[v * 3 + k] / verts.size;
      minX = Math.min(minX, P[v * 3]);
      maxX = Math.max(maxX, P[v * 3]);
    }
    return { c, w: (maxX - minX) / 2 };
  });
  const smooth = (a: number, b: number, x: number) => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  const browRaw = blankGray(MASK_SIZE);
  for (let i = 0; i < browRaw.data.length; i++) {
    if (posImg[0].data[i] < 5) continue;
    const [x, y, z] = posImg.map((img) => img.data[i] - 10);
    for (const { c, w } of eyeSpots) {
      const side = Math.sign(c[0]);
      const t = ((x - c[0]) * side) / w; // -1 inner corner .. +1 outer corner
      if (t < -1.6 || t > 1.7 || z < c[2] - 0.012 || Math.abs(y - c[1]) > 3 * w) continue;
      const arch = 1 - ((t - 0.2) / 1.5) ** 2;
      const yc = c[1] + w * (BROW_LIFT + 0.28 * arch);
      const half = w * (0.3 - 0.13 * smooth(-1.3, 1.5, t));
      const v = smooth(half, half * 0.45, Math.abs(y - yc)) * smooth(-1.45, -1.05, t) * smooth(1.6, 1.15, t);
      browRaw.data[i] = Math.max(browRaw.data[i], v);
    }
  }
  const brows: Gray = blurGray(browRaw, 1);
  writeRgbaPng(join(out, "textures/skin_mask_a.png"), [mask("lips"), mask("aureolae"), maxGray(mask("fingernails"), mask("toenails")), mask("eyelids")]);
  const genitalsMask = mask("genitals");
  writeRgbaPng(join(out, "textures/skin_mask_b.png"), [genitalsMask, mask("crotch"), mask("ears"), brows]);
  // UV box of the genital region (for procedural detail in the skin shader).
  let gb = [1, 1, 0, 0];
  for (let y = 0; y < MASK_SIZE; y++)
    for (let x = 0; x < MASK_SIZE; x++)
      if (genitalsMask.data[y * MASK_SIZE + x] > 0.5) {
        const u = (x + 0.5) / MASK_SIZE, v = 1 - (y + 0.5) / MASK_SIZE;
        gb = [Math.min(gb[0], u), Math.min(gb[1], v), Math.max(gb[2], u), Math.max(gb[3], v)];
      }

  // --- Targets ----------------------------------------------------------------
  const targets: TargetRef[] = [];
  let targetBytes = 0;
  const writeTarget = (name: string, group: string, file: string): boolean => {
    const t = readTarget(file);
    if (!t.indices.length) return false;
    const enc = encodeTarget(t.indices, t.deltas, vertexCount);
    const fileName = `targets/${name.replace(/[^a-z0-9-]+/gi, "_")}.bin`;
    writeFileSync(join(out, fileName), new Uint8Array(enc));
    targetBytes += enc.byteLength;
    targets.push({ name, group, file: fileName, count: t.indices.length });
    return true;
  };

  // Macro targets: names encode the variable values they represent.
  const macroTargets: { name: string; tokens: string[] }[] = [];
  for (const dir of ["macrodetails", "macrodetails/height", "macrodetails/proportions", "breast"]) {
    for (const f of readdirSync(join(data, "targets", dir)).sort()) {
      if (!f.endsWith(".target.gz")) continue;
      const base = f.replace(".target.gz", "");
      if (!/^(female|male|african|asian|caucasian|universal)/.test(base)) continue; // detail breast targets handled below
      const tokens = base.split("-").filter((t) => t !== "universal");
      if (tokens.includes("baby")) continue; // never used: adult-only
      const name = `macro/${base}`;
      if (writeTarget(name, "macro", join(data, "targets", dir, f))) macroTargets.push({ name, tokens });
    }
  }

  // Detail modifiers from MPFB's target index.
  type Category = { name: string; targets: string[]; opposites: Record<string, string> };
  const index = JSON.parse(readFileSync(join(data, "targets/target.json"), "utf8")) as Record<string, { categories: Category[] }>;
  const SKIP_GROUPS = new Set(["expression", "measure"]);
  const modifiers: { id: string; group: string; label: string; negative: string[]; positive: string[] }[] = [];
  for (const [group, { categories }] of Object.entries(index)) {
    if (SKIP_GROUPS.has(group)) continue;
    for (const cat of categories) {
      const o = cat.opposites ?? {};
      let negative = ["negative-left", "negative-right", "negative-unsided"].map((k) => o[k]).filter(Boolean);
      let positive = ["positive-left", "positive-right", "positive-unsided"].map((k) => o[k]).filter(Boolean);
      if (!negative.length && !positive.length) positive = cat.targets;
      const ok = (t: string) => {
        const file = join(data, "targets", group, `${t}.target.gz`);
        return existsSync(file) && writeTarget(`${group}/${t}`, group, file);
      };
      negative = negative.filter(ok).map((t) => `${group}/${t}`);
      positive = positive.filter(ok).map((t) => `${group}/${t}`);
      if (!negative.length && !positive.length) continue;
      const label = cat.name
        .replace(/-(decr-incr|down-up|in-out|backward-forward|forward-backward|less-more|compress-uncompress|out-in|up-down|min-max|left-right|concave-convex|moveup-movedown|movedown-moveup)$/, "")
        .replace(/-/g, " ");
      modifiers.push({ id: `${group}/${cat.name}`, group, label, negative, positive });
    }
  }

  // Facial expression units (per ethnicity; blended by the ethnicity mix at runtime).
  const units = new Set<string>();
  for (const eth of ["african", "asian", "caucasian"]) {
    const dir = join(data, "targets/expression/units", eth);
    for (const f of readdirSync(dir).sort()) {
      const unit = f.replace(".target.gz", "");
      if (writeTarget(`expression/${eth}/${unit}`, "expression", join(dir, f))) units.add(unit);
    }
  }

  // --- Photo skins (MakeHuman system assets, CC0) -------------------------------------
  // One per age group x gender x ethnicity; the runtime blends them like the shape targets.
  const skins: SkinTextureDef[] = [];
  for (const age of ["young", "middleage", "old"] as const)
    for (const gender of ["female", "male"] as const)
      for (const ethnicity of ["african", "asian", "caucasian"] as const) {
        const dir = `skins/${age}_${ethnicity}_${gender}`;
        const mhmat = fetchZipText(CACHE, SYSTEM_ASSETS, `${dir}/${age}_${ethnicity}_${gender}.mhmat`);
        const diffuse = mhmat.match(/^diffuseTexture\s+(\S+)/m)?.[1];
        if (!diffuse) throw new Error(`${dir}: no diffuse texture`);
        const file = `textures/skin_${age}_${ethnicity}_${gender}.jpg`;
        writeJpeg(fetchZipEntry(CACHE, SYSTEM_ASSETS, `${dir}/${diffuse}`), join(out, file));
        skins.push({ age, gender, ethnicity, file, tone: meanColor(join(out, file)) });
      }
  console.log(`Skins: ${skins.length}`);

  // --- Motion clips (Quaternius Universal Animation Library, CC0) -------------------
  const clips: ClipDef[] = [];
  const libraries = new Map<UalArchive, Gltf>();
  // The source files also go to the viewer (not the pack) for its side-by-side check (`?compare`).
  const refDir = join(dirname(out), "../reference");
  mkdirSync(refDir, { recursive: true });
  const reference: Record<string, { glb: string; animation: string }> = {};
  const library = (key: UalArchive): Gltf => {
    if (!libraries.has(key)) {
      const { url, glb } = UAL_ARCHIVES[key];
      const entry = readZip(readFileSync(fetchCached(CACHE, url))).get(glb);
      if (!entry) throw new Error(`${url} has no ${glb}`);
      const bytes = entry();
      writeFileSync(join(refDir, `${key}.glb`), bytes);
      libraries.set(key, parseGlb(bytes));
    }
    return libraries.get(key)!;
  };
  for (const spec of CLIP_SPECS) {
    const name = spec.archive === "ual1" ? "Quaternius Universal Animation Library" : "Quaternius Universal Animation Library 2";
    const { def, data: clipData } = importClip(spec, library(spec.archive), name);
    reference[def.name] = { glb: `${spec.archive}.glb`, animation: spec.animation };
    writeFileSync(join(out, def.file), new Uint8Array(clipData.buffer));
    clips.push(def);
    console.log(`Clip ${def.name}: ${def.frameCount} frames, ${((def.frameCount - 1) / def.fps).toFixed(2)} s`);
  }
  writeFileSync(join(refDir, "clips.json"), JSON.stringify(reference, null, 2));

  // --- CMU motion capture library (on demand; `--no-cmu` skips it, `--cmu-limit N` for a quick run) ---
  const clipLibraries = process.argv.includes("--no-cmu")
    ? []
    : [await importCmu(CACHE, out, fetchText(CACHE, `${CMU_URL}/cmu-mocap-index-text.txt`), arg("cmu-limit") ? +arg("cmu-limit")! : Infinity)];

  // --- Manifest ---------------------------------------------------------------
  const manifest: ActorPackManifest = {
    format: "actors-pack",
    version: 1,
    id: "human-makehuman-hm08",
    species: "human",
    units: "meters",
    source: {
      name: "MakeHuman / MPFB2 (hm08 base mesh, targets, game_engine rig, eyes); Quaternius Universal Animation Library 1 + 2",
      license: "CC0-1.0 (MakeHuman assets and Quaternius animations); CMU mocap library: see clipLibraries",
      url: "https://github.com/makehumancommunity/mpfb2",
    },
    blob: "base.bin",
    vertexCount,
    basePositions,
    garmentVertexOf: blob.add("u32", Array.from(garmentVertexOf)),
    meshes,
    proxies,
    skeleton: { name: RIG, bones },
    skin,
    lods: humanLods(order),
    targets,
    clips,
    clipLibraries,
    extra: {
      human: {
        macroTargets,
        modifiers,
        adultMinAge: ADULT_MIN_AGE,
        expressionUnits: [...units],
        garmentLabels,
        garments: garmentInfo,
        anatomy: { genitalsUV: gb },
        skins,
        hairLabels,
        hairCredits,
        browLabels,
      },
    },
  };
  const bin = blob.toBuffer();
  writeFileSync(join(out, "base.bin"), bin);
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest));
  console.log(
    `Wrote ${out}: ${vertexCount} vertices, ${meshes.length} meshes, ${targets.length} targets ` +
      `(${macroTargets.length} macro, ${modifiers.length} sliders, ${units.size} expression units), ${clips.length} clips, ` +
      `base ${(bin.byteLength / 1e6).toFixed(1)} MB, targets ${(targetBytes / 1e6).toFixed(1)} MB`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
