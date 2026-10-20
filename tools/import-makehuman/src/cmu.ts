/**
 * The CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), 2,548
 * motions in Bruce Hahne's BVH conversion, as one on-demand clip library.
 *
 * Rest pose = every BVH rotation at zero, which is how the skeleton's offsets
 * are defined (the first frame is NOT a rest pose). Bone directions come from
 * offsets, skipping the zero-length helper joints (LHipJoint, LowerBack,
 * Neck, LeftShoulder, …) by pointing at the next joint that is actually apart.
 *
 * Licence (CMU): free for any use, including commercial products; the data
 * may not be resold as such. Credit: "The data used in this project was
 * obtained from mocap.cs.cmu.edu. The database was created with funding from
 * NSF EIA-0196217."
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ClipLibrary, type ClipLibraryRef, type Quat, type Vec3, encodeClipI16, normalize, quatAxisAngle, quatMul } from "@actors/core";
import { type Bvh, parseBvh, poseFrame, rotate } from "./bvh";

export const CMU_URL = "https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master";
/** Bump to re-convert cached clips after changing the conversion. */
const VERSION = 2;
const FPS = 30;

export interface CmuEntry {
  id: string;
  subject: number;
  subjectTitle: string;
  description: string;
}

/** Motions in the BVH conversion that the text index leaves out: [subject, first trial, last trial]. */
const UNLISTED: [number, number, number][] = [
  [63, 2, 30],
  [73, 1, 13],
  [84, 1, 20],
  [117, 1, 15],
  [121, 1, 36],
];

