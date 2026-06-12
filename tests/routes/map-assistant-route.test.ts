import { describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/ai/map-assistant/route";
import { seedMapState } from "@/lib/map/seed-data";

function createRequest(body: unknown, authorization?: string) {
  return new Request("http://localhost/api/ai/map-assistant", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}

function mockOpenAiResponse(body: unknown, init?: ResponseInit) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body), init));
}

describe("POST /api/ai/map-assistant", () => {
  it("returns 401 when Authorization bearer key is missing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const response = await POST(
      createRequest({
        message: "Add a note about Lower Pac Heights.",
        mapState: seedMapState,
      }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "OpenAI key required.",
    });
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends store false to OpenAI and parses a valid proposal response", async () => {
    const proposalResponse = {
      explanation: "I found one map update worth reviewing.",
      intent: "map_edit",
      proposal: {
        summary: "Add a renter note to Lower Pac Heights.",
        operations: [
          {
            type: "addNote",
            entityId: "lower-pac-heights",
            note: "Watch for studio listings near Fillmore with good bus access.",
          },
        ],
        confidence: "high",
        requiresUserReview: true,
      },
      confidence: "high",
      caveats: ["Review before applying."],
    };
    const fetchMock = mockOpenAiResponse({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify(proposalResponse),
            },
          ],
        },
      ],
    });

    const response = await POST(
      createRequest(
        {
          message: "Add a note about Lower Pac Heights.",
          mapState: seedMapState,
          selectedZoneIds: ["lower-pac-heights"],
        },
        "Bearer sk-test-map",
      ),
    );
    const body = await response.json();
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(response.status).toBe(200);
    expect(body).toEqual(proposalResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer sk-test-map",
          "content-type": "application/json",
        }),
      }),
    );
    expect(payload).toMatchObject({
      model: "gpt-5.5",
      store: false,
      text: {
        format: {
          type: "json_schema",
          strict: true,
        },
      },
    });
    expect(JSON.stringify(payload)).toContain(
      '"required":["type","zoneId","fitnessScore","affordabilityScore","carFreeScore"]',
    );
    expect(JSON.stringify(payload)).toContain(
      '"fitnessScore":{"anyOf":[{"enum":[1,2,3,4,5]},{"type":"null"}]}',
    );
    expect(JSON.stringify(payload)).toContain('"type":{"const":"updateTargetPlanningFields"}');
    expect(JSON.stringify(payload)).toContain(
      '"purpose":{"anyOf":[{"type":"string","minLength":1,"maxLength":2000},{"type":"null"}]}',
    );
  });

  it("parses addTarget proposals with target planning fields", async () => {
    const proposalResponse = {
      explanation: "I found one new target worth reviewing.",
      intent: "map_edit",
      proposal: {
        summary: "Add a Divisadero grocery target.",
        operations: [
          {
            type: "addTarget",
            target: {
              id: "divisadero-grocery",
              name: "Divisadero grocery",
              purpose: "easy grocery run",
              coordinates: [-122.437, 37.776],
              priority: "medium",
              influence: "positive",
              radiusMinutes: 10,
              notes: ["Useful errand anchor for NOPA."],
            },
          },
        ],
        confidence: "medium",
        requiresUserReview: true,
      },
      confidence: "medium",
      caveats: [],
    };
    mockOpenAiResponse({ output_text: JSON.stringify(proposalResponse) });

    const response = await POST(
      createRequest(
        {
          message: "Add a grocery target near Divisadero.",
          mapState: seedMapState,
        },
        "Bearer sk-test-map",
      ),
    );

    await expect(response.json()).resolves.toEqual(proposalResponse);
    expect(response.status).toBe(200);
  });

  it("normalizes null updateTargetPlanningFields fields from structured output", async () => {
    mockOpenAiResponse({
      output_text: JSON.stringify({
        explanation: "I found one target update worth reviewing.",
        intent: "prioritization",
        proposal: {
          summary: "Update Valencia target purpose.",
          operations: [
            {
              type: "updateTargetPlanningFields",
              targetId: "valencia-20th",
              name: null,
              purpose: "favorite block",
              influence: null,
              priority: null,
              radiusMinutes: 15,
              notes: null,
              reason: "The pin should carry planning context.",
            },
          ],
          confidence: "medium",
          requiresUserReview: true,
        },
        confidence: "medium",
        caveats: [],
      }),
    });

    const response = await POST(
      createRequest(
        {
          message: "Make Valencia a favorite block target.",
          mapState: seedMapState,
        },
        "Bearer sk-test-map",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.proposal.operations).toEqual([
      {
        type: "updateTargetPlanningFields",
        targetId: "valencia-20th",
        purpose: "favorite block",
        radiusMinutes: 15,
        reason: "The pin should carry planning context.",
      },
    ]);
  });

  it("normalizes null updateZoneScores fields from structured output", async () => {
    mockOpenAiResponse({
      output_text: JSON.stringify({
        explanation: "I found one score update worth reviewing.",
        intent: "prioritization",
        proposal: {
          summary: "Update affordability only.",
          operations: [
            {
              type: "updateZoneScores",
              zoneId: "lower-pac-heights",
              fitnessScore: null,
              affordabilityScore: 4,
              carFreeScore: null,
            },
          ],
          confidence: "medium",
          requiresUserReview: true,
        },
        confidence: "medium",
        caveats: [],
      }),
    });

    const response = await POST(
      createRequest(
        {
          message: "Update Lower Pac Heights affordability.",
          mapState: seedMapState,
        },
        "Bearer sk-test-map",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.proposal.operations).toEqual([
      {
        type: "updateZoneScores",
        zoneId: "lower-pac-heights",
        affordabilityScore: 4,
      },
    ]);
  });

  it("rejects oversized request bodies before calling OpenAI", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const response = await POST(
      createRequest(
        {
          message: "x".repeat(300_000),
          mapState: seedMapState,
        },
        "Bearer sk-test-map",
      ),
    );

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Map assistant request is too large.",
    });
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects structured output with an unsupported intent", async () => {
    mockOpenAiResponse({
      output_text: JSON.stringify({
        explanation: "I found one map update worth reviewing.",
        intent: "add_note",
        proposal: null,
        confidence: "medium",
        caveats: [],
      }),
    });

    const response = await POST(
      createRequest(
        {
          message: "Add a note about Lower Pac Heights.",
          mapState: seedMapState,
        },
        "Bearer sk-test-map",
      ),
    );

    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Invalid map assistant request.",
    });
    expect(response.status).toBe(400);
  });
});
