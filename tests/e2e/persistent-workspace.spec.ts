import { expect, test } from "@playwright/test";

import { samplePlanningMapState, seedMapState } from "../../lib/map/seed-data";

const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async ({ page }) => {
  await page.route("**/{tile.openstreetmap.org,*.tile.openstreetmap.org}/**", async (route) => {
    await route.fulfill({
      body: transparentPng,
      contentType: "image/png",
    });
  });
});

test("signed-in workspace map import persists after reload", async ({ page, baseURL }) => {
  let mapState = seedMapState;
  let mapRevision = "map-1";
  let clientStateRequestCount = 0;
  let importRequestCount = 0;

  await page.context().addCookies([
    {
      name: "sf-apt-e2e-auth",
      value: "playwright",
      url: baseURL ?? "http://127.0.0.1:3333",
    },
  ]);

  await page.route("**/api/workspace/client-state", async (route) => {
    clientStateRequestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspace: {
          id: "workspace-1",
          userId: "user-1",
          name: "Apartment hunt",
          listingLedgerRevision: "ledger-1",
          createdAt: "2026-06-23T12:00:00.000Z",
          updatedAt: "2026-06-23T12:00:00.000Z",
        },
        mapSnapshot: {
          id: "snapshot-1",
          workspaceId: "workspace-1",
          revision: mapRevision,
          mapState,
          createdAt: "2026-06-23T12:00:00.000Z",
          updatedAt: "2026-06-23T12:00:00.000Z",
        },
        listingLeads: [],
        listingLedgerRevision: "ledger-1",
        planningThreadCache: null,
      }),
    });
  });

  await page.route("**/api/workspace/map/import", async (route) => {
    importRequestCount += 1;
    const body = route.request().postDataJSON() as {
      expectedMapRevision: string;
      mapState: typeof seedMapState;
    };

    expect(body.expectedMapRevision).toBe(mapRevision);
    mapState = body.mapState;
    mapRevision = "map-2";

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        mapSnapshot: {
          id: "snapshot-1",
          workspaceId: "workspace-1",
          revision: mapRevision,
          mapState,
          createdAt: "2026-06-23T12:00:00.000Z",
          updatedAt: "2026-06-23T12:00:01.000Z",
        },
        invalidatedActionIds: [],
      }),
    });
  });

  await page.goto("/");
  await expect(page.locator(".target-anchor-marker")).toHaveCount(0);

  await page.getByLabel("Import map JSON file").setInputFiles({
    name: "sample-map.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(samplePlanningMapState)),
  });

  await expect(page.getByText("Ready to import sample-map.json.")).toBeVisible();
  await page.getByRole("button", { name: "Replace current map" }).click();
  await expect(page.getByText("Imported sample-map.json.")).toBeVisible();
  await expect(page.locator(".target-anchor-marker")).toHaveCount(3);
  expect(importRequestCount).toBe(1);

  await page.reload();
  await expect(page.locator(".target-anchor-marker")).toHaveCount(3);
  expect(clientStateRequestCount).toBeGreaterThanOrEqual(2);
});

test("signed-in workspace planning chat ignores stale anonymous local cache", async ({ page, baseURL }) => {
  await page.context().addCookies([
    {
      name: "sf-apt-e2e-auth",
      value: "playwright",
      url: baseURL ?? "http://127.0.0.1:3333",
    },
  ]);
  await page.addInitScript((cache) => {
    window.localStorage.setItem("sf-apt-hunt:planning-thread-cache:v1", JSON.stringify(cache));
  }, createStaleAnonymousPlanningCache());

  await page.route("**/api/workspace/client-state", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspace: {
          id: "workspace-1",
          userId: "user-1",
          name: "Apartment hunt",
          listingLedgerRevision: "ledger-1",
          createdAt: "2026-06-23T12:00:00.000Z",
          updatedAt: "2026-06-23T12:00:00.000Z",
        },
        mapSnapshot: {
          id: "snapshot-1",
          workspaceId: "workspace-1",
          revision: "map-1",
          mapState: seedMapState,
          createdAt: "2026-06-23T12:00:00.000Z",
          updatedAt: "2026-06-23T12:00:00.000Z",
        },
        listingLeads: [],
        listingLedgerRevision: "ledger-1",
        planningThreadCache: null,
      }),
    });
  });

  await page.goto("/");

  await expect(page.getByText("Stale anonymous planning note.")).toHaveCount(0);
  await expect(page.getByText("No planning chat messages yet.")).toBeVisible();
});

