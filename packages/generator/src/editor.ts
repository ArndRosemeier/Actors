import { ADULT_MIN_AGE, BEARD_STYLES, HORN_STYLES, type HumanParams, MAX_AGE, TAIL_STYLES } from "@actors/human";
import { type CharacterConfig, PAINTED_BROWS, type RobotLook, outfitGarments } from "./catalog";
import type { Character, CharacterPatch } from "./character";
import { PUPILS, SKIN_PATTERNS } from "@actors/three";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const STYLE = `
.actors-editor { --ae-panel: #1d1f24; --ae-text: #e6e6e6; --ae-muted: #9aa0a6; --ae-accent: #c98b6b; --ae-border: #2c2f36;
  box-sizing: border-box; background: var(--ae-panel); color: var(--ae-text); font: 13px/1.4 system-ui, sans-serif; padding: 12px 14px 20px; overflow-y: auto; }
.actors-editor * { box-sizing: border-box; }
.actors-editor [hidden], .actors-editor .ae-off, .actors-editor .ae-robot-off { display: none !important; }
.actors-editor header { display: flex; align-items: baseline; justify-content: space-between; }
.actors-editor h1 { font-size: 18px; margin: 0 0 8px; }
.actors-editor h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ae-muted); margin: 16px 0 6px; }
.actors-editor .ae-status { color: var(--ae-muted); font-size: 12px; }
.actors-editor .ae-note { color: var(--ae-muted); font-size: 12px; margin: 2px 0 6px; }
.actors-editor .ae-row { display: grid; grid-template-columns: 110px 1fr 40px; gap: 8px; align-items: center; margin: 3px 0; }
.actors-editor .ae-row label { color: var(--ae-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actors-editor .ae-row output { text-align: right; font-variant-numeric: tabular-nums; color: var(--ae-muted); }
.actors-editor .ae-row select { grid-column: 2 / 4; }
.actors-editor input[type="range"] { width: 100%; accent-color: var(--ae-accent); }
.actors-editor input[type="color"] { width: 100%; height: 24px; padding: 0 2px; background: #272a31; border: 1px solid var(--ae-border); border-radius: 6px; }
.actors-editor .ae-row button { padding: 1px 0; }
.actors-editor details { border-top: 1px solid var(--ae-border); padding: 4px 0; }
.actors-editor summary { cursor: pointer; padding: 3px 0; text-transform: capitalize; }
.actors-editor .ae-check { display: flex; gap: 6px; align-items: center; margin: 3px 0; }
.actors-editor .ae-grid { display: grid; grid-template-columns: 1fr 1fr; }
.actors-editor .ae-check { flex-wrap: wrap; }
.actors-editor .ae-check > span { flex: 1; min-width: 0; }
.actors-editor .ae-credit { flex-basis: 100%; margin: -2px 0 0 22px; color: var(--ae-muted); font-size: 10px; }
.actors-editor input[type="search"] { background: #272a31; color: var(--ae-text); border: 1px solid var(--ae-border); border-radius: 6px; padding: 5px 9px; font: inherit; min-width: 0; }
.actors-editor select, .actors-editor button { background: #272a31; color: var(--ae-text); border: 1px solid var(--ae-border); border-radius: 6px; padding: 5px 9px; font: inherit; }
.actors-editor button { cursor: pointer; }
.actors-editor button:hover { border-color: var(--ae-accent); }
.actors-editor .ae-colors { margin-top: 8px; }
.actors-editor .ae-color-row { display: grid; grid-template-columns: 110px 1fr; gap: 8px; align-items: center; margin: 4px 0; }
.actors-editor .ae-color-row > span { color: var(--ae-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actors-editor .ae-swatches { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; }
.actors-editor .ae-swatch { width: 16px; height: 16px; padding: 0; border-radius: 50%; border: 1px solid #0006; }
.actors-editor .ae-swatch.ae-on { outline: 2px solid var(--ae-text); outline-offset: 1px; }
.actors-editor .ae-original { background: conic-gradient(#c33, #cc3, #3c3, #3cc, #33c, #c3c, #c33); }
.actors-editor input[type="color"] { width: 26px; height: 20px; padding: 0; border: 1px solid var(--ae-border); border-radius: 4px; background: none; cursor: pointer; }
.actors-editor footer { display: flex; gap: 6px; margin-top: 18px; flex-wrap: wrap; }
.actors-editor .ae-modes { display: flex; gap: 0; margin: 2px 0 4px; }
.actors-editor .ae-modes button { flex: 1; border-radius: 0; }
.actors-editor .ae-modes button:first-child { border-radius: 6px 0 0 6px; }
.actors-editor .ae-modes button:last-child { border-radius: 0 6px 6px 0; }
.actors-editor .ae-modes button[aria-pressed="true"] { background: var(--ae-accent); border-color: var(--ae-accent); color: #1d1f24; }
.actors-editor.ae-simple [data-level="detailed"], .actors-editor:not(.ae-simple) [data-level="simple"] { display: none !important; }
`;

