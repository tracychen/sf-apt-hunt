import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  ListingCandidate,
  MapAssistantOutcome,
  MapPatchProposal,
} from "@/lib/domain/types";
import { seedMapState } from "@/lib/map/seed-data";
import { hashInstallationSecret } from "@/lib/server/planning/installation";
import { createMemoryPlanningStore } from "@/lib/server/planning/memory-store";
import type { PlanningStore } from "@/lib/server/planning/store";
import { POST } from "@/app/api/ai/planning-chat/route";
import { runListingSearch } from "@/lib/server/listing-search-service";
import { runMapAssistant } from "@/lib/server/map-assistant-service";

const planningStoreMock = vi.hoisted(() => ({
  current: undefined as PlanningStore | undefined,
}));

vi.mock("@/lib/server/planning/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/planning/store")>();

  return {
    ...actual,
    getPlanningStore: () => {
      if (!planningStoreMock.current) {
        throw new Error("Planning store mock was not initialized.");
      }

      return planningStoreMock.current;
    },
  };
});

vi.mock("@/lib/server/map-assistant-service", () => ({
  MissingStructuredOutputError: class MissingStructuredOutputError extends Error {},
  OpenAiServiceError: class OpenAiServiceError extends Error {},
  runMapAssistant: vi.fn(),
}));

vi.mock("@/lib/server/listing-search-service", () => ({
  MissingStructuredOutputError: class MissingStructuredOutputError extends Error {},
  OpenAiServiceError: class OpenAiServiceError extends Error {},
  runListingSearch: vi.fn(),
}));

const runMapAssistantMock = vi.mocked(runMapAssistant);
const runListingSearchMock = vi.mocked(runListingSearch);

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/ai/planning-chat", {
    method: "POST",
    headers: {
      authorization: "Bearer test-key",
      "content-type": "application/json",
      "x-sf-apt-installation-secret": "secret-1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function createPlanningRequest(message: string, overrides: Record<string, unknown> = {}) {
  return {
    threadId: null,
    clientInstallationId: "install-1",
    message,
    mapState: seedMapState,
    mapRevision: null,
    listingLedgerRevision: null,
    selectedEntity: null,
    visibleContext: null,
    ...overrides,
  };
}