test("signed-in workspace listing actions do not persist the anonymous listing ledger", async ({
  page,
  baseURL,
}) => {
  let actionExecuted = false;

  await page.context().addCookies([
    {
      name: "sf-apt-e2e-auth",
      value: "playwright",
      url: baseURL ?? "http://127.0.0.1:3333",
    },
  ]);
  await page.addInitScript(() => {
    window.sessionStorage.setItem("sf-apt-hunt:openai-key", "sk-test");
  });

  await page.route("**/api/workspace/client-state", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspace: {
          id: "workspace-1",
          userId: "user-1",
          name: "Apartment hunt",
          listingLedgerRevision: "ledger-rev-1",
          createdAt: "2026-06-23T12:00:00.000Z",
          updatedAt: "2026-06-23T12:00:00.000Z",
        },
        mapSnapshot: {
          id: "snapshot-1",
          workspaceId: "workspace-1",
          revision: "map-rev-1",
          mapState: seedMapState,
          createdAt: "2026-06-23T12:00:00.000Z",
          updatedAt: "2026-06-23T12:00:00.000Z",
        },
        listingLeads: [],
        listingLedgerRevision: "ledger-rev-1",
        planningThreadCache: null,
      }),
    });
  });

  await page.route("**/api/ai/planning-chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createWorkspacePlanningChatListingResponse()),
    });
  });

  await page.route("**/api/planning/actions/execute", async (route) => {
    actionExecuted = true;
    const request = route.request().postDataJSON() as {
      payload?: {
        kind?: string;
        expectedListingLedgerRevision?: string;
        expectedListingSnapshotHash?: string;
      };
    };

    expect(request.payload).toMatchObject({
      kind: "listingSave",
      expectedListingLedgerRevision: "ledger-rev-1",
      expectedListingSnapshotHash: "listing-snapshot-hash-1",
    });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createWorkspacePlanningActionExecuteListingSaveResponse()),
    });
  });

  await page.goto("/");
  await page.getByLabel("Ask planning chat").fill("Find studio listings near Fillmore");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("One listing matched.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" }).first()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("sf-apt-hunt:listing-ledger:v1")))
    .toBeNull();

  await page.getByRole("button", { name: "Save" }).first().click();

  await expect.poll(() => actionExecuted).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("sf-apt-hunt:listing-ledger:v1")))
    .toBeNull();
});

function createStaleAnonymousPlanningCache() {
  return {
    thread: {
      id: "thread-local-stale",
      clientInstallationId: "install-local-stale",
      createdAt: "2026-06-23T11:00:00.000Z",
      updatedAt: "2026-06-23T11:01:00.000Z",
      title: "Anonymous planning",
      summary: "",
    },
    messages: [
      {
        id: "message-local-stale",
        threadId: "thread-local-stale",
        role: "assistant",
        parts: [{ type: "text", text: "Stale anonymous planning note." }],
        createdAt: "2026-06-23T11:01:00.000Z",
      },
    ],
    actionRecords: [],
    contextSummary: emptyPlanningContextSummary(),
    contextSummariesByMessageId: {
      "message-local-stale": emptyPlanningContextSummary(),
    },
    mapSnapshot: {
      id: "snapshot-local-stale",
      threadId: "thread-local-stale",
      clientInstallationId: "install-local-stale",
      mapState: seedMapState,
      revision: "map-local-stale",
      createdAt: "2026-06-23T11:00:00.000Z",
      updatedAt: "2026-06-23T11:00:00.000Z",
    },
    listingLedgerRevision: "ledger-local-stale",
  };
}

function emptyPlanningContextSummary() {
  return {
    budget: null,
    beds: null,
    timing: null,
    furnished: null,
    shortTerm: null,
    positiveAnchors: [],
    avoidAnchors: [],
    selectedZones: [],
    sourceStrictness: null,
  };
}

