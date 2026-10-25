import { describe, expect, it } from "vitest";
import { createFurUniforms } from "../fur";
import { animalNodeMaterials, createNodeFurMaterial, createNodeFurShellMaterial } from "./fur";

type MeshArg = Parameters<ReturnType<typeof animalNodeMaterials>["mesh"]>[0];
const mesh = (kind: string, tags: string[] = []) => ({ def: { name: kind, material: { kind, color: [0.2, 0.1, 0.05] }, tags } }) as unknown as MeshArg;

describe("node fur", () => {
  it("picks fur, animal eye and tack materials by kind and tag", () => {
    const kit = animalNodeMaterials(createFurUniforms());
    const fur = kit.mesh(mesh("fur"), null as never) as unknown as { userData: { fur?: boolean }; isNodeMaterial?: boolean };
    expect(fur.userData.fur).toBe(true);
    expect(fur.isNodeMaterial).toBe(true);
    const tack = kit.mesh(mesh("other", ["tack", "metal"]), null as never) as unknown as { metalness: number };
    expect(tack.metalness).toBeGreaterThan(0.5);
  });

  it("shares one graph between animals (one shader), each with its own coat values", () => {
    const a = createFurUniforms(), b = createFurUniforms();
    const ma = createNodeFurMaterial(a), mb = createNodeFurMaterial(b);
    expect(ma.colorNode).toBe(mb.colorNode);
    expect(ma.userData.actorInputs).not.toBe(mb.userData.actorInputs);
    const shell = createNodeFurShellMaterial(a);
    expect(shell.transparent).toBe(true);
    expect(shell.depthWrite).toBe(false);
    expect(shell.positionNode).toBe(createNodeFurShellMaterial(b).positionNode);
  });
});