describe("POST /api/ai/planning-chat", () => {
  beforeEach(() => {
    planningStoreMock.current = createMemoryPlanningStore();
    runMapAssistantMock.mockReset();
    runListingSearchMock.mockReset();
  });

  test("requires OpenAI key", async () => {
    const response = await POST(
      createRequest(createPlanningRequest("Find listings"), { authorization: "" }),
    );

    expect(response.status).toBe(401);
    expect(runMapAssistantMock).not.toHaveBeenCalled();
    expect(runListingSearchMock).not.toHaveBeenCalled();
  });

  test("requires installation secret header", async () => {
    const response = await POST(
      createRequest(createPlanningRequest("Find listings"), {
        "x-sf-apt-installation-secret": "",
      }),
    );

    expect(response.status).toBe(401);
    expect(runMapAssistantMock).not.toHaveBeenCalled();
    expect(runListingSearchMock).not.toHaveBeenCalled();
  });

  test("rejects installation secrets serialized in the JSON body", async () => {
    const response = await POST(
      createRequest(
        createPlanningRequest("Find listings", {
          clientInstallationSecret: "secret-1",
        }),
      ),
    );

    expect(response.status).toBe(400);
    expect(runMapAssistantMock).not.toHaveBeenCalled();
    expect(runListingSearchMock).not.toHaveBeenCalled();
  });

  test("returns a renderable assistant message and map snapshot", async () => {
    runMapAssistantMock.mockResolvedValue(createMapProposalOutcome());

    const response = await POST(
      createRequest(createPlanningRequest("Add pins for Solidcore in SF")),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assistantMessage.parts.length).toBeGreaterThan(0);
    expect(body.mapSnapshot.mapState).toEqual(seedMapState);
    expect(Array.isArray(body.actionRecords)).toBe(true);
  });

  test("creates a stored map proposal action record for proposal parts", async () => {
    const outcome = createMapProposalOutcome();
    runMapAssistantMock.mockResolvedValue(outcome);

    const response = await POST(
      createRequest(createPlanningRequest("Add pins for Solidcore in SF")),
    );
    const body = await response.json();
    const proposalPart = body.assistantMessage.parts.find(
      (part: { type: string }) => part.type === "mapProposal",
    );

    expect(response.status).toBe(200);
    expect(proposalPart).toMatchObject({
      type: "mapProposal",
      proposal: outcome.proposal,
      researchSummary: outcome.researchSummary,
    });
    expect(body.actionRecords).toHaveLength(1);
    expect(body.actionRecords[0]).toMatchObject({
      id: proposalPart.actionId,
      kind: "mapProposal",
      status: "pending",
      target: {
        kind: "mapProposal",
        proposalHash: expect.any(String),
        allowedOperationIndexes: [0],
        mapRevision: body.mapSnapshot.revision,
      },
    });
  });

  test("syncs an edited existing thread snapshot before running assistant context", async () => {
    const store = getTestStore();
    const created = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });

    if (!created.ok) {
      throw new Error(`Failed to create thread: ${created.error}`);
    }

    const updatedMapState = {
      ...seedMapState,
      targets: [
        ...seedMapState.targets,
        {
          id: "edited-target",
          name: "Edited target",
          purpose: "fitness",
          coordinates: [-122.42, 37.77] as [number, number],
          priority: "medium" as const,
          influence: "positive" as const,
          radiusMinutes: 10 as const,
          notes: [],
        },
      ],
    };

    runMapAssistantMock.mockImplementation(async (input) => {
      expect(input.mapState).toEqual(updatedMapState);
      return createMapProposalOutcome();
    });

    const response = await POST(
      createRequest(
        createPlanningRequest("Add pins for Solidcore in SF", {
          threadId: created.thread.id,
          mapState: updatedMapState,
          mapRevision: created.mapSnapshot.revision,
        }),
      ),
    );
    const body = await response.json();
    const storedSnapshot = await store.getMapSnapshot(created.thread.id);

    expect(response.status).toBe(200);
    expect(body.mapSnapshot.mapState).toEqual(updatedMapState);
    expect(storedSnapshot?.mapState).toEqual(updatedMapState);
    expect(storedSnapshot?.revision).not.toBe(created.mapSnapshot.revision);
    expect(runListingSearchMock).not.toHaveBeenCalled();
  });

  test("rejects stale map revisions before syncing an edited thread snapshot", async () => {
    const store = getTestStore();
    const created = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });

    if (!created.ok) {
      throw new Error(`Failed to create thread: ${created.error}`);
    }

    const updatedMapState = {
      ...seedMapState,
      targets: [
        ...seedMapState.targets,
        {
          id: "edited-target",
          name: "Edited target",
          purpose: "fitness",
          coordinates: [-122.42, 37.77] as [number, number],
          priority: "medium" as const,
          influence: "positive" as const,
          radiusMinutes: 10 as const,
          notes: [],
        },
      ],
    };

    const response = await POST(
      createRequest(
        createPlanningRequest("Add pins for Solidcore in SF", {
          threadId: created.thread.id,
          mapState: updatedMapState,
          mapRevision: "map-rev-stale",
        }),
      ),
    );
    const storedSnapshot = await store.getMapSnapshot(created.thread.id);

    expect(response.status).toBe(409);
    expect(runMapAssistantMock).not.toHaveBeenCalled();
    expect(runListingSearchMock).not.toHaveBeenCalled();
    expect(storedSnapshot?.mapState).toEqual(seedMapState);
  });

  test("checks existing thread ownership with the installation secret header", async () => {
    const store = getTestStore();
    const created = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });

    if (!created.ok) {
      throw new Error(`Failed to create thread: ${created.error}`);
    }

    const response = await POST(
      createRequest(
        createPlanningRequest("Add pins for Solidcore in SF", {
          threadId: created.thread.id,
          mapRevision: created.mapSnapshot.revision,
        }),
        { "x-sf-apt-installation-secret": "secret-2" },
      ),
    );

    expect(response.status).toBe(403);
    expect(runMapAssistantMock).not.toHaveBeenCalled();
    expect(runListingSearchMock).not.toHaveBeenCalled();
  });

  test("returns hydrated listing cards with geocode authorization and listing actions", async () => {
    const geocodeAuthorization = {
      nonce: "nonce-1",
      expiresAt: "2026-06-19T12:10:00.000Z",
      maxAttempts: 1,
      allowedQueries: [{ candidateId: "candidate-1", geocodeQueryHash: "hash-1" }],
    };
    runListingSearchMock.mockResolvedValue({
      candidates: [createListingCandidate()],
      sourceSummary: "One listing matched.",
      citations: [],
      caveats: ["Inventory changes quickly."],
      geocodeAuthorization,
    });

    const response = await POST(
      createRequest(
        createPlanningRequest("Find studio listings under $3000 near Fillmore", {
          visibleContext: {
            budget: 3000,
            beds: "studio",
            timing: "July",
            furnished: false,
            shortTerm: false,
            positiveAnchors: ["Fillmore"],
            avoidAnchors: [],
            selectedZones: ["Lower Pac Heights"],
            sourceStrictness: null,
          },
        }),
      ),
    );
    const body = await response.json();
    const listingPart = body.assistantMessage.parts.find(
      (part: { type: string }) => part.type === "listingResults",
    );
    const expectedListingSnapshotHash = planningStoreMock.current!.hashPayload(
      listingPart.listings[0].lead.candidate,
    );

    expect(response.status).toBe(200);
    expect(listingPart).toMatchObject({
      type: "listingResults",
      sourceSummary: "One listing matched.",
      caveats: ["Inventory changes quickly."],
      geocodeAuthorization,
      listings: [
        {
          lead: {
            canonicalUrl: "https://example.com/listings/1",
            status: "seen",
            candidate: expect.objectContaining({ id: "candidate-1" }),
          },
          display: expect.objectContaining({
            canonicalUrl: "https://example.com/listings/1",
            leadStatus: "seen",
            planningScore: expect.any(Number),
          }),
          saveActionId: expect.any(String),
          dismissActionId: expect.any(String),
        },
      ],
    });
    expect(body.actionRecords).toHaveLength(2);
    expect(body.actionRecords.map((action: { kind: string }) => action.kind).sort()).toEqual([
      "listingDismiss",
      "listingSave",
    ]);
    for (const action of body.actionRecords as Array<{
      kind: string;
      target: {
        kind: string;
        listingLedgerRevision: string;
        listingSnapshotHash: string;
      };
    }>) {
      expect(action.target.kind).toBe("listingLead");
      expect(action.target.listingLedgerRevision).toBe(body.listingLedgerRevision);
      expect(action.target.listingSnapshotHash).toBe(expectedListingSnapshotHash);
    }
  });

  test("uses durable preference memory when a later listing turn omits visible context", async () => {
    runListingSearchMock.mockResolvedValue({
      candidates: [createListingCandidate()],
      sourceSummary: "One listing matched.",
      citations: [],
      caveats: [],
      geocodeAuthorization: null,
    });

    let response = await POST(
      createRequest(
        createPlanningRequest("Need a furnished studio under $3k for July, month-to-month.", {
          visibleContext: null,
        }),
      ),
    );
    let body = await response.json();

    expect(response.status).toBe(200);

    for (let index = 0; index < 4; index += 1) {
      response = await POST(
        createRequest(
          createPlanningRequest(`Show more listings ${index + 1}`, {
            threadId: body.thread.id,
            mapRevision: body.mapSnapshot.revision,
            listingLedgerRevision: body.listingLedgerRevision,
            visibleContext: null,
          }),
        ),
      );
      body = await response.json();
      expect(response.status).toBe(200);
    }

    expect(runListingSearchMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          maxBudget: 3000,
          beds: "studio",
          timing: "July",
          furnished: true,
          shortTerm: true,
        }),
      }),
    );
  });

  test("recognizes hyphenated up-to as a budget cue in durable preference memory", async () => {
    runListingSearchMock.mockResolvedValue({
      candidates: [createListingCandidate()],
      sourceSummary: "One listing matched.",
      citations: [],
      caveats: [],
      geocodeAuthorization: null,
    });

    let response = await POST(
      createRequest(
        createPlanningRequest("Need a furnished studio up-to $3000 for July, month-to-month.", {
          visibleContext: null,
        }),
      ),
    );
    let body = await response.json();

    expect(response.status).toBe(200);

    response = await POST(
      createRequest(
        createPlanningRequest("Show more listings", {
          threadId: body.thread.id,
          mapRevision: body.mapSnapshot.revision,
          listingLedgerRevision: body.listingLedgerRevision,
          visibleContext: null,
        }),
      ),
    );
    body = await response.json();

    expect(response.status).toBe(200);
    expect(runListingSearchMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          maxBudget: 3000,
          beds: "studio",
          timing: "July",
          furnished: true,
          shortTerm: true,
        }),
      }),
    );
  });

  test("does not persist a pet deposit as max budget in durable preference memory", async () => {
    runListingSearchMock.mockResolvedValue({
      candidates: [createListingCandidate()],
      sourceSummary: "One listing matched.",
      citations: [],
      caveats: [],
      geocodeAuthorization: null,
    });

    let response = await POST(
      createRequest(
        createPlanningRequest("Find studio listings with a $500 pet deposit near Fillmore.", {
          visibleContext: null,
        }),
      ),
    );
    let body = await response.json();

    expect(response.status).toBe(200);

    response = await POST(
      createRequest(
        createPlanningRequest("Show more listings", {
          threadId: body.thread.id,
          mapRevision: body.mapSnapshot.revision,
          listingLedgerRevision: body.listingLedgerRevision,
          visibleContext: null,
        }),
      ),
    );
    body = await response.json();

    expect(response.status).toBe(200);
    expect(runListingSearchMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          maxBudget: null,
          beds: "studio",
        }),
      }),
    );
  });

  test("does not persist ambiguous bare may as move timing in durable preference memory", async () => {
    runListingSearchMock.mockResolvedValue({
      candidates: [createListingCandidate()],
      sourceSummary: "One listing matched.",
      citations: [],
      caveats: [],
      geocodeAuthorization: null,
    });

    let response = await POST(
      createRequest(
        createPlanningRequest("Need studio listings. May I see more?", {
          visibleContext: null,
        }),
      ),
    );
    let body = await response.json();

    expect(response.status).toBe(200);

    response = await POST(
      createRequest(
        createPlanningRequest("Show more listings", {
          threadId: body.thread.id,
          mapRevision: body.mapSnapshot.revision,
          listingLedgerRevision: body.listingLedgerRevision,
          visibleContext: null,
        }),
      ),
    );
    body = await response.json();

    expect(response.status).toBe(200);
    expect(runListingSearchMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          beds: "studio",
          timing: "",
        }),
      }),
    );
  });

  test("renders a saved reappearing listing without downgrading its lead status", async () => {
    runListingSearchMock.mockResolvedValue({
      candidates: [createListingCandidate()],
      sourceSummary: "One listing matched.",
      citations: [],
      caveats: [],
      geocodeAuthorization: null,
    });

    const firstResponse = await POST(
      createRequest(createPlanningRequest("Find studio listings under $3000 near Fillmore")),
    );
    const firstBody = await firstResponse.json();

    expect(firstResponse.status).toBe(200);

    const savedLead = await getTestStore().updateListingLeadStatus({
      threadId: firstBody.thread.id,
      canonicalUrl: "https://example.com/listings/1",
      expectedRevision: firstBody.listingLedgerRevision,
      status: "saved",
      now: "2026-06-19T12:01:00.000Z",
    });

    expect(savedLead.ok).toBe(true);
    if (!savedLead.ok) {
      throw new Error(`Failed to save listing lead: ${savedLead.error}`);
    }

    const secondResponse = await POST(
      createRequest(
        createPlanningRequest("Show me that listing again", {
          threadId: firstBody.thread.id,
          mapRevision: firstBody.mapSnapshot.revision,
          listingLedgerRevision: savedLead.listingLedgerRevision,
          visibleContext: null,
        }),
      ),
    );
    const secondBody = await secondResponse.json();
    const listingPart = secondBody.assistantMessage.parts.find(
      (part: { type: string }) => part.type === "listingResults",
    );

    expect(secondResponse.status).toBe(200);
    expect(listingPart.listings[0].lead).toMatchObject({
      canonicalUrl: "https://example.com/listings/1",
      status: "saved",
      firstSeenAt: firstBody.assistantMessage.parts.find(
        (part: { type: string }) => part.type === "listingResults",
      ).listings[0].lead.firstSeenAt,
      seenCount: 2,
    });
    expect(listingPart.listings[0].display.leadStatus).toBe("saved");
  });
});

