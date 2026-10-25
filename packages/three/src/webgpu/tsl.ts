/**
 * three's TSL, loosely typed (see types.ts): every webgpu/ file imports TSL
 * from here, never from "three/tsl" directly.
 */
import * as TSL from "three/tsl";
import type { N } from "./types";

const T = TSL as unknown as Record<string, N>;
export const {
  BRDF_Lambert, Fn, If, Loop, OnObjectUpdate, TBNViewMatrix, abs, attribute, clamp, cross, dFdx, dFdy, diffuseContribution, dot, exp, faceDirection, float, floor, fract, fwidth,
  length, materialColor, max, min, mix, morphReference, mx_hsvtorgb, mx_rgbtohsv, normalLocal, normalView, normalize, positionGeometry, positionLocal, positionView, pow, property, reference,
  referenceBuffer, select, sign, sin, skinning, smoothstep, sqrt, step, subBuild, texture, uniform, uv, varying, vec2, vec3, vec4, cos, mod, int, instanceIndex, Discard, normalGeometry,
} = T;
