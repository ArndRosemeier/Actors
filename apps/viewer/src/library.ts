// The animal library page: the public catalogue of the WildMesh3D animals (names and facts only).
// The models are private (PrivateAssets repo) and never part of this site. Pass ?base=<url of a
// served PrivateAssets wildmesh3d/ folder> (e.g. from a local dev server) to preview them in 3D.
import { LIBRARY_ANIMALS, LIBRARY_REPO, pickLibraryClip, type LibraryAnimalInfo, type LibraryMotion } from "@actors/animal/library";
import { CharacterStage } from "@actors/generator";
import { loadLibraryAnimal, type LibraryAnimal, type RootMotion } from "@actors/three";
import * as THREE from "three";

const params = new URLSearchParams(location.search);
const base = params.get("base");
const panel = document.getElementById("panel")!;
const view = document.getElementById("view")!;
const MOTIONS: LibraryMotion[] = ["idle", "walk", "trot", "run", "eat", "sit", "lie", "attack", "death", "swim", "fly"];

let query = "";
let set = "";
let group = "";
let selected: LibraryAnimalInfo = LIBRARY_ANIMALS.find((a) => a.id === params.get("animal")) ?? LIBRARY_ANIMALS.find((a) => a.id === "wolf")!;
let clipName: string | undefined;
let rootMotion: RootMotion = (params.get("rootMotion") as RootMotion) ?? "in-place";

const stage = base ? new CharacterStage(view) : undefined;
let current: LibraryAnimal | undefined;
let removeCurrent: (() => void) | undefined;
let loading = 0;
const detail = document.createElement("div");
detail.className = "lib-detail" + (stage ? " with-3d" : "");
view.append(detail);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const m = (n: number) => `${n.toFixed(2)} m`;

function list(): LibraryAnimalInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return LIBRARY_ANIMALS.filter((a) => (!set || a.set === set) && (!group || a.group === group) && words.every((w) => `${a.id} ${a.name}`.toLowerCase().includes(w)));
}

function renderPanel(): void {
  const shown = list();
  const groups = [...new Set(LIBRARY_ANIMALS.map((a) => a.group))];
  panel.innerHTML = `<div class="dog-panel">
    <h1>Animal library</h1>
    <p class="note">${LIBRARY_ANIMALS.length} rigged, animated animals (WildMesh3D) with ${LIBRARY_ANIMALS.reduce((n, a) => n + a.clips.length, 0).toLocaleString()} clips, loaded with <code>loadLibraryAnimal</code>. This page lists them; the models are licensed for Arnd's projects and live in a private repository. <a href="./animals.html">Generated animals</a> · <a href="./">Humans</a></p>
    <input type="search" placeholder="Search (wolf, deer, bird...)" value="${esc(query)}" />
    <div class="lib-filters">
      <select data-f="set"><option value="">Both sets</option><option value="realistic"${set === "realistic" ? " selected" : ""}>Realistic</option><option value="stylized"${set === "stylized" ? " selected" : ""}>Stylized</option></select>
      <select data-f="group"><option value="">All kinds</option>${groups.map((g) => `<option value="${g}"${group === g ? " selected" : ""}>${g[0].toUpperCase() + g.slice(1)}s</option>`).join("")}</select>
    </div>
    <div class="lib-list">${shown.map((a) => `<button data-id="${a.id}" aria-pressed="${a.id === selected.id}"><span>${esc(a.name)}${a.set === "stylized" ? " <small>stylized</small>" : ""}</span><small>${a.id}</small></button>`).join("")}</div>
    ${shown.length ? "" : `<p class="note">No animal matches.</p>`}
  </div>`;
  const search = panel.querySelector<HTMLInputElement>("input[type=search]")!;
  search.oninput = () => {
    query = search.value;
    const at = search.selectionStart;
    renderPanel();
    const again = panel.querySelector<HTMLInputElement>("input[type=search]")!;
    again.focus();
    again.setSelectionRange(at, at);
  };
  panel.querySelectorAll<HTMLSelectElement>("select[data-f]").forEach((s) => {
    s.onchange = () => {
      if (s.dataset.f === "set") set = s.value;
      else group = s.value;
      renderPanel();
    };
  });
  panel.querySelectorAll<HTMLButtonElement>(".lib-list button").forEach((b) => {
    b.onclick = () => select(LIBRARY_ANIMALS.find((a) => a.id === b.dataset.id)!);
  });
}

