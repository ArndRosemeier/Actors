import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { ActorShape, Clip, Fetcher, MessagePortLike } from "@actors/core";
import { ADULT_MIN_AGE, BEARD_STYLES, BLINK, eyeCentres, HORN_STYLES, TAIL_STYLES, EXPRESSIONS, Human, type HumanParams, MAX_AGE, type RaceId, raceScale, sanitizeRace } from "@actors/human";
import { type ActorMaterialKit, type ScreenTexturePool, IRIS_PRESETS, PUPILS, SKIN_PATTERNS, ThreeActor } from "@actors/three";
import { type CharacterCatalog, type CharacterConfig, PAINTED_BROWS, ROBOT_FINISHES, type RandomOptions, type RobotLook, buildCatalog, defaultConfig, concealedGarments, outfitGarments, randomConfig, resolveOutfit, sanitizeRobotLook } from "./catalog";

/** A change to a character. `body` and `robotLook` are merged into the current body; every other field replaces the current value. */
export type CharacterPatch = Partial<Omit<CharacterConfig, "body" | "robotLook">> & { body?: Partial<HumanParams>; robotLook?: Partial<RobotLook> };

export interface CharacterOptions {
  /** URL of the pack's manifest.json (e.g. "/packs/human/manifest.json"). */
  pack: string;
  /** The renderer the character is drawn with (the WebGL kit blends the photo skins with it). */
  renderer: unknown;
  /**
   * How the character is drawn: `webglMaterials` (default, for THREE.WebGLRenderer)
   * or `nodeMaterials` from `@actors/three/webgpu` (for three's WebGPURenderer).
   */
  materials?: ActorMaterialKit;
  /** Shared screen phases; advance once per scene frame before character updates. */
  screenTextures?: ScreenTexturePool | null;
  /**
   * Optional Web Worker running `@actors/human/worker`, so shape changes never
   * block rendering. With Vite: `import HumanWorker from "@actors/human/worker?worker"`.
   */
  worker?: MessagePortLike;
  /** Starting look; missing fields use the defaults. */
  config?: CharacterPatch;
  /**
   * Narrows what the character offers (and what its editor and `randomize` pick from), e.g. a
   * game that leaves out fantasy outfits or CC-BY garments. Gets the pack's whole catalog.
   */
  catalog?: (catalog: CharacterCatalog) => CharacterCatalog;
  /** Also list the pack's large clip libraries (e.g. 2,548 CMU motions; default true). Only their index is loaded up front. */
  clipLibraries?: boolean;
  fetcher?: Fetcher;
  /**
   * Reuse another character's loaded pack (and worker) instead of loading it
   * again: for crowds. `pack`, `fetcher` and `clipLibraries` are then ignored. With `worker`
   * too, the new character shapes in that worker instead of the other one's, and characters
   * sharing with it later use it as well: one lead per worker makes a worker pool.
   */
  shareWith?: Character;
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
  private applied = { shape: "", face: "", parts: "", animation: undefined as string | null | undefined };
  /** Meshes the current shape was fitted for (see `ThreeActor.neededMeshes`). */
  private fittedNames = new Set<string>();
  private running: Promise<void> = Promise.resolve();
  private waiting?: Promise<void>;
  private time = 0;
  /** How far the robot's soles reach below the body (it stands on them). */
  private lift = 0;
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
    private readonly renderer: unknown,
    materials?: ActorMaterialKit,
    narrow?: (catalog: CharacterCatalog) => CharacterCatalog,
    screenTextures?: ScreenTexturePool | null,
  ) {
    this.actor = new ThreeActor(human.runtime, materials, { screenTextures });
    const all = buildCatalog(human, Object.keys(IRIS_PRESETS));
    this.catalog = narrow ? narrow(all) : all;
    this.cfg = defaultConfig(this.catalog);
  }

  static async load(options: CharacterOptions): Promise<Character> {
    if (options.shareWith) {
      const human = Human.share(options.shareWith.human);
      // Its own worker: the lead of a worker pool (crowd members then share with one of the leads).
      if (options.worker) await human.useWorker(options.worker);
      const c = new Character(human, options.renderer, options.materials ?? options.shareWith.actor.kit, options.catalog, options.screenTextures === undefined ? options.shareWith.actor.screenTextures : options.screenTextures);
      await c.set(options.config ?? {});
      return c;
    }
    const human = await Human.load(options.pack, options.fetcher);
    if (options.clipLibraries !== false) await Promise.all((human.runtime.manifest.clipLibraries ?? []).map((l) => human.runtime.loadClipLibrary(l.name)));
    if (options.worker) await human.useWorker(options.worker);
    const c = new Character(human, options.renderer, options.materials, options.catalog, options.screenTextures);
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
    const robotLook = sanitizeRobotLook({ ...this.cfg.robotLook, ...patch.robotLook });
    this.cfg = { ...this.cfg, ...defined, body, robotLook, robot: !!(patch.robot ?? this.cfg.robot), outfit: this.normalizeOutfit(patch.outfit ?? this.cfg.outfit) };
    const race = sanitizeRace({ race: this.cfg.race, race2: this.cfg.race2, mix: this.cfg.raceMix, size: this.cfg.raceSize });
    Object.assign(this.cfg, { race: race.race, race2: race.race2, raceMix: race.race2 ? race.mix : this.cfg.raceMix, raceSize: race.size });
    const c = this.cfg, clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    if (!BEARD_STYLES.includes(c.beard)) c.beard = "none";
    if (!HORN_STYLES.includes(c.horns)) c.horns = "none";
    if (!TAIL_STYLES.includes(c.tail)) c.tail = "none";
    Object.assign(c, { hornSize: clamp01(c.hornSize), tusks: clamp01(c.tusks), tailLength: clamp01(c.tailLength), stubble: clamp01(c.stubble ?? 0) });
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

  /**
   * Detail level: a fixed level (0 = full detail; see `lods`) or "auto", which
   * picks the level from the distance to `lodCamera` every frame.
   */
  lodMode: number | "auto" = 0;
  /** Camera for `lodMode` "auto" (the generator sets its stage camera). */
  lodCamera?: THREE.Camera;
  /** > 1 keeps detail longer in "auto" mode, < 1 drops it sooner. */
  lodBias = 1;

  /** The pack's detail levels (name, switch distance, bones kept). */
  get lods() {
    return this.actor.lods;
  }

  /** The level drawn now. */
  get lod(): number {
    return this.actor.lod;
  }

  /** Sets `lodMode`: a fixed detail level, or "auto". Switching is instant. */
  setLod(mode: number | "auto"): void {
    this.lodMode = mode;
    if (mode !== "auto") this.actor.setLod(mode);
    else if (this.lodCamera) this.actor.updateLod(this.lodCamera, this.lodBias);
    for (const l of this.listeners) l(this.config);
  }

  /** Advances animation, blinking and cloth colliders. Call once per frame. */
  update(dt: number): void {
    if (this.lodMode === "auto" && this.lodCamera) this.actor.updateLod(this.lodCamera, this.lodBias);
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
    // The exporter redraws normal maps through a canvas, which raw-data textures (the generated fabric and frame maps) can't do: swap in canvas copies.
    const swapped: [THREE.MeshStandardMaterial, THREE.Texture][] = [];
    this.actor.object.traverse((o) => {
      for (const m of ([] as THREE.Material[]).concat((o as THREE.Mesh).material ?? []) as THREE.MeshStandardMaterial[]) {
        const copy = m.normalMap ? drawableTexture(m.normalMap) : null;
        if (!copy) continue;
        swapped.push([m, m.normalMap!]);
        m.normalMap = copy;
      }
    });
    try {
      return (await new GLTFExporter().parseAsync(this.actor.object, { binary: true, animations: clips, onlyVisible: true })) as ArrayBuffer;
    } finally {
      for (const [m, t] of swapped) m.normalMap = t;
    }
  }

  /**
   * Compiles the character's shaders ahead of time, without drawing it, so the
   * frame that first shows it doesn't stall (three's `renderer.compileAsync`;
   * WebGL compiles in parallel where the browser supports it). Pass the camera
   * and scene you will draw it in (their lights are part of the shaders). Only
   * the first character with a given garment, hair or add-on kind compiles
   * anything: later ones reuse the same shaders.
   */
  async compile(renderer: unknown, camera: THREE.Camera, scene?: THREE.Object3D): Promise<void> {
    await this.running;
    const r = renderer as { compileAsync?: (object: THREE.Object3D, camera: THREE.Camera, scene?: THREE.Object3D | null) => Promise<unknown> };
    await r.compileAsync?.(this.actor.object, camera, scene ?? null);
  }

  /** Removes the character from its parent and frees its GPU resources (textures shared with other characters stay). */
  dispose(): void {
    this.actor.dispose();
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
  /** Whether a worn garment (a closed helmet, a hood) hides the hair. */
  private hidesHair(): boolean {
    return this.catalog.garments.some((g) => g.hidesHair && this.cfg.outfit.includes(g.id));
  }

  private applyLook(): void {
    this.actor.batch(() => this.applyLookNow());
  }

  private applyLookNow(): void {
    const c = this.cfg;
    const a = this.actor;
    // Underwear under outer clothes is not drawn at all, so it can't peek through them.
    const concealed = concealedGarments(this.catalog, c.outfit);
    for (const g of this.catalog.garments) {
      a.setVisible(g.id, c.outfit.includes(g.id));
      a.setConcealed(g.id, concealed.includes(g.id));
      a.setGarmentColor(g.id, c.garmentColors[g.id] ?? null);
    }
    // Covering underwear that isn't drawn still hides the female detail painted on the skin.
    const concealedCover = this.catalog.garments.some((g) => g.coversAnatomy && concealed.includes(g.id));
    // Closed helmets and hoods hide the hair, which would poke through them.
    const hatHides = this.hidesHair();
    for (const h of this.catalog.hair) a.setVisible(h.id, h.id === c.hair && !hatHides);
    for (const b of this.catalog.brows) a.setVisible(b.id, b.id === c.brows);
    if (this.human.runtime.meshes.some((m) => m.def.name === "body-low")) {
      a.setVisible("body", c.detail === "high");
      a.setVisible("body-low", c.detail === "low");
    }
    const male = c.body.gender >= 0.5;
    a.setVisible("genitals-male", c.anatomy && male);
    // Robots: the generated parts stand in for every pack mesh.
    a.hidePackMeshes(c.robot);
    // One visibility pass for the whole look (and the meshes now worn exist from here on).
    a.flushVisibility();
    a.skin.uBrowDensity.value = c.brows === PAINTED_BROWS ? 0.92 : 0;
    a.setHairColor(c.hairColor);
    // Generated beards and leaves take the hair colour (or the hair mesh's own colour).
    const hairMat = c.hair ? (a.meshes.get(c.hair)?.material as THREE.Material | undefined) : undefined;
    const natural = (hairMat?.userData.meanColor as THREE.Color | undefined)?.getHexString();
    const beardColor = c.hairColor ?? (natural ? `#${natural}` : "#3b2a1e");
    a.setPartColor(["hair", "leaf", "fur"], beardColor);
    a.skin.uStubble.value.set(c.stubble, 0, c.seed * 31, 0);
    a.skin.uStubbleColor.value.set(beardColor).multiplyScalar(0.55);
    a.setPartColor(["horn"], c.hornColor ?? "#d9cfb4");
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
    a.skin.uFemale.value = concealedCover ? 0 : c.anatomy && !male ? 1 : 0;
    a.setMorphWeight("expression", c.expressionIntensity);
    if (c.robot) {
      const r = c.robotLook, f = ROBOT_FINISHES[r.finish];
      a.setPartColor(["plate"], r.paint);
      a.setPartColor(["trim"], r.trim);
      a.setPartColor(["frame"], r.frame);
      a.setPartColor(["joint"], r.metal);
      a.setPartColor(["glow"], r.glow);
      // Visor glass: near black with a hint of the light colour.
      a.setPartColor(["visor"], new THREE.Color(r.glow).multiplyScalar(0.04));
      a.setPartMaterial(["plate", "trim"], { metalness: f.metalness, roughness: f.roughness, clearcoat: f.clearcoat, clearcoatRoughness: f.clearcoatRoughness });
      a.setPartMaterial(["glow"], { emissiveIntensity: r.glowStrength * 3.2 });
    }
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
    // Garments and hairstyles with their own data file are loaded the first time they are worn.
    const lazy = new Set(h.runtime.manifest.meshes.filter((m) => m.blob).map((m) => m.name));
    // (Also those the main thread already has: this character's worker may not, when characters share a pack through several workers.)
    const added = await h.loadMeshes([...c.outfit, c.hair ?? ""].filter((g) => lazy.has(g)));
    if (added.length) {
      this.actor.addMeshes(added);
      this.applied.shape = ""; // the next shape must include the new garments
      // They can be shown now (the look was applied before their data existed), so the shape fits them.
      this.applyLook();
    }
    const r = c.robotLook;
    // Robot parts are built with the shape (in the worker when there is one).
    const robotConfig = c.robot ? { head: r.head, ears: r.ears, plating: r.plating, thickness: r.thickness, core: r.core } : null;
    const shapeKey = JSON.stringify([c.body, c.details, c.race, c.race2, c.raceMix, c.raceSize, robotConfig]);
    // Only what is worn is fitted; wearing something the last shape left out needs a new one.
    const needed = this.actor.neededMeshes();
    const unfitted = !!this.shape && needed.some((n) => !this.fittedNames.has(n));
    if (shapeKey !== this.applied.shape || unfitted) {
      h.robotConfig = robotConfig;
      h.fit = needed;
      const t0 = performance.now();
      h.params = { ...c.body };
      h.race = sanitizeRace({ race: c.race, race2: c.race2, mix: c.raceMix, size: c.raceSize });
      h.modifierValues = { ...c.details };
      this.shape = await h.evaluate(this.shape);
      const shape = this.shape;
      this.fittedNames = new Set(needed.filter((n) => {
        const m = h.runtime.meshes.find((x) => x.def.name === n);
        if (!m) return false;
        if (m.stencil) return shape.meshes.has(n);
        return m.def.source.kind === "base" || shape.proxies.has(m.def.source.proxy);
      }));
      this.actor.applyShape(this.shape);
      this.actor.object.position.y = this.actor.groundOffset() + (c.robot ? this.lift : 0);
      this.height = this.actor.height();
      // Pattern space: feet at 0, body scale, head joint (skin patterns stay sized and placed per body).
      const sk = this.shape.skeleton;
      const head = sk ? sk.heads[sk.names.indexOf("head")] : undefined;
      const ground = this.actor.groundOffset();
      this.actor.skin.uBind.value.set(ground, raceScale(h.race), head ? head[1] + ground : 1.55, head ? -head[2] : 0);
      // Face frame for painted stubble (same space as the patterns).
      const eyes = eyeCentres(this.shape, h.runtime.meshes);
      if (eyes) {
        const [l, r] = eyes;
        this.actor.skin.uFace.value.set((l[0] + r[0]) / 2, (l[1] + r[1]) / 2 + ground, -(l[2] + r[2]) / 2, Math.hypot(l[0] - r[0], l[1] - r[1], l[2] - r[2]));
      }
      this.applied.shape = shapeKey;
      for (const l of this.shapeListeners) l(this.height);
      this.lastUpdateMs = performance.now() - t0;
      this.applyLook();
    }
    const partsKey = c.robot
      ? shapeKey
      : JSON.stringify([shapeKey, c.hair, this.hidesHair(), c.beard, c.horns, c.hornSize, c.tusks, c.tail, c.tailLength, c.seed]);
    if (partsKey !== this.applied.parts && this.shape && c.robot) {
      this.applied.parts = partsKey;
      const robot = h.robotParts ?? h.robot(this.shape, r);
      this.lift = robot.lift;
      this.actor.setParts(robot.parts);
      this.actor.object.position.y = this.actor.groundOffset() + this.lift;
      this.applyLook();
    } else if (partsKey !== this.applied.parts && this.shape) {
      this.applied.parts = partsKey;
      this.actor.object.position.y = this.actor.groundOffset();
      const hair = (c.hair === "leaves" || c.hair === "crest") && !this.hidesHair() ? c.hair : "none";
      const rgb = new THREE.Color(c.hornColor ?? "#d9cfb4").convertLinearToSRGB();
      this.actor.setParts(await h.parts(this.shape, { seed: c.seed, horns: c.horns, hornSize: c.hornSize, hornColor: [rgb.r, rgb.g, rgb.b], tusks: c.tusks, tail: c.tail, tailLength: c.tailLength, beard: c.beard, hair }));
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

const drawable = new WeakMap<THREE.Texture, THREE.Texture>();

/** A canvas-backed copy of a raw RGBA data texture (null if the texture is already drawable). */
function drawableTexture(t: THREE.Texture): THREE.Texture | null {
  const img = t.image as { data?: ArrayBufferView; width: number; height: number } | undefined;
  if (!img?.data || !(img.data instanceof Uint8Array) || img.data.length !== img.width * img.height * 4 || typeof document === "undefined") return null;
  let copy = drawable.get(t);
  if (!copy) {
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length), img.width, img.height), 0, 0);
    copy = new THREE.CanvasTexture(canvas);
    copy.wrapS = t.wrapS;
    copy.wrapT = t.wrapT;
    copy.repeat.copy(t.repeat);
    copy.offset.copy(t.offset);
    copy.channel = t.channel;
    copy.colorSpace = t.colorSpace;
    drawable.set(t, copy);
  }
  return copy;
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
