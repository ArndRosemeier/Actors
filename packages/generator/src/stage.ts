import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export interface StageOptions {
  /** Background colour (default a dark grey). */
  background?: THREE.ColorRepresentation;
  /** Show the round floor (default true). */
  ground?: boolean;
}

/**
 * A ready-made studio for a character: renderer, soft lights with shadows,
 * a floor, an orbit camera and a render loop that fills `container` and
 * follows its size. Use it as is, or as an example of the settings the
 * character's materials are tuned for (ACES tone mapping, an environment map).
 */
export class CharacterStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();
  private readonly updaters = new Set<(dt: number) => void>();
  private readonly observer: ResizeObserver;

  constructor(
    readonly container: HTMLElement,
    options: StageOptions = {},
  ) {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.style.display = "block";
    r.domElement.style.width = r.domElement.style.height = "100%";
    container.appendChild(r.domElement);

    const scene = this.scene;
    scene.background = new THREE.Color(options.background ?? 0x2a2c31);
    scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
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
      for (const u of this.updaters) u(dt);
      this.controls.update();
      r.render(scene, this.camera);
    });
  }

  /** Adds an object to the scene; if it has `update(dt)` (like a Character), it is called every frame. */
  add(item: { object: THREE.Object3D; update?: (dt: number) => void }): () => void {
    this.scene.add(item.object);
    const u = item.update?.bind(item);
    if (u) this.updaters.add(u);
    return () => {
      this.scene.remove(item.object);
      if (u) this.updaters.delete(u);
    };
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
