/**
 * Builds the animal actor packs:
 * - dog and squirrel: Mesh2Motion's CC0 quadruped rig and clips, plus a body
 *   generated around that rig (implicit surface, see dog.ts and squirrel.ts),
 *   shape morphs (targets.ts) and coat data for the fur material. Both share
 *   the rig's bones, so clips play on either; the squirrel adds its own clips;
 * - deer: the rig and clips of Quaternius' CC0 low-poly Deer, a sika hind body
 *   generated the same way (deer.ts, deercoat.ts, deermorphs.ts).
 *
 *   npm run import:animals [-- --only dog|squirrel|deer] [--out <dir>] [--cell <meters>] [--triangles <n>]
 *
 * Source files are downloaded once into .cache/. No mesh is taken from the
 * sources; only their skeletons and animations.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ActorPackManifest, type BoneDef, type ClipDef, type LodDef, type MeshDef, type TargetRef, type Vec3, encodeTarget, normalize } from "@actors/core";
import { BlobWriter } from "../../import-makehuman/src/blob";
import { fetchCached } from "../../import-makehuman/src/fetch";
import { parseGlb } from "../../import-makehuman/src/gltf";
import { ready as meshoptReady, simplifyLevels } from "../../import-makehuman/src/lod";
import { type CoatFunction, meshBody, skinBody } from "./bodymesh";
import { type ClipOptions, convertClips } from "./clips";
import { DEER_SKIP, deerBody } from "./deer";
import { deerCoat } from "./deercoat";
import { deerMorphs } from "./deermorphs";
import { type DogBody, dogBody } from "./dog";
import type { Gltf } from "../../import-makehuman/src/gltf";
import { QUATERNIUS_NOTE, QUATERNIUS_PACK, deerGlb } from "./quaternius";
import { type Rig, readRig } from "./rig";
import { squirrelBody } from "./squirrel";
import { squirrelClips } from "./squirrelclips";
import { FOX_ANIMATIONS, MESH2MOTION_COMMIT, SOURCE_NOTE } from "./source";
import { type Morph, type MorphInput, dogMorphs, squirrelMorphs } from "./targets";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CACHE = join(ROOT, ".cache");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** A UV sphere whose pole looks along `look` (u around, v from the front pole). */
function eyeSphere(center: Vec3, radius: number, look: Vec3, rings = 14, segments = 20) {
  const w = normalize(look);
  const u = normalize(Math.abs(w[1]) < 0.9 ? [w[2], 0, -w[0]] : [1, 0, 0]);
  const v: Vec3 = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const th = (r / rings) * Math.PI;
    for (let s = 0; s <= segments; s++) {
      const ph = (s / segments) * Math.PI * 2;
      const d = [0, 1, 2].map((k) => w[k] * Math.cos(th) + (u[k] * Math.cos(ph) + v[k] * Math.sin(ph)) * Math.sin(th));
      positions.push(center[0] + d[0] * radius, center[1] + d[1] * radius, center[2] + d[2] * radius);
      uv.push(s / segments, r / rings);
    }
  }
  const row = segments + 1;
  for (let r = 0; r < rings; r++)
    for (let s = 0; s < segments; s++) {
      const a = r * row + s, b = a + row;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  return { positions, uv, indices };
}

/** What one animal pack is built from. */
interface AnimalSpec {
  id: string;
  glb: Gltf;
  /** Rig as read from the source (its bones keep their glTF nodes, for the clips). */
  source: Rig;
  body: DogBody;
  coat?: CoatFunction;
  morphs: (input: MorphInput) => Morph[];
  /** Base vertex of the nose tip and of the "stop" (between the eyes) for morphs. */
  noseTip: Vec3;
  stop: Vec3;
  clipSource: string;
  clipOptions?: ClipOptions;
  /** Clips of its own (made on its re-posed rig); they win over the source's where names clash. */
  ownClips?(rig: Rig): ReturnType<typeof convertClips>;
  /** Bones the crowd level leaves out. */
  crowdDrops: RegExp;
  furColor: [number, number, number];
  eyeColor: [number, number, number];
  manifestSource: ActorPackManifest["source"];
  cell: number;
  triangles: number;
}

