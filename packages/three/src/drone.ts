import * as THREE from "three";

/**
 * three.js adapter for generated drones (@actors/drone): one Object3D per rig
 * node, a mesh per node and material slot, materials from the drone's palette
 * (procedural panel lines, grime and glowing seams in the plating shader,
 * hazard stripes, emissive lenses, additive exhaust plumes and light beams),
 * halo sprites on glow points, and the baked clips as AnimationClips (so they
 * play in an AnimationMixer and export to glTF). WebGL materials.
 *
 * The data types are structural (the fields of @actors/drone's DroneModel),
 * so this adapter does not depend on the drone package.
 */

type RGB = [number, number, number];

export interface DronePaletteData {
  primary: RGB;
  secondary: RGB;
  accent: RGB;
  metal: RGB;
  glow: RGB;
  glass: RGB;
  gloss: number;
  metallic: number;
  panels: number;
}

export interface DroneData {
  nodes: { name: string; parent: number; position: number[]; quaternion: number[]; scale: number[] }[];
  meshes: { node: number; slot: string; positions: Float32Array; normals: Float32Array; indices: Uint32Array; fade?: Float32Array }[];
  clips: { name: string; duration: number; tracks: { node: number; path: "position" | "quaternion" | "scale"; times: Float32Array; values: Float32Array; step?: boolean }[] }[];
  glows: { node: number; color: RGB; size: number }[];
  spec: { seed: number; size: number; palette: DronePaletteData; wear: number; lights: { seams: number } };
}

export interface DroneLook {
  palette: DronePaletteData;
  wear: number;
  seams: number;
  seed: number;
  /** Panel size in meters (default 0.11). */
  panelScale?: number;
}

const srgb = (c: RGB) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

/** Uniforms shared by the plating materials of one drone. */
interface PlateUniforms {
  uPanelScale: { value: number };
  uPanelLines: { value: number };
  uWear: { value: number };
  uSeamGlow: { value: number };
  uSeamColor: { value: THREE.Color };
  uSeed: { value: number };
  uStripeA: { value: THREE.Color };
  uStripeB: { value: THREE.Color };
}

const PLATE_HEAD = /* glsl */ `
uniform float uPanelScale, uPanelLines, uWear, uSeamGlow, uSeed;
uniform vec3 uSeamColor;
varying vec3 vPanelPos;
varying vec3 vPanelNrm;
float dHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float dNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = 0.0;
  for (int k = 0; k < 8; k++) {
    vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 w = mix(1.0 - f, f, o);
    n += w.x * w.y * w.z * dHash((i.xy + o.xy) * 1.31 + (i.z + o.z) * 7.17);
  }
  return n;
}
// Panel layout on one projection plane: x = distance to the nearest seam (cell units), y = panel id.
vec2 dPanel(vec2 uv) {
  vec2 cell = floor(uv);
  vec2 f = fract(uv);
  float r = dHash(cell + uSeed);
  if (r < 0.3) { cell.x += step(0.5, f.x) * 0.5; f.x = fract(f.x * 2.0); }
  else if (r < 0.55) { cell.y += step(0.5, f.y) * 0.5; f.y = fract(f.y * 2.0); }
  vec2 d = min(f, 1.0 - f);
  return vec2(min(d.x, d.y), dHash(cell * 1.7 + 3.1 + uSeed));
}
`;

/** Plating: panel seams, per-panel tint, grime and optional glowing seams. */
function plating(mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial, u: PlateUniforms, stripes = false): void {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPanelPos;\nvarying vec3 vPanelNrm;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPanelPos = position; vPanelNrm = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${PLATE_HEAD}\nuniform vec3 uStripeA, uStripeB;`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 an = abs(vPanelNrm);
        vec2 puv = an.x > an.y && an.x > an.z ? vPanelPos.zy : an.y > an.z ? vPanelPos.xz : vPanelPos.xy;
        puv /= uPanelScale;
        vec2 pan = dPanel(puv);
        float fw = fwidth(pan.x) + 1e-4;
        float seam = (1.0 - smoothstep(0.014, 0.014 + fw * 1.5, pan.x)) * (1.0 - smoothstep(0.06, 0.2, fw));
        ${stripes ? "float st = step(0.5, fract(dot(vPanelPos, vec3(1.0, 0.6, 1.0)) / (uPanelScale * 0.35)));\n        diffuseColor.rgb = mix(uStripeA, uStripeB, st);" : ""}
        diffuseColor.rgb *= 1.0 + (pan.y - 0.5) * 0.12 * uPanelLines;
        diffuseColor.rgb *= mix(1.0, 0.3, seam * uPanelLines);
        float grime = smoothstep(0.45, 0.85, dNoise(vPanelPos * 9.0 + uSeed) * 0.65 + dNoise(vPanelPos * 31.0) * 0.35);
        diffuseColor.rgb *= 1.0 - grime * uWear * 0.55;
        float dPanelSeam = seam;
        float dPanelGlow = step(0.8, pan.y);
        float dGrime = grime * uWear;`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + dGrime * 0.4 + dPanelSeam * 0.2, 0.0, 1.0);")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += uSeamColor * dPanelSeam * dPanelGlow * uSeamGlow * 2.2;");
  };
  mat.customProgramCacheKey = () => (stripes ? "drone-plate-stripes" : "drone-plate");
}

