import * as THREE from "three";

/**
 * Dual-quaternion skinning for any three.js material.
 *
 * three.js blends bone *matrices* (linear blend skinning), which makes
 * elbows, knees, shoulders and hips lose volume and twist like candy
 * wrappers. Blending bone rotations as dual quaternions keeps volume.
 * The patch replaces three's skinning shader chunks; everything else
 * (bone texture, skinIndex/skinWeight attributes) stays standard.
 */
const DQS_PARS = /* glsl */ `
vec4 dqsQuat( mat3 m ) {
  float tr = m[0][0] + m[1][1] + m[2][2];
  if ( tr > 0.0 ) {
    float s = sqrt( tr + 1.0 ) * 2.0;
    return vec4( ( m[1][2] - m[2][1] ) / s, ( m[2][0] - m[0][2] ) / s, ( m[0][1] - m[1][0] ) / s, 0.25 * s );
  } else if ( m[0][0] > m[1][1] && m[0][0] > m[2][2] ) {
    float s = sqrt( 1.0 + m[0][0] - m[1][1] - m[2][2] ) * 2.0;
    return vec4( 0.25 * s, ( m[1][0] + m[0][1] ) / s, ( m[2][0] + m[0][2] ) / s, ( m[1][2] - m[2][1] ) / s );
  } else if ( m[1][1] > m[2][2] ) {
    float s = sqrt( 1.0 + m[1][1] - m[0][0] - m[2][2] ) * 2.0;
    return vec4( ( m[1][0] + m[0][1] ) / s, 0.25 * s, ( m[2][1] + m[1][2] ) / s, ( m[2][0] - m[0][2] ) / s );
  }
  float s = sqrt( 1.0 + m[2][2] - m[0][0] - m[1][1] ) * 2.0;
  return vec4( ( m[2][0] + m[0][2] ) / s, ( m[2][1] + m[1][2] ) / s, 0.25 * s, ( m[0][1] - m[1][0] ) / s );
}
vec4 dqsMul( vec4 a, vec4 b ) {
  return vec4( a.w * b.xyz + b.w * a.xyz + cross( a.xyz, b.xyz ), a.w * b.w - dot( a.xyz, b.xyz ) );
}
void dqsFromMatrix( mat4 m, out vec4 r, out vec4 d ) {
  r = normalize( dqsQuat( mat3( m ) ) );
  d = 0.5 * dqsMul( vec4( m[3].xyz, 0.0 ), r );
}
vec3 dqsRotate( vec4 r, vec3 v ) {
  return v + 2.0 * cross( r.xyz, cross( r.xyz, v ) + r.w * v );
}
`;

const DQS_BLEND = /* glsl */ `
#ifdef USE_SKINNING
  vec4 dqR0, dqD0, dqR1, dqD1, dqR2, dqD2, dqR3, dqD3;
  dqsFromMatrix( boneMatX, dqR0, dqD0 );
  dqsFromMatrix( boneMatY, dqR1, dqD1 );
  dqsFromMatrix( boneMatZ, dqR2, dqD2 );
  dqsFromMatrix( boneMatW, dqR3, dqD3 );
  // Keep all rotations in the same hemisphere as the first before blending.
  float dqS1 = dot( dqR0, dqR1 ) < 0.0 ? -1.0 : 1.0;
  float dqS2 = dot( dqR0, dqR2 ) < 0.0 ? -1.0 : 1.0;
  float dqS3 = dot( dqR0, dqR3 ) < 0.0 ? -1.0 : 1.0;
  vec4 dqR = skinWeight.x * dqR0 + skinWeight.y * dqS1 * dqR1 + skinWeight.z * dqS2 * dqR2 + skinWeight.w * dqS3 * dqR3;
  vec4 dqD = skinWeight.x * dqD0 + skinWeight.y * dqS1 * dqD1 + skinWeight.z * dqS2 * dqD2 + skinWeight.w * dqS3 * dqD3;
  float dqLen = length( dqR );
  dqR /= dqLen;
  dqD /= dqLen;
  vec3 dqT = 2.0 * ( dqR.w * dqD.xyz - dqD.w * dqR.xyz + cross( dqR.xyz, dqD.xyz ) );
#endif
`;

const DQS_NORMAL = /* glsl */ `
#ifdef USE_SKINNING
  objectNormal = ( bindMatrixInverse * vec4( dqsRotate( dqR, ( bindMatrix * vec4( objectNormal, 0.0 ) ).xyz ), 0.0 ) ).xyz;
  #ifdef USE_TANGENT
    objectTangent = ( bindMatrixInverse * vec4( dqsRotate( dqR, ( bindMatrix * vec4( objectTangent, 0.0 ) ).xyz ), 0.0 ) ).xyz;
  #endif
#endif
`;

const DQS_POSITION = /* glsl */ `
#ifdef USE_SKINNING
  vec3 dqP = ( bindMatrix * vec4( transformed, 1.0 ) ).xyz;
  transformed = ( bindMatrixInverse * vec4( dqsRotate( dqR, dqP ) + dqT, 1.0 ) ).xyz;
#endif
`;

export function patchDualQuaternionSkinning(shader: { vertexShader: string }): void {
  let vs = shader.vertexShader;
  vs = vs.replace("#include <skinning_pars_vertex>", `#include <skinning_pars_vertex>\n#ifdef USE_SKINNING\n${DQS_PARS}\n#endif`);
  vs = vs.replace("#include <skinbase_vertex>", `#include <skinbase_vertex>\n${DQS_BLEND}`);
  if (vs.includes("#include <skinnormal_vertex>")) vs = vs.replace("#include <skinnormal_vertex>", DQS_NORMAL);
  vs = vs.replace("#include <skinning_vertex>", DQS_POSITION);
  shader.vertexShader = vs;
}

/** Adds DQS to a material, chaining any existing onBeforeCompile. */
export function useDualQuaternionSkinning<T extends THREE.Material>(material: T): T {
  const previous = material.onBeforeCompile.bind(material);
  const prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    patchDualQuaternionSkinning(shader);
  };
  material.customProgramCacheKey = () => `${prevKey()}|dqs`;
  return material;
}
