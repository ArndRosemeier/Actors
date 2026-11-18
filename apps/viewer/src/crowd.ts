// Crowd figures under WebGPU: two brig crews (about 240 men) as crowd figures, plus a pool of full
// characters near the camera, with memory and frame cost measured. Results in window.__crowd.
//   ?men=121        men per crew (two crews)
//   ?pool=12        full characters near the camera (levels 0 and 1 only)
//   ?fps=30         clip bake rate
//   ?frames=120     frames measured after the warm-up
//   ?noshadows      no sun shadow
//   ?compare        also measures one full character's geometry: all levels, kept to [0, 1], kept to [2]
//   ?swap           hands the nearest crowd man to a full character and back every 2 s (fade)
//   ?view=near|wide|far
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { Character, type CharacterPatch, type CrowdKindSpec, buildCrowdFigures, characterToCrowd, crowdToCharacter, seededRandom } from "@actors/generator";
import { type CrowdFigures, type CrowdMan } from "@actors/three";
import { createNodeCrowdFigureMaterial, nodeMaterials } from "@actors/three/webgpu";
import HumanWorker from "@actors/human/worker?worker";

const params = new URLSearchParams(location.search);
const pack = params.get("pack") ?? `${import.meta.env.BASE_URL}packs/human/manifest.json`;
const perCrew = Number(params.get("men") ?? 121);
const poolSize = Number(params.get("pool") ?? 12);
const frames = Number(params.get("frames") ?? 120);
const log = document.getElementById("log")!;
const say = (s: string) => (log.textContent += s + "\n");
const result: Record<string, unknown> = {};
Object.assign(window, { __crowd: result });
addEventListener("unhandledrejection", (e) => Object.assign(window, { __crowdError: String(e.reason?.stack ?? e.reason) }));
addEventListener("error", (e) => Object.assign(window, { __crowdError: String(e.message) }));

const renderer = new WebGPURenderer({ antialias: true, trackTimestamp: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !params.has("noshadows");
document.getElementById("view")!.appendChild(renderer.domElement);
await renderer.init();
const scene = new THREE.Scene();
scene.background = new THREE.Color("#8fb2cf");
scene.add(new THREE.HemisphereLight("#cfe3f5", "#6b5a45", 1.4));
const sun = new THREE.DirectionalLight("#fff2dc", 2.4);
sun.position.set(-30, 50, 20);
sun.castShadow = renderer.shadowMap.enabled;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 150 });
sun.target.position.set(0, 0, -20);
scene.add(sun, sun.target);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 400);
const views: Record<string, [THREE.Vector3Tuple, THREE.Vector3Tuple]> = {
  near: [[0, 2.4, 6], [0, 1.2, -4]],
  wide: [[0, 6, 10], [0, 1, -18]],
  far: [[-30, 14, 25], [0, 1, -25]],
};
const [eye, at] = views[params.get("view") ?? "wide"] ?? views.wide;
camera.position.set(...eye);
camera.lookAt(...at);
// Two decks: hers under the camera, the other ship's 45 m off.
const deckMat = new THREE.MeshStandardMaterial({ color: "#9c8462", roughness: 0.9 });
const decks = [new THREE.Group(), new THREE.Group()];
decks[1].position.set(8, 0, -45);
decks[1].rotation.y = Math.PI * 0.92;
for (const d of decks) {
  const floor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.2, 30), deckMat);
  floor.position.set(0, -0.1, -12);
  floor.receiveShadow = true;
  d.add(floor);
  scene.add(d);
}

const heap = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
const mb = (b: number) => Math.round((b / 1048576) * 10) / 10;
const heap0 = heap();
const t0 = performance.now();
const workbench = await Character.load({ pack, renderer, materials: nodeMaterials, worker: new HumanWorker(), clipLibraries: false });
result.loadMs = Math.round(performance.now() - t0);
say(`pack loaded in ${result.loadMs} ms`);