const EFFECT_VERT = /* glsl */ `
attribute float fade;
varying float vFade;
varying vec3 vN;
varying vec3 vV;
void main() {
  vFade = fade;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const EFFECT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity, uCore, uTime;
varying float vFade;
varying vec3 vN;
varying vec3 vV;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float a = pow(1.0 - vFade, 1.6) * (0.25 + 0.75 * pow(facing, 1.5));
  a *= 0.85 + 0.15 * sin(vFade * 40.0 - uTime * 50.0);
  vec3 c = mix(vec3(1.0), uColor, smoothstep(0.0, 0.35 + 0.65 * (1.0 - uCore), vFade));
  gl_FragColor = vec4(c * a * uIntensity, 1.0);
}`;

let haloTexture: THREE.DataTexture | null = null;
/** Soft round glow for light halos. */
export function droneHaloTexture(): THREE.DataTexture {
  if (haloTexture) return haloTexture;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
      const v = Math.max(0, 1 - d);
      const a = Math.pow(v, 2.2) * 0.8 + Math.pow(v, 12) * 0.6;
      const k = 4 * (y * n + x);
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.min(255, a * 255);
    }
  haloTexture = new THREE.DataTexture(data, n, n);
  haloTexture.needsUpdate = true;
  return haloTexture;
}

