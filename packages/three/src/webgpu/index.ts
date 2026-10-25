/**
 * `@actors/three/webgpu`: draw actors with three's WebGPURenderer (node
 * materials; WebGPU or its WebGL 2 fallback). Pass `nodeMaterials` wherever a
 * material kit is taken:
 *
 * ```ts
 * import { nodeMaterials } from "@actors/three/webgpu";
 * const character = await Character.load({ pack, renderer, materials: nodeMaterials });
 * ```
 */
export { nodeMaterials, nodeMeshMaterial, createNodeSkinMaterial, createNodeEyeMaterial, createNodeClothMaterial, createNodeHairMaterial, createNodeLashMaterial, createNodeWetMaterial, createNodePartMaterial, createNodeCrowdMaterial, useNodeClip, useNodeColliders } from "./materials";
export { useNodeDqs } from "./dqs";
export { animalNodeMaterials, addNodeFurShells, createNodeFurMaterial, createNodeFurShellMaterial, createNodeAnimalEyeMaterial, createNodeTackMaterial, createNodeWhiskerMaterial } from "./fur";
