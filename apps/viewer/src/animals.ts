import { Animal, DEFAULT_PRESET, type DogCoat, type DogShape, SHAPE_RANGES, type RGB } from "@actors/animal";
import AnimalWorker from "@actors/animal/worker?worker";
import { CharacterStage } from "@actors/generator";
import { ThreeActor, addFurShells, animalMaterials, createFurUniforms, setFurCoat } from "@actors/three";
import * as THREE from "three";

const panel = document.getElementById("panel")!;
const stage = new CharacterStage(document.getElementById("view")!);
// ?animal=squirrel picks the pack; both share the quadruped rig.
const KINDS: Record<string, { title: string; height: number }> = { dog: { title: "Dogs", height: 1 }, squirrel: { title: "Squirrels", height: 0.3 } };
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

const animal = await Animal.load(`./packs/${kind}/manifest.json`);
try {
  await animal.useWorker(new AnimalWorker());
} catch (e) {
  console.warn("Shape worker unavailable, evaluating on the main thread", e);
}
const fur = createFurUniforms();
const actor = new ThreeActor(animal.runtime, animalMaterials(fur));
const shells = addFurShells(actor, fur);
stage.add(actor);

let breed = DEFAULT_PRESET[kind] ?? Object.keys(animal.presets)[0];
let clipName: string | null = "idle";
animal.setBreed(breed);

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
      setFurCoat(fur, animal.coat, animal.shape.size);
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
const LABELS: Partial<Record<keyof DogShape, string>> = { earDrop: "ear drop", earFold: "ear fold", muzzleBroad: "muzzle width", muzzleDeep: "muzzle depth", skullDome: "skull dome", chestDeep: "chest depth", bellyTuck: "tuck-up", tailCurl: "tail curl", tailPlume: "tail plume" };
const COAT_AMOUNTS: (keyof DogCoat)[] = ["saddle", "mask", "points", "belly", "bib", "socks", "blaze", "tailTip", "spots", "spotSize", "shade", "paleMask", "agouti", "tanLegs", "frost", "tailFrost", "eyeRing", "earTufts", "fluff"];
const COAT_LABELS: Partial<Record<keyof DogCoat, string>> = { tailTip: "tail tip", spotSize: "spot size", paleMask: "pale mask", tanLegs: "tan legs", tailFrost: "tail frost", eyeRing: "eye ring", earTufts: "ear tufts" };

function render(): void {
  const s = animal.shape, c = animal.coat;
  const slider = (label: string, value: number, min: number, max: number, step: number, data: string) =>
    `<label><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-${data}><span>${value.toFixed(2)}</span></label>`;
  panel.innerHTML = `<div class="dog-panel">
    <h1>${(KINDS[kind] ?? KINDS.dog).title}</h1>
    <p class="note">Generated body on the CC0 Mesh2Motion quadruped rig. ${Object.entries(KINDS).filter(([k]) => k !== kind).map(([k, v]) => `<a href="?animal=${k}">${v.title}</a>`).join(" · ")} · <a href="./">Humans</a></p>
    <select id="breed">${Object.entries(animal.presets).map(([id, b]) => `<option value="${id}"${id === breed ? " selected" : ""}>${b.name}</option>`).join("")}<option value="custom"${breed === "custom" ? " selected" : ""}>Custom</option></select>
    <h2>Animation</h2>
    <div class="row"><button data-clip="">Rest</button>${(animal.runtime.manifest.clips ?? []).map((cl) => `<button data-clip="${cl.name}">${cl.name}</button>`).join("")}</div>
    <h2>Body</h2>
    ${(Object.keys(SHAPE_RANGES) as (keyof DogShape)[]).filter((k) => animal.supports(k)).map((k) => slider(LABELS[k] ?? k, s[k], SHAPE_RANGES[k][0], SHAPE_RANGES[k][1], 0.01, `shape="${k}"`)).join("")}
    <h2>Coat</h2>
    <div class="colors">${(["base", "second", "tan", "white"] as const).map((k) => `<label>${k}<input type="color" value="${toHex(c[k])}" data-color="${k}"></label>`).join("")}</div>
    ${slider("fur length", c.length * 1000, 0, 40, 0.5, `coat="length"`)}
    ${COAT_AMOUNTS.map((k) => slider(COAT_LABELS[k] ?? k, (c[k] as number | undefined) ?? 0, 0, k === "spotSize" ? 2 : 1, 0.01, `coat="${k}"`)).join("")}
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
      if (input.dataset.shape) animal.shape[input.dataset.shape as keyof DogShape] = v;
      else if (input.dataset.coat === "length") animal.coat.length = v / 1000;
      else (animal.coat as unknown as Record<string, number>)[input.dataset.coat!] = v;
      breed = "custom";
      panel.querySelector<HTMLSelectElement>("#breed")!.value = "custom";
      if (input.dataset.shape) void refresh();
      else setFurCoat(fur, animal.coat, animal.shape.size);
    };
  }
  for (const input of panel.querySelectorAll<HTMLInputElement>("input[type=color]")) {
    input.oninput = () => {
      animal.coat[input.dataset.color as "base"] = fromHex(input.value);
      setFurCoat(fur, animal.coat, animal.shape.size);
    };
  }
}

async function setBreed(id: string): Promise<void> {
  breed = id;
  animal.setBreed(id);
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
