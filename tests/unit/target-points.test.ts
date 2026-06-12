import { describe, expect, it } from "vitest";

import {
  formatTargetLabel,
  targetRadiusMeters,
} from "@/lib/map/target-points";

describe("target point helpers", () => {
  it("formats purpose and location labels", () => {
    expect(formatTargetLabel({ purpose: "favorite block", name: "Valencia & 20th" })).toBe(
      "favorite block · Valencia & 20th",
    );
  });

  it("deduplicates migrated purpose and name labels", () => {
    expect(formatTargetLabel({ purpose: "Valencia & 20th", name: "Valencia & 20th" })).toBe(
      "Valencia & 20th",
    );
  });

  it("uses 80 meters per walking minute for planning rings", () => {
    expect(targetRadiusMeters({ radiusMinutes: 15 })).toBe(1200);
  });
});
