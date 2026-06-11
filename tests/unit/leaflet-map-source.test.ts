import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("leaflet map target marker persistence wiring", () => {
  it("uses the shared edited-layer persistence path without an extra target dragend handler", () => {
    const source = readFileSync(
      new URL("../../components/apartment-map/leaflet-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("persistTargetPosition");
    expect(source).not.toContain('eventHandlers={{ dragend');
  });
});
