import { describe, expect, it } from "vitest";
import { type Vec3, closestOnTriangle, pointTriangleDistance } from "./geometry";

describe("pointTriangleDistance", () => {
  const tri: [Vec3, Vec3, Vec3] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  it("measures to the face, edges and corners", () => {
    expect(pointTriangleDistance([0.2, 0.2, 0.5], tri)).toBeCloseTo(0.5);
    expect(pointTriangleDistance([0.5, -1, 0], tri)).toBeCloseTo(1);
    expect(pointTriangleDistance([1, 1, 0], tri)).toBeCloseTo(Math.SQRT1_2);
    expect(pointTriangleDistance([-1, -1, 0], tri)).toBeCloseTo(Math.SQRT2);
    expect(pointTriangleDistance([2, 0, 0], tri)).toBeCloseTo(1);
    expect(pointTriangleDistance([-0.5, 0.5, 0], tri)).toBeCloseTo(0.5);
  });
});

describe("closestOnTriangle", () => {
  const tri: [Vec3, Vec3, Vec3] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  it("names the feature the closest point lies on", () => {
    expect(closestOnTriangle([0.2, 0.2, 1], tri).feature).toEqual([0, 1, 2]);
    expect(closestOnTriangle([0.5, -1, 0], tri).feature).toEqual([0, 1]);
    expect(closestOnTriangle([1, 1, 0], tri).feature).toEqual([1, 2]);
    expect(closestOnTriangle([-1, 0.5, 0], tri).feature).toEqual([0, 2]);
    expect(closestOnTriangle([2, -1, 0], tri).feature).toEqual([1]);
  });
});

describe("closestOnTriangle point", () => {
  it("returns the closest point itself", () => {
    const tri: [Vec3, Vec3, Vec3] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
    const round = (p: Vec3) => p.map((x) => +x.toFixed(6));
    expect(round(closestOnTriangle([0.2, 0.3, 1], tri).point)).toEqual([0.2, 0.3, 0]);
    expect(round(closestOnTriangle([0.5, -1, 0], tri).point)).toEqual([0.5, 0, 0]);
    expect(round(closestOnTriangle([2, 2, 0], tri).point)).toEqual([0.5, 0.5, 0]);
  });
});
