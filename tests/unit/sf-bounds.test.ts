import { describe, expect, it } from "vitest";

import {
  isCoordinateInSfBounds,
  isLineStringInSfBounds,
  isPolygonInSfBounds,
} from "@/lib/map/sf-bounds";

describe("sf bounds", () => {
  it("accepts coordinates inside San Francisco", () => {
    expect(isCoordinateInSfBounds([-122.42, 37.77])).toBe(true);
  });

  it("rejects coordinates outside San Francisco", () => {
    expect(isCoordinateInSfBounds([-73.98, 40.74])).toBe(false);
  });

  it("accepts a LineString fully within San Francisco", () => {
    expect(
      isLineStringInSfBounds({
        type: "LineString",
        coordinates: [
          [-122.421, 37.752],
          [-122.421, 37.769],
        ],
      }),
    ).toBe(true);
  });

  it("rejects an empty LineString", () => {
    expect(
      isLineStringInSfBounds({ type: "LineString", coordinates: [] }),
    ).toBe(false);
  });

  it("rejects a single-point LineString", () => {
    expect(
      isLineStringInSfBounds({ type: "LineString", coordinates: [[-122.42, 37.77]] }),
    ).toBe(false);
  });

  it("rejects a LineString with any point outside San Francisco", () => {
    expect(
      isLineStringInSfBounds({
        type: "LineString",
        coordinates: [
          [-122.421, 37.752],
          [-73.98, 40.74],
        ],
      }),
    ).toBe(false);
  });

  it("rejects an empty polygon", () => {
    expect(isPolygonInSfBounds({ type: "Polygon", coordinates: [] })).toBe(false);
  });
});
