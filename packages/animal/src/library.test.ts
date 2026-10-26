import { describe, expect, it } from "vitest";
import { LIBRARY_ANIMALS, findLibraryAnimals, libraryAnimal, libraryClips, pickLibraryClip } from "./library";

describe("animal library catalogue", () => {
  it("lists the 100 WildMesh3D animals with unique ids and sane facts", () => {
    expect(LIBRARY_ANIMALS.length).toBe(100);
    expect(new Set(LIBRARY_ANIMALS.map((a) => a.id)).size).toBe(100);
    for (const a of LIBRARY_ANIMALS) {
      expect(a.id).toMatch(/^[a-z0-9-]+$/);
      expect(a.size.every((s) => s > 0 && s < 10)).toBe(true);
      expect(a.clips.length).toBeGreaterThan(0);
    }
    expect(LIBRARY_ANIMALS.filter((a) => a.set === "stylized").length).toBe(36);
  });

  it("finds animals and their clips", () => {
    expect(libraryAnimal("horse").rig).toBe("G");
    expect(() => libraryAnimal("wolve")).toThrow(/no library animal/i);
    expect(findLibraryAnimals("bird stylized").every((a) => a.group === "bird" && a.set === "stylized")).toBe(true);
    expect(findLibraryAnimals("deer").length).toBeGreaterThan(4);
    expect(libraryClips("horse", /gallop/i).length).toBeGreaterThan(0);
  });

  it("picks plain forward loops for common motions", () => {
    const pick = (id: string, m: Parameters<typeof pickLibraryClip>[1]) => pickLibraryClip(libraryAnimal(id).clips, m);
    expect(pick("wolf", "walk")).toMatch(/^Walk\w*_F$/);
    expect(pick("wolf", "idle")).toBe("Idle");
    expect(pick("horse", "walk")).toBe("G0_Walk");
    expect(pick("goat", "walk")).toBe("walk");
    expect(pick("lynx", "run")).toBe("run_fwd_01");
    expect(pick("buck", "eat")).toMatch(/eat/i);
    expect(pick("trout", "walk")).toBeUndefined();
    // The buck's "Walk" only animates 2 channels (a broken export): its other walk is picked.
    expect(pick("buck", "walk")).not.toBe("Walk");
    // Every land mammal with a walk clip gets one.
    for (const a of LIBRARY_ANIMALS.filter((a) => a.group === "mammal")) {
      if (a.clips.some((c) => /walk/i.test(c.name))) expect(pickLibraryClip(a.clips, "walk"), a.id).toBeDefined();
    }
  });
});
