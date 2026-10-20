import * as THREE from "three";

const MAX_LAYERS = 4;

/**
 * Blends up to four photographic skin textures (same UV layout) into one
 * render target on the GPU, so a body can move smoothly between age, gender
 * and ethnicity skins without shipping a texture per combination.
 * Sources are sampled as sRGB (decoded to linear), blended linearly and
 * written to an sRGB target, which the skin shader samples like any map.
 */
export class SkinComposer {
  readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;

  constructor(size = 2048) {
    this.target = new THREE.WebGLRenderTarget(size, size, {
      colorSpace: THREE.SRGBColorSpace,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    this.target.texture.anisotropy = 4;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uLayers: { value: new Array(MAX_LAYERS).fill(null) },
        uWeights: { value: new Array(MAX_LAYERS).fill(0) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uLayers[ ${MAX_LAYERS} ];
        uniform float uWeights[ ${MAX_LAYERS} ];
        varying vec2 vUv;
        void main() {
          vec3 c = vec3( 0.0 );
          ${Array.from({ length: MAX_LAYERS }, (_, i) => `if ( uWeights[ ${i} ] > 0.0 ) c += uWeights[ ${i} ] * texture2D( uLayers[ ${i} ], vUv ).rgb;`).join("\n          ")}
          gl_FragColor = vec4( c, 1.0 );
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  /** Renders the weighted blend. Textures must be loaded; weights should sum to 1. */
  compose(renderer: THREE.WebGLRenderer, layers: { texture: THREE.Texture; weight: number }[]): void {
    const u = this.material.uniforms;
    const blank = layers[0]?.texture ?? null;
    for (let i = 0; i < MAX_LAYERS; i++) {
      u.uLayers.value[i] = layers[i]?.texture ?? blank;
      u.uWeights.value[i] = layers[i]?.weight ?? 0;
    }
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previous);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
