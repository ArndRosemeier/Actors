import { describe, expect, it } from "vitest";
import type { ActorRuntime, ActorShape, SurfaceDelta } from "@actors/core";
import { type Extras, extrasTask } from "./extras";

describe("extras task", () => {
  it("builds each face delta from its weights, loads the targets first, and hands every buffer over", async () => {
    const loaded: string[] = [];
    const runtime = {
      ensureTargets: async (names: Iterable<string>) => void loaded.push(...names),
      surfaceDelta: (_: ActorShape, w: Map<string, number>): SurfaceDelta => ({
        positions: new Float32Array([...w.values()]),
        normals: new Float32Array(1),
        meshes: new Map([["eyelashes", { positions: new Float32Array(2), normals: new Float32Array(2) }]]),
      }),
    } as unknown as ActorRuntime;
    const out = await extrasTask(runtime, {} as ActorShape, { parts: null, faces: [["blink", [["eyes-closed", 1]]], ["smile", [["mouth-smile", 0.5], ["cheeks-up", 0.25]]]] });
    const extras = out.result as Extras;
    expect(extras.parts).toBeNull();
    expect(extras.faces.map(([k]) => k)).toEqual(["blink", "smile"]);
    expect([...extras.faces[1][1].positions]).toEqual([0.5, 0.25]);
    expect(loaded).toEqual(["eyes-closed", "mouth-smile", "cheeks-up"]);
    // Positions, normals and the eyelashes' two arrays, per delta.
    expect(out.transfer).toHaveLength(8);
  });
});
