import { describe, expect, it } from "vitest";
import { cm, sidePolygon } from "./cow";

describe("cow body helpers", () => {
  it("maps side-view centimetres to pack metres (z forward, y up, x to the left)", () => {
    expect(cm(50, 140, -10)).toEqual([-0.1, 1.4, 0.5]);
  });

  it("measures signed distances to a side-view polygon", () => {
    const square = sidePolygon([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(square([0, 0.05, 0.05])).toBeCloseTo(-0.05);
    expect(square([0.3, 0.05, 0.15])).toBeCloseTo(0.05);
  });
});
