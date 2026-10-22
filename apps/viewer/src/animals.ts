import { Animal, type RGB } from "@actors/animal";
import AnimalWorker from "@actors/animal/worker?worker";
import { CharacterStage } from "@actors/generator";
import { ThreeActor, addFurShells, animalMaterials, createFurUniforms, setFurCoat } from "@actors/three";
import * as THREE from "three";

const panel = document.getElementById("panel")!;
const stage = new CharacterStage(document.getElementById("view")!);
// ?animal=squirrel|deer picks the pack (dog and squirrel share the quadruped rig; the deer has its own).
const KINDS: Record<string, { title: string; height: number }> = { dog: { title: "Dogs", height: 1 }, squirrel: { title: "Squirrels", height: 0.3 }, deer: { title: "Deer", height: 1 } };
const kind = new URLSearchParams(location.search).get("animal") ?? "dog";
const H = (KINDS[kind] ?? KINDS.dog).height;
stage.view([1.5 * H, 0.75 * H, 1.9 * H], [0, 0.4 * H, 0]);
if (H < 1) {
  // A tighter shadow map for small animals (the default covers a person).
  stage.scene.traverse((o) => {
    if (o instanceof THREE.DirectionalLight && o.castShadow) {
      const c = o.shadow.camera;
      c.left = c.bottom = -0.6;
      c.right = c.top = 0.6;
      c.updateProjectionMatrix();
      o.shadow.normalBias = 0.004;
    }
  });
}

type Shape = Record<string, number>;
type Coat = Record<string, number | RGB>;
const animal = await Animal.load<Shape, Coat>(`./packs/${kind}/manifest.json`);
const species = animal.species;
if (kind === "deer") stage.view([2.4, 1.05, 2.3], [0, 0.6, 0.05]);
try {
  await animal.useWorker(new AnimalWorker());
} catch (e) {
  console.warn("Shape worker unavailable, evaluating on the main thread", e);
}
const fur = createFurUniforms();
const actor = new ThreeActor(animal.runtime, animalMaterials(fur));
const shells = addFurShells(actor, fur);
stage.add(actor);

let breed = species.base;
let clipName: string | null = "idle";
animal.setPreset(breed);

// --- Shape updates: one at a time, the latest wins ---
let busy: Promise<void> | null = null;
let dirty = false;
async function refresh(): Promise<void> {
  dirty = true;
  if (busy) return busy;
  busy = (async () => {
    while (dirty) {
      dirty = false;
      const shape = await animal.evaluate();
      actor.applyShape(shape);
      actor.object.position.y = actor.groundOffset();
      setFurCoat(fur, animal.coat as never, animal.shape.size);
    }
  })();
  await busy;
  busy = null;
}

async function play(name: string | null): Promise<void> {
  clipName = name;
  actor.play(name ? await animal.runtime.loadClip(name) : null);
  for (const b of panel.querySelectorAll<HTMLButtonElement>("[data-clip]")) b.setAttribute("aria-pressed", String(b.dataset.clip === (name ?? "")));
}

// --- Panel ---
const toHex = (c: RGB) => "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
const fromHex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
const LABELS: Record<string, string> = {
  earDrop: "ear drop", earFold: "ear fold", muzzleBroad: "muzzle width", muzzleDeep: "muzzle depth", skullDome: "skull dome", chestDeep: "chest depth", bellyTuck: "tuck-up", tailCurl: "tail curl", tailPlume: "tail plume",
  neckThick: "neck girth", muzzle: kind === "deer" ? "long face" : "muzzle", tailTip: "tail tip", spotSize: "spot size", paleMask: "pale mask", tanLegs: "tan legs", tailFrost: "tail frost", earTufts: "ear tufts",
  dappleSize: "spot spacing", rumpBorder: "rump border", headTone: "head tone", eyeRing: "eye ring", innerEar: "inner ear", bib: kind === "deer" ? "throat" : "bib", tan: kind === "deer" ? "head" : "tan",
};
const COAT_AMOUNTS: string[] =
  kind === "deer"
    ? ["dapple", "dappleSize", "dorsal", "rump", "rumpBorder", "headTone", "belly", "bib", "paleMask", "eyeRing", "innerEar", "glands", "tanLegs", "shade", "agouti", "fluff"]
    : ["saddle", "mask", "points", "belly", "bib", "socks", "blaze", "tailTip", "spots", "spotSize", "shade", "paleMask", "agouti", "tanLegs", "frost", "tailFrost", "eyeRing", "earTufts", "fluff"];

