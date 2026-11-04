import { describe, expect, it } from "vitest";
import { FaceAnimator, VISEMES, textToVisemes } from "./faceAnimator";

/** A small seeded random source, so the tests are repeatable. */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const run = (a: FaceAnimator, seconds: number, each?: (t: number) => void) => {
  for (let t = 0; t < seconds; t += 1 / 60) {
    a.update(1 / 60);
    each?.(t);
  }
};

describe("FaceAnimator", () => {
  it("blinks every few seconds, fully closing the lids", () => {
    const a = new FaceAnimator({ random: seeded(3), saccades: false, idle: false });
    let closed = 0, wasClosed = false, max = 0;
    run(a, 30, () => {
      const c = a.update(0).units["eye-left-closure"];
      max = Math.max(max, c);
      const now = c > 0.5;
      if (now && !wasClosed) closed++;
      wasClosed = now;
    });
    expect(max).toBeCloseTo(1, 1);
    expect(closed).toBeGreaterThan(4);
    expect(closed).toBeLessThan(20);
  });

  it("lowers the lids when the eyes look down and opens them when they look up", () => {
    const a = new FaceAnimator({ blink: false, saccades: false, idle: false });
    expect(a.update(0.016, -0.4).units["eye-left-closure"]).toBeGreaterThan(0.3);
    expect(a.update(0.016, 0.3).units["eye-left-opened-up"]).toBeGreaterThan(0.2);
    expect(a.update(0.016, 0).units["eye-left-closure"]).toBe(0);
  });

  it("makes small eye jumps, now and then a bigger glance", () => {
    const a = new FaceAnimator({ random: seeded(7), blink: false, idle: false });
    const yaws = new Set<number>();
    let big = 0;
    run(a, 60, () => {
      const f = a.update(0);
      yaws.add(f.yaw);
      big = Math.max(big, Math.hypot(f.yaw, f.pitch));
    });
    expect(yaws.size).toBeGreaterThan(20);
    expect(big).toBeGreaterThan(0.08);
    expect(big).toBeLessThan(0.3);
  });

  it("moves the mouth while saying a line and rests after it", () => {
    const a = new FaceAnimator({ blink: false, saccades: false, idle: false });
    const d = a.say("Hello there, traveller!");
    expect(d).toBeGreaterThan(1);
    expect(d).toBeLessThan(4);
    let open = 0;
    run(a, d, () => {
      const u = a.update(0).units;
      open = Math.max(open, u["mouth-open"] ?? 0);
    });
    expect(open).toBeGreaterThan(0.3);
    run(a, 0.5);
    expect(a.speaking).toBe(false);
    expect(a.update(0.016).units["mouth-open"] ?? 0).toBe(0);
  });

  it("opens the jaw with the voice level", () => {
    const a = new FaceAnimator({ blink: false, saccades: false, idle: false });
    a.setVoiceLevel(1);
    run(a, 0.3);
    expect(a.update(0.016).units["mouth-open"]).toBeGreaterThan(0.4);
    a.setVoiceLevel(0);
    run(a, 1);
    expect(a.update(0.016).units["mouth-open"] ?? 0).toBeLessThan(0.01);
  });

  it("keeps idle movement small and never negative", () => {
    const a = new FaceAnimator({ random: seeded(5), blink: false, saccades: false });
    run(a, 40, () => {
      for (const [, w] of Object.entries(a.update(0).units)) {
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThan(0.2);
      }
    });
  });
});

describe("textToVisemes", () => {
  it("reads letters and digraphs into known visemes, in time order, ending silent", () => {
    const keys = textToVisemes("Think, maybe.");
    expect(keys.map((k) => k.viseme).slice(0, 3)).toEqual(["TH", "ih", "nn"]);
    for (const k of keys) expect(VISEMES[k.viseme]).toBeDefined();
    for (let i = 1; i < keys.length; i++) expect(keys[i].time).toBeGreaterThan(keys[i - 1].time);
    expect(keys[keys.length - 1].viseme).toBe("sil");
    expect(textToVisemes("Think", 2).at(-1)!.time).toBeCloseTo(textToVisemes("Think").at(-1)!.time / 2);
  });
});
