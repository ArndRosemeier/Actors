import { ADULT_MIN_AGE, type HumanParams, MAX_AGE } from "@actors/human";
import { type CharacterConfig, PAINTED_BROWS, outfitGarments } from "./catalog";
import type { Character } from "./character";

const CSS = `
.actors-editor { --ae-panel: #1d1f24; --ae-text: #e6e6e6; --ae-muted: #9aa0a6; --ae-accent: #c98b6b; --ae-border: #2c2f36;
  box-sizing: border-box; background: var(--ae-panel); color: var(--ae-text); font: 13px/1.4 system-ui, sans-serif; padding: 12px 14px 20px; overflow-y: auto; }
.actors-editor * { box-sizing: border-box; }
.actors-editor header { display: flex; align-items: baseline; justify-content: space-between; }
.actors-editor h1 { font-size: 18px; margin: 0 0 8px; }
.actors-editor h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ae-muted); margin: 16px 0 6px; }
.actors-editor .ae-status { color: var(--ae-muted); font-size: 12px; }
.actors-editor .ae-row { display: grid; grid-template-columns: 110px 1fr 40px; gap: 8px; align-items: center; margin: 3px 0; }
.actors-editor .ae-row label { color: var(--ae-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actors-editor .ae-row output { text-align: right; font-variant-numeric: tabular-nums; color: var(--ae-muted); }
.actors-editor .ae-row select { grid-column: 2 / 4; }
.actors-editor input[type="range"] { width: 100%; accent-color: var(--ae-accent); }
.actors-editor details { border-top: 1px solid var(--ae-border); padding: 4px 0; }
.actors-editor summary { cursor: pointer; padding: 3px 0; text-transform: capitalize; }
.actors-editor .ae-check { display: flex; gap: 6px; align-items: center; margin: 3px 0; }
.actors-editor .ae-grid { display: grid; grid-template-columns: 1fr 1fr; }
.actors-editor select, .actors-editor button { background: #272a31; color: var(--ae-text); border: 1px solid var(--ae-border); border-radius: 6px; padding: 5px 9px; font: inherit; }
.actors-editor button { cursor: pointer; }
.actors-editor button:hover { border-color: var(--ae-accent); }
.actors-editor footer { display: flex; gap: 6px; margin-top: 18px; flex-wrap: wrap; }
`;

