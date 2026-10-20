import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { ActorShape, Clip, Fetcher, MessagePortLike } from "@actors/core";
import { ADULT_MIN_AGE, BLINK, EXPRESSIONS, Human, type HumanParams, MAX_AGE, type RaceId, raceScale, sanitizeRace } from "@actors/human";
import { IRIS_PRESETS, PUPILS, SKIN_PATTERNS, ThreeActor } from "@actors/three";
import { type CharacterCatalog, type CharacterConfig, PAINTED_BROWS, type RandomOptions, buildCatalog, defaultConfig, outfitGarments, randomConfig, resolveOutfit } from "./catalog";

/** A change to a character. `body` is merged into the current body; every other field replaces the current value. */
export type CharacterPatch = Partial<Omit<CharacterConfig, "body">> & { body?: Partial<HumanParams> };

export interface CharacterOptions {
  /** URL of the pack's manifest.json (e.g. "/packs/human/manifest.json"). */
  pack: string;
  /** Used to blend the photo skins on the GPU. */
  renderer: THREE.WebGLRenderer;
  /**
   * Optional Web Worker running `@actors/human/worker`, so shape changes never
   * block rendering. With Vite: `import HumanWorker from "@actors/human/worker?worker"`.
   */
  worker?: MessagePortLike;
  /** Starting look; missing fields use the defaults. */
  config?: CharacterPatch;
  /** Also list the pack's large clip libraries (e.g. 2,548 CMU motions; default true). Only their index is loaded up front. */
  clipLibraries?: boolean;
  fetcher?: Fetcher;
}

const SKIN_TONES = [new THREE.Color(0.93, 0.76, 0.66), new THREE.Color(0.78, 0.57, 0.43), new THREE.Color(0.5, 0.33, 0.22), new THREE.Color(0.25, 0.15, 0.1)];

/**
 * A complete, animated character: body shape, skin, eyes, hair, eyebrows,
 * outfit, anatomy, animation and facial expression, all driven by one
 * JSON-serialisable `CharacterConfig`.
 *
 * ```ts
 * const character = await Character.load({ pack: "/packs/human/manifest.json", renderer });
 * scene.add(character.object);
 * await character.set({ body: { gender: 1, muscle: 0.7 }, outfit: ["tshirt", "jeans"], animation: "walk" });
 * // every frame:
 * character.update(dt);
 * ```
 */
export class Character {
  readonly actor: ThreeActor;
  readonly catalog: CharacterCatalog;
  private cfg: CharacterConfig;
  private shape?: ActorShape;
  private readonly clips = new Map<string, Promise<Clip>>();
  private readonly listeners = new Set<(config: CharacterConfig) => void>();
  private applied = { shape: "", face: "", animation: undefined as string | null | undefined };
  private running: Promise<void> = Promise.resolve();
  private waiting?: Promise<void>;
  private time = 0;
  private nextBlink = 2;
  /** Freezes the animation (see `seek`). */
  paused = false;
  /** Milliseconds the last shape update took. */
  lastUpdateMs = 0;
  /** Standing height of the current shape in meters (0 before the first shape). */
  height = 0;
  private readonly shapeListeners = new Set<(height: number) => void>();

  private constructor(
    readonly human: Human,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.actor = new ThreeActor(human.runtime);
    this.catalog = buildCatalog(human, Object.keys(IRIS_PRESETS));
    this.cfg = defaultConfig(this.catalog);
  }

  static async load(options: CharacterOptions): Promise<Character> {
    const human = await Human.load(options.pack, options.fetcher);
    if (options.clipLibraries !== false) await Promise.all((human.runtime.manifest.clipLibraries ?? []).map((l) => human.runtime.loadClipLibrary(l.name)));
    if (options.worker) await human.useWorker(options.worker);
    const c = new Character(human, options.renderer);
    await c.set(options.config ?? {});
    return c;
  }

  /** The scene object to add to your scene. */
  get object(): THREE.Object3D {
    return this.actor.object;
  }

