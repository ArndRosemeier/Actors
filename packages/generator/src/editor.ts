import { ADULT_MIN_AGE, BEARD_STYLES, BODY_TYPES, HORN_STYLES, SHAPE_SLIDERS, type HumanParams, MAX_AGE, TAIL_STYLES } from "@actors/human";
import { type CharacterConfig, PAINTED_BROWS, type RobotLook, type SkeletalLook, outfitGarments, raceFeatures } from "./catalog";
import type { Character, CharacterPatch } from "./character";
import { PUPILS, SKIN_PATTERNS } from "@actors/three";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const STYLE = `
.actors-editor { --ae-panel: #1d1f24; --ae-text: #e6e6e6; --ae-muted: #9aa0a6; --ae-accent: #c98b6b; --ae-border: #2c2f36;
  box-sizing: border-box; background: var(--ae-panel); color: var(--ae-text); font: 13px/1.4 system-ui, sans-serif; padding: 12px 14px 20px; overflow-y: auto; }
.actors-editor * { box-sizing: border-box; }
.actors-editor [hidden], .actors-editor .ae-off, .actors-editor .ae-robot-off, .actors-editor .ae-skel-off { display: none !important; }
.actors-editor header { display: flex; align-items: baseline; justify-content: space-between; }
.actors-editor h1 { font-size: 18px; margin: 0 0 8px; }
.actors-editor .ae-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 16px 0 6px; }
.actors-editor h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ae-muted); margin: 0; }
.actors-editor h3 { font-size: 11px; font-weight: 600; color: var(--ae-muted); margin: 10px 0 4px; }
.actors-editor .ae-status { color: var(--ae-muted); font-size: 12px; }
.actors-editor .ae-note { color: var(--ae-muted); font-size: 12px; margin: 2px 0 6px; }
.actors-editor .ae-row { display: grid; grid-template-columns: 110px 1fr 40px; gap: 8px; align-items: center; margin: 3px 0; }
.actors-editor .ae-row label { color: var(--ae-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actors-editor .ae-row output { text-align: right; font-variant-numeric: tabular-nums; color: var(--ae-muted); }
.actors-editor .ae-row select { grid-column: 2 / 4; }
.actors-editor input[type="range"] { width: 100%; accent-color: var(--ae-accent); }
.actors-editor .ae-row button { padding: 1px 0; }
.actors-editor details { border-top: 1px solid var(--ae-border); padding: 4px 0; }
.actors-editor summary { cursor: pointer; padding: 3px 0; text-transform: capitalize; }
.actors-editor .ae-check { display: flex; gap: 6px; align-items: center; margin: 3px 0; flex-wrap: wrap; }
.actors-editor .ae-grid { display: grid; grid-template-columns: 1fr 1fr; }
.actors-editor .ae-check > span { flex: 1; min-width: 0; }
.actors-editor .ae-credit { flex-basis: 100%; margin: -2px 0 0 22px; color: var(--ae-muted); font-size: 10px; }
.actors-editor input[type="search"], .actors-editor input[type="text"] { background: #272a31; color: var(--ae-text); border: 1px solid var(--ae-border); border-radius: 6px; padding: 5px 9px; font: inherit; min-width: 0; }
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
.actors-editor .ae-tabs { display: flex; gap: 0; }
.actors-editor .ae-tabs button { border-radius: 0; padding: 2px 9px; font-size: 11px; }
.actors-editor .ae-tabs button:first-child { border-radius: 6px 0 0 6px; }
.actors-editor .ae-tabs button:last-child { border-radius: 0 6px 6px 0; }
.actors-editor .ae-tabs button[aria-selected="true"] { background: var(--ae-accent); border-color: var(--ae-accent); color: #1d1f24; }
.actors-editor section.ae-simple [data-level="detailed"], .actors-editor section:not(.ae-simple) [data-level="simple"] { display: none !important; }
`;

/** A section's tab: the presets (simple) or every control, starting from what the presets set (detailed). */
export type EditorMode = "simple" | "detailed";

/**
 * The editor's sections, in order: race (and kind: person, robot, skeleton), robot, skeleton, body
 * (with skin), face (with hair), outfit (clothes), animation. Older names still work in `sections`:
 * "look" is the face; "shape" and "details" are part of the Detailed tabs of body and face.
 */
export type EditorSection = "race" | "robot" | "skeleton" | "body" | "face" | "outfit" | "animation" | "look" | "shape" | "details";
/** The footer's buttons. */
export type EditorButton = "randomize" | "reset" | "save" | "load" | "export";

/** Sections that have a Simple and a Detailed tab. */
const TABBED: EditorSection[] = ["race", "robot", "skeleton", "body", "face", "outfit", "animation"];