type Slider = { key: keyof HumanParams; label: string; min: number; max: number; step: number; fmt: (v: number) => string };
const pct = (v: number) => `${Math.round(v * 100)}`;
const BODY: Slider[] = [
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

export interface EditorOptions {
  /** Heading text (default "Character"). */
  title?: string;
  /** Show the detail sliders (default true). */
  details?: boolean;
  /** Extra buttons for the footer. */
  actions?: { label: string; onClick: () => void }[];
}

/**
 * A plain-DOM control panel for a Character: body sliders, look, outfit
 * (presets and single garments, including nude), animation, face, detail
 * sliders, randomize/reset, save/load as JSON and glTF export.
 * It only calls the public Character API, so it doubles as a usage example.
 */
export class CharacterEditor {
  readonly element: HTMLElement;
  private readonly syncers: ((c: CharacterConfig) => void)[] = [];
  private readonly status: HTMLElement;
  private readonly unsubscribe: () => void;

  constructor(
    readonly character: Character,
    container: HTMLElement,
    options: EditorOptions = {},
  ) {
    if (!document.getElementById("actors-editor-css")) {
      const style = document.createElement("style");
      style.id = "actors-editor-css";
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const el = (this.element = document.createElement("div"));
    el.className = "actors-editor";
    container.appendChild(el);
    const cat = character.catalog;
    const set = (patch: Parameters<Character["set"]>[0]) => {
      this.status.textContent = "…";
      character.set(patch).then(
        () => (this.status.textContent = `${character.lastUpdateMs.toFixed(0)} ms${character.human.usesWorker ? " · worker" : ""}`),
        (e: Error) => (this.status.textContent = `Error: ${e.message}`),
      );
    };

    const header = document.createElement("header");
    header.innerHTML = `<h1></h1><span class="ae-status">Ready</span>`;
    header.querySelector("h1")!.textContent = options.title ?? "Character";
    this.status = header.querySelector(".ae-status")!;
    el.appendChild(header);

    // Body
    const body = this.section("Body");
    for (const s of BODY) this.slider(body, s.label, s.min, s.max, s.step, s.fmt, (c) => c.body[s.key], (v) => set({ body: { [s.key]: v } }), `body.${s.key}`);

    // Look
    const look = this.section("Look");
    if (cat.photoSkin) this.select(look, "Skin", [["photo", "Photo (follows ethnicity)"], ["procedural", "Procedural"]], (c) => c.skin, (v) => set({ skin: v as CharacterConfig["skin"] }), "skin");
    const tone = this.slider(look, "Skin tone", 0, 1, 0.01, pct, (c) => c.skinTone, (v) => set({ skinTone: v }), "skinTone");
    this.syncers.push((c) => (tone.hidden = c.skin === "photo"));
    this.select(look, "Eyes", cat.eyes.map((e) => [e.id, e.label]), (c) => c.eyes, (v) => set({ eyes: v }), "eyes");
    this.select(look, "Hair", [["", "None"], ...cat.hair.map((h): [string, string] => [h.id, h.label])], (c) => c.hair ?? "", (v) => set({ hair: v || null }), "hair");
    this.select(look, "Hair colour", [["", "Natural"], ...cat.hairColors.map((h): [string, string] => [h.id, h.label])], (c) => c.hairColor ?? "", (v) => set({ hairColor: v || null }), "hairColor");
    this.select(look, "Eyebrows", [...cat.brows.map((b): [string, string] => [b.id, b.label]), [PAINTED_BROWS, "Painted"], ["", "None"]], (c) => c.brows ?? "", (v) => set({ brows: v || null }), "brows");
    this.select(look, "Detail", [["high", "High (subdivided)"], ["low", "Low"]], (c) => c.detail, (v) => set({ detail: v as CharacterConfig["detail"] }), "detail");
    this.check(look, "Anatomical detail", (c) => c.anatomy, (v) => set({ anatomy: v }), "anatomy");

    // Outfit
    const outfit = this.section("Outfit");
    const presetSel = this.select(outfit, "Preset", [["", "Custom"], ...cat.outfits.map((o): [string, string] => [o.id, o.label])], (c) => {
      const match = cat.outfits.find((o) => sameSet(outfitGarments(o, c.body), c.outfit));
      return match?.id ?? "";
    }, (v) => v && character.wear(v).catch(() => {}), "outfit");
    presetSel.dataset.role = "outfit-preset";
    const grid = document.createElement("div");
    grid.className = "ae-grid";
    outfit.appendChild(grid);
    for (const g of cat.garments) {
      const box = this.check(grid, g.label, (c) => c.outfit.includes(g.id), (on) => {
        const cur = character.config.outfit.filter((x) => x !== g.id);
        set({ outfit: on ? [...cur, g.id] : cur });
      });
      box.dataset.garment = g.id;
    }

    // Animation and face
    const motion = this.section("Animation");
    this.select(motion, "Clip", [["", "Bind pose"], ...cat.animations.map((a): [string, string] => [a.id, a.label])], (c) => c.animation ?? "", (v) => set({ animation: v || null }), "animation");
    const root = this.check(motion, "Root motion", () => character.rootMotion, (v) => (character.rootMotion = v));
    root.dataset.role = "root-motion";
    this.select(motion, "Face", cat.expressions.map((e) => [e.id, e.label]), (c) => c.expression, (v) => set({ expression: v }), "expression");
    this.slider(motion, "Intensity", 0, 1, 0.01, pct, (c) => c.expressionIntensity, (v) => set({ expressionIntensity: v }), "expressionIntensity");
    this.check(motion, "Blink", (c) => c.blink, (v) => set({ blink: v }), "blink");

    // Detail sliders
    if (options.details !== false && cat.details.length) {
      const details = this.section("Details");
      const groups = new Map<string, HTMLElement>();
      for (const d of cat.details) {
        if (!groups.has(d.group)) {
          const g = document.createElement("details");
          g.innerHTML = `<summary></summary>`;
          g.querySelector("summary")!.textContent = d.group;
          details.appendChild(g);
          groups.set(d.group, g);
        }
        this.slider(groups.get(d.group)!, d.label, d.min, d.max, 0.01, (v) => v.toFixed(2), (c) => c.details[d.id] ?? 0, (v) => set({ details: { ...character.config.details, [d.id]: v } }), `details.${d.id}`);
      }
    }

    // Footer
    const footer = document.createElement("footer");
    const button = (label: string, onClick: () => void, role?: string) => {
      const b = document.createElement("button");
      b.textContent = label;
      if (role) b.dataset.role = role;
      b.addEventListener("click", onClick);
      footer.appendChild(b);
    };
    button("Randomize", () => character.randomize(), "randomize");
    button("Reset", () => character.reset(), "reset");
    button("Save", () => download(new Blob([JSON.stringify(character.config, null, 2)], { type: "application/json" }), "character.json"), "save");
    button("Load", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (file) set(JSON.parse(await file.text()));
      };
      input.click();
    }, "load");
    button("Export glTF", async () => download(new Blob([await character.exportGlb()], { type: "model/gltf-binary" }), "character.glb"), "export");
    for (const a of options.actions ?? []) button(a.label, a.onClick);
    el.appendChild(footer);

    this.unsubscribe = character.onChange((c) => this.sync(c));
    this.sync(character.config);
  }

  dispose(): void {
    this.unsubscribe();
    this.element.remove();
  }

  private sync(c: CharacterConfig): void {
    for (const s of this.syncers) s(c);
  }

  private section(title: string): HTMLElement {
    const s = document.createElement("section");
    const h = document.createElement("h2");
    h.textContent = title;
    s.appendChild(h);
    this.element.appendChild(s);
    return s;
  }

  private slider(parent: HTMLElement, label: string, min: number, max: number, step: number, fmt: (v: number) => string, get: (c: CharacterConfig) => number, onInput: (v: number) => void, key?: string): HTMLElement {
    const div = document.createElement("div");
    div.className = "ae-row";
    div.innerHTML = `<label></label><input type="range"><output></output>`;
    div.querySelector("label")!.textContent = label;
    div.querySelector("label")!.title = label;
    const input = div.querySelector("input")!;
    Object.assign(input, { min: String(min), max: String(max), step: String(step) });
    if (key) input.dataset.key = key;
    const out = div.querySelector("output")!;
    input.addEventListener("input", () => {
      out.textContent = fmt(+input.value);
      onInput(+input.value);
    });
    this.syncers.push((c) => {
      const v = get(c);
      input.value = String(v);
      out.textContent = fmt(v);
    });
    parent.appendChild(div);
    return div;
  }

  private select(parent: HTMLElement, label: string, options: [string, string][], get: (c: CharacterConfig) => string, onChange: (v: string) => void, key?: string): HTMLSelectElement {
    const div = document.createElement("div");
    div.className = "ae-row";
    div.innerHTML = `<label></label><select></select>`;
    div.querySelector("label")!.textContent = label;
    const sel = div.querySelector("select")!;
    if (key) sel.dataset.key = key;
    for (const [v, text] of options) sel.add(new Option(text, v));
    sel.addEventListener("change", () => onChange(sel.value));
    this.syncers.push((c) => (sel.value = get(c)));
    parent.appendChild(div);
    return sel;
  }

  private check(parent: HTMLElement, label: string, get: (c: CharacterConfig) => boolean, onChange: (v: boolean) => void, key?: string): HTMLInputElement {
    const l = document.createElement("label");
    l.className = "ae-check";
    const box = document.createElement("input");
    box.type = "checkbox";
    if (key) box.dataset.key = key;
    l.append(box, ` ${label}`);
    box.addEventListener("change", () => onChange(box.checked));
    this.syncers.push((c) => (box.checked = get(c)));
    parent.appendChild(l);
    return box;
  }
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
