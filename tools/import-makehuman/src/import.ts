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
} from "@actors/core";
import { BlobWriter } from "./blob";
import { fetchCached, fetchText, fetchZipEntry, fetchZipText } from "./fetch";
import { GARMENTS, garmentCut, insideFaces, selectGarmentFaces } from "./garments";
import { type Gray, blankGray, blurGray, loadGray, maxGray, rasterizeUV, resizeGray, writeJpeg, writeRgbaDownsampled, writeRgbaPng } from "./image";
import { parseMhclo } from "./mhclo";
import { type ObjData, type ObjFace, buildRenderMesh, parseObj } from "./obj";
import { CLIP_SPECS, UAL_ARCHIVES, type UalArchive, importClip } from "./clips";
import { type Gltf, parseGlb } from "./gltf";
import { readZip } from "./zip";
import type { SkinTextureDef } from "@actors/human";

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

function main() {
  const src = mpfbDir();
  const data = join(src, "src/mpfb/data");
  const out = resolve(arg("out") ?? join(ROOT, "apps/viewer/public/packs/human"));
  // Clear generated subfolders but keep the folder itself (a running dev server keeps watching it).
  for (const d of ["targets", "textures", "clips"]) {
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
  ) => {
    if (!faces.length) throw new Error(`No faces for ${name}`);
    const m = buildRenderMesh(obj, faces);
    meshes.push({
      name,
      source: { kind: "base" },
      baseIndex: blob.add("u32", m.map),
      uv: blob.add("f32", uvTransform ? uvTransform(m.uv) : m.uv),
      indices: blob.add("u32", m.indices),
      ...(clipOf ? { clip: blob.add("f32", m.map.map(clipOf)) } : {}),
      ...def,
    });
  };

  /** Catmull-Clark subdivided version of an earlier (quad) mesh; the runtime builds it at load time. */
  const addSubdividedMesh = (name: string, source: string, def: Omit<MeshDef, "name" | "source" | "baseIndex" | "uv" | "indices" | "stencil" | "subdivide">) => {
    meshes.push({ name, source: { kind: "base" }, subdivide: { source }, ...def });
  };

  /**
   * Body vertices hidden while a garment is worn: close to the garment, and
   * not near its edges (so no holes show at hems).
   */
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
    const used = new Set(gFaces.flat());
    const cell = Math.max(radius, margin);
    const grid = new Map<string, number[]>();
    const keyOf = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    for (const i of used) {
      const k = keyOf(gPos[i * 3], gPos[i * 3 + 1], gPos[i * 3 + 2]);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k)!.push(i);
    }
    const out: number[] = [];
    for (const v of groupVerts.get("body")!) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      let near = Infinity, nearEdge = Infinity;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++)
            for (const i of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              const d = Math.hypot(gPos[i * 3] - x, gPos[i * 3 + 1] - y, gPos[i * 3 + 2] - z);
              near = Math.min(near, d);
              if (boundary.has(i)) nearEdge = Math.min(nearEdge, d);
            }
      if (near < radius && nearEdge > margin) out.push(v);
    }
    return out;
  };

  // --- Body, face parts, anatomy ----------------------------------------------
  const skinMaterial: MeshDef["material"] = { kind: "skin", color: [0.8, 0.62, 0.52], roughness: 0.5 };
  addBaseMesh("body-low", facesOf("body"), {
    role: "body",
    slot: "body",
    optional: true,
    material: skinMaterial,
    textures: { maskA: "textures/skin_mask_a.png", maskB: "textures/skin_mask_b.png" },
  });
  addSubdividedMesh("body", "body-low", {
    role: "body",
    slot: "body",
    material: skinMaterial,
    textures: { maskA: "textures/skin_mask_a.png", maskB: "textures/skin_mask_b.png" },
  });
  addBaseMesh("genitals-male-low", facesOf("helper-genital"), { role: "bodypart", internal: true, material: skinMaterial });
  addSubdividedMesh("genitals-male", "genitals-male-low", {
    role: "bodypart",
    material: skinMaterial,
    tags: ["anatomy", "male"],
    textures: { maskA: "textures/skin_mask_a.png", maskB: "textures/skin_mask_b.png" },
  });
  addBaseMesh("teeth", facesOf("helper-upper-teeth", "helper-lower-teeth"), { role: "bodypart", material: { kind: "teeth", color: [0.92, 0.9, 0.84], roughness: 0.25 } });
  addBaseMesh("tongue", facesOf("helper-tongue"), { role: "bodypart", material: { kind: "mouth", color: [0.62, 0.3, 0.3], roughness: 0.35 } });
  addBaseMesh(
    "eyelashes",
    facesOf("helper-l-eyelashes-1", "helper-l-eyelashes-2", "helper-r-eyelashes-1", "helper-r-eyelashes-2"),
    { role: "hair", material: { kind: "hair", color: [0.05, 0.04, 0.035], roughness: 0.6 }, tags: ["lashes"] },
    normalizeUV,
  );

  // Eyes: MakeHuman's CC0 high-poly eye proxy with its brown iris texture.
  const eyeClo = parseMhclo(fetchText(CACHE, `${MH_RAW}/eyes/high-poly/high-poly.mhclo`));
  const eyeObj = parseObj(fetchText(CACHE, `${MH_RAW}/eyes/high-poly/high-poly.obj`));
  copyFileSync(fetchCached(CACHE, `${MH_RAW}/eyes/materials/brown_eye.png`), join(out, "textures/eye_brown.png"));
  const proxies: ProxyDef[] = [];
  const addProxy = (name: string, clo: ReturnType<typeof parseMhclo>, cloObj: ObjData, faces = cloObj.faces, legBlend?: ProxyDef["legBlend"]) => {
    const n = cloObj.positions.length / 3;
    if (clo.refs.length / 3 !== n) throw new Error(`${name}: mhclo/obj vertex count mismatch`);
    if (clo.scale.filter(Boolean).length !== 3) throw new Error(`${name}: needs x/y/z scale references`);
    proxies.push({
      name,
      vertexCount: n,
      refs: blob.add("u32", clo.refs),
      weights: blob.add("f32", clo.weights),
      offsets: blob.add("f32", clo.offsets.map((v) => v * SCALE)),
      scaleRefs: clo.scale.map(([a, b, l]) => [a, b, l * SCALE]) as ProxyDef["scaleRefs"],
      ...(legBlend ? { legBlend } : {}),
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
    material: { kind: "eye", color: [1, 1, 1], roughness: 0.05 },
    textures: { color: "textures/eye_brown.png" },
  });

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
  for (const spec of GARMENTS) {
    const cut = garmentCut(tightsFaces, spec, garmentCtx);
    const faces = selectGarmentFaces(tightsFaces, cut);
    // Does it cover the genitals? Then adapters hide genital geometry while it is worn.
    const coversGenitals = insideFaces(faces, cut).some((f) => f.v.some((v) => Math.hypot(P[v * 3] - genitalCenter[0], P[v * 3 + 1] - genitalCenter[1], P[v * 3 + 2] - genitalCenter[2]) < 0.06));
    addBaseMesh(
      spec.name,
      faces,
      {
        role: "garment",
        optional: true,
        inflate: spec.inflate,
        material: { kind: "cloth", color: spec.color, roughness: spec.roughness },
        tags: [`fabric:${spec.fabric}`, ...(coversGenitals ? ["covers:anatomy"] : [])],
        hidesBaseVertices: blob.add("u32", coveredBody(P, insideFaces(faces, cut).map((f) => f.v))),
      },
      normalizeUV,
      (v) => cut.get(v)!,
    );
    garmentLabels[spec.name] = spec.label;
    console.log(`Garment ${spec.name}: ${faces.length} faces`);
  }
  addBaseMesh("tights", tightsFaces, { role: "garment", optional: true, inflate: 0.001, material: { kind: "cloth", color: [0.08, 0.08, 0.1], roughness: 0.6 }, tags: ["fabric:knit", "covers:anatomy"] }, normalizeUV);
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
    material: { kind: "cloth", color: [0.85, 0.85, 0.82], roughness: 0.9 },
    optional: true,
    inflate: 0.002,
    tags: ["fabric:knit"],
    // The asset's own delete list is a placeholder (mostly face vertices), so derive one.
    hidesBaseVertices: blob.add("u32", coveredBody(sockObj.positions.map((v) => v * SCALE), sockObj.faces.map((f) => f.v), 0.03, 0.03)),
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
      material: { kind: "cloth", color: mean as [number, number, number], roughness: 0.8 },
      ...(diffuse ? { textures: { color: file } } : {}),
      optional: true,
      inflate,
      slot: "skirt",
      tags: ["fabric:smooth"],
    });
    garmentLabels[name] = label;
  }

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
      // Mean colour of the texture, so adapters can recolour it.
      material: { kind: "hair", color: mean, roughness: 0.45 },
      textures: { color: file },
      tags: [slot === "hair" ? "scalp" : "brows"],
    });
    return name;
  };
  for (const [id, label] of HAIRS) hairLabels[addHairProxy("hair", id, "hair", 1024, true)] = label;
  // Eyebrows: MakeHuman's CC0 eyebrow proxies; the first one is shown by default.
  const BROWS: [string, string][] = [
    ["eyebrow001", "Natural"],
    ["eyebrow003", "Thin"],
    ["eyebrow006", "Arched"],
    ["eyebrow009", "Bushy"],
    ["eyebrow011", "Straight"],
  ];
  BROWS.forEach(([id, label], i) => (browLabels[addHairProxy("eyebrows", id, "brows", 512, i > 0)] = label));
  console.log(`Hair: ${HAIRS.length} styles`);

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
        skins.push({ age, gender, ethnicity, file });
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

  // --- Manifest ---------------------------------------------------------------
  const manifest: ActorPackManifest = {
    format: "actors-pack",
    version: 1,
    id: "human-makehuman-hm08",
    species: "human",
    units: "meters",
    source: {
      name: "MakeHuman / MPFB2 (hm08 base mesh, targets, game_engine rig, eyes); Quaternius Universal Animation Library 1 + 2",
      license: "CC0-1.0 (MakeHuman assets and Quaternius animations)",
      url: "https://github.com/makehumancommunity/mpfb2",
    },
    blob: "base.bin",
    vertexCount,
    basePositions,
    meshes,
    proxies,
    skeleton: { name: RIG, bones },
    skin,
    targets,
    clips,
    extra: {
      human: {
        macroTargets,
        modifiers,
        adultMinAge: ADULT_MIN_AGE,
        expressionUnits: [...units],
        garmentLabels,
        anatomy: { genitalsUV: gb },
        skins,
        hairLabels,
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

main();
