import { describe, expect, it } from "vitest";
import { applyBoneScales } from "@actors/core";
import { MAX_HEAD_SCALE, RACE_IDS, RACE_STYLES } from "./races";
import { raceBareTargetWeights, raceScale, raceShapeOptions, sanitizeRace } from "./raceshape";

const BONES = ["Root", "pelvis", "thigh_l", "calf_l", "spine_01", "neck_01", "head", "index_01_l"];
const resolve = (bare: string) => `group/${bare}`;

describe("races", () => {
  it("keeps every race and mix within the adult head-scale cap", () => {
    for (const a of RACE_IDS)
      for (const b of RACE_IDS)
        for (const mix of [0, 0.5, 1]) {
          const head = raceShapeOptions(sanitizeRace({ race: a, race2: b, mix }), BONES, resolve).bones?.head;
          expect(head?.len ?? 1).toBeLessThanOrEqual(MAX_HEAD_SCALE + 1e-9);
        }
  });

  it("gives dwarves short legs and giantkin a large overall scale", () => {
    const dwarf = raceShapeOptions(sanitizeRace({ race: "dwarf" }), BONES, resolve);
    expect(dwarf.bones?.thigh_l.len).toBeLessThan(0.9);
    expect(dwarf.bones?.thigh_l.girth).toBeGreaterThan(1.05);
    expect(raceScale(sanitizeRace({ race: "giantkin" }))).toBeGreaterThan(1.5);
    expect(raceScale(sanitizeRace({ race: "human" }))).toBe(1);
  });

  it("points elf ear tips outward on each side and backward (-Z)", () => {
    const tips = raceShapeOptions(sanitizeRace({ race: "elf" }), BONES, resolve).tips!;
    expect(tips).toHaveLength(2);
    const left = tips.find((t) => t.mask.includes("l-ear"))!, right = tips.find((t) => t.mask.includes("r-ear"))!;
    expect(left.direction[0]).toBeGreaterThan(0);
    expect(right.direction[0]).toBeLessThan(0);
    expect(left.direction[2]).toBeLessThan(0);
    expect(raceShapeOptions(sanitizeRace({ race: "human" }), BONES, resolve).tips).toHaveLength(0);
  });

  it("expands sided targets and nets opposing pairs", () => {
    const w = raceBareTargetWeights(sanitizeRace({ race: "elf" }));
    expect(w.get("l-cheek-bones-incr")).toBeGreaterThan(0);
    expect(w.get("r-cheek-bones-incr")).toBe(w.get("l-cheek-bones-incr"));
    for (const name of w.keys()) {
      if (name.endsWith("-decr")) expect(w.has(name.replace(/-decr$/, "-incr"))).toBe(false);
    }
  });

  it("sanitizes unknown races and same-race mixes", () => {
    expect(sanitizeRace({ race: "dragon" as never })).toEqual({ race: "human", race2: null, mix: 0, size: 0.5 });
    expect(sanitizeRace({ race: "elf", race2: "elf", mix: 0.4 }).race2).toBeNull();
    expect(Object.keys(RACE_STYLES).sort()).toEqual([...RACE_IDS].sort());
  });
});

describe("bone proportion pass", () => {
  it("lengthens a bone and carries its children along", () => {
    // Two bones along +Y: a (0..1) and its child b (1..2); one vertex per bone.
    const skeleton = { names: ["a", "b"], parents: [-1, 0], heads: [[0, 0, 0], [0, 1, 0]] as [number, number, number][], tails: [[0, 1, 0], [0, 2, 0]] as [number, number, number][] };
    const positions = new Float32Array([0.1, 0.5, 0, 0, 1.5, 0]);
    const joints = new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0]);
    const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]);
    applyBoneScales(positions, skeleton, joints, weights, { a: { len: 2, girth: 0.5 } });
    expect(positions[0]).toBeCloseTo(0.05); // girth halves across the bone
    expect(positions[1]).toBeCloseTo(1); // length doubles along it
    expect(positions[4]).toBeCloseTo(2.5); // the child moves with its parent's end
  });
});