/** One material per slot for a drone look. */
export function createDroneMaterials(look: DroneLook): { materials: Record<string, THREE.Material>; time: { value: number } } {
  const p = look.palette;
  const rough = 1 - 0.85 * p.gloss;
  const u: PlateUniforms = {
    uPanelScale: { value: look.panelScale ?? 0.11 },
    uPanelLines: { value: p.panels },
    uWear: { value: look.wear },
    uSeamGlow: { value: look.seams },
    uSeamColor: { value: srgb(p.glow) },
    uSeed: { value: (look.seed % 997) * 0.37 },
    uStripeA: { value: srgb(p.accent[0] + p.accent[1] + p.accent[2] < 0.6 ? [0.95, 0.75, 0.1] : p.accent) },
    uStripeB: { value: srgb([0.05, 0.05, 0.05]) },
  };
  const time = { value: 0 };
  const plate = (c: RGB, metal: number, r: number, clearcoat = 0) => {
    const m = clearcoat > 0 ? new THREE.MeshPhysicalMaterial({ color: srgb(c), metalness: metal, roughness: r, clearcoat, clearcoatRoughness: 0.15 }) : new THREE.MeshStandardMaterial({ color: srgb(c), metalness: metal, roughness: r });
    plating(m, u);
    return m;
  };
  const emissive = (c: RGB, k: number) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: srgb(c), emissiveIntensity: k, roughness: 0.4 });
  const effect = (c: RGB, intensity: number, core: number) =>
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: srgb(c) }, uIntensity: { value: intensity }, uCore: { value: core }, uTime: time },
      vertexShader: EFFECT_VERT,
      fragmentShader: EFFECT_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  const hazard = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.55 });
  plating(hazard, u, true);
  const materials: Record<string, THREE.Material> = {
    primary: plate(p.primary, p.metallic, rough, p.gloss > 0.6 ? p.gloss * 0.6 : 0),
    secondary: plate(p.secondary, Math.min(1, p.metallic + 0.15), Math.min(1, rough + 0.1)),
    accent: plate(p.accent, p.metallic, rough * 0.9, p.gloss > 0.6 ? 0.5 : 0),
    metal: new THREE.MeshStandardMaterial({ color: srgb(p.metal), metalness: 0.9, roughness: 0.32 }),
    dark: new THREE.MeshStandardMaterial({ color: srgb(p.metal.map((v) => v * 0.3) as RGB), metalness: 0.4, roughness: 0.55 }),
    glass: new THREE.MeshPhysicalMaterial({ color: srgb(p.glass), metalness: 0.1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6 }),
    glow: emissive(p.glow, 3.5),
    hazard,
    navRed: emissive([1, 0.1, 0.06], 5),
    navGreen: emissive([0.1, 1, 0.3], 5),
    white: emissive([1, 1, 1], 5),
    exhaust: effect(p.glow, 1.4, 1),
    beam: effect(p.glow.map((v) => 0.5 + 0.5 * v) as RGB, 0.16, 0),
    blur: new THREE.MeshBasicMaterial({ color: srgb(p.metal), transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
  };
  return { materials, time };
}

const EFFECTS = new Set(["exhaust", "beam", "blur"]);

/** A generated drone in a three.js scene: `stage.add(new ThreeDrone(generateDrone({ seed: 7 })))`. */
export class ThreeDrone {
  readonly object = new THREE.Group();
  readonly nodes: THREE.Object3D[] = [];
  readonly mixer: THREE.AnimationMixer;
  readonly clips = new Map<string, THREE.AnimationClip>();
  readonly materials: Record<string, THREE.Material>;
  current: THREE.AnimationAction | null = null;
  private readonly time: { value: number };
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly sprites: THREE.SpriteMaterial[] = [];

  constructor(readonly data: DroneData, options: { halos?: boolean } = {}) {
    const look: DroneLook = { palette: data.spec.palette, wear: data.spec.wear, seams: data.spec.lights.seams, seed: data.spec.seed, panelScale: 0.06 + 0.05 * data.spec.size };
    const { materials, time } = createDroneMaterials(look);
    this.materials = materials;
    this.time = time;
    this.object.name = "drone";
    for (const n of data.nodes) {
      const o = new THREE.Group();
      o.name = n.name;
      o.position.fromArray(n.position);
      o.quaternion.fromArray(n.quaternion);
      o.scale.fromArray(n.scale);
      this.nodes.push(o);
      (n.parent < 0 ? this.object : this.nodes[n.parent]).add(o);
    }
    for (const m of data.meshes) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
      if (m.fade) g.setAttribute("fade", new THREE.BufferAttribute(m.fade, 1));
      g.setIndex(new THREE.BufferAttribute(m.indices, 1));
      g.computeBoundingSphere();
      this.geometries.push(g);
      const mesh = new THREE.Mesh(g, materials[m.slot] ?? materials.primary);
      mesh.name = `${data.nodes[m.node].name}_${m.slot}`;
      const fx = EFFECTS.has(m.slot);
      mesh.castShadow = !fx;
      mesh.receiveShadow = !fx;
      if (fx) mesh.renderOrder = 2;
      this.nodes[m.node].add(mesh);
    }
    if (options.halos !== false) {
      for (const gl of data.glows) {
        const mat = new THREE.SpriteMaterial({ map: droneHaloTexture(), color: srgb(gl.color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 });
        this.sprites.push(mat);
        const s = new THREE.Sprite(mat);
        s.name = "halo";
        s.scale.setScalar(gl.size);
        s.renderOrder = 3;
        this.nodes[gl.node].add(s);
      }
    }
    for (const c of data.clips) {
      const tracks = c.tracks.map((t) => {
        const name = `${data.nodes[t.node].name}.${t.path}`;
        const tr =
          t.path === "quaternion" ? new THREE.QuaternionKeyframeTrack(name, Array.from(t.times), Array.from(t.values)) : new THREE.VectorKeyframeTrack(name, Array.from(t.times), Array.from(t.values));
        if (t.step) tr.setInterpolation(THREE.InterpolateDiscrete);
        return tr;
      });
      this.clips.set(c.name, new THREE.AnimationClip(c.name, c.duration, tracks));
    }
    this.mixer = new THREE.AnimationMixer(this.object);
  }

  /** Plays a clip by name (null: rest pose), cross-fading from the current one. */
  play(name: string | null, fade = 0.4): THREE.AnimationAction | null {
    const clip = name ? this.clips.get(name) : undefined;
    const prev = this.current;
    if (!clip) {
      this.mixer.stopAllAction();
      this.current = null;
      return null;
    }
    const action = this.mixer.clipAction(clip);
    action.reset().play();
    if (prev && prev !== action && fade > 0) action.crossFadeFrom(prev, fade, false);
    else if (prev && prev !== action) prev.stop();
    this.current = action;
    return action;
  }

  update(dt: number): void {
    this.mixer.update(dt);
    this.time.value += dt;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const g of this.geometries) g.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    for (const s of this.sprites) s.dispose();
    this.object.removeFromParent();
  }
}
