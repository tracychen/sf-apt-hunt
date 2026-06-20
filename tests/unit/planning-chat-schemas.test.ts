import { describe, expect, test } from "vitest";

import {
  executePlanningActionRequestSchema,
  listingLeadStatusSchema,
  planningActionRecordSchema,
  planningChatRequestSchema,
  planningChatResponseSchema,
} from "@/lib/domain/schemas";
import { seedMapState } from "@/lib/map/seed-data";

const now = "2026-06-19T12:00:00.000Z";

describe("planning chat schemas", () => {
  test("accepts saved and dismissed listing statuses", () => {
    expect(listingLeadStatusSchema.parse("saved")).toBe("saved");
    expect(listingLeadStatusSchema.parse("dismissed")).toBe("dismissed");
  });

  test("requires action records to bind to a stored target", () => {
    const action = planningActionRecordSchema.parse({
      id: "action-1",
      threadId: "thread-1",
      messageId: "message-1",
      partIndex: 1,
      kind: "mapProposal",
      target: {
        kind: "mapProposal",
        messageId: "message-1",
        partIndex: 1,
        proposalHash: "hash-1",
        allowedOperationIndexes: [0],
        mapRevision: "map-rev-1",
      },
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    expect(action.target.kind).toBe("mapProposal");
  });

  test("rejects planning chat responses with swapped message roles", () => {
    const result = planningChatResponseSchema.safeParse({
      thread: {
        id: "thread-1",
        clientInstallationId: "install-1",
        createdAt: now,
        updatedAt: now,
        title: "Apartment planning",
        summary: "",
      },
      userMessage: {
        id: "message-user-1",
        threadId: "thread-1",
        role: "assistant",
        parts: [{ type: "text", text: "Add pins for Solidcore in SF" }],
        createdAt: now,
      },
      assistantMessage: {
        id: "message-assistant-1",
        threadId: "thread-1",
        role: "user",
        parts: [{ type: "text", text: "I can help with that." }],
        createdAt: now,
      },
      contextSummary: {
        budget: null,
        beds: null,
        timing: null,
        furnished: null,
        shortTerm: null,
        positiveAnchors: [],
        avoidAnchors: [],
        selectedZones: [],
        sourceStrictness: null,
      },
      actionRecords: [],
      mapSnapshot: {
        id: "snapshot-1",
        threadId: "thread-1",
        clientInstallationId: "install-1",
        mapState: seedMapState,
        revision: "map-rev-1",
        createdAt: now,
        updatedAt: now,
      },
      listingLedgerRevision: "ledger-rev-1",
    });

    expect(result.success).toBe(false);
  });

  test("rejects action records whose kind does not match the target kind", () => {
    const result = planningActionRecordSchema.safeParse({
      id: "action-1",
      threadId: "thread-1",
      messageId: "message-1",
      partIndex: 1,
      kind: "listingSave",
      target: {
        kind: "mapProposal",
        messageId: "message-1",
        partIndex: 1,
        proposalHash: "hash-1",
        allowedOperationIndexes: [0],
        mapRevision: "map-rev-1",
      },
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    expect(result.success).toBe(false);
  });

  test("rejects listing action payloads that try to provide a canonical URL", () => {
    const result = executePlanningActionRequestSchema.safeParse({
      threadId: "thread-1",
      actionId: "action-1",
      idempotencyKey: "idem-1",
      payload: {
        kind: "listingSave",
        canonicalUrl: "https://example.com/listing/1",
        expectedListingLedgerRevision: "ledger-rev-1",
        expectedListingSnapshotHash: "snapshot-hash-1",
      },
    });

    expect(result.success).toBe(false);
  });

  test("accepts listing action payloads with the stored snapshot hash", () => {
    const result = executePlanningActionRequestSchema.safeParse({
      threadId: "thread-1",
      actionId: "action-1",
      idempotencyKey: "idem-1",
      payload: {
        kind: "listingSave",
        expectedListingLedgerRevision: "ledger-rev-1",
        expectedListingSnapshotHash: "snapshot-hash-1",
      },
    });

    expect(result.success).toBe(true);
  });

  test("accepts listing dismiss payloads with the stored snapshot hash", () => {
    const result = executePlanningActionRequestSchema.safeParse({
      threadId: "thread-1",
      actionId: "action-1",
      idempotencyKey: "idem-2",
      payload: {
        kind: "listingDismiss",
        expectedListingLedgerRevision: "ledger-rev-1",
        expectedListingSnapshotHash: "snapshot-hash-1",
      },
    });

    expect(result.success).toBe(true);
  });

  test("accepts planning chat request and response contracts", () => {
    const request = planningChatRequestSchema.parse({
      threadId: null,
      clientInstallationId: "install-1",
      message: "Add pins for Solidcore in SF",
      mapState: seedMapState,
      mapRevision: null,
      listingLedgerRevision: null,
      selectedEntity: null,
      visibleContext: null,
    });

    expect(request.message).toContain("Solidcore");

    const response = planningChatResponseSchema.parse({
      thread: {
        id: "thread-1",
        clientInstallationId: "install-1",
        createdAt: now,
        updatedAt: now,
        title: "Apartment planning",
        summary: "",
      },
      userMessage: {
        id: "message-user-1",
        threadId: "thread-1",
        role: "user",
        parts: [{ type: "text", text: "Add pins for Solidcore in SF" }],
        createdAt: now,
      },
      assistantMessage: {
        id: "message-assistant-1",
        threadId: "thread-1",
        role: "assistant",
        parts: [
          { type: "text", text: "I can help with that." },
          {
            type: "listingResults",
            resultSetId: "result-set-1",
            listings: [],
            sourceSummary: "No matching listings returned.",
            caveats: [],
            geocodeAuthorization: null,
          },
        ],
        createdAt: now,
      },
      contextSummary: {
        budget: null,
        beds: null,
        timing: null,
        furnished: null,
        shortTerm: null,
        positiveAnchors: [],
        avoidAnchors: [],
        selectedZones: [],
        sourceStrictness: null,
      },
      actionRecords: [],
      mapSnapshot: {
        id: "snapshot-1",
        threadId: "thread-1",
        clientInstallationId: "install-1",
        mapState: seedMapState,
        revision: "map-rev-1",
        createdAt: now,
        updatedAt: now,
      },
      listingLedgerRevision: "ledger-rev-1",
    });

    expect(response.assistantMessage.parts[1]).toMatchObject({
      type: "listingResults",
      geocodeAuthorization: null,
    });
  });

  test("rejects planning chat request bodies that include an installation secret", () => {
    const result = planningChatRequestSchema.safeParse({
      threadId: null,
      clientInstallationId: "install-1",
      clientInstallationSecret: "secret-1",
      message: "Add pins for Solidcore in SF",
      mapState: seedMapState,
      mapRevision: null,
      listingLedgerRevision: null,
      selectedEntity: null,
      visibleContext: null,
    });

    expect(result.success).toBe(false);
  });
});
