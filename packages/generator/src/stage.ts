import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ScreenTexturePool, type ThreeActor, type ActorMaterialKit } from "@actors/three";

export interface StageOptions {
  /** Share four screen phases across characters (default true). False keeps independent screens. */
  sharedScreenTextures?: boolean;
  /** Background colour (default a dark grey). */
  background?: THREE.ColorRepresentation;
  /** Show the round floor (default true). */
  ground?: boolean;
  /**
   * Which three.js renderer to use (`CharacterStage.create` only): "webgl"
   * (default, THREE.WebGLRenderer), "webgpu" (three's WebGPURenderer, node
   * materials) or "webgpu-gl" (the WebGPURenderer on its WebGL 2 backend).
   */
  renderer?: "webgl" | "webgpu" | "webgpu-gl";
}

/** The parts of a three.js renderer the stage uses (THREE.WebGLRenderer or three's WebGPURenderer). */
export interface StageRenderer {
  readonly domElement: HTMLCanvasElement;
  toneMapping: THREE.ToneMapping;
  shadowMap: { enabled: boolean; type: THREE.ShadowMapType };
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setAnimationLoop(callback: (() => void) | null): unknown;
  render(scene: THREE.Object3D, camera: THREE.Camera): unknown;
  dispose(): void;
}

/**
 * A ready-made studio for a character: renderer, soft lights with shadows,
 * a floor, an orbit camera and a render loop that fills `container` and
 * follows its size. Use it as is, or as an example of the settings the
 * character's materials are tuned for (ACES tone mapping, an environment map).
 */
export class CharacterStage {
  readonly screenTextures: ScreenTexturePool | null;
  private readonly removers = new Set<() => void>();
  readonly renderer: StageRenderer;
  /** How characters on this stage are drawn (pass it to `Character.load`). */
  materials?: ActorMaterialKit;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();
  private readonly updaters = new Set<(dt: number) => void>();
  private readonly observer: ResizeObserver;

  /** A stage with the renderer `options.renderer` asks for (WebGPU needs this async setup). */
  static async create(container: HTMLElement, options: StageOptions = {}): Promise<CharacterStage> {
    if (!options.renderer || options.renderer === "webgl") return new CharacterStage(container, options);
    const [{ WebGPURenderer, PMREMGenerator }, { nodeMaterials }] = await Promise.all([import("three/webgpu"), import("@actors/three/webgpu")]);
    const r = new WebGPURenderer({ antialias: true, forceWebGL: options.renderer === "webgpu-gl" });
    await r.init();
    const stage = new CharacterStage(container, options, r as unknown as StageRenderer, (scene) => new PMREMGenerator(r).fromScene(scene as THREE.Scene, 0.04).texture);
    stage.materials = nodeMaterials;
    return stage;
  }

  /** A WebGL stage; `CharacterStage.create` for the others. */
  constructor(
    readonly container: HTMLElement,
    options: StageOptions = {},
    renderer?: StageRenderer,
    environment?: (scene: THREE.Object3D) => THREE.Texture,
  ) {
    this.screenTextures = options.sharedScreenTextures === false ? null : new ScreenTexturePool();
    const r = (this.renderer = renderer ?? new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.style.display = "block";
    r.domElement.style.width = r.domElement.style.height = "100%";
    container.appendChild(r.domElement);

    const scene = this.scene;
    scene.background = new THREE.Color(options.background ?? 0x2a2c31);
    scene.environment = environment ? environment(new RoomEnvironment()) : new THREE.PMREMGenerator(r as THREE.WebGLRenderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.6;

    const key = new THREE.DirectionalLight(0xfff1e6, 2.2);
    key.position.set(2, 4, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = key.shadow.camera.bottom = -2.2;
    key.shadow.camera.right = key.shadow.camera.top = 2.2;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xc8d8ff, 1.2);
    rim.position.set(-3, 2.5, -3);
    scene.add(rim);
    if (options.ground !== false) {
      const ground = new THREE.Mesh(new THREE.CircleGeometry(2.5, 64), new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.95 }));
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);
    }

    this.camera.position.set(0.6, 1.2, 4.2);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.set(0, 0.95, 0);
    this.controls.enableDamping = true;

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    r.setAnimationLoop(() => {
      const dt = this.clock.getDelta();
      this.screenTextures?.update(dt);
      for (const u of this.updaters) u(dt);
      this.controls.update();
      r.render(scene, this.camera);
    });
  }

  /** Adds an object to the scene; if it has `update(dt)` (like a Character), it is called every frame. */
  add(item: { object: THREE.Object3D; actor?: ThreeActor; update?: (dt: number) => void }): () => void {
    this.scene.add(item.object);
    const previousPool = item.actor?.screenTextures ?? null;
    if (this.screenTextures) item.actor?.setScreenTexturePool(this.screenTextures);
    const u = item.update?.bind(item);
    if (u) this.updaters.add(u);
    const remove = () => {
      if (!this.removers.delete(remove)) return;
      this.scene.remove(item.object);
      if (u) this.updaters.delete(u);
      if (this.screenTextures && item.actor?.screenTextures === this.screenTextures) item.actor.setScreenTexturePool(previousPool);
    };
    this.removers.add(remove);
    return remove;
  }

  /** Calls `fn(dt)` every frame. Returns a function that stops it. */
  onFrame(fn: (dt: number) => void): () => void {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  /** Moves the camera to `position`, looking at `target`. */
  view(position: THREE.Vector3Tuple, target: THREE.Vector3Tuple = [0, 0.95, 0]): void {
    this.camera.position.fromArray(position);
    this.controls.target.fromArray(target);
    this.controls.update();
  }

  /**
   * Re-frames the camera for a character `height` meters tall: same viewing
   * direction, distance and target scaled from the default 1.7 m framing.
   */
  frame(height: number): void {
    const k = Math.max(0.3, height) / 1.7;
    const dir = this.camera.position.clone().sub(this.controls.target);
    const dist = 4.27 * k;
    this.controls.target.set(this.controls.target.x, 0.95 * k, this.controls.target.z);
    this.camera.position.copy(this.controls.target).add(dir.setLength(dist));
    this.controls.update();
  }

  /** A PNG of the current frame. */
  screenshot(): string {
    return this.renderer.domElement.toDataURL("image/png");
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    for (const remove of this.removers) remove();
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }
}