function renderDetail(): void {
  const a = selected;
  const most = Math.max(...a.clips.map((c) => c.tracks));
  const picks = new Map(MOTIONS.map((mo) => [mo, pickLibraryClip(a.clips, mo)] as const).filter(([, n]) => n));
  const picked = new Set(picks.values());
  detail.innerHTML = `
    <h2>${esc(a.name)} <small style="color:#8d93a0;font-weight:normal">${a.id}</small></h2>
    <p class="facts">${a.set} ${a.group} · ${m(a.size[1])} tall, ${m(a.size[2])} long, ${m(a.size[0])} wide · ${a.triangles.toLocaleString()} triangles · ${a.mb} MB · ${a.rig ? `rig family ${a.rig} (shares bone names with ${LIBRARY_ANIMALS.filter((o) => o.rig === a.rig && o.id !== a.id).map((o) => o.id).join(", ") || "none"})` : "own rig"}</p>
    <p class="facts">Common motions: ${[...picks].map(([mo, n]) => `${mo} = <code>${esc(n!)}</code>`).join(" · ") || "none found by name"}</p>
    ${stage ? `<p class="facts"><label>Root motion <select data-rm>${(["in-place", "move", "keep"] as const).map((r) => `<option${r === rootMotion ? " selected" : ""}>${r}</option>`).join("")}</select></label> <span data-status></span></p>` : ""}
    <div class="clips">${a.clips.map((c) => `<button data-clip="${esc(c.name)}" class="${picked.has(c.name) ? "pick" : ""}${c.tracks < 0.25 * most ? " partial" : ""}" aria-pressed="${c.name === clipName}" title="${c.seconds} s, ${c.tracks} channels${c.tracks < 0.25 * most ? " (partial clip)" : ""}">${esc(c.name)}</button>`).join("")}</div>
    ${stage ? "" : `<div class="lib-private"><p>The models are not part of this site. In a game, add <a href="${LIBRARY_REPO}">PrivateAssets</a> (private) and load an animal with <code>loadLibraryAnimal("${a.id}", { baseUrl: "./wildmesh3d/" })</code> (see docs/using-actors.md, "Library animals"). To preview here, serve PrivateAssets' <code>wildmesh3d/</code> folder locally and open this page with <code>?base=&lt;its URL&gt;</code>.</p></div>`}`;
  detail.querySelectorAll<HTMLButtonElement>("[data-clip]").forEach((b) => {
    b.onclick = () => {
      clipName = b.dataset.clip!;
      current?.play(clipName, { fade: 0.25 });
      if (current) {
        stage!.controls.target.x -= current.object.position.x;
        stage!.camera.position.x -= current.object.position.x;
        current.object.position.x = 0;
      }
      detail.querySelectorAll("[data-clip]").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
      status();
    };
  });
  const rm = detail.querySelector<HTMLSelectElement>("[data-rm]");
  if (rm)
    rm.onchange = () => {
      rootMotion = rm.value as RootMotion;
      void show();
    };
  status();
}

function status(): void {
  const el = detail.querySelector("[data-status]");
  if (!el) return;
  el.textContent = !current ? "loading..." : clipName && current.speedOf(clipName) > 0 ? `travels ${current.speedOf(clipName).toFixed(2)} m/s` : "";
}

async function show(): Promise<void> {
  if (!stage || !base) return;
  const ticket = ++loading;
  removeCurrent?.();
  current?.dispose();
  current = undefined;
  status();
  const a = selected;
  const animal = await loadLibraryAnimal(a.id, { baseUrl: base, rootMotion });
  if (ticket !== loading) return animal.dispose();
  current = animal;
  const names = animal.clipNames;
  if (!clipName || !names.includes(clipName)) clipName = animal.clipFor("idle") ?? animal.clipFor("walk") ?? names[0];
  if (clipName) animal.play(clipName);
  // With "move", walk across the view (along +X) with the camera following, and start over after a few body lengths.
  if (rootMotion === "move") animal.object.rotation.y = Math.PI / 2;
  const span = Math.max(2, a.size[2] * 3);
  const follow = (d: THREE.Vector3) => {
    stage.camera.position.add(d);
    stage.controls.target.add(d);
    stage.controls.update();
  };
  removeCurrent = stage.add({
    object: animal.object,
    update: (dt) => {
      const step = animal.update(dt);
      if (rootMotion === "move") follow(step);
      if (Math.abs(animal.object.position.x) > span) {
        const back = new THREE.Vector3(-animal.object.position.x, 0, 0);
        animal.object.position.x = 0;
        follow(back);
      }
    },
  });
  // The facts cover the lower part of the view: aim low so the animal sits above them.
  const h = Math.max(a.size[1], a.size[2] * 0.6);
  stage.view([2.5 * h, 1.1 * h, 3.4 * h], [0, a.size[1] * 0.2, 0]);
  stage.camera.far = Math.max(50, h * 40);
  stage.camera.updateProjectionMatrix();
  stage.scene.traverse((o) => {
    if (o instanceof THREE.DirectionalLight && o.castShadow) {
      const c = o.shadow.camera;
      c.left = c.bottom = -Math.max(1, h * 1.5);
      c.right = c.top = Math.max(1, h * 1.5);
      c.updateProjectionMatrix();
    }
  });
  renderDetail();
}

function select(a: LibraryAnimalInfo): void {
  selected = a;
  clipName = undefined;
  const url = new URL(location.href);
  url.searchParams.set("animal", a.id);
  history.replaceState(null, "", url);
  renderPanel();
  renderDetail();
  void show();
}

renderPanel();
renderDetail();
void show();
(window as unknown as { library: unknown }).library = { get animal() { return current; }, select: (id: string) => select(LIBRARY_ANIMALS.find((a) => a.id === id)!) };
