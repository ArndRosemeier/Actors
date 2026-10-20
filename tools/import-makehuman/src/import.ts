/**
 * Converts MakeHuman/MPFB2 CC0 assets into an actor pack.
 *
 *   npm run import:human [-- --mpfb <path to mpfb2 checkout>] [--out <dir>]
 *
 * Without --mpfb, the MPFB2 repository is shallow-cloned into .cache/mpfb2.
 * Only CC0 data (base mesh, targets, rig, weights, a CC0 test garment) is used;
 * no MakeHuman/MPFB code is copied.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ActorPackManifest, type BoneDef, type MeshDef, type ProxyDef, type TargetRef, encodeTarget } from "@actors/core";
import { BlobWriter } from "./blob";
import { parseMhclo } from "./mhclo";
import { type ObjFace, buildRenderMesh, parseObj } from "./obj";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCALE = 0.1; // MakeHuman units are decimeters
const RIG = "game_engine";
const ADULT_MIN_AGE = 18;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function mpfbDir(): string {
  const given = arg("mpfb");
  if (given) return resolve(given);
  const dir = join(ROOT, ".cache/mpfb2");
  if (!existsSync(join(dir, "src/mpfb/data"))) {
    console.log("Cloning makehumancommunity/mpfb2 (shallow) into .cache/mpfb2 ...");
    mkdirSync(dirname(dir), { recursive: true });
    execFileSync("git", ["clone", "--depth", "1", "https://github.com/makehumancommunity/mpfb2", dir], {
      stdio: "inherit",
      env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "1" },
    });
  }
  return dir;
}

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

function main() {
  const src = mpfbDir();
  const data = join(src, "src/mpfb/data");
  const out = resolve(arg("out") ?? join(ROOT, "apps/viewer/public/packs/human"));
  // Clear old targets but keep the folder itself (a running dev server keeps watching it).
  rmSync(join(out, "targets"), { recursive: true, force: true });
  mkdirSync(join(out, "targets"), { recursive: true });

  // --- Base mesh ---------------------------------------------------------
  const obj = parseObj(readFileSync(join(data, "3dobjs/base.obj"), "utf8"));
  const vertexCount = obj.positions.length / 3;
  const blob = new BlobWriter();
  const basePositions = blob.add("f32", obj.positions.map((v) => v * SCALE));

  const groupVerts = new Map<string, number[]>();
  const groupFaces = new Map<string, ObjFace[]>();
  for (const f of obj.faces) {
    if (!groupFaces.has(f.group)) groupFaces.set(f.group, []);
    groupFaces.get(f.group)!.push(f);
    const set = groupVerts.get(f.group) ?? [];
    for (const v of f.v) if (!set.includes(v)) set.push(v);
    groupVerts.set(f.group, set);
  }

  const meshes: MeshDef[] = [];
  const addBaseMesh = (name: string, groups: string[], role: MeshDef["role"], material: MeshDef["material"], optional = false) => {
    const faces = groups.flatMap((g) => groupFaces.get(g) ?? []);
    if (!faces.length) throw new Error(`No faces for ${groups}`);
    const m = buildRenderMesh(obj, faces);
    meshes.push({
      name,
      source: { kind: "base" },
      role,
      baseIndex: blob.add("u32", m.map),
      uv: blob.add("f32", m.uv),
      indices: blob.add("u32", m.indices),
      material,
      optional: optional || undefined,
    });
  };
  addBaseMesh("body", ["body"], "body", { kind: "skin", color: [0.8, 0.62, 0.52], roughness: 0.55 });
  addBaseMesh("eyes", ["helper-l-eye", "helper-r-eye"], "eyes", { kind: "eye", color: [0.95, 0.95, 0.95], roughness: 0.1 });
  // MakeHuman's helper geometry doubles as simple garments: it is part of the base mesh, so it follows every morph for free.
  addBaseMesh("tights", ["helper-tights"], "garment", { kind: "cloth", color: [0.08, 0.08, 0.1], roughness: 0.7 }, true);
  addBaseMesh("skirt", ["helper-skirt"], "garment", { kind: "cloth", color: [0.35, 0.12, 0.15], roughness: 0.8 }, true);

  // --- Proxy garment (fitted via .mhclo binding) ---------------------------
  const proxies: ProxyDef[] = [];
  const testdata = join(src, "test/testdata");
  const clo = parseMhclo(readFileSync(join(testdata, "better_socks_low.mhclo"), "utf8"));
  const cloObj = parseObj(readFileSync(join(testdata, clo.objFile), "utf8"));
  const proxyVerts = cloObj.positions.length / 3;
  if (clo.refs.length / 3 !== proxyVerts) throw new Error("mhclo/obj vertex count mismatch");
  if (clo.scale.length !== 3) throw new Error("mhclo needs x/y/z scale references");
  proxies.push({
    name: "socks",
    vertexCount: proxyVerts,
    refs: blob.add("u32", clo.refs),
    weights: blob.add("f32", clo.weights),
    offsets: blob.add("f32", clo.offsets.map((v) => v * SCALE)),
    scaleRefs: clo.scale.map(([a, b, l]) => [a, b, l * SCALE]) as ProxyDef["scaleRefs"],
  });
  const socks = buildRenderMesh(cloObj, cloObj.faces);
  meshes.push({
    name: "socks",
    source: { kind: "proxy", proxy: "socks" },
    role: "garment",
    baseIndex: blob.add("u32", socks.map),
    uv: blob.add("f32", socks.uv),
    indices: blob.add("u32", socks.indices),
    material: { kind: "cloth", color: [0.85, 0.85, 0.82], roughness: 0.9 },
    optional: true,
    // This CC0 test garment ships a placeholder delete list (11500-13000, mostly the face), so we
    // derive our own: body skin within 3 cm of the garment is hidden while it is worn.
    hidesBaseVertices: blob.add("u32", coveredBodyVertices(cloObj.positions.map((v) => v * SCALE), 0.03)),
  });

  function coveredBodyVertices(garment: number[], radius: number): number[] {
    const cell = radius;
    const grid = new Map<string, number[]>();
    const keyOf = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    for (let i = 0; i < garment.length; i += 3) {
      const k = keyOf(garment[i], garment[i + 1], garment[i + 2]);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k)!.push(i);
    }
    const out: number[] = [];
    for (const v of groupVerts.get("body")!) {
      const x = obj.positions[v * 3] * SCALE, y = obj.positions[v * 3 + 1] * SCALE, z = obj.positions[v * 3 + 2] * SCALE;
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      search: for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++)
            for (const i of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              if (Math.hypot(garment[i] - x, garment[i + 1] - y, garment[i + 2] - z) < radius) {
                out.push(v);
                break search;
              }
            }
    }
    return out;
  }

  // --- Skeleton -------------------------------------------------------------
  type RigBone = {
    parent: string;
    roll: number;
    head: { strategy: string; cube_name?: string; vertex_indices?: number[]; default_position: number[] };
    tail: RigBone["head"];
  };
  const rig = JSON.parse(readFileSync(join(data, `rigs/standard/rig.${RIG}.json`), "utf8")) as Record<string, RigBone>;
  const order: string[] = [];
  const visit = (name: string) => {
    if (order.includes(name)) return;
    if (rig[name].parent) visit(rig[name].parent);
    order.push(name);
  };
  Object.keys(rig).forEach(visit);
  const jointVerts = (j: RigBone["head"]): number[] => {
    if (j.strategy === "CUBE") {
      const v = groupVerts.get(j.cube_name!);
      if (!v) throw new Error(`Missing joint cube ${j.cube_name}`);
      return v;
    }
    if (j.strategy === "MEAN" || j.strategy === "VERTEX") return j.vertex_indices!;
    throw new Error(`Unsupported joint strategy ${j.strategy}`);
  };
  const bones: BoneDef[] = order.map((name) => ({
    name,
    parent: rig[name].parent ? order.indexOf(rig[name].parent) : -1,
    head: { vertices: jointVerts(rig[name].head) },
    tail: { vertices: jointVerts(rig[name].tail) },
    roll: rig[name].roll ?? 0,
  }));
  // Sanity check against MPFB's own default joint positions (Blender coords: x, -z, y).
  let maxErr = 0;
  for (const name of order) {
    if (name === "Root") continue; // MPFB stores the root at the origin; we keep it on the ground joint
    const verts = jointVerts(rig[name].head);
    const p = [0, 1, 2].map((c) => verts.reduce((s, v) => s + obj.positions[v * 3 + c], 0) / verts.length * SCALE);
    const d = rig[name].head.default_position;
    maxErr = Math.max(maxErr, Math.hypot(p[0] - d[0], -p[2] - d[1], p[1] - d[2]));
  }
  console.log(`Skeleton: ${bones.length} bones, max joint deviation from MPFB's stored defaults ${(maxErr * 1000).toFixed(2)} mm`);

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
  const macroDirs = ["macrodetails", "macrodetails/height", "macrodetails/proportions", "breast"];
  for (const dir of macroDirs) {
    for (const f of readdirSync(join(data, "targets", dir)).sort()) {
      if (!f.endsWith(".target.gz")) continue;
      const base = f.replace(".target.gz", "");
      const tokens = base.split("-").filter((t) => t !== "universal");
      if (!/^(female|male|african|asian|caucasian|universal)/.test(base)) continue; // detail breast targets handled below
      if (tokens.includes("baby")) continue; // never used: adult-only
      const name = `macro/${base}`;
      if (writeTarget(name, "macro", join(data, "targets", dir, f))) macroTargets.push({ name, tokens });
    }
  }

  // Detail modifiers from MPFB's target index.
  type Category = { name: string; label: string; targets: string[]; opposites: Record<string, string> };
  const index = JSON.parse(readFileSync(join(data, "targets/target.json"), "utf8")) as Record<string, { categories: Category[] }>;
  const SKIP_GROUPS = new Set(["expression", "genitals", "measure"]);
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
      const label = cat.name.replace(/-(decr-incr|down-up|in-out|backward-forward|forward-backward|less-more|compress-uncompress|out-in|up-down|min-max|left-right|concave-convex|moveup-movedown|movedown-moveup)$/, "").replace(/-/g, " ");
      modifiers.push({ id: `${group}/${cat.name}`, group, label, negative, positive });
    }
  }

  // --- Manifest ---------------------------------------------------------------
  const manifest: ActorPackManifest = {
    format: "actors-pack",
    version: 1,
    id: "human-makehuman-hm08",
    species: "human",
    units: "meters",
    source: { name: "MakeHuman / MPFB2 (hm08 base mesh, targets, game_engine rig)", license: "CC0-1.0", url: "https://github.com/makehumancommunity/mpfb2" },
    blob: "base.bin",
    vertexCount,
    basePositions,
    meshes,
    proxies,
    skeleton: { name: RIG, bones },
    skin,
    targets,
    extra: { human: { macroTargets, modifiers, adultMinAge: ADULT_MIN_AGE } },
  };
  const bin = blob.toBuffer();
  writeFileSync(join(out, "base.bin"), bin);
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest));
  console.log(
    `Wrote ${out}: ${vertexCount} vertices, ${meshes.length} meshes, ${targets.length} targets ` +
      `(${macroTargets.length} macro, ${modifiers.length} sliders), base ${(bin.byteLength / 1e6).toFixed(1)} MB, ` +
      `targets ${(targetBytes / 1e6).toFixed(1)} MB`,
  );
}

main();
