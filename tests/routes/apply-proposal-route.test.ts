import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/map/apply-proposal/route";
import type { MapState, TargetPoint } from "@/lib/domain/types";
import { seedMapState } from "@/lib/map/seed-data";

function createRequest(body: unknown) {
  return createRawRequest(JSON.stringify(body));
}

function createRawRequest(body: string) {
  return new Request("http://localhost/api/map/apply-proposal", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body,
  });
}

function createStateAtTargetLimit(): MapState {
  const fillerTargets: TargetPoint[] = Array.from(
    { length: 200 - seedMapState.targets.length },
    (_, index) => ({
      id: `limit-target-${index}`,
      name: `Limit Target ${index}`,
      purpose: `Limit Target ${index}`,
      coordinates: [-122.421, 37.758],
      priority: "low",
      influence: "neutral",
      radiusMinutes: 10,
      notes: [],
    }),
  );

  return {
    ...seedMapState,
    targets: [...seedMapState.targets, ...fillerTargets],
  };
}

function createStateWithZoneNotesAtLimit(zoneId: string): MapState {
  return {
    ...seedMapState,
    zones: seedMapState.zones.map((zone) =>
      zone.id === zoneId
        ? {
            ...zone,
            notes: Array.from({ length: 50 }, (_, index) => `Limit note ${index}`),
          }
        : zone,
    ),
  };
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

  it("rejects oversized proposal requests before parsing", async () => {
    const response = await POST(
      createRawRequest(
        JSON.stringify({
          mapState: seedMapState,
          proposal: {
            summary: "Append a large note.",
            operations: [
              {
                type: "addNote",
                entityId: "lower-pac-heights",
                note: "x".repeat(300_000),
              },
            ],
            confidence: "low",
            requiresUserReview: true,
          },
        }),
      ),
    );

    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body).toEqual({
      ok: false,
      error: "Proposal request is too large.",
    });
  });

  it("rejects addTarget proposals that would exceed map limits", async () => {
    const response = await POST(
      createRequest({
        mapState: createStateAtTargetLimit(),
        proposal: {
          summary: "Add one more target.",
          operations: [
            {
              type: "addTarget",
              target: {
                id: "target-over-limit",
                name: "Target Over Limit",
                purpose: "Target over limit",
                coordinates: [-122.421, 37.758],
                priority: "low",
                influence: "neutral",
                radiusMinutes: 10,
                notes: [],
              },
            },
          ],
          confidence: "medium",
          requiresUserReview: true,
        },
      }),
    );

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      ok: false,
      error: "Proposal exceeds map limits.",
    });
  });

  it("rejects addNote proposals that would exceed map limits", async () => {
    const response = await POST(
      createRequest({
        mapState: createStateWithZoneNotesAtLimit("lower-pac-heights"),
        proposal: {
          summary: "Add one more zone note.",
          operations: [
            {
              type: "addNote",
              entityId: "lower-pac-heights",
              note: "One note too many.",
            },
          ],
          confidence: "medium",
          requiresUserReview: true,
        },
      }),
    );

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      ok: false,
      error: "Proposal exceeds map limits.",
    });
  });
});
