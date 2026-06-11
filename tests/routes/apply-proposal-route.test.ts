import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/map/apply-proposal/route";
import { seedMapState } from "@/lib/map/seed-data";

function createRequest(body: unknown) {
  return new Request("http://localhost/api/map/apply-proposal", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/map/apply-proposal", () => {
  it("returns the updated map state for a valid proposal", async () => {
    const response = await POST(
      createRequest({
        mapState: seedMapState,
        proposal: {
          summary: "Increase car-free confidence for Lower Pac Heights.",
          operations: [
            {
              type: "updateZoneScores",
              zoneId: "lower-pac-heights",
              carFreeScore: 5,
            },
          ],
          confidence: "high",
          requiresUserReview: true,
        },
      }),
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true });
    expect(
      body.state.zones.find((zone: { id: string }) => zone.id === "lower-pac-heights")
        ?.carFreeScore,
    ).toBe(5);
  });

  it("rejects proposals for unknown zone IDs", async () => {
    const response = await POST(
      createRequest({
        mapState: seedMapState,
        proposal: {
          summary: "Update a zone that is not in the map.",
          operations: [
            {
              type: "updateZoneScores",
              zoneId: "not-a-real-zone",
              carFreeScore: 5,
            },
          ],
          confidence: "low",
          requiresUserReview: true,
        },
      }),
    );

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      ok: false,
      error: "Unknown zone ID.",
    });
  });
});
