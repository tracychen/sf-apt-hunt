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