export function parseCmuIndex(text: string): CmuEntry[] {
  const out: CmuEntry[] = [];
  let subject = 0, title = "";
  for (const line of text.split(/\r?\n/)) {
    const s = line.match(/^Subject #(\d+)\s*\((.*)\)\s*$/);
    if (s) {
      subject = +s[1];
      title = s[2].trim();
      continue;
    }
    const m = line.match(/^(\d+_\d+)\t+(.*)$/);
    if (m && subject) out.push({ id: m[1], subject, subjectTitle: title, description: m[2].trim().replace(/[“”]/g, '"') });
  }
  const have = new Set(out.map((e) => e.id));
  for (const [subj, a, b] of UNLISTED) {
    const known = out.find((e) => e.subject === subj);
    for (let t = a; t <= b; t++) {
      const id = `${String(subj).padStart(2, "0")}_${String(t).padStart(2, "0")}`;
      if (!have.has(id)) out.push({ id, subject: subj, subjectTitle: known?.subjectTitle ?? "not described by CMU", description: "Unknown" });
    }
  }
  return out.sort((x, y) => x.subject - y.subject || x.id.localeCompare(y.id));
}

/** game_engine bone <- BVH joint (whose rotation moves the bone). */
const MAP: [string, string][] = [
  ["pelvis", "Hips"],
  ["spine_01", "LowerBack"],
  ["spine_02", "Spine"],
  ["spine_03", "Spine1"],
  ["neck_01", "Neck"],
  ["head", "Head"],
  ["clavicle_l", "LeftShoulder"],
  ["upperarm_l", "LeftArm"],
  ["lowerarm_l", "LeftForeArm"],
  ["hand_l", "LeftHand"],
  ["clavicle_r", "RightShoulder"],
  ["upperarm_r", "RightArm"],
  ["lowerarm_r", "RightForeArm"],
  ["hand_r", "RightHand"],
  ["thigh_l", "LeftUpLeg"],
  ["calf_l", "LeftLeg"],
  ["foot_l", "LeftFoot"],
  ["ball_l", "LeftToeBase"],
  ["thigh_r", "RightUpLeg"],
  ["calf_r", "RightLeg"],
  ["foot_r", "RightFoot"],
  ["ball_r", "RightToeBase"],
];

/** Rest direction of a joint's bone: toward the first descendant (or end site) that is not at the same place. */
function restDirection(bvh: Bvh, rest: { pos: Vec3[] }, j: number): Vec3 {
  const queue = [j];
  while (queue.length) {
    const k = queue.shift()!;
    for (let c = 0; c < bvh.joints.length; c++) {
      if (bvh.joints[c].parent !== k) continue;
      const d: Vec3 = [rest.pos[c][0] - rest.pos[j][0], rest.pos[c][1] - rest.pos[j][1], rest.pos[c][2] - rest.pos[j][2]];
      if (Math.hypot(...d) > 1e-4) return normalize(d);
      queue.push(c);
    }
    const end = bvh.joints[k].endSite;
    if (end) {
      const p: Vec3 = [rest.pos[k][0] + end[0] - rest.pos[j][0], rest.pos[k][1] + end[1] - rest.pos[j][1], rest.pos[k][2] + end[2] - rest.pos[j][2]];
      if (Math.hypot(...p) > 1e-4) return normalize(p);
    }
  }
  return [0, 1, 0];
}

export function convertBvh(bvh: Bvh): { bones: string[]; refDirs: number[]; frames: number; data: Float32Array } {
  const index = (n: string) => bvh.joints.findIndex((j) => j.name === n);
  const map = MAP.filter(([, s]) => index(s) >= 0);
  const src = map.map(([, s]) => index(s));
  const rest = poseFrame(bvh, -1);
  const refDirs = src.flatMap((j) => restDirection(bvh, rest, j));
  const hips = index("Hips");
  const feet = ["LeftToeBase", "RightToeBase", "LeftFoot", "RightFoot"].map(index).filter((i) => i >= 0);
  const hipHeight = Math.max(1e-3, rest.pos[hips][1] - Math.min(...feet.map((i) => rest.pos[i][1])));

  const srcFps = 1 / bvh.frameTime;
  const count = Math.max(2, Math.floor(((bvh.frameCount - 1) / srcFps) * FPS) + 1);
  const first = poseFrame(bvh, 0);
  // Start facing +Z: remove the initial heading (the rest skeleton faces +Z, left = +X).
  const fwd = rotate(first.rot[hips], [0, 0, 1]);
  const unYaw: Quat = quatAxisAngle([0, 1, 0], -Math.atan2(fwd[0], fwd[2]));
  const start = first.pos[hips];
  const stride = src.length * 4 + 3;
  const data = new Float32Array(count * stride);
  const poses = Array.from({ length: count }, (_, f) => poseFrame(bvh, Math.min(bvh.frameCount - 1, Math.round((f / FPS) * srcFps))));
  // The root channels are absolute: hip height counts from the floor the feet touch in this take.
  const floor = Math.min(...poses.map((p) => Math.min(...feet.map((i) => p.pos[i][1]))));
  for (let f = 0; f < count; f++) {
    const p = poses[f];
    src.forEach((j, k) => {
      const q = quatMul(unYaw, p.rot[j]); // rest rotations are identity
      if (f > 0) {
        const o = (f - 1) * stride + k * 4;
        if (q[0] * data[o] + q[1] * data[o + 1] + q[2] * data[o + 2] + q[3] * data[o + 3] < 0) q.forEach((v, c) => (q[c] = -v));
      }
      data.set(q, f * stride + k * 4);
    });
    const d = rotate(unYaw, [p.pos[hips][0] - start[0], 0, p.pos[hips][2] - start[2]]);
    data.set([d[0] / hipHeight, (p.pos[hips][1] - floor - hipHeight) / hipHeight, d[2] / hipHeight], f * stride + src.length * 4);
  }
  return { bones: map.map(([t]) => t), refDirs, frames: count, data };
}

function download(url: string, file: string): Promise<void> {
  return new Promise((ok, fail) => {
    const p = spawn("curl", ["-sSfL", "--retry", "5", "--retry-all-errors", "-o", file, url], { stdio: ["ignore", "ignore", "inherit"] });
    p.on("close", (code) => (code === 0 ? ok() : fail(new Error(`curl ${url} exited ${code}`))));
  });
}

interface Converted {
  bones: string[];
  refDirs: number[];
  frames: number;
}

/**
 * Converts (once; results are cached in `cacheDir`) and writes the library to
 * `<out>/clips/cmu/`. Raw BVH files are deleted after conversion, so the cache
 * holds only the compact clips. `limit` caps the number of motions (testing).
 */
export async function importCmu(cacheDir: string, out: string, indexText: string, limit = Infinity): Promise<ClipLibraryRef> {
  const entries = parseCmuIndex(indexText).slice(0, limit);
  const conv = join(cacheDir, `cmu-converted-v${VERSION}`);
  mkdirSync(conv, { recursive: true });
  const dir = join(out, "clips/cmu");
  mkdirSync(dir, { recursive: true });

  let done = 0, failed = 0;
  const work = async (e: CmuEntry) => {
    const meta = join(conv, `${e.id}.json`);
    if (!existsSync(meta)) {
      const subj = e.id.split("_")[0].padStart(3, "0");
      const raw = join(conv, `${e.id}.bvh.part`);
      try {
        await download(`${CMU_URL}/data/${subj}/${e.id}.bvh`, raw);
        const c = convertBvh(parseBvh(readFileSync(raw, "utf8")));
        writeFileSync(join(conv, `${e.id}.bin`), encodeClipI16(c.bones.length, c.frames, c.data));
        writeFileSync(`${meta}.part`, JSON.stringify({ bones: c.bones, refDirs: c.refDirs.map((v) => +v.toFixed(4)), frames: c.frames } satisfies Converted));
        renameSync(`${meta}.part`, meta);
      } catch (err) {
        failed++;
        console.warn(`CMU ${e.id}: ${(err as Error).message}`);
        return;
      } finally {
        rmSync(raw, { force: true });
      }
    }
    if (++done % 100 === 0) console.log(`CMU: ${done}/${entries.length}`);
  };
  const queue = [...entries];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) await work(queue.shift()!);
  }));

  const lib: ClipLibrary = { name: "cmu", rigs: {}, clips: [] };
  const rigKeys = new Map<string, string>();
  for (const e of entries) {
    const meta = join(conv, `${e.id}.json`);
    if (!existsSync(meta)) continue;
    const c = JSON.parse(readFileSync(meta, "utf8")) as Converted;
    const key = JSON.stringify([c.bones, c.refDirs.map((v) => v.toFixed(3))]);
    if (!rigKeys.has(key)) {
      const name = `r${rigKeys.size}`;
      rigKeys.set(key, name);
      lib.rigs[name] = { bones: c.bones, refDirs: c.refDirs, rootBone: "pelvis" };
    }
    writeFileSync(join(dir, `${e.id}.bin`), readFileSync(join(conv, `${e.id}.bin`)));
    lib.clips.push({
      name: `cmu ${e.id}`,
      file: `${e.id}.bin`,
      fps: FPS,
      frameCount: c.frames,
      loop: false,
      rig: rigKeys.get(key)!,
      source: `CMU Graphics Lab Motion Capture Database, motion ${e.id}`,
      category: `${e.subject}: ${e.subjectTitle}`,
      description: e.description,
      encoding: "i16",
    });
  }
  writeFileSync(join(dir, "index.json"), JSON.stringify(lib));
  console.log(`CMU: ${lib.clips.length} motions, ${Object.keys(lib.rigs).length} rigs${failed ? `, ${failed} failed` : ""}`);
  return {
    name: "cmu",
    file: "clips/cmu/index.json",
    count: lib.clips.length,
    source: "CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH conversion by B. Hahne",
    license: "Free for any use incl. commercial; do not resell the data as such. Created with funding from NSF EIA-0196217.",
  };
}
