/**
 * Writes reference results of the TypeScript runtime (@actors/core) for the Rust port's
 * golden tests (rust/crates/actors-core/tests/golden.rs).
 *
 *   npx tsx rust/golden/dump.ts <packs dir> <out dir>
 *
 * Each case writes `<out>/<case>/index.json` (array name -> file, length) and one
 * little-endian f32 file per array.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ActorRuntime, Retargeter, bindPose, createPose, lodBoneMap, lodLevels, mergeMeshes, poseWorld, type ActorShape, type Fetcher } from "../../packages/core/src/index";
import { CASES } from "./cases";

const [packs, out] = process.argv.slice(2);
if (!packs || !out) throw new Error("usage: dump.ts <packs dir> <out dir>");

const fetcher: Fetcher = async (url) => {
  const b = readFileSync(url);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

class Writer {
  private index: Record<string, { file: string; length: number }> = {};
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  put(name: string, data: ArrayLike<number>) {
    const file = name.replace(/[^a-zA-Z0-9_.-]/g, "_") + ".f32";
    writeFileSync(join(this.dir, file), Buffer.from(Float32Array.from(data).buffer));
    this.index[name] = { file, length: data.length };
  }
  done() {
    writeFileSync(join(this.dir, "index.json"), JSON.stringify(this.index, null, 1));
  }
}

const flat = (list: ArrayLike<number>[]) => list.flatMap((v) => Array.from(v));

for (const c of CASES) {
  const rt = await ActorRuntime.load(join(packs, c.pack, "manifest.json"), fetcher);
  if (c.load?.length) await rt.loadMeshes(c.load);
  const weights = new Map(Object.entries(c.weights));
  const shape: ActorShape = await rt.evaluate(weights, undefined, c.options, c.fit);
  const w = new Writer(join(out, c.name));
  w.put("positions", shape.positions);
  w.put("normals", shape.normals);
  for (const [name, p] of shape.proxies) {
    w.put(`proxy:${name}:positions`, p.positions);
    w.put(`proxy:${name}:normals`, p.normals);
  }
  for (const [name, m] of shape.meshes) {
    w.put(`mesh:${name}:positions`, m.positions);
    w.put(`mesh:${name}:normals`, m.normals);
  }
  const sk = shape.skeleton!;
  w.put("skeleton:heads", flat(sk.heads));
  w.put("skeleton:tails", flat(sk.tails));
  w.put("skeleton:localPositions", flat(sk.localPositions));
  w.put("skeleton:localRotations", flat(sk.localRotations));
  w.put("skeleton:worldRotations", flat(sk.worldRotations));
  for (const name of c.skins ?? []) {
    const m = rt.meshes.find((x) => x.def.name === name)!;
    w.put(`skin:${name}:joints`, m.joints!);
    w.put(`skin:${name}:weights`, m.weights!);
    w.put(`skin:${name}:map`, m.map);
    w.put(`skin:${name}:uv`, m.uv);
    w.put(`skin:${name}:indices`, m.indices);
  }
  for (const [clip, times] of Object.entries(c.clips ?? {})) {
    for (const inPlace of [false, true, "drift"] as const) {
      const r = new Retargeter(sk, await rt.loadClip(clip), { inPlace });
      const pose = createPose(sk.names.length);
      for (const t of times) {
        r.sampleInto(t, pose);
        const tag = `clip:${clip}:${String(inPlace)}:${t}`;
        w.put(`${tag}:rotations`, pose.rotations);
        w.put(`${tag}:root`, [...pose.root, pose.rootIndex]);
        const rot = new Float64Array(sk.names.length * 4), heads = new Float64Array(sk.names.length * 3);
        poseWorld(sk, pose, rot, heads);
        w.put(`${tag}:worldHeads`, heads);
      }
      if (inPlace === false) w.put(`clip:${clip}:travel`, r.travel());
    }
  }
  if (c.surfaceDelta) {
    const extra = new Map(Object.entries(c.surfaceDelta));
    await rt.ensureTargets(extra.keys());
    const d = rt.surfaceDelta(shape, extra);
    w.put("delta:positions", d.positions);
    w.put("delta:normals", d.normals);
    for (const [name, m] of d.meshes) {
      w.put(`delta:${name}:positions`, m.positions);
      w.put(`delta:${name}:normals`, m.normals);
    }
  }
  if (c.merge) {
    const lods = lodLevels(rt.manifest);
    const level = lods.length - 1;
    const map = lodBoneMap(rt.manifest.skeleton!, lods[level]);
    const merged = mergeMeshes(c.merge.map((n) => ({ data: rt.meshes.find((m) => m.def.name === n)! })), map);
    w.put("merge:indices", merged.indices);
    w.put("merge:joints", merged.joints!);
    w.put("merge:weights", merged.weights!);
    w.put("merge:part", merged.part);
  }
  w.put("bind:rotations", bindPose(sk).rotations);
  w.done();
  console.log(`${c.name}: done`);
}