function getTestStore() {
  if (!planningStoreMock.current) {
    throw new Error("Planning store mock was not initialized.");
  }

  return planningStoreMock.current;
}

function createMapProposalOutcome(): Extract<MapAssistantOutcome, { kind: "proposal" }> {
  const proposal: MapPatchProposal = {
    summary: "Add a note to Lower Pac Heights.",
    operations: [
      {
        type: "addNote",
        entityId: "lower-pac-heights",
        note: "Solidcore access is a strong fitness signal.",
      },
    ],
    confidence: "high",
    requiresUserReview: true,
  };

  return {
    kind: "proposal",
    assistantMessage: "I found one map update worth reviewing.",
    proposal,
    researchSummary: {
      items: [],
      exclusions: [],
      caveats: ["Review before applying."],
    },
  };
}

function createListingCandidate(): ListingCandidate {
  return {
    id: "candidate-1",
    title: "Studio near Fillmore",
    url: "https://example.com/listings/1",
    sourceDomain: "example.com",
    neighborhoodGuess: "Lower Pac Heights",
    locationText: "1234 Fillmore St",
    geocodeQuery: "1234 Fillmore St, San Francisco, CA",
    locationConfidence: "medium",
    coordinates: null,
    geocodeStatus: "not_attempted",
    markerPrecision: "none",
    priceMonthly: 2800,
    beds: "studio",
    shortTermSignal: false,
    furnishedSignal: false,
    fitScore: 4,
    whyItFits: "Close to Fillmore and high-priority fitness anchors.",
    citations: [
      {
        url: "https://example.com/listings/1",
        title: "Studio near Fillmore",
        sourceDomain: "example.com",
      },
    ],
    caveats: [],
  };
}