// --- The crews' kinds: two navies, four builds for the men before the mast ------------------
const catalog = workbench.catalog;
const preset = (id: string) => catalog.outfits.find((o) => o.id === id)!;
const HATS = ["navy-round-hat", "navy-knit-cap"];
const HAIR = ["hair-short02", "hair-short-messy", "hair-short-curls"].filter((h) => catalog.hair.some((c) => c.id === h));
const builds = {
  lean: { gender: 1, ageYears: 24, muscle: 0.6, weight: 0.32, height: 0.45, proportions: 0.5 },
  average: { gender: 1, ageYears: 30, muscle: 0.65, weight: 0.45, height: 0.5, proportions: 0.5 },
  stocky: { gender: 1, ageYears: 36, muscle: 0.75, weight: 0.6, height: 0.4, proportions: 0.45 },
  tall: { gender: 1, ageYears: 28, muscle: 0.62, weight: 0.4, height: 0.65, proportions: 0.55 },
};
/** Men of each rank in a crew of 121 (an 18-gun brig-sloop about 1805), and the builds they come in. */
const RANKS: { rank: string; share: number; builds: (keyof typeof builds)[] }[] = [
  { rank: "captain", share: 1, builds: ["average"] },
  { rank: "officer", share: 6, builds: ["average"] },
  { rank: "midshipman", share: 4, builds: ["lean"] },
  { rank: "boatswain", share: 7, builds: ["stocky"] },
  { rank: "marine", share: 19, builds: ["average", "tall"] },
  { rank: "seaman", share: 42, builds: ["lean", "average", "stocky", "tall"] },
  { rank: "hand", share: 42, builds: ["lean", "average", "stocky", "tall"] },
];
const PRESETS: Record<string, Record<string, string>> = {
  rn: { captain: "navy-rn-captain", officer: "navy-rn-lieutenant", midshipman: "navy-rn-midshipman", boatswain: "navy-rn-boatswain", marine: "navy-rn-marine", seaman: "navy-rn-seaman", hand: "navy-rn-hand" },
  fr: { captain: "navy-fr-captain", officer: "navy-fr-officer", midshipman: "navy-fr-aspirant", boatswain: "navy-fr-boatswain", marine: "navy-fr-marine", seaman: "navy-fr-seaman", hand: "navy-fr-hand" },
};
const total = RANKS.reduce((s, r) => s + r.share, 0);
const kinds: CrowdKindSpec[] = [];
const roster: { navy: string; kind: string }[] = [];
for (const navy of ["rn", "fr"]) {
  for (const r of RANKS) {
    const p = preset(PRESETS[navy][r.rank]);
    const men = Math.round((r.share / total) * perCrew);
    // Hats of the men before the mast are worn or not; officers' and marines' hats carry cockades, so they stay.
    const before = r.rank === "seaman" || r.rank === "hand";
    const hats = before ? p.garments.filter((g) => HATS.includes(g)) : [];
    const look: CharacterPatch = { outfit: p.garments.filter((g) => !hats.includes(g)), garmentColors: p.colors ?? {}, skin: "procedural" };
    r.builds.forEach((b, i) => {
      const n = Math.floor(men / r.builds.length) + (i < men % r.builds.length ? 1 : 0);
      if (!n) return;
      const id = `${navy}-${r.rank}-${b}`;
      const tints = before ? [p.garments.filter((g) => g.startsWith("navy-slops")), ["navy-shirt"], ["navy-neckerchief"]] : undefined;
      kinds.push({ id, build: b, look, options: [...hats, ...HAIR], tints, max: n });
      for (let k = 0; k < n; k++) roster.push({ navy, kind: id });
    });
  }
}
const clips = ["idle", "walk", "arms folded", "talk", "lean on rail", "interact", "pick up", "crouch"].filter((c) => catalog.animations.some((a) => a.id === c));
const t1 = performance.now();
const figures: CrowdFigures = await buildCrowdFigures(workbench, { material: createNodeCrowdFigureMaterial, builds, kinds, clips, fps: Number(params.get("fps") ?? 30) });
result.buildMs = Math.round(performance.now() - t1);
result.kinds = figures.kinds.size;
result.clips = clips.length;
say(`${figures.kinds.size} kinds, ${clips.length} clips baked in ${result.buildMs} ms`);

