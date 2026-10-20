import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { ActorShape } from "@actors/core";
import { ADULT_MIN_AGE, CLIPS, DEFAULT_PARAMS, Human, type HumanParams, MAX_AGE } from "@actors/human";
import { ThreeActor } from "@actors/three";

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
    statusEl.textContent = `${(performance.now() - t0).toFixed(0)} ms · ${human.runtime.targets.size} shapes loaded`;
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

const skinRow = document.createElement("div");
skinRow.className = "row";
skinRow.innerHTML = `<label>Skin tone</label><input type="range" min="0" max="1" step="0.01" value="0.3"><output></output>`;
macroEl.appendChild(skinRow);
const skinTones = [new THREE.Color(0.93, 0.76, 0.66), new THREE.Color(0.78, 0.57, 0.43), new THREE.Color(0.5, 0.33, 0.22), new THREE.Color(0.25, 0.15, 0.1)];
function setSkin(t: number) {
  const f = t * (skinTones.length - 1);
  const i = Math.min(skinTones.length - 2, Math.floor(f));
  const c = skinTones[i].clone().lerp(skinTones[i + 1], f - i);
  ((actor.meshes.get("body")!.material) as THREE.MeshPhysicalMaterial).color.copy(c);
}
skinRow.querySelector("input")!.addEventListener("input", (e) => setSkin(+(e.target as HTMLInputElement).value));
setSkin(0.3);

const outfitEl = document.getElementById("outfit")!;
const DEFAULT_OUTFIT = new Set<string>();
for (const m of human.runtime.meshes.filter((m) => m.def.optional)) {
  const label = document.createElement("label");
  label.className = "check";
  label.innerHTML = `<input type="checkbox"> ${m.def.name}`;
  const box = label.querySelector("input")!;
  box.checked = DEFAULT_OUTFIT.has(m.def.name);
  actor.setVisible(m.def.name, box.checked);
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

const anim = document.getElementById("anim") as HTMLSelectElement;
anim.addEventListener("change", () => actor.play(CLIPS.find((c) => c.name === anim.value) ?? null));

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
  const clips = shape?.skeleton ? CLIPS.map((c) => actor.toThreeClip(c)) : [];
  const exporter = new GLTFExporter();
  const glb = (await exporter.parseAsync(actor.object, { binary: true, animations: clips, onlyVisible: true })) as ArrayBuffer;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([glb], { type: "model/gltf-binary" }));
  a.download = "human.glb";
  a.click();
  URL.revokeObjectURL(a.href);
});

// --- Loop -------------------------------------------------------------------
await refresh();
actor.play(CLIPS.find((c) => c.name === anim.value) ?? null);
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  actor.update(clock.getDelta());
  controls.update();
  renderer.render(scene, camera);
});

// Test hook (used by the headless smoke test).
Object.assign(window, { __actors: { human, actor, refresh, ready: true } });