  /** A copy of the current configuration (save it as JSON and pass it to `set` to restore the character). */
  get config(): CharacterConfig {
    return structuredClone(this.cfg);
  }

  /** Called after every change, with the new configuration. Returns an unsubscribe function. */
  onChange(listener: (config: CharacterConfig) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called after every new body shape, with the standing height in meters. Returns an unsubscribe function. */
  onShape(listener: (height: number) => void): () => void {
    this.shapeListeners.add(listener);
    return () => this.shapeListeners.delete(listener);
  }

  /** Applies a change. Resolves once the character shows it (shape, skin, clip loaded). */
  set(patch: CharacterPatch): Promise<void> {
    const body = { ...this.cfg.body, ...patch.body };
    body.ageYears = Math.min(MAX_AGE, Math.max(ADULT_MIN_AGE, body.ageYears));
    const defined = Object.fromEntries(Object.entries(structuredClone(patch)).filter(([, v]) => v !== undefined));
    this.cfg = { ...this.cfg, ...defined, body, outfit: this.normalizeOutfit(patch.outfit ?? this.cfg.outfit) };
    const race = sanitizeRace({ race: this.cfg.race, race2: this.cfg.race2, mix: this.cfg.raceMix, size: this.cfg.raceSize });
    Object.assign(this.cfg, { race: race.race, race2: race.race2, raceMix: race.race2 ? race.mix : this.cfg.raceMix, raceSize: race.size });
    this.applyLook();
    const done = this.sync();
    for (const l of this.listeners) l(this.config);
    return done;
  }

  /** Back to the default character (keeps the animation). */
  reset(): Promise<void> {
    const d = defaultConfig(this.catalog);
    return this.set({ ...d, animation: this.cfg.animation });
  }

  /**
   * Turns the character into a typical-looking member of `race` (random within
   * the race's ranges and palettes); gender, outfit and animation are kept.
   */
  async setRace(race: RaceId): Promise<CharacterConfig> {
    return this.randomize({ race, outfit: false, gender: this.cfg.body.gender < 0.5 ? "female" : "male" });
  }

  /** A random adult character; see `RandomOptions`. Returns the new configuration. */
  async randomize(options: RandomOptions = {}): Promise<CharacterConfig> {
    const next = randomConfig(this.catalog, this.cfg, options);
    await this.set(next);
    return this.config;
  }

  /** Dresses the character in a preset from `catalog.outfits` ("nude", "casual", …). */
  wear(outfitId: string): Promise<void> {
    const preset = this.catalog.outfits.find((o) => o.id === outfitId);
    if (!preset) throw new Error(`Unknown outfit ${outfitId}`);
    return this.set({ outfit: outfitGarments(preset, this.cfg.body), garmentColors: { ...this.cfg.garmentColors, ...preset.colors } });
  }

  /** Plays a clip from `catalog.animations` (looping), or the bind pose for null. */
  play(animation: string | null): Promise<void> {
    return this.set({ animation });
  }

  /** Advances animation, blinking and cloth colliders. Call once per frame. */
  update(dt: number): void {
    this.time += dt;
    this.actor.update(this.paused ? 0 : dt);
    // Blink: ~150 ms close/open every 2-6 s.
    const t = this.time;
    if (t > this.nextBlink + 0.15) this.nextBlink = t + 2 + Math.random() * 4;
    const b = this.cfg.blink && t > this.nextBlink ? Math.sin(((t - this.nextBlink) / 0.15) * Math.PI) : 0;
    this.actor.setMorphWeight("blink", Math.max(0, b));
  }

  /** Jumps the animation to a time in seconds and pauses it; null resumes. */
  seek(seconds: number | null): void {
    this.paused = seconds !== null;
    const action = this.actor.currentAction;
    if (action && seconds !== null) {
      action.time = seconds;
      this.actor.update(0);
    }
  }

  /** Play clips with root motion (moving through the scene) instead of in place. */
  set rootMotion(on: boolean) {
    this.actor.inPlace = !on;
    this.applied.animation = undefined;
    void this.sync();
  }

  get rootMotion(): boolean {
    return !this.actor.inPlace;
  }

  /** Loads (once) a clip by name. */
  loadClip(name: string): Promise<Clip> {
    if (!this.clips.has(name)) this.clips.set(name, this.human.runtime.loadClip(name));
    return this.clips.get(name)!;
  }

  /**
   * The visible character as binary glTF (mesh, rig, garments, hair) with
   * animations baked for its current shape: "all" clips (default), "current", or a list of names.
   */
  async exportGlb(animations: "all" | "current" | string[] = "all"): Promise<ArrayBuffer> {
    await this.running;
    const names = animations === "all" ? this.catalog.animations.map((a) => a.id) : animations === "current" ? (this.cfg.animation ? [this.cfg.animation] : []) : animations;
    const clips = await Promise.all(names.map(async (n) => this.actor.toThreeClip(await this.loadClip(n))));
    return (await new GLTFExporter().parseAsync(this.actor.object, { binary: true, animations: clips, onlyVisible: true })) as ArrayBuffer;
  }

  /** Removes the character from its parent and frees its GPU resources. */
  dispose(): void {
    this.actor.object.removeFromParent();
    this.actor.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of ([] as THREE.Material[]).concat(mesh.material)) m.dispose();
    });
  }

  // --- internals ---------------------------------------------------------------

  private normalizeOutfit(outfit: string[]): string[] {
    return resolveOutfit(this.catalog, outfit);
  }

  /** Everything that needs no new shape: visibility, colours, eyes, morph weights. */
  private applyLook(): void {
    const c = this.cfg;
    const a = this.actor;
    for (const g of this.catalog.garments) {
      a.setVisible(g.id, c.outfit.includes(g.id));
      a.setGarmentColor(g.id, c.garmentColors[g.id] ?? null);
    }
    for (const h of this.catalog.hair) a.setVisible(h.id, h.id === c.hair);
    for (const b of this.catalog.brows) a.setVisible(b.id, b.id === c.brows);
    a.skin.uBrowDensity.value = c.brows === PAINTED_BROWS ? 0.92 : 0;
    a.setHairColor(c.hairColor);
    if (c.eyeColor) a.setIris(irisFromColor(c.eyeColor));
    else if (IRIS_PRESETS[c.eyes]) a.setIris(c.eyes);
    const f = Math.min(1, Math.max(0, c.skinTone)) * (SKIN_TONES.length - 1);
    const i = Math.min(SKIN_TONES.length - 2, Math.floor(f));
    const custom = c.skinColor ? new THREE.Color(c.skinColor) : null;
    a.setSkinTone(custom ?? SKIN_TONES[i].clone().lerp(SKIN_TONES[i + 1], f - i));
    // Photo skin: scale its channels so its mean colour becomes the custom colour.
    const ref = custom && c.skin === "photo" ? this.human.skinTextureTone(c.body) : null;
    if (custom && ref) {
      const lin = new THREE.Color().setRGB(ref[0], ref[1], ref[2], THREE.SRGBColorSpace);
      a.skin.uAlbedoTint.value.setRGB(custom.r / Math.max(lin.r, 1e-3), custom.g / Math.max(lin.g, 1e-3), custom.b / Math.max(lin.b, 1e-3));
    } else a.skin.uAlbedoTint.value.setRGB(1, 1, 1);
    // Race pattern and eyes.
    const glow = c.skinPattern === "veins" ? 0.6 + c.eyeGlow * 0.6 : c.skinPattern === "crystals" ? 0.4 : 0;
    a.skin.uPattern.value.set(SKIN_PATTERNS[c.skinPattern] ?? 0, c.patternStrength, c.seed * 97, glow);
    if (c.patternColor) a.skin.uAccent.value.set(c.patternColor);
    else a.skin.uAccent.value.copy(a.skin.uTone.value).multiplyScalar(0.3);
    a.eye.uPupil.value.set(PUPILS[c.pupil] ?? 0, 0.5, c.eyeGlow, 0);
    if (a.meshes.has("body-low")) {
      a.setVisible("body", c.detail === "high");
      a.setVisible("body-low", c.detail === "low");
    }
    const male = c.body.gender >= 0.5;
    a.setVisible("genitals-male", c.anatomy && male);
    a.skin.uFemale.value = c.anatomy && !male ? 1 : 0;
    a.setMorphWeight("expression", c.expressionIntensity);
  }

  /** Brings shape, face, skin and clip up to date with the config; overlapping calls are merged. */
  private sync(): Promise<void> {
    if (!this.waiting) {
      const job = this.running.then(() => {
        this.waiting = undefined;
        return this.reconcile();
      });
      this.waiting = job;
      this.running = job.catch(() => {});
    }
    return this.waiting;
  }

  private async reconcile(): Promise<void> {
    const c = this.cfg;
    const h = this.human;
    // Garments with their own data file are loaded the first time they are worn.
    const added = await h.loadMeshes(c.outfit.filter((g) => !h.runtime.isLoaded(g)));
    if (added.length) {
      this.actor.addMeshes(added);
      this.applied.shape = ""; // the next shape must include the new garments
    }
    const shapeKey = JSON.stringify([c.body, c.details, c.race, c.race2, c.raceMix, c.raceSize]);
    if (shapeKey !== this.applied.shape) {
      const t0 = performance.now();
      h.params = { ...c.body };
      h.race = sanitizeRace({ race: c.race, race2: c.race2, mix: c.raceMix, size: c.raceSize });
      h.modifierValues = { ...c.details };
      this.shape = await h.evaluate(this.shape);
      this.actor.applyShape(this.shape);
      this.actor.object.position.y = this.actor.groundOffset();
      this.height = this.actor.height();
      // Pattern space: feet at 0, body scale, head joint (skin patterns stay sized and placed per body).
      const sk = this.shape.skeleton;
      const head = sk ? sk.heads[sk.names.indexOf("head")] : undefined;
      const ground = this.actor.groundOffset();
      this.actor.skin.uBind.value.set(ground, raceScale(h.race), head ? head[1] + ground : 1.55, head ? -head[2] : 0);
      this.applied.shape = shapeKey;
      for (const l of this.shapeListeners) l(this.height);
      this.lastUpdateMs = performance.now() - t0;
      this.applyLook();
    }
    const faceKey = `${shapeKey}|${c.expression}`;
    if (faceKey !== this.applied.face && this.shape) {
      const units = EXPRESSIONS[c.expression] ?? {};
      this.actor.setMorph("expression", Object.keys(units).length ? await h.faceDelta(this.shape, units) : null);
      this.actor.setMorph("blink", await h.faceDelta(this.shape, BLINK));
      this.actor.setMorphWeight("expression", c.expressionIntensity);
      this.applied.face = faceKey;
    }
    await this.actor.setSkinTextures(this.renderer, c.skin === "photo" ? h.skinTextures() : null);
    if (c.animation !== this.applied.animation) {
      this.applied.animation = c.animation;
      this.actor.play(c.animation ? await this.loadClip(c.animation) : null);
    }
  }
}

/** Iris shader factors (hue, saturation and lightness gain on the iris texture) for an sRGB colour. */
export function irisFromColor(hex: string): { hue: number; sat: number; light: number } {
  const hsl = { h: 0, s: 0, l: 0 };
  const c = new THREE.Color(hex);
  const srgb = c.clone().convertLinearToSRGB();
  const max = Math.max(srgb.r, srgb.g, srgb.b), min = Math.min(srgb.r, srgb.g, srgb.b);
  c.getHSL(hsl, THREE.SRGBColorSpace);
  const sat = max > 0 ? (max - min) / max : 0;
  // The iris texture is a mid brown (value ~0.35, saturation ~0.6).
  return { hue: hsl.h, sat: Math.min(1.4, Math.max(0.15, sat / 0.6)), light: Math.min(2.6, Math.max(0.4, max / 0.35)) };
}
