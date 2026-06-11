import { describe, expect, it } from "vitest";

import { mapStateSchema } from "@/lib/domain/schemas";
import { isCoordinateInSfBounds } from "@/lib/map/sf-bounds";
import { seedMapState } from "@/lib/map/seed-data";

describe("seedMapState", () => {
  it("validates with mapStateSchema", () => {
    expect(() => mapStateSchema.parse(seedMapState)).not.toThrow();
  });

  it("contains exactly the expected seed zone IDs", () => {
    expect(seedMapState.zones.map((zone) => zone.id).sort()).toEqual([
      "lower-haight-duboce-hayes",
      "lower-pac-heights",
      "marina-cow-hollow",
      "mission-dolores-valencia",
      "nob-hill-polk-gulch",
      "panhandle-nopa",
      "van-ness-lower-russian-hill",
    ]);
  });

  it("keeps all target points inside SF bounds", () => {
    for (const target of seedMapState.targets) {
      expect(isCoordinateInSfBounds(target.coordinates)).toBe(true);
    }
  });
});
