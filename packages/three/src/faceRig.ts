/**
 * Face rig on the GPU (see @actors/core faceRig.ts): every face unit's deltas in one half-float
 * texture per actor, blended in the vertex shader before skinning. A frame only uploads the
 * unit weights (one float each); vertices no unit moves skip the work.
 *
 * Each drawn vertex carries `actorFaceSlot` (slot + 1, 0: not moved). With the node kit it sits
 * in the face morphs' interleaved buffer (WebGPU allows only 8 vertex buffers per draw).
 */
import * as THREE from "three";
import { BASE_SPACE, type FaceRig } from "@actors/core";
import { morphAttribute } from "./morphs";

/** Most units a face rig can blend (MakeHuman has 34 per side mix; room for more). */
export const FACE_RIG_MAX_UNITS = 48;

/** The attribute holding each vertex's slot + 1. */
export const FACE_SLOT = "actorFaceSlot";

export interface FaceRigUniforms {
  uFaceRig: { value: THREE.DataTexture };
  /** x unit count, y texture width, z on (1) or off (0). */
  uFaceInfo: { value: THREE.Vector4 };
  /** Unit weights, in the rig's unit order (shared by every material of the actor). */
  uFaceW: { value: number[] };
}

function emptyTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export function createFaceRigUniforms(): FaceRigUniforms {
  return {
    uFaceRig: { value: emptyTexture() },
    uFaceInfo: { value: new THREE.Vector4(0, 1, 0, 0) },
    uFaceW: { value: new Array(FACE_RIG_MAX_UNITS).fill(0) },
  };
}

/**
 * Puts a rig's deltas into the uniforms' texture (null: switches the rig off and frees the
 * texture). The texture object stays the same (shaders hold on to it); its GPU copy is
 * re-created at the new size.
 */
export function setFaceRigTexture(u: FaceRigUniforms, rig: FaceRig | null): void {
  const t = u.uFaceRig.value;
  t.dispose();
  t.image = rig ? { data: rig.data, width: rig.width, height: rig.height } : { data: new Uint16Array(4), width: 1, height: 1 };
  t.needsUpdate = true;
  u.uFaceW.value.fill(0);
  if (rig) u.uFaceInfo.value.set(Math.min(rig.units.length, FACE_RIG_MAX_UNITS), rig.width, 1, 0);
  else u.uFaceInfo.value.set(0, 1, 0, 0);
}

/**
 * Uploads the rig texture now and lets go of its CPU copy: a rig's deltas are about 7 MB a character, and
 * three keeps the array in `texture.image.data` for good (33 characters held 260 MB of JS memory). The
 * renderer must be initialised (`initTexture`); without one, or when the upload throws, nothing is dropped
 * and false is returned. A lost WebGL context can no longer restore the texture; set the rig again then.
 */
export function releaseFaceRigTexture(u: FaceRigUniforms, renderer: unknown): boolean {
  const t = u.uFaceRig.value;
  const r = renderer as { initTexture?: (texture: THREE.Texture) => unknown } | null;
  if (!r?.initTexture || !t.image?.data || t.image.width <= 1) return false;
  try {
    r.initTexture(t);
  } catch {
    return false;
  }
  t.image = { data: null, width: t.image.width, height: t.image.height };
  return true;
}

/**
 * Slot + 1 of each drawn vertex: `map` maps drawn vertices to their source vertex in `space`
 * (BASE_SPACE or the mesh's own stencil space); `anchors` (parts) map them to base vertices.
 * Null when no vertex is moved.
 */
export function faceSlotsFor(rig: FaceRig, space: string, map: ArrayLike<number>): Float32Array | null {
  const slots = rig.slots.get(space);
  if (!slots) return null;
  const out = new Float32Array(map.length);
  let any = false;
  for (let i = 0; i < map.length; i++) {
    const s = map[i];
    if (s < slots.length && slots[s]) {
      out[i] = slots[s];
      any = true;
    }
  }
  return any ? out : null;
}

export { BASE_SPACE };

/**
 * Sets (or clears, with null) a geometry's face slots. With interleaved face morphs (node kit)
 * the slot goes into their buffer, which grows by one float per vertex the first time.
 * Returns whether the geometry's layout changed (its draw state must be rebuilt).
 */