const DEER_CLIPS: [string, string, boolean, string][] = [
  ["idle", "Idle", true, "Idle"],
  ["idle2", "Idle_2", true, "Idle"],
  ["headLow", "Idle_Headlow", true, "Idle"],
  ["eat", "Eating", true, "Idle"],
  ["walk", "Walk", true, "Locomotion"],
  ["gallop", "Gallop", true, "Locomotion"],
  ["leap", "Gallop_Jump", false, "Locomotion"],
  ["jump", "Jump_toIdle", false, "Locomotion"],
  ["headbutt", "Attack_Headbutt", false, "Actions"],
  ["kick", "Attack_Kick", false, "Actions"],
  ["hit", "Idle_HitReact1", false, "Reactions"],
  ["hit2", "Idle_HitReact2", false, "Reactions"],
  ["death", "Death", false, "Reactions"],
];

/** Dog and squirrel: bodies on Mesh2Motion's fox rig (same bones, so every dog clip plays on both). */
function quadrupedSpec(id: "dog" | "squirrel", cell: number, triangles: number): AnimalSpec {
  const glb = parseGlb(readFileSync(fetchCached(CACHE, FOX_ANIMATIONS)));
  const source = readRig(glb);
  const squirrel = id === "squirrel";
  const body = (squirrel ? squirrelBody : dogBody)(source);
  const bone = (n: string) => body.rig.bones[body.rig.index.get(n)!];
  return {
    id,
    glb,
    source,
    body,
    morphs: squirrel ? squirrelMorphs : dogMorphs,
    noseTip: bone("Head.tip").tail,
    stop: bone("Nose").head,
    clipSource: "Mesh2Motion fox rig (CC0)",
    ownClips: squirrel ? squirrelClips : undefined,
    crowdDrops: /Tip|tip|Foot_1/,
    furColor: squirrel ? [0.5, 0.45, 0.38] : [0.55, 0.38, 0.22],
    eyeColor: squirrel ? [0.02, 0.018, 0.016] : [0.35, 0.2, 0.08],
    manifestSource: { name: `Generated ${squirrel ? "grey squirrel" : "dog"} body; ${SOURCE_NOTE}`, license: "CC0-1.0", url: `https://github.com/scottpetrovic/mesh2motion-app/tree/${MESH2MOTION_COMMIT}` },
    cell,
    triangles,
  };
}

function deerSpec(cell: number, triangles: number): AnimalSpec {
  const glb = parseGlb(deerGlb(CACHE));
  const source = readRig(glb, DEER_SKIP);
  const body = deerBody(source);
  const eye = body.eyes[0].center;
  return {
    id: "deer",
    glb,
    // The clips are read for the deer's bones (pole targets and root left out, feet re-parented).
    source: body.rig,
    body,
    coat: deerCoat,
    morphs: deerMorphs,
    noseTip: body.marks.nose,
    stop: [0, eye[1], eye[2] + 0.02],
    clipSource: "Quaternius Deer (CC0)",
    clipOptions: { clips: DEER_CLIPS, rootBone: "Back", feet: (n) => /^FFB?\.[LR]$/.test(n), tailMotion: 0.6 },
    crowdDrops: /^Ear[34]|^FFB?\.|^Tail3/,
    furColor: [0.45, 0.25, 0.12],
    eyeColor: [0.12, 0.07, 0.04],
    manifestSource: { name: `Generated sika deer body; ${QUATERNIUS_NOTE}`, license: "CC0-1.0", url: QUATERNIUS_PACK },
    cell,
    triangles,
  };
}

