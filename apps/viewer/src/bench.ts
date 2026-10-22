// Load benchmark: loads characters one after another, the way a game spawns them,
// and times each one (load, first frame). `?n=6` characters, `?skin=procedural`, `?pack=<manifest url>`,
// `?compile` precompiles, `?share` reuses the first character's pack, `?webgpu`. Results in window.__bench.
import * as THREE from "three";
import { Character, CharacterStage, randomConfig, seededRandom } from "@actors/generator";
import HumanWorker from "@actors/human/worker?worker";

const params = new URLSearchParams(location.search);
const pack = params.get("pack") ?? `${import.meta.env.BASE_URL}packs/human/manifest.json`;
const n = Number(params.get("n") ?? 6);
const stage = await CharacterStage.create(document.getElementById("view")!, { renderer: params.has("webgpu") ? "webgpu" : "webgl" });
const log = document.getElementById("log")!;
// Frames are drawn by hand below: the stage's own loop would stall the loads (software GL draws slowly).
stage.renderer.setAnimationLoop(null);
const results: Record<string, number | string>[] = [];
const random = seededRandom(3);
const renderer = stage.renderer as unknown as THREE.WebGLRenderer;
const finish = () => {
  const gl = (renderer as { getContext?: () => WebGL2RenderingContext }).getContext?.();
  if (gl?.readPixels) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
};
const characters: Character[] = [];
// `?worker`: one shape worker for every character, `?workers`: a new one per character.
const sharedWorker = params.has("worker") ? new HumanWorker() : undefined;
for (let i = 0; i < n; i++) {
  const t0 = performance.now();
  const first = characters[0];
  // `?same`: every character after the first one gets the same look (shows per-character shader work).
  const look = params.has("same") ? seededRandom(5) : random;
  const base = first ? { ...randomConfig(first.catalog, first.config, { random: look }), animation: "walk" } : { animation: "walk" };
  const config = params.get("skin") ? { ...base, skin: params.get("skin") as "photo" | "procedural" } : base;
  const c = await Character.load({ pack, renderer: stage.renderer, materials: stage.materials, config, worker: params.has("workers") ? new HumanWorker() : sharedWorker, shareWith: params.has("share") ? first : undefined });
  const t1a = performance.now();
  const compile = (c as unknown as { compile?: Character["compile"] }).compile;
  if (params.has("compile") && compile) await compile.call(c, stage.renderer, stage.camera, stage.scene);
  const t1 = performance.now();
  c.object.position.x = (i % 5) * 0.8 - 1.6;
  c.object.position.z = -Math.floor(i / 5) * 1.0;
  stage.add(c);
  const programs = () => (renderer.info as { programs?: unknown[] }).programs?.length ?? (stage.renderer as unknown as { _pipelines?: { programs: { vertex: Map<string, unknown>; fragment: Map<string, unknown> } } })._pipelines?.programs.fragment.size ?? 0;
  const progs = programs();
  stage.renderer.render(stage.scene, stage.camera);
  finish();
  const t2 = performance.now();
  stage.renderer.render(stage.scene, stage.camera);
  finish();
  const t3 = performance.now();
  const r = { i, load: Math.round(t1a - t0), compile: Math.round(t1 - t1a), firstFrame: Math.round(t2 - t1), nextFrame: Math.round(t3 - t2), programsBefore: progs, programsAfter: programs(), outfit: c.config.outfit.join(","), hair: c.config.hair ?? "", skin: c.config.skin };
  results.push(r);
  characters.push(c);
  log.textContent += JSON.stringify(r) + "\n";
}
Object.assign(window, { __bench: { results, done: true } });
