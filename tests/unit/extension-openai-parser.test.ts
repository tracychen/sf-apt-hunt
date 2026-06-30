import { beforeEach, describe, expect, test, vi } from "vitest";

import { parseHousingDetailsWithOpenAI } from "../../extension/openai-parser.js";

type FetchCall = [input: RequestInfo | URL, init?: RequestInit];

describe("extension OpenAI parser", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      listingType: "private_room",
                      tenancyType: "sublet",
                      priceMonthly: 1800,
                      bedrooms: 2,
                      bathroom: "shared",
                      roommateCount: 2,
                      locationText: "Hayes Valley",
                      neighborhoodGuess: "Hayes Valley",
                      availabilityStart: "2026-07-15",
                      availabilityEnd: "2026-10-15",
                      dateFlexibility: "flexible",
                      durationText: "3 months",
                      furnished: true,
                      pets: "unknown",
                      notes: ["Utilities not confirmed"],
                    }),
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
  });

  test("requests strict structured housing details with store false", async () => {
    const result = await parseHousingDetailsWithOpenAI({
      apiKey: "sk-test",
      capturedText: "Room in Hayes Valley, $1800, available July 15.",
      sourceGroupName: "SF Housing",
    });

    expect(result.ok).toBe(true);
    if (!result.ok || !result.details) {
      throw new Error("Expected housing details parse result");
    }

    expect(result.details.priceMonthly).toBe(1800);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer sk-test",
        }),
      }),
    );
    const fetchInit = readFirstFetchInit();
    const body = JSON.parse(String(fetchInit.body));
    expect(body.store).toBe(false);
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.strict).toBe(true);
  });

  test("rejects structured output that does not narrow to housing details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      listingType: "private_room",
                      tenancyType: "sublet",
                      priceMonthly: "1800",
                      bedrooms: 2,
                      bathroom: "shared",
                      roommateCount: 2,
                      locationText: "Hayes Valley",
                      neighborhoodGuess: "Hayes Valley",
                      availabilityStart: "2026-07-15",
                      availabilityEnd: "2026-10-15",
                      dateFlexibility: "flexible",
                      durationText: "3 months",
                      furnished: true,
                      pets: "unknown",
                      notes: ["Utilities not confirmed"],
                    }),
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const result = await parseHousingDetailsWithOpenAI({
      apiKey: "sk-test",
      capturedText: "Room in Hayes Valley, $1800, available July 15.",
      sourceGroupName: "SF Housing",
    });

    expect(result).toEqual({
      ok: false,
      error: "invalid_structured_output",
    });
  });
});

function readFirstFetchInit(): RequestInit {
  const mockedFetch = fetch as typeof fetch & { mock: { calls: FetchCall[] } };
  const fetchInit = mockedFetch.mock.calls[0]?.[1];

  if (!fetchInit?.body) {
    throw new Error("Expected fetch to be called with a request body");
  }

  return fetchInit;
}