async function buildPack(spec: AnimalSpec, out: string): Promise<void> {
  const { body, glb } = spec;
  const { rig } = body;

  let t = Date.now();
  const surface = await meshBody(body, spec.cell, spec.triangles);
  const skinned = skinBody(body, surface, spec.coat);
  console.log(`${spec.id} body: ${skinned.positions.length / 3} vertices, ${skinned.indices.length / 3} triangles (${Date.now() - t} ms)`);

  // --- Base vertices: body, eyes, then one helper vertex per joint (heads and tails). ---
  const nBody = skinned.positions.length / 3;
  const positions: number[] = Array.from(skinned.positions);
  const joints: number[] = Array.from(skinned.joints);
  const weights: number[] = Array.from(skinned.weights);
  const headBone = rig.index.get("Head")!;
  const eyeMeshes = body.eyes.map((e) => {
    const s = eyeSphere(e.center, e.radius * 0.97, e.look);
    const first = positions.length / 3;
    positions.push(...s.positions);
    for (let i = 0; i < s.positions.length / 3; i++) {
      joints.push(headBone, 0, 0, 0);
      weights.push(1, 0, 0, 0);
    }
    return { first, count: s.positions.length / 3, ...s, center: e.center };
  });
  const nVisible = positions.length / 3;
  const helper = (p: Vec3, bone: number) => {
    positions.push(...p);
    joints.push(bone, 0, 0, 0);
    weights.push(1, 0, 0, 0);
    return positions.length / 3 - 1;
  };
  const bones: BoneDef[] = rig.bones.map((b, i) => ({
    name: b.name,
    parent: b.parent,
    head: { vertices: [helper(b.head, i)] },
    tail: { vertices: [helper(b.tail, i)] },
    roll: b.roll,
  }));
  const vertexCount = positions.length / 3;

  // --- Morph targets ---
  const boneIndex = rig.index;
  const weightOf = (v: number, name: string) => {
    const b = boneIndex.get(name);
    if (b === undefined) return 0;
    let w = 0;
    for (let k = 0; k < 4; k++) if (joints[v * 4 + k] === b) w += weights[v * 4 + k];
    return w;
  };
  const eyeOf = (v: number) => eyeMeshes.find((e) => v >= e.first && v < e.first + e.count);
  const morphs = spec.morphs({
    positions: Float32Array.from(positions),
    rig,
    weight: weightOf,
    anchor: (v) => eyeOf(v)?.center ?? null,
    stop: spec.stop,
    noseTip: spec.noseTip,
    eyeCenter: body.eyes[0].center,
  });

  // --- Write the pack ---
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "targets"), { recursive: true });
  mkdirSync(join(out, "clips"), { recursive: true });
  const blob = new BlobWriter();
  const basePositions = blob.add("f32", positions);

  await meshoptReady;
  const bodyMap = Uint32Array.from({ length: nBody }, (_, i) => i);
  const simplified = simplifyLevels(blob, positions, { map: bodyMap, indices: skinned.indices }, [
    [1, 0.3, 0.004],
    [2, 0.08, 0.02],
  ]);
  const attr = (data: Float32Array, size: 1 | 2 | 3 | 4) => ({ data: blob.add("f32", data), size });
  const meshes: MeshDef[] = [
    {
      name: "body",
      source: { kind: "base" },
      role: "body",
      baseIndex: blob.add("u32", bodyMap),
      uv: blob.add("f32", skinned.uv),
      indices: blob.add("u32", skinned.indices),
      material: { kind: "fur", color: spec.furColor },
      simplified,
      attributes: {
        furFlow: attr(skinned.flow, 3),
        coatA: attr(skinned.coatA, 4),
        coatB: attr(skinned.coatB, 4),
        coatC: attr(skinned.coatC, 4),
        coatD: attr(skinned.coatD, 4),
        coatE: attr(skinned.coatE, 4),
        coatF: attr(skinned.coatF, 4),
        // Base-pack position, so coat patterns stay put whatever the breed shape.
        coatPos: attr(skinned.positions, 3),
      },
    },
    {
      name: "eyes",
      source: { kind: "base" },
      role: "eyes",
      baseIndex: blob.add("u32", eyeMeshes.flatMap((e) => Array.from({ length: e.count }, (_, i) => e.first + i))),
      uv: blob.add("f32", eyeMeshes.flatMap((e) => e.uv)),
      indices: blob.add(
        "u32",
        eyeMeshes.flatMap((e, k) => {
          const offset = eyeMeshes.slice(0, k).reduce((a, m) => a + m.count, 0);
          return e.indices.map((i) => i + offset);
        }),
      ),
      material: { kind: "eye", color: spec.eyeColor },
      tags: ["animal"],
      lods: [0, 1],
    },
  ];

  const targets: TargetRef[] = [];
  for (const m of morphs) {
    const idx: number[] = [], del: number[] = [];
    for (let v = 0; v < vertexCount; v++) {
      const d = m.deltas.subarray(v * 3, v * 3 + 3);
      if (Math.hypot(d[0], d[1], d[2]) < 1e-6) continue;
      idx.push(v);
      del.push(d[0], d[1], d[2]);
    }
    const file = `targets/${m.name}.bin`;
    writeFileSync(join(out, file), new Uint8Array(encodeTarget(idx, del, vertexCount)));
    targets.push({ name: m.name, group: m.group, file, count: idx.length });
  }

  const clips: ClipDef[] = [];
  // Its own clips first, then the source rig's (they play on any re-posed copy of the rig).
  for (const { def, data } of [...(spec.ownClips?.(rig) ?? []), ...convertClips(glb, spec.source, spec.clipSource, spec.clipOptions)]) {
    if (clips.some((c) => c.name === def.name)) continue;
    writeFileSync(join(out, def.file), new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    clips.push(def);
  }

  const lods: LodDef[] = [
    { name: "Full", distance: 0 },
    { name: "Medium", distance: 5 },
    { name: "Crowd", distance: 16, bones: rig.bones.filter((b) => !spec.crowdDrops.test(b.name)).map((b) => b.name), merge: true },
  ];

  const manifest: ActorPackManifest = {
    format: "actors-pack",
    version: 1,
    id: spec.id,
    species: spec.id,
    units: "meters",
    source: spec.manifestSource,
    blob: "base.bin",
    vertexCount,
    basePositions,
    meshes,
    proxies: [],
    skeleton: { name: spec.id === "deer" ? "deer" : "quadruped", bones },
    skin: { joints: blob.add("u16", joints), weights: blob.add("f32", weights) },
    targets,
    clips,
    lods,
    extra: { animal: { kind: spec.id, visibleVertices: nVisible, morphs: morphs.map((m) => m.name) } },
  };
  writeFileSync(join(out, "base.bin"), blob.toBuffer());
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest));
  console.log(`Wrote ${out}: ${vertexCount} vertices, ${targets.length} morphs, ${clips.length} clips (${Date.now() - t} ms)`);
  t = Date.now();
}

async function main(): Promise<void> {
  const only = arg("only");
  const ids = only ? only.split(",") : ["dog", "squirrel", "deer"];
  if (arg("out") && ids.length > 1) throw new Error("--out needs --only <animal>");
  const specs: Record<string, (cell: number, triangles: number) => AnimalSpec> = {
    dog: (c, t) => quadrupedSpec("dog", c, t),
    squirrel: (c, t) => quadrupedSpec("squirrel", c, t),
    deer: deerSpec,
  };
  const defaults: Record<string, [number, number]> = { dog: [0.0035, 44000], squirrel: [0.0011, 40000], deer: [0.003, 52000] };
  for (const id of ids) {
    const make = specs[id];
    if (!make) throw new Error(`Unknown animal ${id}`);
    const [cell, triangles] = defaults[id];
    const spec = make(Number(arg("cell") ?? cell), Number(arg("triangles") ?? triangles));
    await buildPack(spec, resolve(arg("out") ?? join(ROOT, `apps/viewer/public/packs/${id}`)));
  }
}

await main();