function createWorkspacePlanningChatListingResponse() {
  const listingCandidate = {
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
    fitScore: 5,
    whyItFits: "Close to Fillmore and under budget.",
    citations: [
      {
        url: "https://example.com/listings/1",
        title: "Studio near Fillmore",
        sourceDomain: "example.com",
      },
    ],
    caveats: [],
  };

  return {
    thread: {
      id: "thread-1",
      clientInstallationId: "workspace-1",
      createdAt: "2026-06-23T12:00:00.000Z",
      updatedAt: "2026-06-23T12:00:01.000Z",
      title: "Apartment planning",
      summary: "",
    },
    userMessage: {
      id: "message-user-1",
      threadId: "thread-1",
      role: "user",
      parts: [{ type: "text", text: "Find studio listings near Fillmore" }],
      createdAt: "2026-06-23T12:00:01.000Z",
    },
    assistantMessage: {
      id: "message-assistant-1",
      threadId: "thread-1",
      role: "assistant",
      parts: [
        { type: "text", text: "I found 1 listing candidate." },
        {
          type: "listingResults",
          resultSetId: "result-set-1",
          sourceSummary: "One listing matched.",
          caveats: ["Inventory changes quickly."],
          geocodeAuthorization: {
            nonce: "nonce-1",
            expiresAt: "2026-06-24T12:10:00.000Z",
            maxAttempts: 1,
            allowedQueries: [{ candidateId: listingCandidate.id, geocodeQueryHash: "hash-1" }],
          },
          listings: [
            {
              lead: {
                canonicalUrl: listingCandidate.url,
                firstSeenAt: "2026-06-23T12:00:01.000Z",
                lastSeenAt: "2026-06-23T12:00:01.000Z",
                lastSearchQuery: "Find studio listings near Fillmore",
                seenCount: 1,
                status: "seen",
                candidate: listingCandidate,
              },
              display: {
                ...listingCandidate,
                canonicalUrl: listingCandidate.url,
                firstSeenAt: "2026-06-23T12:00:01.000Z",
                lastSeenAt: "2026-06-23T12:00:01.000Z",
                seenCount: 1,
                planningScore: 5,
                leadStatus: "seen",
                planningSignals: ["Near Fillmore"],
              },
              saveActionId: "listing-save-1",
              dismissActionId: "listing-dismiss-1",
            },
          ],
        },
      ],
      createdAt: "2026-06-23T12:00:01.000Z",
    },
    contextSummary: emptyPlanningContextSummary(),
    actionRecords: [
      {
        id: "listing-save-1",
        threadId: "thread-1",
        messageId: "message-assistant-1",
        partIndex: 1,
        kind: "listingSave",
        target: {
          kind: "listingLead",
          resultSetId: "result-set-1",
          canonicalUrl: listingCandidate.url,
          listingSnapshotHash: "listing-snapshot-hash-1",
          listingLedgerRevision: "ledger-rev-1",
        },
        status: "pending",
        createdAt: "2026-06-23T12:00:01.000Z",
        updatedAt: "2026-06-23T12:00:01.000Z",
      },
      {
        id: "listing-dismiss-1",
        threadId: "thread-1",
        messageId: "message-assistant-1",
        partIndex: 1,
        kind: "listingDismiss",
        target: {
          kind: "listingLead",
          resultSetId: "result-set-1",
          canonicalUrl: listingCandidate.url,
          listingSnapshotHash: "listing-snapshot-hash-1",
          listingLedgerRevision: "ledger-rev-1",
        },
        status: "pending",
        createdAt: "2026-06-23T12:00:01.000Z",
        updatedAt: "2026-06-23T12:00:01.000Z",
      },
    ],
    mapSnapshot: {
      id: "snapshot-1",
      threadId: "thread-1",
      clientInstallationId: "workspace-1",
      mapState: seedMapState,
      revision: "map-rev-1",
      createdAt: "2026-06-23T12:00:00.000Z",
      updatedAt: "2026-06-23T12:00:00.000Z",
    },
    listingLedgerRevision: "ledger-rev-1",
  };
}

function createWorkspacePlanningActionExecuteListingSaveResponse() {
  const listingLead = {
    canonicalUrl: "https://example.com/listings/1",
    firstSeenAt: "2026-06-23T12:00:01.000Z",
    lastSeenAt: "2026-06-23T12:00:01.000Z",
    lastSearchQuery: "Find studio listings near Fillmore",
    seenCount: 1,
    status: "seen" as const,
    candidate: {
      id: "candidate-1",
      title: "Studio near Fillmore",
      url: "https://example.com/listings/1",
      sourceDomain: "example.com",
      neighborhoodGuess: "Lower Pac Heights",
      locationText: "1234 Fillmore St",
      geocodeQuery: "1234 Fillmore St, San Francisco, CA",
      locationConfidence: "medium" as const,
      coordinates: null,
      geocodeStatus: "not_attempted" as const,
      markerPrecision: "none" as const,
      priceMonthly: 2800,
      beds: "studio" as const,
      shortTermSignal: false,
      furnishedSignal: false,
      fitScore: 5,
      whyItFits: "Close to Fillmore and under budget.",
      citations: [
        {
          url: "https://example.com/listings/1",
          title: "Studio near Fillmore",
          sourceDomain: "example.com",
        },
      ],
      caveats: [],
    },
  };

  return {
    ok: true,
    action: {
      id: "listing-save-1",
      threadId: "thread-1",
      messageId: "message-assistant-1",
      partIndex: 1,
      kind: "listingSave",
      target: {
        kind: "listingLead",
        resultSetId: "result-set-1",
        canonicalUrl: listingLead.canonicalUrl,
        listingSnapshotHash: "listing-snapshot-hash-1",
        listingLedgerRevision: "ledger-rev-1",
      },
      status: "applied",
      createdAt: "2026-06-23T12:00:01.000Z",
      updatedAt: "2026-06-23T12:00:02.000Z",
    },
    execution: {
      id: "exec-2",
      actionId: "listing-save-1",
      idempotencyKey: "idem-2",
      payloadHash: "payload-hash-2",
      status: "succeeded",
      createdAt: "2026-06-23T12:00:02.000Z",
    },
    listingLead: {
      ...listingLead,
      status: "saved",
    },
    listingLedgerRevision: "ledger-rev-2",
  };
}