function render(): void {
  const s = animal.shape, c = animal.coat;
  const slider = (label: string, value: number, min: number, max: number, step: number, data: string) =>
    `<label><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-${data}><span>${value.toFixed(2)}</span></label>`;
  const note = kind === "deer" ? "Generated sika hind on the rig and clips of Quaternius' CC0 low-poly Deer." : "Generated body on the CC0 Mesh2Motion quadruped rig.";
  panel.innerHTML = `<div class="dog-panel">
    <h1>${(KINDS[kind] ?? KINDS.dog).title}</h1>
    <p class="note">${note} ${Object.entries(KINDS).filter(([k]) => k !== kind).map(([k, v]) => `<a href="?animal=${k}">${v.title}</a>`).join(" · ")} · <a href="./">Humans</a></p>
    <select id="breed">${Object.entries(species.presets).map(([id, b]) => `<option value="${id}"${id === breed ? " selected" : ""}>${b.name}</option>`).join("")}<option value="custom"${breed === "custom" ? " selected" : ""}>Custom</option></select>
    <h2>Animation</h2>
    <div class="row"><button data-clip="">Rest</button>${(animal.runtime.manifest.clips ?? []).map((cl) => `<button data-clip="${cl.name}">${cl.name}</button>`).join("")}</div>
    <h2>Body</h2>
    ${Object.entries(species.ranges as Record<string, [number, number]>).filter(([k]) => animal.supports(k)).map(([k, [lo, hi]]) => slider(LABELS[k] ?? k, s[k], lo, hi, 0.01, `shape="${k}"`)).join("")}
    <h2>Coat</h2>
    <div class="colors">${(["base", "second", "tan", "white"] as const).map((k) => `<label>${LABELS[k] ?? k}<input type="color" value="${toHex(c[k] as RGB)}" data-color="${k}"></label>`).join("")}</div>
    ${slider("fur length", (c.length as number) * 1000, 0, 40, 0.5, `coat="length"`)}
    ${COAT_AMOUNTS.map((k) => slider(LABELS[k] ?? k, (c[k] as number | undefined) ?? 0, 0, k === "spotSize" || k === "dappleSize" ? 2 : 1, 0.01, `coat="${k}"`)).join("")}
  </div>`;
  for (const b of panel.querySelectorAll<HTMLButtonElement>("[data-clip]")) {
    b.setAttribute("aria-pressed", String(b.dataset.clip === (clipName ?? "")));
    b.onclick = () => void play(b.dataset.clip || null);
  }
  panel.querySelector<HTMLSelectElement>("#breed")!.onchange = (e) => {
    const id = (e.target as HTMLSelectElement).value;
    if (id === "custom") return;
    setBreed(id);
  };
  for (const input of panel.querySelectorAll<HTMLInputElement>("input[type=range]")) {
    input.oninput = () => {
      const v = Number(input.value);
      (input.nextElementSibling as HTMLElement).textContent = v.toFixed(2);
      if (input.dataset.shape) animal.shape[input.dataset.shape] = v;
      else if (input.dataset.coat === "length") animal.coat.length = v / 1000;
      else animal.coat[input.dataset.coat!] = v;
      breed = "custom";
      panel.querySelector<HTMLSelectElement>("#breed")!.value = "custom";
      if (input.dataset.shape) void refresh();
      else setFurCoat(fur, animal.coat as never, animal.shape.size);
    };
  }
  for (const input of panel.querySelectorAll<HTMLInputElement>("input[type=color]")) {
    input.oninput = () => {
      animal.coat[input.dataset.color!] = fromHex(input.value);
      setFurCoat(fur, animal.coat as never, animal.shape.size);
    };
  }
}

async function setBreed(id: string): Promise<void> {
  breed = id;
  animal.setPreset(id);
  render();
  await refresh();
}

render();
await refresh();
await play(clipName);

// Test hooks (scripts/animals.mjs).
Object.assign(window, {
  __actors: {
    animal,
    actor,
    stage,
    shells,
    kind,
    setBreed,
    play,
    refresh,
    /** Pauses the animation at a time (seconds) for still shots. */
    pose(time: number) {
      const a = actor.currentAction;
      if (a) {
        a.paused = true;
        a.time = time;
        actor.mixer.update(0);
      }
    },
    ready: true,
  },
});
