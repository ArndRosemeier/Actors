import { describe, expect, it } from "vitest";
import { muscleBareTargetWeights } from "./muscle";

describe("muscle shaping", () => {
  it("adds nothing at average muscle", () => {
    expect(muscleBareTargetWeights(0.5, 1).size).toBe(0);
  });

  it("bulks both arms and legs above average and thins them below", () => {
    const strong = muscleBareTargetWeights(1, 0.5);
    for (const n of ["l-upperarm-muscle-incr", "r-upperarm-muscle-incr", "l-upperleg-muscle-incr", "r-lowerleg-muscle-incr"]) expect(strong.get(n)).toBeGreaterThan(0.5);
    const weak = muscleBareTargetWeights(0, 0.5);
    expect(weak.get("l-upperarm-muscle-decr")).toBeGreaterThan(0);
    expect([...weak.keys()].some((k) => k.endsWith("-incr"))).toBe(false);
  });

  it("gives men more chest and neck bulk than women", () => {
    const m = muscleBareTargetWeights(1, 1);
    const f = muscleBareTargetWeights(1, 0);
    expect(m.get("torso-muscle-pectoral-incr")!).toBeGreaterThan(f.get("torso-muscle-pectoral-incr")!);
    expect(m.get("l-upperarm-muscle-incr")).toBe(f.get("l-upperarm-muscle-incr"));
  });
});