// --- The men: placed on their decks, each with his own look, clip and phase -------------------
const random = seededRandom(7);
const pick = <T,>(a: readonly T[]) => a[Math.floor(random() * a.length)];
const SKIN = ["#e8c4a8", "#d9a98a", "#c48e6c", "#a8714f", "#8a5a3c", "#5e3a26"];
const HAIR_COL = ["#2a1d14", "#3b2417", "#4a3020", "#6a4a2a", "#8a6a3a", "#1c1814", "#7a3a1e"];
const SLOPS = ["#d8d2c2", "#c9c1ab", "#a9a08a", "#3b4660", "#4a4a52"];
const SHIRTS = ["#e8e2d4", "#cfc7b4", "#b9ad94", "#6f2a24", "#2f3a55"];
const NECK = ["#151515", "#2a2a3a", "#6a1a1a", "#d8d0c0"];
const men: CrowdMan[] = [];
const v = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
// `?full`: the same men as full characters kept to the crowd level (one each), for comparison.
const full: Character[] = [];
const tFull = performance.now();
for (const [i, r] of roster.entries()) {
  const kind = figures.kinds.get(r.kind)!;
  // Each crew's kinds go into its deck's frame.
  const deck = decks[r.navy === "rn" ? 0 : 1];
  if (kind.mesh.parent !== deck) deck.add(kind.mesh);
  const hats = kind.options.filter((o) => HATS.includes(o));
  const show = [...(random() < 0.7 ? hats : []), pick(kind.options.filter((o) => HAIR.includes(o)))];
  const look = { skin: pick(SKIN), hair: pick(HAIR_COL), tints: [pick(SLOPS), pick(SHIRTS), pick(NECK)], show };
  const row = Math.floor((i % perCrew) / 8), col = (i % perCrew) % 8;
  v.set(-3.5 + col + (random() - 0.5) * 0.4, 0, -row * 1.6 + (random() - 0.5) * 0.4);
  q.setFromAxisAngle(up, (random() - 0.5) * Math.PI * 1.2);
  const h = 0.96 + random() * 0.08;
  const clip = pick(clips), phase = random() * 5;
  if (params.has("full")) {
    const spec = kinds.find((k) => k.id === r.kind)!;
    const c = await Character.load({ pack, renderer, materials: nodeMaterials, shareWith: workbench, levels: [2] });
    const hair = show.find((x) => HAIR.includes(x)) ?? null;
    await c.set({ ...spec.look, body: builds[spec.build as keyof typeof builds], outfit: [...(spec.look.outfit ?? []), ...show.filter((x) => HATS.includes(x))], hair, hairColor: look.hair, animation: clip });
    c.setLod(2);
    const action = c.actor.currentAction;
    if (action) action.time = phase % action.getClip().duration;
    const place = new THREE.Group();
    place.matrixAutoUpdate = false;
    place.matrix.compose(v, q, s.set(h, h, h));
    place.add(c.object);
    deck.add(place);
    full.push(c);
    continue;
  }
  const man = figures.add(kind, look);
  man.matrix.compose(v, q, s.set(h, h, h));
  figures.play(man, clip, { time: phase });
  men.push(man);
}
result.men = men.length;
result.fullMen = full.length;
if (full.length) result.fullLoadMs = Math.round(performance.now() - tFull);
scene.add(figures.object);
say(`${men.length} crowd men, ${full.length} full men`);

// --- The pool: full characters near the camera, kept to the near levels -----------------------
const pool: Character[] = [];
for (let i = 0; i < poolSize; i++) {
  // `?poolLevel=1`: the pool kept to the medium level (no subdivided body).
  const poolLevel = params.get("poolLevel");
  const c = await Character.load({ pack, renderer, materials: nodeMaterials, shareWith: workbench, levels: poolLevel ? [Number(poolLevel)] : [0, 1] });
  const p = preset(i % 3 ? "navy-rn-seaman" : "navy-rn-lieutenant");
  await c.set({ body: builds.average, outfit: p.garments, garmentColors: p.colors ?? {}, hair: HAIR[i % HAIR.length], skin: "procedural", animation: "idle" });
  c.setLod(i < 4 ? 0 : 1);
  const place = new THREE.Group();
  place.position.set(-3 + (i % 6) * 1.2, 0, 2.5 - Math.floor(i / 6) * 1.4);
  place.add(c.object);
  decks[0].add(place);
  pool.push(c);
}
workbench.object.visible = false;

/** Geometry and texture bytes under an object (each array once). */
const arrays = new Set<ArrayBufferView>();
const geometryOf = (root: THREE.Object3D) => {
  let n = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const a of [...Object.values(m.geometry.attributes), ...Object.values(m.geometry.morphAttributes).flat(), m.geometry.index]) {
      const array = (a as THREE.BufferAttribute | null)?.array as ArrayBufferView | undefined;
      if (array && !arrays.has(array)) {
        arrays.add(array);
        n += array.byteLength;
      }
    }
  });
  return n;
};
// Where a pool character's bytes go, by mesh (largest first).
const breakdown: Record<string, number> = {};
pool[0]?.object.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return;
  let n = 0;
  for (const a of [...Object.values(m.geometry.attributes), ...Object.values(m.geometry.morphAttributes).flat(), m.geometry.index]) n += ((a as THREE.BufferAttribute | null)?.array as ArrayBufferView | undefined)?.byteLength ?? 0;
  breakdown[`${m.name}${m.visible ? "" : " (hidden)"}`] = Math.round(n / 1024);
});
result.poolKB = Object.fromEntries(Object.entries(breakdown).sort((a, b) => b[1] - a[1]).slice(0, 12));
// Vertices and triangles of each kind: all of it, and what one man shows (options he leaves off still run their vertices).
const kindStats = [...figures.kinds.values()].map((k) => {
  const g = k.mesh.geometry, info = g.getAttribute("crowdFigure"), index = g.index!;
  let optionTris = 0;
  for (let t = 0; t < index.count; t += 3) if (info.getY(index.getX(t)) > 0) optionTris++;
  return { kind: k.name, vertices: info.count, triangles: index.count / 3, optionTriangles: optionTris, options: k.options.length };
});
result.kindSample = kindStats.filter((k) => /seaman-lean|marine-average|captain/.test(k.kind));
result.trianglesPerMan = Math.round(kindStats.reduce((s2, k) => s2 + (k.triangles - k.optionTriangles), 0) / kindStats.length);
const fm = figures.memory();
const poolBytes = pool.reduce((sum, c) => sum + geometryOf(c.object), 0);
const fullBytes = full.reduce((sum, c) => sum + geometryOf(c.object), 0);
result.memory = {
  figuresGeometryMB: mb(fm.geometry),
  figuresPerKindKB: Math.round(fm.geometry / 1024 / figures.kinds.size),
  atlasKB: Math.round(fm.atlas / 1024),
  instancesKB: Math.round(fm.instances / 1024),
  poolGeometryMB: mb(poolBytes),
  poolPerCharacterMB: mb(poolBytes / Math.max(1, poolSize)),
  fullMenGeometryMB: mb(fullBytes),
  heapMB: mb(heap() - heap0),
};
say(`memory ${JSON.stringify(result.memory)}`);

