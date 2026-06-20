import { describe, expect, it } from "vitest";

import {
  DEFAULT_TILE_ATTRIBUTION,
  DEFAULT_TILE_URL,
  resolveTileConfig,
} from "@/lib/map/tile-config";

describe("tile config", () => {
  it("falls back to the default base map when public tile env vars are blank", () => {
    expect(resolveTileConfig({ tileUrl: "", tileAttribution: "" })).toEqual({
      tileUrl: DEFAULT_TILE_URL,
      tileAttribution: DEFAULT_TILE_ATTRIBUTION,
    });
    expect(resolveTileConfig({ tileUrl: "   ", tileAttribution: "   " })).toEqual({
      tileUrl: DEFAULT_TILE_URL,
      tileAttribution: DEFAULT_TILE_ATTRIBUTION,
    });
  });

  it("uses trimmed custom public tile config when present", () => {
    expect(
      resolveTileConfig({
        tileUrl: " https://tiles.example.test/{z}/{x}/{y}.png ",
        tileAttribution: " Example tiles ",
      }),
    ).toEqual({
      tileUrl: "https://tiles.example.test/{z}/{x}/{y}.png",
      tileAttribution: "Example tiles",
    });
  });
});
