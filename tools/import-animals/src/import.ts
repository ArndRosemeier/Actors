/**
 * Builds the dog actor pack: Mesh2Motion's CC0 quadruped rig and clips, plus a
 * body generated around that rig (implicit surface, see dog.ts), breed morphs
 * (targets.ts) and coat data for the fur material.
 *
 *   npm run import:animals [-- --out <dir>] [--cell <meters>] [--triangles <n>]
 *
 * The rig file is downloaded once into .cache/. No mesh is taken from the
 * source; only its skeleton and animations.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ActorPackManifest, type BoneDef, type ClipDef, type LodDef, type MeshDef, type TargetRef, type Vec3, encodeTarget, normalize } from "@actors/core";
import { BlobWriter } from "../../import-makehuman/src/blob";
import { fetchCached } from "../../import-makehuman/src/fetch";
import { parseGlb } from "../../import-makehuman/src/gltf";
import { ready as meshoptReady, simplifyLevels } from "../../import-makehuman/src/lod";
import { meshBody, skinBody } from "./bodymesh";
import { convertClips } from "./clips";
import { dogBody } from "./dog";
import { readRig } from "./rig";
import { FOX_ANIMATIONS, MESH2MOTION_COMMIT, SOURCE_NOTE } from "./source";
import { dogMorphs } from "./targets";

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

async function main(): Promise<void> {
  const out = resolve(arg("out") ?? join(ROOT, "apps/viewer/public/packs/dog"));
  const cell = Number(arg("cell") ?? 0.0035);
  const triangles = Number(arg("triangles") ?? 44000);

  const glb = parseGlb(readFileSync(fetchCached(CACHE, FOX_ANIMATIONS)));
  const source = readRig(glb);
  const body = dogBody(source);
  const { rig } = body;

  let t = Date.now();
  const surface = await meshBody(body, cell, triangles);
  const skinned = skinBody(body, surface);
  console.log(`Body: ${skinned.positions.length / 3} vertices, ${skinned.indices.length / 3} triangles (${Date.now() - t} ms)`);

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
  const morphs = dogMorphs({
    positions: Float32Array.from(positions),
    rig,
    weight: weightOf,
    anchor: (v) => eyeOf(v)?.center ?? null,
    stop: rig.bones[boneIndex.get("Nose")!].head,
    noseTip: rig.bones[boneIndex.get("Head.tip")!].tail,
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
      material: { kind: "fur", color: [0.55, 0.38, 0.22] },
      simplified,
      attributes: {
        furFlow: attr(skinned.flow, 3),
        coatA: attr(skinned.coatA, 4),
        coatB: attr(skinned.coatB, 4),
        coatC: attr(skinned.coatC, 4),
        coatD: attr(skinned.coatD, 4),
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
      material: { kind: "eye", color: [0.35, 0.2, 0.08] },
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
  for (const { def, data } of convertClips(glb, source)) {
    writeFileSync(join(out, def.file), new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    clips.push(def);
  }

  const lods: LodDef[] = [
    { name: "Full", distance: 0 },
    { name: "Medium", distance: 5 },
    { name: "Crowd", distance: 16, bones: rig.bones.filter((b) => !/Tip|tip|Foot_1/.test(b.name)).map((b) => b.name), merge: true },
  ];

  const manifest: ActorPackManifest = {
    format: "actors-pack",
    version: 1,
    id: "dog",
    species: "dog",
    units: "meters",
    source: { name: `Generated dog body; ${SOURCE_NOTE}`, license: "CC0-1.0", url: `https://github.com/scottpetrovic/mesh2motion-app/tree/${MESH2MOTION_COMMIT}` },
    blob: "base.bin",
    vertexCount,
    basePositions,
    meshes,
    proxies: [],
    skeleton: { name: "quadruped", bones },
    skin: { joints: blob.add("u16", joints), weights: blob.add("f32", weights) },
    targets,
    clips,
    lods,
    extra: { animal: { kind: "dog", visibleVertices: nVisible, morphs: morphs.map((m) => m.name) } },
  };
  writeFileSync(join(out, "base.bin"), blob.toBuffer());
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest));
  console.log(`Wrote ${out}: ${vertexCount} vertices, ${targets.length} morphs, ${clips.length} clips (${Date.now() - t} ms)`);
  t = Date.now();
}

await main();
