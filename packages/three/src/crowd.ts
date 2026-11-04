import * as THREE from "three";
import type { SkinUniforms } from "./materials";

const white = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

/**
 * Material of a crowd-level merged mesh (body, garments and hair in one draw call):
 * garments and hair take their vertex colour, skin (attribute `crowdSkin` = 1) the
 * actor's skin tone or blended photo skin; hems are cut per pixel where
 * `crowdClip` < 0, hair cards where their texture (`hairMaps[crowdHair - 1]`) is
 * transparent. Linear skinning, no extras.
 */
export function createCrowdMaterial(skin: SkinUniforms, hairMaps: readonly (THREE.Texture | null)[] = []): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    // Read at every draw: the actor swaps its hair maps when it rebuilds the crowd mesh.
    shader.uniforms.uHair0 = { get value() { return hairMaps[0] ?? white; } };
    shader.uniforms.uHair1 = { get value() { return hairMaps[1] ?? white; } };
    shader.uniforms.uTone = skin.uTone;
    shader.uniforms.uAlbedo = skin.uAlbedo;
    shader.uniforms.uAlbedoMix = skin.uAlbedoMix;
    shader.uniforms.uAlbedoTint = skin.uAlbedoTint;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float crowdSkin;\nattribute float crowdClip;\nattribute float crowdHair;\nvarying float vCrowdSkin;\nvarying float vCrowdClip;\nvarying float vCrowdHair;\nvarying vec2 vCrowdUv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCrowdSkin = crowdSkin;\nvCrowdClip = crowdClip;\nvCrowdHair = crowdHair;\nvCrowdUv = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uTone;\nuniform sampler2D uAlbedo;\nuniform float uAlbedoMix;\nuniform vec3 uAlbedoTint;\nuniform sampler2D uHair0;\nuniform sampler2D uHair1;\nvarying float vCrowdSkin;\nvarying float vCrowdClip;\nvarying float vCrowdHair;\nvarying vec2 vCrowdUv;",
      )
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\nif ( vCrowdClip < 0.0 ) discard;\nif ( vCrowdHair > 0.5 && ( vCrowdHair < 1.5 ? texture2D( uHair0, vCrowdUv ).a : texture2D( uHair1, vCrowdUv ).a ) < 0.35 ) discard;\n{\n  vec3 skinCol = uTone;\n  if ( uAlbedoMix > 0.0 ) skinCol = mix( skinCol, texture2D( uAlbedo, vCrowdUv ).rgb * uAlbedoTint, uAlbedoMix );\n  diffuseColor.rgb = mix( diffuseColor.rgb, skinCol, vCrowdSkin );\n}",
      );
  };
  mat.customProgramCacheKey = () => "actors-crowd";
  return mat;
}