const ETHNICITIES: [string, string, [number, number, number]][] = [
  ["african", "African", [1, 0, 0]],
  ["asian", "Asian", [0, 1, 0]],
  ["caucasian", "Caucasian", [0, 0, 1]],
  ["mixed", "Mixed", [1 / 3, 1 / 3, 1 / 3]],
];

/** Simple presets for single body values: [id, label, value]. */
const GENDERS: [string, string, number][] = [["female", "Female", 0], ["androgynous", "Androgynous", 0.5], ["male", "Male", 1]];
const AGES: [string, string, number][] = [["young", "Young adult (22)", 22], ["adult", "Adult (35)", 35], ["middle", "Middle-aged (50)", 50], ["old", "Old (70)", 70]];
const HEIGHTS: [string, string, number][] = [["short", "Short", 0.2], ["average", "Average", 0.5], ["tall", "Tall", 0.8]];

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

/** Detail slider groups that belong to the face (the rest go with the body). */
const FACE_GROUPS = new Set(["head", "eyes", "eyebrows", "nose", "mouth", "ears", "chin", "cheek", "forehead", "asym"]);

export interface EditorOptions {
  /** Heading text (default "Character"). */
  title?: string;
  /** Show the raw detail sliders in the Detailed tabs of body and face (default true). */
  details?: boolean;
  /** Extra buttons for the footer. */
  actions?: { label: string; onClick: () => void }[];
  /**
   * The tab every section starts on: "simple" (presets) or "detailed" (every control). Default: the
   * viewer's last choice per section, else "simple".
   */
  mode?: EditorMode;
  /** Show the Simple/Detailed tabs of each section (default true). Without them every section stays on `mode`. */
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

const TABS_KEY = "actors-editor-tabs";
const OLD_MODE_KEY = "actors-editor-mode";

/**
 * A plain-DOM control panel for a Character. Each section (race, body, face, clothes, animation, and
 * robot or skeleton when the character is one) has a Simple tab with presets and a Detailed tab with
 * every control; both edit the same character, so Detailed always starts from what Simple picked.
 * Also randomize/reset, save/load as JSON and glTF export. It only calls the public Character API, so
 * it doubles as a usage example.
 */
export class CharacterEditor {
  readonly element: HTMLElement;
  private readonly syncers: ((c: CharacterConfig) => void)[] = [];
  private readonly status: HTMLElement;
  private readonly unsubscribe: () => void;
  private readonly tabs = new Map<EditorSection, EditorMode>();
  private readonly onMode: (() => void)[] = [];
  private currentMode: EditorMode = "simple";
  private readonly remember: boolean;

