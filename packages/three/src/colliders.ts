import * as THREE from "three";

export const MAX_COLLIDERS = 4;

/** Leg capsules (model space) that skirt-like garments are pushed out of. */
export interface ColliderUniforms {
  uCapA: { value: THREE.Vector4[] }; // xyz = segment start, w = radius
  uCapB: { value: THREE.Vector3[] }; // segment end
  /** Body centre line (the garment is pushed away from it, horizontally). */
  uCenter: { value: THREE.Vector3 };
}

export function createColliderUniforms(): ColliderUniforms {
  return {
    uCapA: { value: Array.from({ length: MAX_COLLIDERS }, () => new THREE.Vector4(0, -100, 0, 0)) },
    uCapB: { value: Array.from({ length: MAX_COLLIDERS }, () => new THREE.Vector3(0, -100, 0)) },
    uCenter: { value: new THREE.Vector3() },
  };
}

const PARS = /* glsl */ `
uniform vec4 uCapA[ ${MAX_COLLIDERS} ];
uniform vec3 uCapB[ ${MAX_COLLIDERS} ];
uniform vec3 uCenter;
`;

// After skinning: a vertex inside a leg capsule is moved outward, away from the
// body's centre line (horizontally), until it sits on the capsule. Moving every
// vertex the same way (rather than away from each leg) keeps the cloth whole
// where both legs are close. On a level leg (seated) that direction runs along
// the thigh, so there the cloth is moved up instead, onto the lap. A soft band lets the cloth tent over the leg.
const PUSH = /* glsl */ `
{
  vec3 out_ = transformed - uCenter;
  out_.y = 0.0;
  vec3 n = length( out_ ) > 1e-4 ? normalize( out_ ) : vec3( 0.0, 0.0, 1.0 );
  for ( int i = 0; i < ${MAX_COLLIDERS}; i ++ ) {
    vec3 a = uCapA[ i ].xyz, b = uCapB[ i ];
    float r = uCapA[ i ].w;
    if ( r <= 0.0 ) continue;
    vec3 ab = b - a;
    float len = max( length( ab ), 1e-5 );
    vec3 axis = ab / len;
    float h = clamp( dot( transformed - a, axis ), 0.0, len );
    vec3 d = transformed - ( a + axis * h ); // offset from the axis
    float dist = length( d );
    float soft = r * 1.6;
    if ( dist >= soft ) continue;
    // Monotonic remap [0, soft] -> [r, soft]: stacked cloth layers keep their order.
    float target = r + ( soft - r ) * ( dist / soft );
    // Walk along n (projected off the axis) until the offset reaches target: |d + s m| = target.
    // Away from the centre line on an upright leg; up on a level one (a seated lap: the centre line
    // points along the thigh there, and the cloth, skinned between the legs, belongs on top).
    vec3 side = n - axis * dot( n, axis );
    vec3 up = vec3( 0.0, 1.0, 0.0 ) - axis * axis.y;
    vec3 m = mix( side, up, smoothstep( 0.3, 0.8, 1.0 - abs( axis.y ) ) );
    float ml = length( m );
    if ( ml < 1e-3 ) continue;
    m /= ml;
    float dm = dot( d, m );
    float s = -dm + sqrt( max( dm * dm - dist * dist + target * target, 0.0 ) );
    transformed += m * min( s, 0.3 );
  }
}
`;

/** Adds leg-capsule collision to a skinned garment material (call after DQS). */
export function useColliders<T extends THREE.Material>(material: T, uniforms: ColliderUniforms): T {
  const previous = material.onBeforeCompile.bind(material);
  const prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${PARS}`)
      .replace("#include <project_vertex>", `${PUSH}\n#include <project_vertex>`);
  };
  material.customProgramCacheKey = () => `${prevKey()}|colliders`;
  return material;
}
