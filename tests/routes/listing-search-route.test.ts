import { describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/ai/listing-search/route";

function createRequest(body: unknown, authorization?: string) {
  return new Request("http://localhost/api/ai/listing-search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}

function createCandidate(index: number, geocodeQuery: string | null = `123${index} Market St`) {
  return {
    id: `candidate-${index}`,
    title: `Candidate ${index}`,
    url: `https://example.com/listings/${index}`,
    sourceDomain: "example.com",
    neighborhoodGuess: "Lower Pac Heights",
    locationText: geocodeQuery,
    geocodeQuery,
    locationConfidence: "medium",
    coordinates: null,
    geocodeStatus: "not_attempted",
    markerPrecision: "none",
    priceMonthly: 2600 + index,
    beds: "studio",
    shortTermSignal: index % 2 === 0,
    furnishedSignal: false,
    fitScore: 4,
    whyItFits: `Candidate ${index} fits because it is close to transit and fitness options.`,
    citations: [
      {
        url: `https://example.com/listings/${index}`,
        title: `Listing ${index}`,
        sourceDomain: "example.com",
      },
    ],
    caveats: [`Caveat ${index}`],
  };
}

function mockOpenAiResponse(body: unknown, init?: ResponseInit) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body), init));
}

describe("POST /api/ai/listing-search", () => {
  it("returns 401 when Authorization bearer key is missing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const response = await POST(
      createRequest({
        query: "Find furnished studios near Fillmore.",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "OpenAI key required.",
    });
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves whyItFits and citations from structured output", async () => {
    const structuredOutput = {
      candidates: [createCandidate(1, "1231 Market St")],
      sourceSummary: "One source matched the search.",
      citations: [
        {
          url: "https://example.com/listings/1",
          title: "Listing 1",
          sourceDomain: "example.com",
        },
      ],
      caveats: ["Inventory can change quickly."],
      geocodeAuthorization: null,
    };
    mockOpenAiResponse({ output_text: JSON.stringify(structuredOutput) });

    const response = await POST(
      createRequest({ query: "Find furnished studios near Fillmore." }, "Bearer sk-test-listing"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.candidates[0].whyItFits).toBe(
      "Candidate 1 fits because it is close to transit and fitness options.",
    );
    expect(body.candidates[0].citations).toEqual(structuredOutput.candidates[0].citations);
    expect(body.citations).toEqual(structuredOutput.citations);
    expect(body.sourceSummary).toBe(structuredOutput.sourceSummary);
    expect(body.caveats).toEqual(structuredOutput.caveats);
  });

  it("requires hosted web search and disables storage in the OpenAI request", async () => {
    const structuredOutput = {
      candidates: [],
      sourceSummary: "No matching listings were found.",
      citations: [],
      caveats: ["Try a broader query."],
      geocodeAuthorization: null,
    };
    const fetchMock = mockOpenAiResponse({ output_text: JSON.stringify(structuredOutput) });

    const response = await POST(
      createRequest(
        {
          query: "Find furnished studios near Fillmore.",
          selectedContext: {
            zones: [{ id: "lower-pac-heights", name: "Lower Pac Heights" }],
            corridors: [{ id: "fillmore", name: "Fillmore", priority: "high" }],
          },
        },
        "Bearer sk-test-listing",
      ),
    );
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const userMessage = JSON.parse(payload.input[1].content);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      model: "gpt-5.5",
      store: false,
      tools: [{ type: "web_search" }],
      tool_choice: "required",
      text: {
        format: {
          type: "json_schema",
          strict: true,
        },
      },
    });
    expect(userMessage.selectedContext).toEqual({
      zones: [{ id: "lower-pac-heights", name: "Lower Pac Heights" }],
      corridors: [{ id: "fillmore", name: "Fillmore", priority: "high" }],
    });
  });

  it("mints geocode authorization for at most 10 geocodeable candidates", async () => {
    vi.stubEnv("GEOCODE_NONCE_SECRET", "test-secret");
    const structuredOutput = {
      candidates: Array.from({ length: 12 }, (_, index) =>
        createCandidate(index + 1, `${1000 + index} Fillmore St`),
      ),
      sourceSummary: "Several sources matched the search.",
      citations: [],
      caveats: [],
      geocodeAuthorization: null,
    };
    mockOpenAiResponse({ output_text: JSON.stringify(structuredOutput) });

    const response = await POST(
      createRequest({ query: "Find studios near Fillmore." }, "Bearer sk-test-listing"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.geocodeAuthorization).toEqual(
      expect.objectContaining({
        nonce: expect.any(String),
        expiresAt: expect.any(String),
        maxAttempts: 10,
        allowedQueries: expect.any(Array),
      }),
    );
    expect(body.geocodeAuthorization.allowedQueries).toHaveLength(10);
    expect(body.geocodeAuthorization.allowedQueries.map((query: { candidateId: string }) => query.candidateId))
      .toEqual(Array.from({ length: 10 }, (_, index) => `candidate-${index + 1}`));
  });

  it("normalizes model-supplied coordinates so only guarded geocoding can create pins", async () => {
    vi.stubEnv("GEOCODE_NONCE_SECRET", "test-secret");
    const candidate = {
      ...createCandidate(1, "Fillmore and California"),
      coordinates: [-122.433, 37.789],
      geocodeStatus: "geocoded_exact",
      markerPrecision: "exact",
    };
    mockOpenAiResponse({
      output_text: JSON.stringify({
        candidates: [candidate],
        sourceSummary: "One source matched the search.",
        citations: [],
        caveats: [],
        geocodeAuthorization: null,
      }),
    });

    const response = await POST(
      createRequest({ query: "Find studios near Fillmore." }, "Bearer sk-test-listing"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.candidates[0]).toMatchObject({
      coordinates: null,
      geocodeStatus: "not_attempted",
      markerPrecision: "none",
    });
    expect(body.geocodeAuthorization.allowedQueries).toHaveLength(1);
  });
});
