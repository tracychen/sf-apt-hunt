import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/ai/map-assistant/route";
import { seedMapState } from "@/lib/map/seed-data";
import { geocodeListingLocation } from "@/lib/server/google-geocode";
import { checkFixedWindowRateLimit, createRedisFromEnv } from "@/lib/server/rate-limit";

vi.mock("@/lib/server/google-geocode", () => ({
  geocodeListingLocation: vi.fn(),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkFixedWindowRateLimit: vi.fn(),
  createRedisFromEnv: vi.fn(),
}));

const geocodeListingLocationMock = vi.mocked(geocodeListingLocation);
const checkFixedWindowRateLimitMock = vi.mocked(checkFixedWindowRateLimit);
const createRedisFromEnvMock = vi.mocked(createRedisFromEnv);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  geocodeListingLocationMock.mockReset();
  checkFixedWindowRateLimitMock.mockReset();
  createRedisFromEnvMock.mockReset();
  createRedisFromEnvMock.mockReturnValue(null);
  checkFixedWindowRateLimitMock.mockResolvedValue({
    ok: true,
    remaining: 49,
    resetAt: new Date("2026-06-18T12:00:00.000Z"),
  });
});

function createRequest(
  body: unknown,
  authorization?: string,
  headers: Record<string, string> = {},
) {
  return new Request("http://localhost/api/ai/map-assistant", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
      ...headers,
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
    const expectedOutcome = {
      kind: "proposal",
      assistantMessage: proposalResponse.explanation,
      proposal: proposalResponse.proposal,
      researchSummary: {
        items: [],
        exclusions: [],
        caveats: proposalResponse.caveats,
      },
    };

    expect(response.status).toBe(200);
    expect(body).toEqual(expectedOutcome);
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
      tools: [{ type: "web_search" }],
      text: {
        format: {
          type: "json_schema",
          strict: true,
        },
      },
    });
    expect(payload.text.format.schema.type).toBe("object");
    expect(payload.text.format.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: expect.arrayContaining([
        "kind",
        "assistantMessage",
        "missingInformation",
        "proposal",
        "targetCandidates",
        "corridorCandidates",
        "caveats",
      ]),
    });
    expect(JSON.stringify(payload.text.format.schema)).not.toContain('"oneOf"');
    expect(payload.text.format.schema).not.toHaveProperty("anyOf");
    expect(JSON.stringify(payload.text.format.schema)).not.toContain('"const"');
    expect(JSON.stringify(payload)).toContain(
      '"required":["type","zoneId","fitnessScore","affordabilityScore","carFreeScore"]',
    );
    expect(JSON.stringify(payload)).toContain(
      '"fitnessScore":{"anyOf":[{"enum":[1,2,3,4,5]},{"type":"null"}]}',
    );
    expect(JSON.stringify(payload)).toContain('"type":{"enum":["updateTargetPlanningFields"]}');
    expect(JSON.stringify(payload)).toContain(
      '"required":["type","targetId","name","purpose","influence","priority","radiusMinutes","notes","reason"]',
    );
    expect(JSON.stringify(payload)).toContain(
      '"reason":{"type":"string","minLength":1,"maxLength":2000}',
    );
    expect(JSON.stringify(payload)).toContain('"type":{"enum":["updateCorridorPriority"]}');
    expect(JSON.stringify(payload)).toContain(
      '"purpose":{"anyOf":[{"type":"string","minLength":1,"maxLength":2000},{"type":"null"}]}',
    );
  });

  it("preserves the proposal response shape for successful assistant outcomes", async () => {
    mockOpenAiResponse({
      output_text: JSON.stringify({
        kind: "proposal",
        assistantMessage: "I found one map update worth reviewing.",
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
        targetCandidates: [],
        corridorCandidates: [],
        caveats: ["Review before applying."],
      }),
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

    expect(response.status).toBe(200);
    expect(body.kind === "proposal" || body.kind === "needsMoreInfo" || body.kind === "noAction").toBe(
      true,
    );
    expect(body).toMatchObject({
      kind: "proposal",
      proposal: expect.objectContaining({
        summary: "Add a renter note to Lower Pac Heights.",
        operations: expect.any(Array),
      }),
      researchSummary: expect.objectContaining({
        items: expect.any(Array),
        exclusions: expect.any(Array),
        caveats: ["Review before applying."],
      }),
    });
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

    await expect(response.json()).resolves.toEqual({
      kind: "proposal",
      assistantMessage: proposalResponse.explanation,
      proposal: proposalResponse.proposal,
      researchSummary: {
        items: [],
        exclusions: [],
        caveats: proposalResponse.caveats,
      },
    });
    expect(response.status).toBe(200);
  });

  it("returns needsMoreInfo outcomes without opening a proposal path", async () => {
    const assistantResponse = {
      kind: "needsMoreInfo",
      assistantMessage: "Which area should I search?",
      missingInformation: ["where to search"],
      proposal: null,
      targetCandidates: null,
      corridorCandidates: null,
      caveats: null,
    };
    mockOpenAiResponse({ output_text: JSON.stringify(assistantResponse) });

    const response = await POST(
      createRequest(
        {
          message: "Add all locations.",
          mapState: seedMapState,
        },
        "Bearer sk-test-map",
      ),
    );

    await expect(response.json()).resolves.toEqual({
      kind: "needsMoreInfo",
      assistantMessage: "Which area should I search?",
      missingInformation: ["where to search"],
    });
    expect(response.status).toBe(200);
    expect(geocodeListingLocationMock).not.toHaveBeenCalled();
  });

  it("geocodes researched target candidates and returns sourced addTarget proposals", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "google-key");
    geocodeListingLocationMock.mockResolvedValue({
      status: "ok",
      coordinates: [-122.409, 37.789],
      markerPrecision: "exact",
      formattedAddress: "123 Battery St, San Francisco, CA 94111, USA",
    });
    mockOpenAiResponse({
      output_text: JSON.stringify({
        kind: "proposal",
        assistantMessage: "I found one Orange Theory location for review.",
        proposal: {
          summary: "Add researched Orange Theory pins.",
          operations: [],
          confidence: "high",
          requiresUserReview: true,
        },
        targetCandidates: [
          {
            id: "orange-theory-financial-district",
            name: "Orangetheory Fitness Financial District",
            address: "123 Battery St, San Francisco, CA",
            geocodeQuery: "Orangetheory Fitness Financial District, San Francisco, CA",
            source: {
              url: "https://www.orangetheory.com/en-us/locations/california/san-francisco",
              title: "Orangetheory San Francisco",
              sourceDomain: "orangetheory.com",
            },
            purpose: "fitness studio",
            influence: "positive",
            priority: "high",
            radiusMinutes: 10,
            confidence: "high",
            caveats: ["Confirm current class schedule."],
          },
        ],
        corridorCandidates: [],
        caveats: ["Review the source before applying."],
      }),
    });

    const response = await POST(
      createRequest(
        {
          message: "Create pins for all Orange Theory locations in SF.",
          mapState: seedMapState,
        },
        "Bearer sk-test-map",
        { "x-sf-apt-session": "session-1", "x-forwarded-for": "203.0.113.10" },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(geocodeListingLocationMock).toHaveBeenCalledWith({
      apiKey: "google-key",
      query: "Orangetheory Fitness Financial District, San Francisco, CA",
    });
    expect(body).toMatchObject({
      kind: "proposal",
      assistantMessage: "I found one Orange Theory location for review.",
      proposal: {
        summary: "Add researched Orange Theory pins.",
        operations: [
          {
            type: "addTarget",
            target: {
              id: "target-orange-theory-financial-district",
              name: "Orangetheory Fitness Financial District",
              purpose: "fitness studio",
              coordinates: [-122.409, 37.789],
              priority: "high",
              influence: "positive",
              radiusMinutes: 10,
            },
          },
        ],
      },
      researchSummary: {
        items: [
          {
            entityId: "target-orange-theory-financial-district",
            operationType: "addTarget",
            label: "Orangetheory Fitness Financial District",
            confidence: "high",
            geocodePrecision: "exact",
          },
        ],
        exclusions: [],
        caveats: ["Review the source before applying."],
      },
    });
  });

  it("checks researched geocoding rate limits by IP and session before calling Google", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "google-key");
    const redis = {} as NonNullable<ReturnType<typeof createRedisFromEnv>>;
    createRedisFromEnvMock.mockReturnValue(redis);
    geocodeListingLocationMock.mockResolvedValue({
      status: "ok",
      coordinates: [-122.409, 37.789],
      markerPrecision: "approximate",
      formattedAddress: "123 Battery St, San Francisco, CA 94111, USA",
    });
    mockOpenAiResponse({
      output_text: JSON.stringify({
        kind: "proposal",
        assistantMessage: "I found one researched place.",
        proposal: {
          summary: "Add researched pin.",
          operations: [],
          confidence: "medium",
          requiresUserReview: true,
        },
        targetCandidates: [
          {
            id: "researched-place",
            name: "Researched Place",
            address: null,
            geocodeQuery: "123 Battery St, San Francisco, CA",
            source: {
              url: "https://example.com/place",
              title: "Place",
              sourceDomain: "example.com",
            },
            purpose: "reference",
            influence: "neutral",
            priority: "medium",
            radiusMinutes: 10,
            confidence: "medium",
            caveats: [],
          },
        ],
        corridorCandidates: [],
        caveats: [],
      }),
    });

    const response = await POST(
      createRequest(
        {
          message: "Add the researched place.",
          mapState: seedMapState,
        },
        "Bearer sk-test-map",
        { "x-sf-apt-session": "session-1", "x-forwarded-for": "203.0.113.10" },
      ),
    );

    expect(response.status).toBe(200);
    expect(checkFixedWindowRateLimitMock).toHaveBeenCalledTimes(2);
    expect(checkFixedWindowRateLimitMock).toHaveBeenCalledWith({
      redis,
      key: expect.stringMatching(/^geocode:map-research:ip:/),
      limit: 50,
      windowSeconds: 3600,
    });
    expect(checkFixedWindowRateLimitMock).toHaveBeenCalledWith({
      redis,
      key: expect.stringMatching(/^geocode:map-research:session:/),
      limit: 50,
      windowSeconds: 3600,
    });
    expect(geocodeListingLocationMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed for researched geocoding in production without rate limiting", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "google-key");
    vi.stubEnv("NODE_ENV", "production");
    mockOpenAiResponse({
      output_text: JSON.stringify({
        kind: "proposal",
        assistantMessage: "I found one researched place.",
        proposal: {
          summary: "Add researched pin.",
          operations: [],
          confidence: "medium",
          requiresUserReview: true,
        },
        targetCandidates: [
          {
            id: "researched-place",
            name: "Researched Place",
            address: null,
            geocodeQuery: "123 Battery St, San Francisco, CA",
            source: {
              url: "https://example.com/place",
              title: "Place",
              sourceDomain: "example.com",
            },
            purpose: "reference",
            influence: "neutral",
            priority: "medium",
            radiusMinutes: 10,
            confidence: "medium",
            caveats: [],
          },
        ],
        corridorCandidates: [],
        caveats: [],
      }),
    });

    const response = await POST(
      createRequest(
        {
          message: "Add the researched place.",
          mapState: seedMapState,
        },
        "Bearer sk-test-map",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      kind: "noAction",
      assistantMessage: "I found possible map items, but none passed validation.",
      caveats: ["Rate limiting is not configured."],
    });
    expect(geocodeListingLocationMock).not.toHaveBeenCalled();
  });

  it("converts researched model LineString corridors into approximate addCorridor proposals", async () => {
    mockOpenAiResponse({
      output_text: JSON.stringify({
        kind: "proposal",
        assistantMessage: "I created an approximate corridor for review.",
        proposal: {
          summary: "Add the 1 California bus corridor.",
          operations: [],
          confidence: "medium",
          requiresUserReview: true,
        },
        targetCandidates: [],
        corridorCandidates: [
          {
            id: "muni-1-california",
            name: "1 California bus corridor",
            source: {
              url: "https://www.sfmta.com/routes/1-california",
              title: "1 California",
              sourceDomain: "sfmta.com",
            },
            priority: "high",
            tags: ["transit"],
            notes: ["Planning reference for the 1 California bus."],
            confidence: "medium",
            requestedGeometryQuality: "approximate",
            geometry: {
              kind: "modelLineString",
              coordinates: [
                [-122.447, 37.787],
                [-122.43, 37.79],
                [-122.405, 37.793],
              ],
              caveat: "Approximate route line based on source description.",
            },
            caveats: ["Not navigation-grade geometry."],
          },
        ],
        caveats: [],
      }),
    });

    const response = await POST(
      createRequest(
        {
          message: "Create a corridor where the 1 California bus runs.",
          mapState: seedMapState,
        },
        "Bearer sk-test-map",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.proposal.operations).toEqual([
      {
        type: "addCorridor",
        corridor: {
          id: "corridor-muni-1-california",
          name: "1 California bus corridor",
          geometry: {
            type: "LineString",
            coordinates: [
              [-122.447, 37.787],
              [-122.43, 37.79],
              [-122.405, 37.793],
            ],
          },
          priority: "high",
          tags: ["transit"],
          notes: [
            "Planning reference for the 1 California bus.",
            "Approximate route line based on source description.",
            "Not navigation-grade geometry.",
          ],
        },
      },
    ]);
    expect(body.researchSummary.items[0]).toMatchObject({
      entityId: "corridor-muni-1-california",
      operationType: "addCorridor",
      geometryQuality: "approximate",
    });
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