export type EditorMode = "simple" | "detailed";

/** The editor's sections, in order. */
export type EditorSection = "race" | "robot" | "body" | "look" | "outfit" | "animation" | "details";
/** The footer's buttons. */
export type EditorButton = "randomize" | "reset" | "save" | "load" | "export";

const ETHNICITIES: [string, string, [number, number, number]][] = [
  ["african", "African", [1, 0, 0]],
  ["asian", "Asian", [0, 1, 0]],
  ["caucasian", "Caucasian", [0, 0, 1]],
  ["mixed", "Mixed", [1 / 3, 1 / 3, 1 / 3]],
];

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
  /**
   * "simple": the main choices for everyday users (body basics, ethnicity, hair, eyes,
   * outfit preset, animation, face). "detailed": every control. Default: the viewer's
   * last choice, else "simple".
   */
  mode?: EditorMode;
  /** Show the Simple/Detailed switch (default true). */
  modeSwitch?: boolean;
  /** Only these sections (default: all). For a game's own creator, e.g. without "race" or "animation". */
  sections?: EditorSection[];
  /** Only these footer buttons (default: all). */
  buttons?: EditorButton[];
  /**
   * Controls to leave out, by their key: a config field ("anatomy", "expression", "beard"), a body
   * slider ("body.cupSize"), a detail slider ("details.nose") or a role ("outfit-preset").
   */
  hide?: string[];
  /** What Randomize sets (default: `character.randomize()` from the character's catalog). */
  randomize?: () => CharacterPatch | Promise<CharacterPatch>;
}