if (params.has("compare")) {
  // One character dressed as a seaman, drawn once at each level it may use, then its geometry counted.
  const one = async (levels?: number[]) => {
    const c = await Character.load({ pack, renderer, materials: nodeMaterials, shareWith: workbench, levels });
    const p = preset("navy-rn-seaman");
    await c.set({ body: builds.average, outfit: p.garments, garmentColors: p.colors ?? {}, hair: HAIR[0], skin: "procedural", animation: "idle" });
    for (const l of levels ?? [0, 1, 2]) {
      c.setLod(l);
      c.update(0);
    }
    c.actor.crowdMesh();
    arrays.clear();
    return mb(geometryOf(c.object));
  };
  result.characterMB = { allLevels: await one(), near: await one([0, 1]), crowdOnly: await one([2]) };
  say(`one character: ${JSON.stringify(result.characterMB)}`);
}

// --- Frames --------------------------------------------------------------------------------
await renderer.compileAsync(scene, camera);
let swapAt = 2, swapped: { man: CrowdMan; c: Character } | null = null;
const swapper = pool[0];
const times = { figures: [] as number[], pool: [] as number[], render: [] as number[], frame: [] as number[], gpu: [] as number[] };
let last = performance.now(), frame = 0, clock = 0;
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
const loop = async () => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  times.frame.push(now - last);
  last = now;
  clock += dt;
  if (params.has("swap") && clock > swapAt) {
    swapAt += 2;
    if (!swapped) {
      const man = men[0];
      swapped = { man, c: swapper };
      swapper.object.parent!.position.setFromMatrixPosition(man.matrix);
      await crowdToCharacter(figures, man, swapper);
    } else {
      characterToCrowd(figures, swapped.man, swapped.c);
      swapped = null;
    }
  }
  const a = performance.now();
  figures.update(dt);
  const b = performance.now();
  for (const c of pool) c.update(dt);
  for (const c of full) c.update(dt);
  const c2 = performance.now();
  renderer.render(scene, camera);
  const d = performance.now();
  // Read at once: the renderer's own frame clock resets these.
  const info = renderer.info.render as unknown as { drawCalls: number; triangles: number };
  const drawn = { drawCalls: info.drawCalls, triangles: info.triangles };
  if (frame > 10) {
    times.figures.push(b - a);
    times.pool.push(c2 - b);
    times.render.push(d - c2);
    try {
      const gpu = await (renderer as unknown as { resolveTimestampsAsync(t: string): Promise<number | undefined> }).resolveTimestampsAsync("render");
      if (gpu) times.gpu.push(gpu);
    } catch {
      /* no timestamp queries on this adapter */
    }
  }
  frame++;
  if (frame === frames + 10) {
    result.frame = {
      figuresMs: +median(times.figures).toFixed(3),
      poolMs: +median(times.pool).toFixed(2),
      renderCallMs: +median(times.render).toFixed(2),
      frameMs: +median(times.frame.slice(11)).toFixed(1),
      gpuMs: times.gpu.length ? +median(times.gpu).toFixed(2) : null,
      drawCalls: drawn.drawCalls,
      triangles: drawn.triangles,
    };
    result.ready = true;
    say(`frame ${JSON.stringify(result.frame)}`);
  }
  requestAnimationFrame(() => void loop());
};
requestAnimationFrame(() => void loop());
Object.assign(window, { __actors: { figures, pool, workbench, renderer, scene, camera } });