  constructor(
    readonly character: Character,
    container: HTMLElement,
    options: EditorOptions = {},
  ) {
    if (!document.getElementById("actors-editor-css")) {
      const style = document.createElement("style");
      style.id = "actors-editor-css";
      document.head.appendChild(style);
    }
    // (Replaced on every editor, so a page with an older editor's CSS gets this one's.)
    document.getElementById("actors-editor-css")!.textContent = STYLE;
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
    const tabbed = options.modeSwitch !== false;
    this.remember = tabbed;

    const header = document.createElement("header");
    header.innerHTML = `<h1></h1><span class="ae-status">Ready</span>`;
    header.querySelector("h1")!.textContent = options.title ?? "Character";
    this.status = header.querySelector(".ae-status")!;
    el.appendChild(header);
    // Marks a control as shown only on one tab of its section.
    const only = (level: EditorMode, node: HTMLElement) => {
      ((node.closest(".ae-row, .ae-check") as HTMLElement | null) ?? node).dataset.level = level;
      return node;
    };
    const detailed = (node: HTMLElement) => only("detailed", node);
    const simple = (node: HTMLElement) => only("simple", node);
    const heading = (parent: HTMLElement, text: string) => {
      const h = document.createElement("h3");
      h.textContent = text;
      parent.appendChild(h);
      return detailed(h);
    };
    // A select of named values for one body number (Custom when it matches none).
    const presetSelect = (parent: HTMLElement, label: string, key: keyof HumanParams, list: [string, string, number][], tol: number, role: string) => {
      const sel = this.select(parent, label, [...list.map(([id, l]): [string, string] => [id, l]), ["", "Custom"]], (c) => list.find(([, , v]) => Math.abs((c.body[key] as number) - v) <= tol)?.[0] ?? "", (v) => {
        const p = list.find(([id]) => id === v);
        if (p) set({ body: { [key]: p[2] } });
      });
      sel.dataset.role = role;
      return simple(sel);
    };
    const opts = (list: readonly string[]): [string, string][] => list.map((v) => [v, cap(v)]);
    const pick = (list: { id: string; label: string }[]): [string, string][] => list.map((x) => [x.id, x.label]);
    // Rows that only apply to living people (skin, hair...): hidden for robots and skeletons.
    const fleshRows: HTMLElement[] = [];
    const flesh = <T extends HTMLElement>(node: T) => {
      fleshRows.push((node.closest(".ae-row, .ae-check") as HTMLElement | null) ?? node);
      return node;
    };

    // Race-only features (horns, tails, tusks, eye glow, pupils, skin patterns): only what the races on offer have.
    const feat = raceFeatures(cat.races, { horns: HORN_STYLES, tails: TAIL_STYLES, pupils: Object.keys(PUPILS) as CharacterConfig["pupil"][], patterns: Object.keys(SKIN_PATTERNS) as CharacterConfig["skinPattern"][] });
    const notOffered = (node: HTMLElement, offered: boolean) => {
      if (!offered) ((node.closest(".ae-row, .ae-check") as HTMLElement | null) ?? node).classList.add("ae-off");
      return node;
    };
    // Race, and what the character is: a person, a robot or a skeleton.
    const raceSec = this.section("Race", "race");
    const kinds: [string, string][] = [...(cat.people !== false ? [["person", "Person"] as [string, string]] : []), ...(cat.robot ? [["robot", "Robot"] as [string, string]] : []), ...(cat.skeletal ? [["skeleton", "Skeleton"] as [string, string]] : [])];
    const kindSel = this.select(raceSec, "Kind", kinds, (c) => (c.robot ? "robot" : c.skeletal ? "skeleton" : "person"), (v) => set({ robot: v === "robot", skeletal: v === "skeleton" }), "kind");
    if (kinds.length < 2) (kindSel.parentElement as HTMLElement).hidden = true;
    const raceNames = cat.races.map((r): [string, string] => [r.id, r.label]);
    // Picking a race rolls a typical member of it (shape, skin, eyes, hair), keeping gender, outfit and animation.
    const raceSel = this.select(raceSec, "Race", raceNames, (c) => c.race, (v) => {
      this.status.textContent = "…";
      character.setRace(v as CharacterConfig["race"]).then(() => (this.status.textContent = `${character.lastUpdateMs.toFixed(0)} ms`));
    }, "race");
    const raceInfo = document.createElement("p");
    raceInfo.className = "ae-note";
    raceSec.appendChild(raceInfo);
    this.syncers.push((c) => (raceInfo.textContent = cat.races.find((r) => r.id === c.race)?.description ?? ""));
    const mixed = detailed(this.select(raceSec, "Mixed with", [["", "None"], ...raceNames], (c) => c.race2 ?? "", (v) => set({ race2: (v || null) as CharacterConfig["race2"], raceMix: v ? character.config.raceMix || 0.5 : 0 }), "race2"));
    const mixRow = detailed(this.slider(raceSec, "Mix", 0, 1, 0.01, pct, (c) => c.raceMix, (v) => set({ raceMix: v }), "raceMix"));
    this.syncers.push((c) => (mixRow.hidden = !c.race2));
    detailed(this.slider(raceSec, "Size", 0, 1, 0.01, pct, (c) => c.raceSize, (v) => set({ raceSize: v }), "raceSize"));
    // Child proportions on the adult body (no anatomy for children).
    detailed(this.slider(raceSec, "Youth", 0, 1, 0.01, pct, (c) => c.youth, (v) => set({ youth: v }), "youth"));
    // A single race: nothing to pick or mix.
    if (raceNames.length < 2) for (const n of [raceSel, mixed, raceInfo]) ((n.closest(".ae-row") as HTMLElement | null) ?? n).hidden = true;
    if (raceNames.length < 2 && kinds.length < 2) raceSec.querySelector<HTMLElement>(".ae-head")!.hidden = true;

    // Robot: same skeleton and clips, shaped by the body and race sliders.
    const robotOpts = cat.robot;
    if (robotOpts) {
      const sec = this.section("Robot", "robot");
      const setRobot = (look: Partial<RobotLook>) => set({ robotLook: look });
      this.select(sec, "Colours", [["", "Custom"], ...pick(robotOpts.palettes)], (c) => robotOpts.palettes.find((p) => Object.entries(p.look).every(([k, v]) => c.robotLook[k as keyof RobotLook] === v))?.id ?? "", (v) => {
        const p = robotOpts.palettes.find((x) => x.id === v);
        if (p) setRobot(p.look);
      }, "robotLook.palette");
      this.select(sec, "Head", pick(robotOpts.heads), (c) => c.robotLook.head, (v) => setRobot({ head: v as RobotLook["head"] }), "robotLook.head");
      detailed(this.select(sec, "Ears", pick(robotOpts.ears), (c) => c.robotLook.ears, (v) => setRobot({ ears: v as RobotLook["ears"] }), "robotLook.ears"));
      detailed(this.select(sec, "Plating", pick(robotOpts.plating), (c) => c.robotLook.plating, (v) => setRobot({ plating: v as RobotLook["plating"] }), "robotLook.plating"));
      detailed(this.slider(sec, "Plate thickness", 0, 1, 0.01, pct, (c) => c.robotLook.thickness, (v) => setRobot({ thickness: v }), "robotLook.thickness"));
      detailed(this.select(sec, "Finish", pick(robotOpts.finishes), (c) => c.robotLook.finish, (v) => setRobot({ finish: v as RobotLook["finish"] }), "robotLook.finish"));
      for (const [k, label] of [["paint", "Paint"], ["trim", "Trim"], ["frame", "Frame"], ["metal", "Metal"], ["glow", "Lights"]] as const) detailed(this.color(sec, label, (c) => c.robotLook[k], (v) => setRobot({ [k]: v ?? undefined }), `robotLook.${k}`));
      detailed(this.slider(sec, "Light strength", 0, 1, 0.01, pct, (c) => c.robotLook.glowStrength, (v) => setRobot({ glowStrength: v }), "robotLook.glowStrength"));
      detailed(this.check(sec, "Chest light", (c) => c.robotLook.core, (v) => setRobot({ core: v }), "robotLook.core"));
      // Shown only for robots; robots wear no skin, hair or clothes.
      this.syncers.push((c) => {
        sec.classList.toggle("ae-robot-off", !c.robot);
        for (const id of ["face", "outfit"]) el.querySelector<HTMLElement>(`section[data-section="${id}"]`)?.classList.toggle("ae-robot-off", c.robot);
      });
    }

    // Skeleton: every bone generated from the body, on the same rig and clips; garments stay on.
    const skelOpts = cat.skeletal;
    if (skelOpts) {
      const sec = this.section("Skeleton", "skeleton");
      const setSkel = (look: Partial<SkeletalLook>) => set({ skeletalLook: look });
      this.select(sec, "Colours", [["", "Custom"], ...pick(skelOpts.palettes)], (c) => skelOpts.palettes.find((p) => Object.entries(p.look).every(([k, v]) => c.skeletalLook[k as keyof SkeletalLook] === v))?.id ?? "", (v) => {
        const p = skelOpts.palettes.find((x) => x.id === v);
        if (p) setSkel(p.look);
      }, "skeletalLook.palette");
      this.slider(sec, "Wear", 0, 1, 0.01, pct, (c) => c.skeletalLook.wear, (v) => setSkel({ wear: v }), "skeletalLook.wear");
      detailed(this.slider(sec, "Lost bones", 0, 1, 0.01, pct, (c) => c.skeletalLook.missing, (v) => setSkel({ missing: v }), "skeletalLook.missing"));
      detailed(this.slider(sec, "Robust", 0, 1, 0.01, pct, (c) => c.skeletalLook.robust, (v) => setSkel({ robust: v }), "skeletalLook.robust"));
      detailed(this.check(sec, "Lower jaw", (c) => c.skeletalLook.jaw, (v) => setSkel({ jaw: v }), "skeletalLook.jaw"));
      detailed(this.color(sec, "Bone", (c) => c.skeletalLook.bone, (v) => setSkel({ bone: v ?? undefined }), "skeletalLook.bone"));
      detailed(this.slider(sec, "Dryness", 0, 1, 0.01, pct, (c) => c.skeletalLook.dryness, (v) => setSkel({ dryness: v }), "skeletalLook.dryness"));
      detailed(this.check(sec, "Eye lights", (c) => c.skeletalLook.eyes, (v) => setSkel({ eyes: v }), "skeletalLook.eyes"));
      detailed(this.check(sec, "Heart light", (c) => c.skeletalLook.heart, (v) => setSkel({ heart: v }), "skeletalLook.heart"));
      detailed(this.color(sec, "Lights", (c) => c.skeletalLook.glow, (v) => setSkel({ glow: v ?? undefined }), "skeletalLook.glow"));
      detailed(this.slider(sec, "Light strength", 0, 1, 0.01, pct, (c) => c.skeletalLook.glowStrength, (v) => setSkel({ glowStrength: v }), "skeletalLook.glowStrength"));
      // Shown only for skeletons; they have no skin or hair (clothes stay).
      this.syncers.push((c) => {
        sec.classList.toggle("ae-skel-off", !c.skeletal);
        el.querySelector<HTMLElement>(`section[data-section="face"]`)?.classList.toggle("ae-skel-off", c.skeletal);
      });
    }

    // Body: presets on Simple; every body slider, the shape sliders, the skin and raw sliders on Detailed.
    const body = this.section("Body", "body");
    presetSelect(body, "Gender", "gender", GENDERS, 0.15, "gender");
    presetSelect(body, "Age", "ageYears", AGES, 0, "age");
    // Body types: a starting point that sets the macros and the shape sliders together.
    this.select(body, "Body type", [["", "Custom"], ...BODY_TYPES.map((t): [string, string] => [t.id, t.label])], (c) => {
      const same = (a: Record<string, number>, b: Record<string, number>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 0.005);
      return BODY_TYPES.find((t) => Object.entries(t.body).every(([k, v]) => Math.abs((c.body[k as keyof HumanParams] as number) - (v as number)) < 0.005) && same(t.shape, c.shape ?? {}))?.id ?? "";
    }, (v) => {
      const t = BODY_TYPES.find((b) => b.id === v);
      if (t) set({ body: { ...t.body }, shape: { ...t.shape } });
    }, "bodyType");
    presetSelect(body, "Height", "height", HEIGHTS, 0, "height");
    flesh(simple(this.select(body, "Ethnicity", [...ETHNICITIES.map(([id, label]): [string, string] => [id, label]), ["", "Custom"]], (c) => {
      const sum = c.body.african + c.body.asian + c.body.caucasian || 1;
      const mix = [c.body.african / sum, c.body.asian / sum, c.body.caucasian / sum];
      return ETHNICITIES.find(([, , w]) => w.every((v, i) => Math.abs(v - mix[i]) < 0.02))?.[0] ?? "";
    }, (v) => {
      const e = ETHNICITIES.find(([id]) => id === v);
      if (e) set({ body: { african: e[2][0], asian: e[2][1], caucasian: e[2][2] } });
    }, "ethnicity")));
    // The standing height in meters, and the game's range when it sets one.
    const tall = document.createElement("p");
    tall.className = "ae-note";
    tall.dataset.role = "standing-height";
    body.appendChild(tall);
    const showHeight = (h: number) => {
      const r = character.heightRange;
      const range = r && (r.min !== undefined || r.max !== undefined) ? ` (kept ${r.min !== undefined && r.max !== undefined ? `between ${r.min.toFixed(2)} and ${r.max.toFixed(2)}` : r.min !== undefined ? `above ${r.min.toFixed(2)}` : `below ${r.max!.toFixed(2)}`} m)` : "";
      tall.textContent = h > 0 ? `Standing height ${h.toFixed(2)} m${range}` : "";
    };
    showHeight(character.height);
    const stopHeight = character.onShape(showHeight);
    for (const s of BODY) {
      const row = detailed(this.slider(body, s.label, s.min, s.max, s.step, s.fmt, (c) => c.body[s.key], (v) => set({ body: { [s.key]: v } }), `body.${s.key}`));
      if (s.key === "african" || s.key === "asian" || s.key === "caucasian") flesh(row);
    }
    // Shape: named sliders that each move several raw modifiers together (on top of the raw ones).
    const signed = (v: number) => (v === 0 ? "0" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}`);
    const shapeSliders = (parent: HTMLElement, group: "Body" | "Face") => {
      heading(parent, "Shape");
      for (const sl of SHAPE_SLIDERS.filter((x) => x.group === group)) {
        const row = detailed(this.slider(parent, sl.label, -1, 1, 0.01, signed, (c) => c.shape?.[sl.id] ?? 0, (v) => {
          const next = { ...character.config.shape };
          if (v === 0) delete next[sl.id];
          else next[sl.id] = v;
          set({ shape: next });
        }, `shape.${sl.id}`));
        row.title = `${sl.low} ↔ ${sl.high}`;
      }
    };
    shapeSliders(body, "Body");
    notOffered(detailed(this.select(body, "Tail", opts(feat.tails), (c) => c.tail, (v) => set({ tail: v as CharacterConfig["tail"] }), "tail")), feat.tails.length > 1);
    const tailRow = notOffered(detailed(this.slider(body, "Tail length", 0, 1, 0.01, pct, (c) => c.tailLength, (v) => set({ tailLength: v }), "tailLength")), feat.tails.length > 1);
    this.syncers.push((c) => (tailRow.hidden = c.tail === "none"));
    // Skin
    flesh(heading(body, "Skin"));
    if (cat.photoSkin) flesh(detailed(this.select(body, "Skin", [["photo", "Photo (follows ethnicity)"], ["procedural", "Procedural"]], (c) => c.skin, (v) => set({ skin: v as CharacterConfig["skin"] }), "skin")));
    const tone = flesh(detailed(this.slider(body, "Skin tone", 0, 1, 0.01, pct, (c) => c.skinTone, (v) => set({ skinTone: v }), "skinTone")));
    this.syncers.push((c) => (tone.hidden = c.skin === "photo"));
    flesh(detailed(this.color(body, "Skin colour", (c) => c.skinColor, (v) => set({ skinColor: v }), "skinColor")));
    flesh(detailed(this.check(body, "Skin detail", (c) => c.skinDetail, (v) => set({ skinDetail: v }), "skinDetail")));
    flesh(detailed(this.slider(body, "Wet skin", 0, 1, 0.01, pct, (c) => c.skinWetness, (v) => set({ skinWetness: v }), "skinWetness")));
    notOffered(flesh(detailed(this.select(body, "Skin pattern", feat.patterns.map((p): [string, string] => [p, cap(p)]), (c) => c.skinPattern, (v) => set({ skinPattern: v as CharacterConfig["skinPattern"] }), "skinPattern"))), feat.patterns.length > 1);
    const patRows = [
      flesh(detailed(this.slider(body, "Pattern strength", 0, 1, 0.01, pct, (c) => c.patternStrength, (v) => set({ patternStrength: v }), "patternStrength"))),
      flesh(detailed(this.color(body, "Pattern colour", (c) => c.patternColor, (v) => set({ patternColor: v }), "patternColor"))),
    ];
    this.syncers.push((c) => patRows.forEach((row) => (row.hidden = c.skinPattern === "none")));
    flesh(this.check(body, "Anatomical detail", (c) => c.anatomy, (v) => set({ anatomy: v }), "anatomy"));
    heading(body, "Mesh");
    detailed(this.select(body, "Detail", [["high", "High (subdivided)"], ["low", "Low"]], (c) => c.detail, (v) => set({ detail: v as CharacterConfig["detail"] }), "detail"));
    if (character.lods.length > 1)
      detailed(this.select(body, "Level of detail", [["auto", "Auto (by distance)"], ...character.lods.map((l, i): [string, string] => [String(i), l.name])], () => String(character.lodMode), (v) => character.setLod(v === "auto" ? "auto" : +v), "lod"));

    // Face and hair
    const face = this.section("Face & hair", "face");
    this.select(face, "Hair", [["", "None"], ...cat.hair.map((h): [string, string] => [h.id, h.label])], (c) => c.hair ?? "", (v) => set({ hair: v || null }), "hair");
    // CC-BY hairstyles name their author.
    const hairCredit = document.createElement("p");
    hairCredit.className = "ae-note";
    hairCredit.dataset.role = "hair-credit";
    face.appendChild(hairCredit);
    this.syncers.push((c) => {
      const credit = cat.hair.find((h) => h.id === c.hair)?.credit;
      const author = credit?.match(/ by (.+?) \(/)?.[1];
      hairCredit.hidden = !credit;
      hairCredit.textContent = credit ? `CC-BY${author ? ` · ${author}` : ""}` : "";
      hairCredit.title = credit ?? "";
    });
    this.select(face, "Hair colour", [["", "Natural"], ...cat.hairColors.map((h): [string, string] => [h.id, h.label])], (c) => c.hairColor ?? "", (v) => set({ hairColor: v || null }), "hairColor");
    this.select(face, "Beard", opts(BEARD_STYLES), (c) => c.beard, (v) => set({ beard: v as CharacterConfig["beard"] }), "beard");
    detailed(this.slider(face, "Stubble", 0, 1, 0.01, pct, (c) => c.stubble, (v) => set({ stubble: v }), "stubble"));
    detailed(this.select(face, "Eyebrows", [...cat.brows.map((b): [string, string] => [b.id, b.label]), [PAINTED_BROWS, "Painted"], ["", "None"]], (c) => c.brows ?? "", (v) => set({ brows: v || null }), "brows"));
    this.select(face, "Eyes", cat.eyes.map((e) => [e.id, e.label]), (c) => c.eyes, (v) => set({ eyes: v, eyeColor: null }), "eyes");
    detailed(this.color(face, "Eye colour", (c) => c.eyeColor, (v) => set({ eyeColor: v }), "eyeColor"));
    notOffered(detailed(this.select(face, "Pupils", feat.pupils.map((p): [string, string] => [p, cap(p)]), (c) => c.pupil, (v) => set({ pupil: v as CharacterConfig["pupil"] }), "pupil")), feat.pupils.length > 1);
    notOffered(detailed(this.slider(face, "Eye glow", 0, 1, 0.01, pct, (c) => c.eyeGlow, (v) => set({ eyeGlow: v }), "eyeGlow")), feat.eyeGlow);
    const horned = feat.horns.length > 1;
    notOffered(detailed(this.select(face, "Horns", opts(feat.horns), (c) => c.horns, (v) => set({ horns: v as CharacterConfig["horns"] }), "horns")), horned);
    const hornRows = [
      notOffered(detailed(this.slider(face, "Horn size", 0, 1, 0.01, pct, (c) => c.hornSize, (v) => set({ hornSize: v }), "hornSize")), horned),
      notOffered(detailed(this.color(face, "Horn colour", (c) => c.hornColor, (v) => set({ hornColor: v }), "hornColor")), horned),
    ];
    this.syncers.push((c) => hornRows.forEach((row) => (row.hidden = c.horns === "none")));
    notOffered(detailed(this.slider(face, "Tusks", 0, 1, 0.01, pct, (c) => c.tusks, (v) => set({ tusks: v }), "tusks")), feat.tusks);
    shapeSliders(face, "Face");

    // Raw detail sliders, in the Detailed tabs of the face (head groups) and the body (the rest).
    // (An older `sections` list, naming "look", leaves them out unless it names "details" too.)
    const legacyNoDetails = !!options.sections?.includes("look") && !options.sections.includes("details");
    if (options.details !== false && !legacyNoDetails && cat.details.length) {
      const fine = { body: heading(body, "Fine detail"), face: heading(face, "Fine detail") };
      fine.body.dataset.role = "details";
      fine.face.dataset.role = "details";
      const groups = new Map<string, HTMLElement>();
      for (const d of cat.details) {
        if (!groups.has(d.group)) {
          const g = document.createElement("details");
          g.innerHTML = `<summary></summary>`;
          g.querySelector("summary")!.textContent = d.group === "asym" ? "Asymmetry" : d.group;
          g.dataset.group = d.group;
          detailed(g);
          (FACE_GROUPS.has(d.group) ? face : body).appendChild(g);
          groups.set(d.group, g);
          // Genital shape sliders only matter with anatomical detail on (hidden with it).
          if (d.group.toLowerCase() === "genitals") this.syncers.push((c) => (g.hidden = !c.anatomy));
        }
        const row = this.slider(groups.get(d.group)!, d.label, d.min, d.max, 0.01, (v) => v.toFixed(2), (c) => c.details[d.id] ?? 0, (v) => set({ details: { ...character.config.details, [d.id]: v } }), `details.${d.id}`);
        // (The crotch bulge too.)
        if (row && /(^|\/)bulge/.test(d.id)) this.syncers.push((c) => (row.hidden = !c.anatomy));
      }
    }

    // Clothes: a preset on Simple; single garments, colours and cloth options on Detailed.
    const outfit = this.section("Clothes", "outfit");
    const presetSel = this.select(outfit, "Outfit", [["", "Custom"], ...cat.outfits.map((o): [string, string] => [o.id, o.label])], (c) => {
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
    detailed(this.check(outfit, "Tuck covered layers in", (c) => c.clothTuck, (v) => set({ clothTuck: v }), "clothTuck"));
    detailed(this.check(outfit, "Loose clothes swing", (c) => c.clothMotion, (v) => set({ clothMotion: v }), "clothMotion"));
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
    detailed(colors);
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

    // Animation and expression
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
    // The Simple tab lists only the pack's own clips.
    this.onMode.push(() => {
      if (this.sectionMode("animation") === "simple" && libSel.value !== "") {
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
    this.select(motion, "Expression", cat.expressions.map((e) => [e.id, e.label]), (c) => c.expression, (v) => set({ expression: v }), "expression");
    detailed(this.slider(motion, "Intensity", 0, 1, 0.01, pct, (c) => c.expressionIntensity, (v) => set({ expressionIntensity: v }), "expressionIntensity"));
    detailed(this.check(motion, "Blink", (c) => c.blink, (v) => set({ blink: v }), "blink"));
    detailed(this.check(motion, "Face rig", (c) => c.faceRig, (v) => set({ faceRig: v }), "faceRig"));
    detailed(this.check(motion, "Wrinkles", (c) => c.wrinkles, (v) => set({ wrinkles: v }), "wrinkles"));
    detailed(this.check(motion, "Living face", (c) => c.faceAnimation, (v) => set({ faceAnimation: v }), "faceAnimation"));
    detailed(this.check(motion, "Eyes follow camera", (c) => c.gaze === "camera", (v) => set({ gaze: v ? "camera" : "ahead" }), "gaze"));
    // Lip-sync test: speaks a line (needs the face rig and a living face).
    const sayRow = document.createElement("div");
    sayRow.className = "ae-row";
    sayRow.innerHTML = `<label>Say</label><input type="text" placeholder="Hello there, traveller!" style="grid-column: 2 / 4">`;
    const sayInput = sayRow.querySelector("input")!;
    sayInput.dataset.key = "say";
    sayInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") character.say(sayInput.value || sayInput.placeholder);
    });
    this.syncers.push((c) => (sayRow.hidden = !(c.faceAnimation && c.faceRig)));
    motion.appendChild(sayRow);
    detailed(sayRow);

    // Robots and skeletons: no skin or hair rows in the body section.
    this.syncers.push((c) => {
      for (const row of fleshRows) row.classList.toggle("ae-robot-off", c.robot || c.skeletal);
    });

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

    // What the host leaves out ("look" is the old name of the face section).
    if (options.sections) {
      const shown = new Set<EditorSection>(options.sections);
      if (shown.has("look")) shown.add("face");
      for (const sec of el.querySelectorAll<HTMLElement>("section[data-section]")) sec.classList.toggle("ae-off", !shown.has(sec.dataset.section as EditorSection));
    }
    for (const key of options.hide ?? []) {
      for (const node of el.querySelectorAll<HTMLElement>(`[data-key="${CSS.escape(key)}"], [data-role="${CSS.escape(key)}"]`)) {
        ((node.closest(".ae-row, .ae-check") as HTMLElement | null) ?? node).classList.add("ae-off");
      }
    }
    // Sections whose Detailed tab adds nothing get no tabs.
    for (const sec of el.querySelectorAll<HTMLElement>("section[data-section]")) {
      if (!sec.querySelector('[data-level="detailed"]')) sec.querySelector<HTMLElement>(".ae-tabs")?.remove();
    }

    const off = character.onChange((c) => this.sync(c));
    this.unsubscribe = () => {
      off();
      stopHeight();
    };
    this.sync(character.config);
    // Starting tabs: `mode` for every section, else what this viewer last had per section.
    let saved: Partial<Record<EditorSection, EditorMode>> = {};
    if (!options.mode && tabbed)
      try {
        saved = JSON.parse(localStorage.getItem(TABS_KEY) ?? "null") ?? (localStorage.getItem(OLD_MODE_KEY) === "detailed" ? Object.fromEntries(TABBED.map((s) => [s, "detailed"])) : {});
      } catch {
        // storage unavailable (private mode, sandboxed frame) or unreadable
      }
    this.currentMode = options.mode ?? "simple";
    for (const id of TABBED) this.applyTab(id, saved[id] === "detailed" || saved[id] === "simple" ? saved[id]! : this.currentMode);
  }

  /** The tab most sections are on: the last `setMode`, or the starting `mode`. */
  get mode(): EditorMode {
    return this.currentMode;
  }

  /** Puts every section on its Simple or its Detailed tab. */
  setMode(mode: EditorMode, remember = true): void {
    this.currentMode = mode;
    for (const id of TABBED) this.applyTab(id, mode);
    if (remember) this.store();
  }

  /** Which tab a section is on. */
  sectionMode(section: EditorSection): EditorMode {
    return this.tabs.get(section === "look" ? "face" : section) ?? this.currentMode;
  }

  /** Puts one section on its Simple or its Detailed tab (e.g. `setSectionMode("face", "detailed")`). */
  setSectionMode(section: EditorSection, mode: EditorMode, remember = true): void {
    this.applyTab(section === "look" ? "face" : section, mode);
    if (remember) this.store();
  }

  private applyTab(section: EditorSection, mode: EditorMode): void {
    this.tabs.set(section, mode);
    const sec = this.element.querySelector<HTMLElement>(`section[data-section="${section}"]`);
    if (sec) {
      sec.classList.toggle("ae-simple", mode === "simple");
      for (const b of sec.querySelectorAll<HTMLElement>(".ae-tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === mode));
    }
    for (const f of this.onMode) f();
  }

  private store(): void {
    if (!this.remember) return;
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify(Object.fromEntries(this.tabs)));
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
    const head = document.createElement("div");
    head.className = "ae-head";
    const h = document.createElement("h2");
    h.textContent = title;
    head.appendChild(h);
    if (this.remember) {
      const tabs = document.createElement("div");
      tabs.className = "ae-tabs";
      tabs.setAttribute("role", "tablist");
      for (const [m, label] of [["simple", "Simple"], ["detailed", "Detailed"]] as const) {
        const b = document.createElement("button");
        b.textContent = label;
        b.dataset.tab = m;
        b.setAttribute("role", "tab");
        b.addEventListener("click", () => this.setSectionMode(id, m));
        tabs.appendChild(b);
      }
      head.appendChild(tabs);
    }
    s.appendChild(head);
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