const SIMPLE_BODY = new Set<keyof HumanParams>(["gender", "ageYears", "muscle", "weight", "height", "cupSize"]);
const MODE_KEY = "actors-editor-mode";

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
  private readonly modeButtons: HTMLButtonElement[] = [];
  private readonly onMode: (() => void)[] = [];
  private currentMode: EditorMode = "simple";

  constructor(
    readonly character: Character,
    container: HTMLElement,
    options: EditorOptions = {},
  ) {
    if (!document.getElementById("actors-editor-css")) {
      const style = document.createElement("style");
      style.id = "actors-editor-css";
      style.textContent = STYLE;
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
    // Marks a control as shown only in one mode.
    const only = (level: EditorMode, node: HTMLElement) => {
      ((node.closest(".ae-row, .ae-check") as HTMLElement | null) ?? node).dataset.level = level;
      return node;
    };
    const detailed = (node: HTMLElement) => only("detailed", node);
    if (options.modeSwitch !== false) {
      const modes = document.createElement("div");
      modes.className = "ae-modes";
      for (const [m, label] of [["simple", "Simple"], ["detailed", "Detailed"]] as const) {
        const b = document.createElement("button");
        b.textContent = label;
        b.dataset.mode = m;
        b.addEventListener("click", () => this.setMode(m));
        modes.appendChild(b);
        this.modeButtons.push(b);
      }
      el.appendChild(modes);
    }

    // Race
    const raceSec = this.section("Race", "race");
    const raceNames = cat.races.map((r): [string, string] => [r.id, r.label]);
    // Picking a race rolls a typical member of it (shape, skin, eyes, hair), keeping gender, outfit and animation.
    this.select(raceSec, "Race", raceNames, (c) => c.race, (v) => {
      this.status.textContent = "…";
      character.setRace(v as CharacterConfig["race"]).then(() => (this.status.textContent = `${character.lastUpdateMs.toFixed(0)} ms`));
    }, "race");
    const raceInfo = document.createElement("p");
    raceInfo.className = "ae-note";
    raceSec.appendChild(raceInfo);
    this.syncers.push((c) => (raceInfo.textContent = cat.races.find((r) => r.id === c.race)?.description ?? ""));
    detailed(this.select(raceSec, "Mixed with", [["", "None"], ...raceNames], (c) => c.race2 ?? "", (v) => set({ race2: (v || null) as CharacterConfig["race2"], raceMix: v ? character.config.raceMix || 0.5 : 0 }), "race2"));
    const mixRow = detailed(this.slider(raceSec, "Mix", 0, 1, 0.01, pct, (c) => c.raceMix, (v) => set({ raceMix: v }), "raceMix"));
    this.syncers.push((c) => (mixRow.hidden = !c.race2));
    detailed(this.slider(raceSec, "Size", 0, 1, 0.01, pct, (c) => c.raceSize, (v) => set({ raceSize: v }), "raceSize"));

    // Robot: same skeleton and clips, shaped by the body and race sliders.
    const robotOpts = cat.robot;
    if (robotOpts) {
      const sec = this.section("Robot", "robot");
      const setRobot = (look: Partial<RobotLook>) => set({ robotLook: look });
      this.check(sec, "Robot", (c) => c.robot, (v) => set({ robot: v }), "robot");
      const rows: HTMLElement[] = [];
      const add = <T extends HTMLElement>(node: T) => {
        rows.push((node.closest(".ae-row, .ae-check") as HTMLElement | null) ?? node);
        return node;
      };
      const pick = (list: { id: string; label: string }[]): [string, string][] => list.map((x) => [x.id, x.label]);
      add(this.select(sec, "Colours", [["", "Custom"], ...pick(robotOpts.palettes)], (c) => robotOpts.palettes.find((p) => Object.entries(p.look).every(([k, v]) => c.robotLook[k as keyof RobotLook] === v))?.id ?? "", (v) => {
        const p = robotOpts.palettes.find((x) => x.id === v);
        if (p) setRobot(p.look);
      }, "robotLook.palette"));
      add(this.select(sec, "Head", pick(robotOpts.heads), (c) => c.robotLook.head, (v) => setRobot({ head: v as RobotLook["head"] }), "robotLook.head"));
      add(this.select(sec, "Ears", pick(robotOpts.ears), (c) => c.robotLook.ears, (v) => setRobot({ ears: v as RobotLook["ears"] }), "robotLook.ears"));
      add(this.select(sec, "Plating", pick(robotOpts.plating), (c) => c.robotLook.plating, (v) => setRobot({ plating: v as RobotLook["plating"] }), "robotLook.plating"));
      add(detailed(this.slider(sec, "Plate thickness", 0, 1, 0.01, pct, (c) => c.robotLook.thickness, (v) => setRobot({ thickness: v }), "robotLook.thickness")));
      add(this.select(sec, "Finish", pick(robotOpts.finishes), (c) => c.robotLook.finish, (v) => setRobot({ finish: v as RobotLook["finish"] }), "robotLook.finish"));
      for (const [k, label] of [["paint", "Paint"], ["trim", "Trim"], ["frame", "Frame"], ["metal", "Metal"], ["glow", "Lights"]] as const) {
        const row = add(this.color(sec, label, (c) => c.robotLook[k], (v) => setRobot({ [k]: v ?? undefined }), `robotLook.${k}`));
        if (k === "frame" || k === "metal") detailed(row);
      }
      add(this.slider(sec, "Light strength", 0, 1, 0.01, pct, (c) => c.robotLook.glowStrength, (v) => setRobot({ glowStrength: v }), "robotLook.glowStrength"));
      add(this.check(sec, "Chest light", (c) => c.robotLook.core, (v) => setRobot({ core: v }), "robotLook.core"));
      // Robots wear no skin, hair or clothes: those sections hide, and the robot rows show.
      this.syncers.push((c) => {
        for (const row of rows) row.classList.toggle("ae-robot-off", !c.robot);
        for (const id of ["look", "outfit"]) el.querySelector<HTMLElement>(`section[data-section="${id}"]`)?.classList.toggle("ae-robot-off", c.robot);
      });
    }

    // Body
    const body = this.section("Body", "body");
    for (const s of BODY) {
      const row = this.slider(body, s.label, s.min, s.max, s.step, s.fmt, (c) => c.body[s.key], (v) => set({ body: { [s.key]: v } }), `body.${s.key}`);
      if (!SIMPLE_BODY.has(s.key)) detailed(row);
    }
    const eth = this.select(body, "Ethnicity", [...ETHNICITIES.map(([id, label]): [string, string] => [id, label]), ["", "Custom"]], (c) => {
      const sum = c.body.african + c.body.asian + c.body.caucasian || 1;
      const mix = [c.body.african / sum, c.body.asian / sum, c.body.caucasian / sum];
      return ETHNICITIES.find(([, , w]) => w.every((v, i) => Math.abs(v - mix[i]) < 0.02))?.[0] ?? "";
    }, (v) => {
      const e = ETHNICITIES.find(([id]) => id === v);
      if (e) set({ body: { african: e[2][0], asian: e[2][1], caucasian: e[2][2] } });
    }, "ethnicity");
    only("simple", eth);

    // Look
    const look = this.section("Look", "look");
    if (cat.photoSkin) detailed(this.select(look, "Skin", [["photo", "Photo (follows ethnicity)"], ["procedural", "Procedural"]], (c) => c.skin, (v) => set({ skin: v as CharacterConfig["skin"] }), "skin"));
    const tone = detailed(this.slider(look, "Skin tone", 0, 1, 0.01, pct, (c) => c.skinTone, (v) => set({ skinTone: v }), "skinTone"));
    this.syncers.push((c) => (tone.hidden = c.skin === "photo"));
    this.color(look, "Skin colour", (c) => c.skinColor, (v) => set({ skinColor: v }), "skinColor");
    this.select(look, "Eyes", cat.eyes.map((e) => [e.id, e.label]), (c) => c.eyes, (v) => set({ eyes: v, eyeColor: null }), "eyes");
    detailed(this.color(look, "Eye colour", (c) => c.eyeColor, (v) => set({ eyeColor: v }), "eyeColor"));
    detailed(this.select(look, "Pupils", Object.keys(PUPILS).map((p): [string, string] => [p, cap(p)]), (c) => c.pupil, (v) => set({ pupil: v as CharacterConfig["pupil"] }), "pupil"));
    detailed(this.slider(look, "Eye glow", 0, 1, 0.01, pct, (c) => c.eyeGlow, (v) => set({ eyeGlow: v }), "eyeGlow"));
    detailed(this.select(look, "Skin pattern", Object.keys(SKIN_PATTERNS).map((p): [string, string] => [p, cap(p)]), (c) => c.skinPattern, (v) => set({ skinPattern: v as CharacterConfig["skinPattern"] }), "skinPattern"));
    const patRows = [
      detailed(this.slider(look, "Pattern strength", 0, 1, 0.01, pct, (c) => c.patternStrength, (v) => set({ patternStrength: v }), "patternStrength")),
      detailed(this.color(look, "Pattern colour", (c) => c.patternColor, (v) => set({ patternColor: v }), "patternColor")),
    ];
    this.syncers.push((c) => patRows.forEach((row) => (row.hidden = c.skinPattern === "none")));
    this.select(look, "Hair", [["", "None"], ...cat.hair.map((h): [string, string] => [h.id, h.label])], (c) => c.hair ?? "", (v) => set({ hair: v || null }), "hair");
    // CC-BY hairstyles name their author.
    const hairCredit = document.createElement("p");
    hairCredit.className = "ae-note";
    hairCredit.dataset.role = "hair-credit";
    look.appendChild(hairCredit);
    this.syncers.push((c) => {
      const credit = cat.hair.find((h) => h.id === c.hair)?.credit;
      const author = credit?.match(/ by (.+?) \(/)?.[1];
      hairCredit.hidden = !credit;
      hairCredit.textContent = credit ? `CC-BY${author ? ` · ${author}` : ""}` : "";
      hairCredit.title = credit ?? "";
    });
    this.select(look, "Hair colour", [["", "Natural"], ...cat.hairColors.map((h): [string, string] => [h.id, h.label])], (c) => c.hairColor ?? "", (v) => set({ hairColor: v || null }), "hairColor");
    const opts = (list: string[]): [string, string][] => list.map((v) => [v, cap(v)]);
    this.select(look, "Beard", opts(BEARD_STYLES), (c) => c.beard, (v) => set({ beard: v as CharacterConfig["beard"] }), "beard");
    this.slider(look, "Stubble", 0, 1, 0.01, pct, (c) => c.stubble, (v) => set({ stubble: v }), "stubble");
    detailed(this.select(look, "Horns", opts(HORN_STYLES), (c) => c.horns, (v) => set({ horns: v as CharacterConfig["horns"] }), "horns"));
    const hornRows = [
      detailed(this.slider(look, "Horn size", 0, 1, 0.01, pct, (c) => c.hornSize, (v) => set({ hornSize: v }), "hornSize")),
      detailed(this.color(look, "Horn colour", (c) => c.hornColor, (v) => set({ hornColor: v }), "hornColor")),
    ];
    this.syncers.push((c) => hornRows.forEach((row) => (row.hidden = c.horns === "none")));
    detailed(this.slider(look, "Tusks", 0, 1, 0.01, pct, (c) => c.tusks, (v) => set({ tusks: v }), "tusks"));
    detailed(this.select(look, "Tail", opts(TAIL_STYLES), (c) => c.tail, (v) => set({ tail: v as CharacterConfig["tail"] }), "tail"));
    const tailRow = detailed(this.slider(look, "Tail length", 0, 1, 0.01, pct, (c) => c.tailLength, (v) => set({ tailLength: v }), "tailLength"));
    this.syncers.push((c) => (tailRow.hidden = c.tail === "none"));
    detailed(this.select(look, "Eyebrows", [...cat.brows.map((b): [string, string] => [b.id, b.label]), [PAINTED_BROWS, "Painted"], ["", "None"]], (c) => c.brows ?? "", (v) => set({ brows: v || null }), "brows"));
    detailed(this.select(look, "Detail", [["high", "High (subdivided)"], ["low", "Low"]], (c) => c.detail, (v) => set({ detail: v as CharacterConfig["detail"] }), "detail"));
    if (character.lods.length > 1)
      detailed(this.select(look, "Level of detail", [["auto", "Auto (by distance)"], ...character.lods.map((l, i): [string, string] => [String(i), l.name])], () => String(character.lodMode), (v) => character.setLod(v === "auto" ? "auto" : +v), "lod"));
    this.check(look, "Anatomical detail", (c) => c.anatomy, (v) => set({ anatomy: v }), "anatomy");

    // Outfit
    const outfit = this.section("Outfit", "outfit");
    const presetSel = this.select(outfit, "Preset", [["", "Custom"], ...cat.outfits.map((o): [string, string] => [o.id, o.label])], (c) => {
      const match = cat.outfits.find((o) => sameSet(outfitGarments(o, c.body), c.outfit));
      return match?.id ?? "";
    }, (v) => v && character.wear(v).catch(() => {}), "outfit");
    presetSel.dataset.role = "outfit-preset";
    const outfitDescription = document.createElement("p");
    outfitDescription.className = "ae-note";
    outfitDescription.dataset.role = "outfit-description";
    outfitDescription.setAttribute("aria-live", "polite");
    outfit.appendChild(outfitDescription);
    this.syncers.push((c) => {
      const preset = cat.outfits.find((o) => sameSet(outfitGarments(o, c.body), c.outfit));
      outfitDescription.textContent = preset?.description ?? "";
      outfitDescription.hidden = !preset?.description;
    });
    // Single garments, grouped by category.
    const groups = new Map<string, HTMLElement>();
    for (const g of cat.garments) {
      let grid = groups.get(g.category);
      if (!grid) {
        const box = document.createElement("details");
        box.innerHTML = `<summary></summary><div class="ae-grid"></div>`;
        box.querySelector("summary")!.textContent = g.category;
        box.dataset.category = g.category;
        detailed(box);
        outfit.appendChild(box);
        grid = box.querySelector<HTMLElement>(".ae-grid")!;
        groups.set(g.category, grid);
      }
      const box = this.check(grid, g.label, (c) => c.outfit.includes(g.id), (on) => {
        const cur = character.config.outfit.filter((x) => x !== g.id);
        set({ outfit: on ? [...cur, g.id] : cur });
      });
      box.dataset.garment = g.id;
      if (g.credit) {
        const credit = document.createElement("small");
        credit.className = "ae-credit";
        credit.textContent = `CC-BY · ${g.author ?? ""}`;
        credit.title = g.credit;
        box.parentElement!.appendChild(credit);
      }
    }

    // Colours of the worn garments: palette swatches, a free colour picker and "original".
    const colors = document.createElement("div");
    colors.className = "ae-colors";
    outfit.appendChild(colors);
    let shownOutfit = "";
    const recolor = (id: string, color: string | null) => {
      const next = { ...character.config.garmentColors };
      if (color) next[id] = color;
      else delete next[id];
      set({ garmentColors: next });
    };
    this.syncers.push((c) => {
      const key = c.outfit.join("|");
      if (key !== shownOutfit) {
        shownOutfit = key;
        colors.replaceChildren();
        for (const id of c.outfit) {
          const g = cat.garments.find((x) => x.id === id);
          if (!g) continue;
          const row = document.createElement("div");
          row.className = "ae-color-row";
          row.dataset.garmentColor = id;
          const name = document.createElement("span");
          name.textContent = g.label;
          const swatches = document.createElement("div");
          swatches.className = "ae-swatches";
          const orig = document.createElement("button");
          orig.className = "ae-swatch ae-original";
          orig.title = "Original colours";
          orig.addEventListener("click", () => recolor(id, null));
          swatches.appendChild(orig);
          for (const col of cat.garmentColors) {
            const b = document.createElement("button");
            b.className = "ae-swatch";
            b.title = col.label;
            b.style.background = col.id;
            b.dataset.color = col.id;
            b.addEventListener("click", () => recolor(id, col.id));
            swatches.appendChild(b);
          }
          const picker = document.createElement("input");
          picker.type = "color";
          picker.title = "Any colour";
          picker.addEventListener("input", () => recolor(id, picker.value));
          swatches.appendChild(picker);
          row.append(name, swatches);
          colors.appendChild(row);
        }
      }
      for (const row of colors.querySelectorAll<HTMLElement>(".ae-color-row")) {
        const cur = c.garmentColors[row.dataset.garmentColor!] ?? null;
        for (const b of row.querySelectorAll<HTMLElement>(".ae-swatch")) b.classList.toggle("ae-on", (b.dataset.color ?? null) === cur);
        const picker = row.querySelector<HTMLInputElement>('input[type="color"]')!;
        if (cur) picker.value = cur;
      }
      // Open the groups that have something worn.
      for (const [category, grid] of groups) if (c.outfit.some((id) => cat.garments.find((x) => x.id === id)?.category === category)) (grid.parentElement as HTMLDetailsElement).open = true;
    });

    // Animation and face
    const motion = this.section("Animation", "animation");
    // Clip pickers: a library choice, a search box for big libraries, and the clip list grouped by category.
    const libSel = this.select(motion, "Library", cat.libraries.map((l) => [l.id, l.label]), (c) => cat.animations.find((a) => a.id === c.animation)?.library ?? libSel.value, () => fillClips(), "library");
    if (cat.libraries.length < 2) (libSel.parentElement as HTMLElement).hidden = true;
    detailed(libSel);
    const searchRow = document.createElement("div");
    searchRow.className = "ae-row";
    searchRow.innerHTML = `<label>Search</label><input type="search" placeholder="walk, dance, jump…" style="grid-column: 2 / 4">`;
    const search = searchRow.querySelector("input")!;
    search.dataset.key = "clip-search";
    motion.appendChild(searchRow);
    detailed(searchRow);
    // Simple mode lists only the pack's own clips.
    this.onMode.push(() => {
      if (this.currentMode === "simple" && libSel.value !== "") {
        libSel.value = "";
        search.value = "";
        fillClips();
      }
    });
    search.addEventListener("input", () => fillClips());
    const clipSel = this.select(motion, "Clip", [], (c) => c.animation ?? "", (v) => set({ animation: v || null }), "animation");
    const fillClips = () => {
      const lib = libSel.value;
      const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
      const list = cat.animations.filter((a) => a.library === lib && words.every((w) => `${a.label} ${a.category}`.toLowerCase().includes(w)));
      clipSel.replaceChildren(new Option("Bind pose", ""));
      const groups = new Map<string, HTMLOptGroupElement>();
      for (const a of list.slice(0, 600)) {
        if (!groups.has(a.category)) {
          const g = document.createElement("optgroup");
          g.label = a.category;
          clipSel.appendChild(g);
          groups.set(a.category, g);
        }
        groups.get(a.category)!.appendChild(new Option(a.label, a.id));
      }
      const current = character.config.animation;
      if (current && !list.some((a) => a.id === current)) {
        const a = cat.animations.find((x) => x.id === current);
        // Keep the playing clip selectable at the top, outside the groups.
        if (a) clipSel.insertBefore(new Option(a.label, a.id), clipSel.children[1] ?? null);
      }
      clipSel.value = current ?? "";
      searchRow.hidden = list.length < 40 && !search.value;
    };
    this.syncers.push(() => {
      if (!clipSel.querySelector(`option[value="${CSS.escape(character.config.animation ?? "")}"]`)) fillClips();
    });
    fillClips();
    const root = detailed(this.check(motion, "Root motion", () => character.rootMotion, (v) => (character.rootMotion = v))) as HTMLInputElement;
    root.dataset.role = "root-motion";
    this.select(motion, "Face", cat.expressions.map((e) => [e.id, e.label]), (c) => c.expression, (v) => set({ expression: v }), "expression");
    detailed(this.slider(motion, "Intensity", 0, 1, 0.01, pct, (c) => c.expressionIntensity, (v) => set({ expressionIntensity: v }), "expressionIntensity"));
    detailed(this.check(motion, "Blink", (c) => c.blink, (v) => set({ blink: v }), "blink"));

    // Detail sliders
    if (options.details !== false && cat.details.length) {
      const details = detailed(this.section("Details", "details"));
      const groups = new Map<string, HTMLElement>();
      for (const d of cat.details) {
        if (!groups.has(d.group)) {
          const g = document.createElement("details");
          g.innerHTML = `<summary></summary>`;
          g.querySelector("summary")!.textContent = d.group;
          details.appendChild(g);
          groups.set(d.group, g);
          // Genital shape sliders only matter with anatomical detail on (hidden with it).
          if (d.group.toLowerCase() === "genitals") this.syncers.push((c) => (g.hidden = !c.anatomy));
        }
        const row = this.slider(groups.get(d.group)!, d.label, d.min, d.max, 0.01, (v) => v.toFixed(2), (c) => c.details[d.id] ?? 0, (v) => set({ details: { ...character.config.details, [d.id]: v } }), `details.${d.id}`);
        // (The crotch bulge too.)
        if (row && /(^|\/)bulge/.test(d.id)) this.syncers.push((c) => (row.hidden = !c.anatomy));
      }
    }

    // Footer
    const footer = document.createElement("footer");
    const button = (label: string, onClick: () => void, role?: string) => {
      if (role && options.buttons && !options.buttons.includes(role as EditorButton)) return;
      const b = document.createElement("button");
      b.textContent = label;
      if (role) b.dataset.role = role;
      b.addEventListener("click", onClick);
      footer.appendChild(b);
    };
    const randomize = options.randomize;
    button("Randomize", () => void (randomize ? Promise.resolve(randomize()).then((p) => character.set(p)) : character.randomize()), "randomize");
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

    // What the host leaves out.
    if (options.sections) for (const sec of el.querySelectorAll<HTMLElement>("section[data-section]")) sec.classList.toggle("ae-off", !options.sections.includes(sec.dataset.section as EditorSection));
    for (const key of options.hide ?? []) {
      for (const node of el.querySelectorAll<HTMLElement>(`[data-key="${CSS.escape(key)}"], [data-role="${CSS.escape(key)}"]`)) {
        ((node.closest(".ae-row, .ae-check") as HTMLElement | null) ?? node).classList.add("ae-off");
      }
    }

    this.unsubscribe = character.onChange((c) => this.sync(c));
    this.sync(character.config);
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(MODE_KEY);
    } catch {
      // storage unavailable (private mode, sandboxed frame)
    }
    this.setMode(options.mode ?? (saved === "detailed" ? "detailed" : "simple"), false);
  }

  get mode(): EditorMode {
    return this.currentMode;
  }

  /** Switches between the simple and the detailed panel. */
  setMode(mode: EditorMode, remember = true): void {
    this.currentMode = mode;
    this.element.classList.toggle("ae-simple", mode === "simple");
    for (const b of this.modeButtons) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    for (const f of this.onMode) f();
    if (remember)
      try {
        localStorage.setItem(MODE_KEY, mode);
      } catch {
        // ignore
      }
  }

  dispose(): void {
    this.unsubscribe();
    this.element.remove();
  }

  private sync(c: CharacterConfig): void {
    for (const s of this.syncers) s(c);
  }

  private section(title: string, id: EditorSection): HTMLElement {
    const s = document.createElement("section");
    s.dataset.section = id;
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
    this.syncers.push((c) => {
      const v = get(c);
      // Values outside the list (e.g. a race's random hair colour) show as "Custom".
      sel.querySelector("option[data-custom]")?.remove();
      if (v && ![...sel.options].some((o) => o.value === v)) {
        const o = new Option("Custom", v);
        o.dataset.custom = "";
        sel.add(o);
      }
      sel.value = v;
    });
    parent.appendChild(div);
    return sel;
  }

  /** A colour picker with a reset button (null = the default colour). */
  private color(parent: HTMLElement, label: string, get: (c: CharacterConfig) => string | null, onChange: (v: string | null) => void, key?: string): HTMLElement {
    const div = document.createElement("div");
    div.className = "ae-row";
    div.innerHTML = `<label></label><input type="color"><button title="Back to the default">×</button>`;
    div.querySelector("label")!.textContent = label;
    const input = div.querySelector("input")!;
    const reset = div.querySelector("button")!;
    if (key) input.dataset.key = key;
    input.addEventListener("input", () => onChange(input.value));
    reset.addEventListener("click", () => onChange(null));
    this.syncers.push((c) => {
      const v = get(c);
      input.value = v ?? "#808080";
      input.style.opacity = v ? "1" : "0.35";
      reset.disabled = !v;
    });
    parent.appendChild(div);
    return div;
  }

  private check(parent: HTMLElement, label: string, get: (c: CharacterConfig) => boolean, onChange: (v: boolean) => void, key?: string): HTMLInputElement {
    const l = document.createElement("label");
    l.className = "ae-check";
    const box = document.createElement("input");
    box.type = "checkbox";
    if (key) box.dataset.key = key;
    const text = document.createElement("span");
    text.textContent = label;
    l.append(box, text);
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