export function setFaceSlots(g: THREE.BufferGeometry, slots: Float32Array | null): boolean {
  const existing = g.getAttribute(FACE_SLOT) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  const count = g.getAttribute("position").count;
  const write = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => {
    for (let i = 0; i < count; i++) a.setX(i, slots ? slots[i] : 0);
    if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) (a as THREE.InterleavedBufferAttribute).data.needsUpdate = true;
    else a.needsUpdate = true;
  };
  if (existing) {
    write(existing);
    return false;
  }
  if (!slots) return false;
  const morph = g.getAttribute(morphAttribute(0)) as THREE.InterleavedBufferAttribute | undefined;
  if (morph?.isInterleavedBufferAttribute) {
    // Grow the interleaved morph buffer by one float per vertex and re-point its attributes.
    const old = morph.data;
    const stride = old.stride + 1;
    const array = new Float32Array(count * stride);
    const src = old.array as Float32Array;
    for (let i = 0; i < count; i++) array.set(src.subarray(i * old.stride, (i + 1) * old.stride), i * stride);
    const buffer = new THREE.InterleavedBuffer(array, stride);
    for (const [name, a] of Object.entries(g.attributes)) {
      const ia = a as THREE.InterleavedBufferAttribute;
      if (ia.isInterleavedBufferAttribute && ia.data === old) g.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, ia.itemSize, ia.offset));
    }
    g.setAttribute(FACE_SLOT, new THREE.InterleavedBufferAttribute(buffer, 1, old.stride));
  } else {
    g.setAttribute(FACE_SLOT, new THREE.BufferAttribute(new Float32Array(count), 1));
  }
  write(g.getAttribute(FACE_SLOT) as THREE.BufferAttribute);
  return true;
}

const GLSL_FACE_PARS = /* glsl */ `
attribute float actorFaceSlot;
uniform highp sampler2D uFaceRig;
uniform vec4 uFaceInfo;
uniform float uFaceW[${FACE_RIG_MAX_UNITS}];
void actorFaceRig( out vec3 dp, out vec3 dn ) {
  dp = vec3( 0.0 );
  dn = vec3( 0.0 );
  int slot = int( actorFaceSlot + 0.5 ) - 1;
  if ( slot < 0 || uFaceInfo.z < 0.5 ) return;
  int units = int( uFaceInfo.x );
  int width = int( uFaceInfo.y );
  for ( int u = 0; u < ${FACE_RIG_MAX_UNITS}; u++ ) {
    if ( u >= units ) break;
    float w = uFaceW[ u ];
    if ( w == 0.0 ) continue;
    int t = ( slot * units + u ) * 2;
    dp += w * texelFetch( uFaceRig, ivec2( t % width, t / width ), 0 ).xyz;
    dn += w * texelFetch( uFaceRig, ivec2( ( t + 1 ) % width, ( t + 1 ) / width ), 0 ).xyz;
  }
}
`;

/** Patches a vertex shader for the face rig: unit deltas added to the position and normal before morphs end and skinning starts. */
export function patchFaceRig(shader: { vertexShader: string }): void {
  let vs = shader.vertexShader;
  vs = vs.replace("#include <common>", `#include <common>\n${GLSL_FACE_PARS}`);
  vs = vs.replace(/void main\(\) \{/, "void main() {\n  vec3 actorFaceP, actorFaceN;\n  actorFaceRig( actorFaceP, actorFaceN );");
  if (vs.includes("#include <morphnormal_vertex>")) vs = vs.replace("#include <morphnormal_vertex>", "#include <morphnormal_vertex>\n  objectNormal += actorFaceN;");
  vs = vs.replace("#include <morphtarget_vertex>", "#include <morphtarget_vertex>\n  transformed += actorFaceP;");
  shader.vertexShader = vs;
}

/** Adds the face rig to a WebGL material (once), chaining its onBeforeCompile. */
export function useFaceRig<T extends THREE.Material>(material: T, uniforms: FaceRigUniforms): T {
  if (material.userData.faceRig) return material;
  material.userData.faceRig = uniforms;
  const previous = material.onBeforeCompile.bind(material);
  const prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    patchFaceRig(shader);
  };
  material.customProgramCacheKey = () => `${prevKey()}|face`;
  material.needsUpdate = true;
  return material;
}
