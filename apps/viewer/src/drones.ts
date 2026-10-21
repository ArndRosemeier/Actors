import { ARCHETYPES, type ArchetypeId, type DroneConfig, type DroneModel, type DroneSpec, PALETTES, buildDrone, designDrone } from "@actors/drone";
import { CharacterStage } from "@actors/generator";
import { ThreeDrone } from "@actors/three";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

// Generated drones: every block (hull, propulsion, sensors, tools, optional
// weapons, antennae, fins, gear, lights, palette) comes from a seed; ?gallery shows many at once.
const params = new URLSearchParams(location.search);
const panel = document.getElementById("panel")!;
const stage = new CharacterStage(document.getElementById("view")!, { ground: false, background: 0x23252b });
const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 96), new THREE.MeshStandardMaterial({ color: 0x34373e, roughness: 0.92 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
stage.scene.add(floor);
const sun = stage.scene.children.find((o): o is THREE.DirectionalLight => o instanceof THREE.DirectionalLight && o.castShadow)!;
const shadowBox = (r: number) => {
  const c = sun.shadow.camera;
  c.left = c.bottom = -r;
  c.right = c.top = r;
  c.far = 60;
  c.updateProjectionMatrix();
  sun.shadow.normalBias = 0.01;
};

const ARCHS = Object.keys(ARCHETYPES) as ArchetypeId[];
const HULLS = ["auto", "pod", "wedge", "disc", "orb", "frame", "manta"] as const;
const PROPS = ["auto", "ducted", "rotor", "jet", "ring", "ion"] as const;
const num = (k: string) => (params.has(k) ? Number(params.get(k)) : undefined);
const config: DroneConfig & { seed: number } = {
  seed: num("seed") ?? 1234,
  archetype: (params.get("archetype") as ArchetypeId) ?? "random",
  hull: (params.get("hull") as DroneConfig["hull"]) ?? "auto",
  propulsion: (params.get("propulsion") as DroneConfig["propulsion"]) ?? "auto",
  count: num("count") ?? "auto",
  palette: params.get("palette") ?? "random",
  size: num("size") ?? "auto",
  armed: params.get("armed") === "1",
  tools: params.get("tools") !== "0",
};

let drones: { drone: ThreeDrone; model: DroneModel; remove: () => void }[] = [];
let clipName = params.get("clip") ?? "hover";
let spec: DroneSpec;

function clear(): void {
  for (const d of drones) {
    d.remove();
    d.drone.dispose();
  }
  drones = [];
}

function place(model: DroneModel, x = 0, z = 0): ThreeDrone {
  const drone = new ThreeDrone(model);
  drone.object.position.set(x, 0, z);
  const remove = stage.add(drone);
  drones.push({ drone, model, remove });
  drone.play(model.clips.some((c) => c.name === clipName) ? clipName : "hover", 0);
  // Desynchronise gallery drones.
  if (drone.current) drone.current.time = (Math.abs(x * 0.37 + z * 0.61) % 1) * drone.current.getClip().duration;
  return drone;
}

function frame(model: DroneModel, k = 1): void {
  const { min, max } = model.bounds;
  const c: [number, number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const r = Math.max(max[0] - min[0], max[2] - min[2], (max[1] - min[1]) * 1.4) * 0.5;
  const d = Math.max(1.6, r * 3.4) * k;
  stage.view([c[0] + d * 0.62, c[1] + d * 0.32, c[2] + d * 0.78], [c[0], c[1] - 0.05 * d, c[2]]);
  shadowBox(Math.max(2.2, r * 2.5));
}

function show(): DroneModel {
  clear();
  spec = designDrone(config);
  const model = buildDrone(spec);
  place(model);
  return model;
}

function gallery(n = 12, armed = false): void {
  clear();
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const gap = 3.6;
  for (let i = 0; i < n; i++) {
    const arch = ARCHS[i % ARCHS.length];
    const model = buildDrone(designDrone({ seed: config.seed + i * 7919, archetype: arch, armed }));
    const cx = i % cols, cz = Math.floor(i / cols);
    place(model, (cx - (cols - 1) / 2) * gap, (cz - (rows - 1) / 2) * gap);
  }
  const w = Math.max(cols, rows) * gap;
  stage.view([0, w * 0.92, w * 1.6], [0, 0.3, w * 0.08]);
  shadowBox(w * 0.75);
}

function play(name: string): void {
  clipName = name;
  for (const d of drones) d.drone.play(d.model.clips.some((c) => c.name === name) ? name : "hover");
  for (const b of panel.querySelectorAll<HTMLButtonElement>("[data-clip]")) b.setAttribute("aria-pressed", String(b.dataset.clip === name));
}

async function exportGltf(): Promise<void> {
  const d = drones[0];
  if (!d) return;
  const halos: THREE.Object3D[] = [];
  d.drone.object.traverse((o) => o instanceof THREE.Sprite && halos.push(o));
  for (const h of halos) h.visible = false;
  const glb = (await new GLTFExporter().parseAsync(d.drone.object, { binary: true, animations: [...d.drone.clips.values()], onlyVisible: true })) as ArrayBuffer;
  for (const h of halos) h.visible = true;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([glb], { type: "model/gltf-binary" }));
  a.download = `${spec.name.replace(/\s+/g, "-").toLowerCase()}.glb`;
  a.click();
}

function render(model?: DroneModel): void {
  const opt = (v: string, label: string, sel: unknown) => `<option value="${v}"${String(sel) === v ? " selected" : ""}>${label}</option>`;
  const s = spec;
  const blocks = s
    ? [
        `${s.hull.kind} hull`,
        `${s.propulsion.count}× ${s.propulsion.kind}${s.propulsion.layout === "lateral" ? " (pairs)" : ""}${s.propulsion.arm !== "none" ? `, ${s.propulsion.arm} arms` : ""}`,
        ...s.sensors.map((x) => `${x.kind} (${x.mount})`),
        ...s.tools.map((x) => x.kind),
        ...s.weapons.map((x) => `${x.kind} (${x.mount})`),
        ...s.antennae.map((x) => `${x.count}× ${x.kind} antenna`),
        s.gear !== "none" ? `${s.gear}` : "",
        s.rcs ? "RCS jets" : "",
      ].filter(Boolean)
    : [];
  panel.innerHTML = `<div class="dog-panel">
    <h1>Drones</h1>
    <p class="note">Procedural drones from building blocks. <a href="./">Humans</a> · <a href="./animals.html">Animals</a> · <a href="?gallery">Gallery</a></p>
    <div class="row"><button id="dice">New drone</button><label style="display:flex;gap:6px;margin:0">seed<input id="seed" type="number" value="${config.seed}" style="width:110px"></label></div>
    ${model ? `<p class="note" style="margin-top:8px"><b>${s.name}</b> · ${s.size.toFixed(2)} m · ${model.triangles.toLocaleString()} triangles<br>${blocks.join(" · ")}</p>` : ""}
    <h2>Animation</h2>
    <div class="row">${(model?.clips ?? []).map((c) => `<button data-clip="${c.name}">${c.name}</button>`).join("")}</div>
    <h2>Blocks</h2>
    <label><span>role</span><select data-k="archetype">${opt("random", "Random", config.archetype)}${ARCHS.map((a) => opt(a, ARCHETYPES[a].name, config.archetype)).join("")}</select><span></span></label>
    <label><span>hull</span><select data-k="hull">${HULLS.map((h) => opt(h, h, config.hull)).join("")}</select><span></span></label>
    <label><span>propulsion</span><select data-k="propulsion">${PROPS.map((h) => opt(h, h, config.propulsion)).join("")}</select><span></span></label>
    <label><span>units</span><select data-k="count">${["auto", "1", "2", "3", "4", "6", "8"].map((h) => opt(h, h, config.count)).join("")}</select><span></span></label>
    <label><span>palette</span><select data-k="palette">${opt("random", "Random", config.palette)}${Object.entries(PALETTES).map(([k, p]) => opt(k, p.name, config.palette)).join("")}</select><span></span></label>
    <label><span>size (m)</span><input type="range" min="0.3" max="3" step="0.05" value="${typeof config.size === "number" ? config.size : (s?.size ?? 1)}" data-k="size"><span>${typeof config.size === "number" ? config.size.toFixed(2) : "auto"}</span></label>
    <label><span>detail</span><input type="range" min="0" max="1" step="0.05" value="${config.detail ?? s?.hull.detail ?? 0.6}" data-k="detail"><span>${(config.detail ?? s?.hull.detail ?? 0).toFixed(2)}</span></label>
    <label><span>wear</span><input type="range" min="0" max="1" step="0.05" value="${config.wear ?? s?.wear ?? 0}" data-k="wear"><span>${(config.wear ?? s?.wear ?? 0).toFixed(2)}</span></label>
    <label><span>tools</span><input type="checkbox" data-k="tools"${config.tools !== false ? " checked" : ""}><span></span></label>
    <label><span>weapons</span><input type="checkbox" data-k="armed"${config.armed ? " checked" : ""}><span></span></label>
    <h2>Export</h2>
    <div class="row"><button id="glb">glTF (.glb)</button><button id="json">Copy spec JSON</button></div>
  </div>`;
  for (const b of panel.querySelectorAll<HTMLButtonElement>("[data-clip]")) {
    b.setAttribute("aria-pressed", String(b.dataset.clip === clipName));
    b.onclick = () => play(b.dataset.clip!);
  }
  panel.querySelector<HTMLButtonElement>("#dice")!.onclick = () => {
    config.seed = Math.floor(Math.random() * 1e9);
    update(true);
  };
  panel.querySelector<HTMLInputElement>("#seed")!.onchange = (e) => {
    config.seed = Number((e.target as HTMLInputElement).value) >>> 0;
    update(true);
  };
  panel.querySelector<HTMLButtonElement>("#glb")!.onclick = () => void exportGltf();
  panel.querySelector<HTMLButtonElement>("#json")!.onclick = () => void navigator.clipboard?.writeText(JSON.stringify(spec, null, 2));
  for (const el of panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-k]")) {
    el.onchange = () => {
      const k = el.dataset.k as keyof DroneConfig;
      const c = config as unknown as Record<string, unknown>;
      if (el instanceof HTMLInputElement && el.type === "checkbox") c[k] = el.checked;
      else if (el instanceof HTMLInputElement) c[k] = Number(el.value);
      else c[k] = k === "count" && el.value !== "auto" ? Number(el.value) : el.value;
      update(k === "size");
    };
  }
}

function update(reframe = false): void {
  const model = show();
  if (reframe) frame(model);
  render(model);
}

if (params.has("gallery")) {
  gallery(Number(params.get("gallery")) || 12, params.get("armed") === "1");
  render();
} else {
  const model = show();
  frame(model);
  render(model);
}

// Test hooks (scripts/drones.mjs).
Object.assign(window, {
  __actors: {
    stage,
    config,
    get drones() {
      return drones;
    },
    get spec() {
      return spec;
    },
    /** Shows one drone for a config (merged into the current one). */
    set(c: Partial<DroneConfig>, reframe = true, zoom = 1) {
      Object.assign(config, c);
      const model = show();
      if (reframe) frame(model, zoom);
      render(model);
      return { name: spec.name, triangles: model.triangles, clips: model.clips.map((x) => x.name), blocks: spec };
    },
    gallery,
    play,
    /** Pauses every drone at time t (seconds) for still shots. */
    pose(t: number) {
      for (const d of drones) {
        const a = d.drone.current;
        if (a) {
          a.paused = true;
          a.time = t;
        }
        d.drone.update(0);
      }
    },
    ready: true,
  },
});
