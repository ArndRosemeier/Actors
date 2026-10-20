import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ActorShape, Clip } from "@actors/core";
import { ADULT_MIN_AGE, BLINK, DEFAULT_PARAMS, EXPRESSIONS, Human, type HumanParams, MAX_AGE } from "@actors/human";
import HumanWorker from "@actors/human/worker?worker";
import { IRIS_PRESETS, ThreeActor } from "@actors/three";

const statusEl = document.getElementById("status")!;
const view = document.getElementById("view")!;

// --- Scene ------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2c31);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;

const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
camera.position.set(0.6, 1.2, 4.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.95, 0);
controls.enableDamping = true;

const key = new THREE.DirectionalLight(0xfff1e6, 2.2);
key.position.set(2, 4, 3);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -1.5;
key.shadow.camera.right = key.shadow.camera.top = 1.5;
key.shadow.bias = -0.0005;
key.shadow.normalBias = 0.02;
scene.add(key);
const rim = new THREE.DirectionalLight(0xc8d8ff, 1.2);
rim.position.set(-3, 2.5, -3);
scene.add(rim);

const ground = new THREE.Mesh(new THREE.CircleGeometry(2.5, 64), new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

function resize() {
  const { clientWidth: w, clientHeight: h } = view;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
resize();

// --- Actor ------------------------------------------------------------------
const human = await Human.load(`${import.meta.env.BASE_URL}packs/human/manifest.json`);
const actor = new ThreeActor(human.runtime);
scene.add(actor.object);
let shape: ActorShape | undefined;
// Shape evaluation runs in a Web Worker so slider drags never stall rendering.
const useWorker = !new URLSearchParams(location.search).has("noworker");
if (useWorker) await human.useWorker(new HumanWorker());

// Face: one expression channel and one blink channel, blended on the GPU.
const face = { expression: "neutral", intensity: 0.8, blink: true };
async function rebuildFace() {
  if (!shape) return;
  const units = EXPRESSIONS[face.expression] ?? {};
  actor.setMorph("expression", Object.keys(units).length ? await human.faceDelta(shape, units) : null);
  actor.setMorph("blink", await human.faceDelta(shape, BLINK));
  actor.setMorphWeight("expression", face.intensity);
}

// Anatomy: male genital mesh or female detail in the skin shader, adults only (age is clamped in the data path).
const anatomy = { on: true };
function updateAnatomy() {
  const male = human.params.gender >= 0.5;
  actor.setVisible("genitals-male", anatomy.on && male);
  actor.skin.uFemale.value = anatomy.on && !male ? 1 : 0;
}

let busy = false;
let dirty = false;
async function refresh() {
  if (busy) {
    dirty = true;
    return;
  }
  busy = true;
  try {
    const t0 = performance.now();
    shape = await human.evaluate(shape);
    actor.applyShape(shape);
    actor.object.position.y = actor.groundOffset();
    updateAnatomy();
    await rebuildFace();
    statusEl.textContent = `${(performance.now() - t0).toFixed(0)} ms${useWorker ? " · worker" : ""}`;
  } catch (e) {
    statusEl.textContent = `Error: ${(e as Error).message}`;
    console.error(e);
  } finally {
    busy = false;
    if (dirty) {
      dirty = false;
      refresh();
    }
  }
}

// --- UI ---------------------------------------------------------------------
type Slider = { key: keyof HumanParams; label: string; min: number; max: number; step: number; fmt?: (v: number) => string };
const pct = (v: number) => `${Math.round(v * 100)}`;
const MACRO: Slider[] = [
  { key: "gender", label: "Female ↔ Male", min: 0, max: 1, step: 0.01, fmt: pct },
  { key: "ageYears", label: "Age", min: ADULT_MIN_AGE, max: MAX_AGE, step: 1, fmt: (v) => `${v}` },
  { key: "muscle", label: "Muscle", min: 0, max: 1, step: 0.01, fmt: pct },
  { key: "weight", label: "Weight", min: 0, max: 1, step: 0.01, fmt: pct },
  { key: "height", label: "Height", min: 0, max: 1, step: 0.01, fmt: pct },
  { key: "proportions", label: "Proportions", min: 0, max: 1, step: 0.01, fmt: pct },
  { key: "cupSize", label: "Breast size", min: 0, max: 1, step: 0.01, fmt: pct },
  { key: "firmness", label: "Breast firmness", min: 0, max: 1, step: 0.01, fmt: pct },
  { key: "african", label: "African", min: 0, max: 1, step: 0.01, fmt: pct },
  { key: "asian", label: "Asian", min: 0, max: 1, step: 0.01, fmt: pct },
  { key: "caucasian", label: "Caucasian", min: 0, max: 1, step: 0.01, fmt: pct },
];

const inputs = new Map<string, { input: HTMLInputElement; out: HTMLOutputElement; fmt: (v: number) => string }>();

function row(parent: HTMLElement, id: string, label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, onInput: (v: number) => void) {
  const div = document.createElement("div");
  div.className = "row";
  div.innerHTML = `<label title="${label}">${label}</label><input type="range" min="${min}" max="${max}" step="${step}"><output></output>`;
  const input = div.querySelector("input")!;
  const out = div.querySelector("output")!;
  input.value = String(value);
  out.textContent = fmt(value);
  input.addEventListener("input", () => {
    const v = +input.value;
    out.textContent = fmt(v);
    onInput(v);
  });
  parent.appendChild(div);
  inputs.set(id, { input, out, fmt });
}

const macroEl = document.getElementById("macro")!;
for (const s of MACRO) {
  row(macroEl, s.key, s.label, s.min, s.max, s.step, human.params[s.key], s.fmt ?? String, (v) => {
    human.params[s.key] = v;
    refresh();
  });
}

// --- Look -------------------------------------------------------------------
const lookEl = document.getElementById("look")!;
const skinTones = [new THREE.Color(0.93, 0.76, 0.66), new THREE.Color(0.78, 0.57, 0.43), new THREE.Color(0.5, 0.33, 0.22), new THREE.Color(0.25, 0.15, 0.1)];
function setSkin(t: number) {
  const f = t * (skinTones.length - 1);
  const i = Math.min(skinTones.length - 2, Math.floor(f));
  actor.setSkinTone(skinTones[i].clone().lerp(skinTones[i + 1], f - i));
}
row(lookEl, "skinTone", "Skin tone", 0, 1, 0.01, 0.3, pct, setSkin);
setSkin(0.3);
row(lookEl, "brows", "Eyebrows", 0, 1, 0.01, actor.skin.uBrowDensity.value, pct, (v) => (actor.skin.uBrowDensity.value = v));
row(lookEl, "sss", "Subsurface", 0, 2, 0.01, 1, (v) => v.toFixed(2), (v) => (actor.skin.uSSS.value = v));

function selectRow(parent: HTMLElement, label: string, options: [string, string][], value: string, onChange: (v: string) => void) {
  const div = document.createElement("div");
  div.className = "row";
  div.innerHTML = `<label>${label}</label><select></select>`;
  const sel = div.querySelector("select")!;
  for (const [v, text] of options) sel.add(new Option(text, v, false, v === value));
  sel.addEventListener("change", () => onChange(sel.value));
  parent.appendChild(div);
  return sel;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
selectRow(lookEl, "Eyes", Object.keys(IRIS_PRESETS).map((k) => [k, cap(k)]), "brown", (v) => actor.setIris(v));
actor.setIris("brown");
selectRow(lookEl, "Detail", [["body", "High (subdivided)"], ["body-low", "Low"]], "body", (v) => actor.setVisible(v, true));
const anatomyBox = document.createElement("label");
anatomyBox.className = "check";
anatomyBox.innerHTML = `<input type="checkbox" checked> Anatomical detail`;
anatomyBox.querySelector("input")!.addEventListener("change", (e) => {
  anatomy.on = (e.target as HTMLInputElement).checked;
  updateAnatomy();
});
lookEl.appendChild(anatomyBox);

// --- Outfit -----------------------------------------------------------------
const outfitEl = document.getElementById("outfit")!;
const labels = human.extra.garmentLabels ?? {};
for (const m of human.runtime.meshes.filter((m) => m.def.role === "garment")) {
  const label = document.createElement("label");
  label.className = "check";
  label.innerHTML = `<input type="checkbox"> ${labels[m.def.name] ?? m.def.name}`;
  const box = label.querySelector("input")!;
  box.dataset.garment = m.def.name;
  box.checked = actor.isVisible(m.def.name);
  box.addEventListener("change", () => actor.setVisible(m.def.name, box.checked));
  outfitEl.appendChild(label);
}

const detailsEl = document.getElementById("details")!;
const groups = new Map<string, HTMLElement>();
for (const m of human.modifiers) {
  if (!groups.has(m.group)) {
    const d = document.createElement("details");
    d.innerHTML = `<summary>${m.group}</summary>`;
    detailsEl.appendChild(d);
    groups.set(m.group, d);
  }
  const lo = m.negative.length ? -1 : 0;
  row(groups.get(m.group)!, m.id, m.label, lo, 1, 0.01, 0, (v) => v.toFixed(2), (v) => {
    human.modifierValues[m.id] = v;
    refresh();
  });
}

// --- Animation and face -------------------------------------------------------
const anim = document.getElementById("anim") as HTMLSelectElement;
const clipCache = new Map<string, Promise<Clip>>();
function loadClip(name: string) {
  if (!clipCache.has(name)) clipCache.set(name, human.runtime.loadClip(name));
  return clipCache.get(name)!;
}
for (const c of human.runtime.manifest.clips ?? []) anim.add(new Option(cap(c.name), c.name, false, c.name === "idle"));
async function playSelected() {
  actor.play(anim.value ? await loadClip(anim.value) : null);
  await playReference(anim.value);
}

// `?compare`: the source animation on its own mannequin next to the actor (dev check for the retarget).
const compare = new URLSearchParams(location.search).has("compare");
const refBase = `${import.meta.env.BASE_URL}reference/`;
const refLibs = new Map<string, Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>>();
let refMixer: THREE.AnimationMixer | undefined;
let refScene: THREE.Object3D | undefined;
async function playReference(name: string) {
  if (!compare) return;
  if (refScene) scene.remove(refScene);
  refMixer = refScene = refAction = undefined;
  const index = (await (await fetch(`${refBase}clips.json`)).json()) as Record<string, { glb: string; animation: string }>;
  const ref = index[name];
  if (!ref) return;
  if (!refLibs.has(ref.glb)) refLibs.set(ref.glb, new GLTFLoader().loadAsync(refBase + ref.glb));
  const lib = await refLibs.get(ref.glb)!;
  refScene = lib.scene;
  refScene.position.set(0.9, 0, 0);
  scene.add(refScene);
  refMixer = new THREE.AnimationMixer(refScene);
  const clip = lib.animations.find((a) => a.name === ref.animation)!;
  // Same treatment as the actor: in place, so the two stay side by side.
  refAction = refMixer.clipAction(clip);
  refAction.play();
}
anim.addEventListener("change", playSelected);

const exprSel = document.getElementById("expression") as HTMLSelectElement;
for (const k of Object.keys(EXPRESSIONS)) exprSel.add(new Option(`Face: ${cap(k)}`, k, false, k === face.expression));
exprSel.addEventListener("change", async () => {
  face.expression = exprSel.value;
  await rebuildFace();
});
const motionEl = document.getElementById("motion")!;
row(motionEl, "exprIntensity", "Intensity", 0, 1, 0.01, face.intensity, pct, (v) => {
  face.intensity = v;
  actor.setMorphWeight("expression", v);
});
const blinkBox = document.createElement("label");
blinkBox.className = "check";
blinkBox.innerHTML = `<input type="checkbox" checked> Blink`;
blinkBox.querySelector("input")!.addEventListener("change", (e) => (face.blink = (e.target as HTMLInputElement).checked));
motionEl.appendChild(blinkBox);

function syncInputs() {
  for (const s of MACRO) {
    const e = inputs.get(s.key)!;
    e.input.value = String(human.params[s.key]);
    e.out.textContent = e.fmt(human.params[s.key]);
  }
  for (const m of human.modifiers) {
    const e = inputs.get(m.id)!;
    e.input.value = String(human.modifierValues[m.id] ?? 0);
    e.out.textContent = e.fmt(human.modifierValues[m.id] ?? 0);
  }
}

document.getElementById("reset")!.addEventListener("click", () => {
  human.params = { ...DEFAULT_PARAMS };
  human.modifierValues = {};
  syncInputs();
  refresh();
});

document.getElementById("randomize")!.addEventListener("click", () => {
  const r = () => Math.random();
  const mid = (spread: number) => 0.5 + (r() - 0.5) * spread;
  human.params = {
    ...human.params,
    gender: r() < 0.5 ? r() * 0.15 : 1 - r() * 0.15,
    ageYears: Math.round(ADULT_MIN_AGE + r() * 50),
    muscle: mid(0.9),
    weight: mid(0.9),
    height: mid(0.9),
    proportions: mid(0.8),
    cupSize: mid(0.9),
    firmness: mid(0.9),
    african: r(),
    asian: r(),
    caucasian: r(),
  };
  human.modifierValues = {};
  for (const m of human.modifiers) if (r() < 0.15) human.modifierValues[m.id] = (r() - (m.negative.length ? 0.5 : 0)) * 0.8;
  syncInputs();
  refresh();
});

document.getElementById("export")!.addEventListener("click", async () => {
  const names = (human.runtime.manifest.clips ?? []).map((c) => c.name);
  const clips = shape?.skeleton ? await Promise.all(names.map(async (n) => actor.toThreeClip(await loadClip(n)))) : [];
  const exporter = new GLTFExporter();
  const glb = (await exporter.parseAsync(actor.object, { binary: true, animations: clips, onlyVisible: true })) as ArrayBuffer;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([glb], { type: "model/gltf-binary" }));
  a.download = "human.glb";
  a.click();
  URL.revokeObjectURL(a.href);
});

// --- Loop -------------------------------------------------------------------
let paused = false;
let refAction: THREE.AnimationAction | undefined;
function syncReference() {
  const t = actor.currentAction?.time;
  if (!refAction || t === undefined) return;
  refAction.time = t % refAction.getClip().duration;
  refMixer!.update(0);
}
/** Test hook: freezes the animation at a time in seconds (null resumes). */
function seek(t: number | null) {
  paused = t !== null;
  const action = actor.currentAction;
  if (action && t !== null) {
    action.time = t;
    actor.mixer.update(0);
  }
}

await refresh();
await playSelected();
const clock = new THREE.Clock();
let nextBlink = 2;
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (!paused) actor.update(dt);
  syncReference();
  // Blink: ~150 ms close/open every 2-6 s.
  const t = clock.elapsedTime;
  if (t > nextBlink + 0.15) nextBlink = t + 2 + Math.random() * 4;
  const b = face.blink && t > nextBlink ? Math.sin(((t - nextBlink) / 0.15) * Math.PI) : 0;
  actor.setMorphWeight("blink", Math.max(0, b));
  controls.update();
  renderer.render(scene, camera);
});

// Test hook (used by the headless smoke test).
Object.assign(window, { __actors: { human, actor, refresh, view: (p: number[], t: number[]) => { camera.position.fromArray(p); controls.target.fromArray(t); controls.update(); }, face, rebuildFace, loadClip, seek, ready: true } });
