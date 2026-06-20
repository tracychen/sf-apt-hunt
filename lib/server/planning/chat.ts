import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";

import type {
  ListingCandidate,
  ListingLead,
  MapSnapshot,
  PlanningActionRecord,
  PlanningActionTarget,
  PlanningChatPart,
  PlanningChatRequest,
  PlanningChatResponse,
  PlanningContextSummary,
  PlanningMessage,
  PlanningThread,
} from "@/lib/domain/types";
import { scoreListingLead } from "@/lib/map/listing-planning-score";
import { runListingSearch } from "@/lib/server/listing-search-service";
import { runMapAssistant } from "@/lib/server/map-assistant-service";
import { hashInstallationSecret } from "@/lib/server/planning/installation";
import {
  buildSeenListingLead,
  mergeReappearingListingLead,
} from "@/lib/server/planning/listing-leads";
import type { PlanningStore } from "@/lib/server/planning/store";
import {
  buildListingFilters,
  buildListingSelectedContext,
  buildPlanningAppContext,
  buildPlanningContextSummary,
  buildSelectedZoneIds,
  classifyPlanningIntent,
} from "@/lib/server/planning/context";

type ThreadState = {
  thread: PlanningThread;
  mapSnapshot: MapSnapshot;
  listingLedgerRevision: string;
};

type ActionDraft = {
  id: string;
  partIndex: number;
  kind: PlanningActionRecord["kind"];
  buildTarget(messageId: string): PlanningActionTarget;
};

type AssistantPartsResult = {
  parts: PlanningChatPart[];
  actionDrafts: ActionDraft[];
};

type PlanningChatErrorCode =
  | "installation_secret_mismatch"
  | "installation_record_invalid"
  | "thread_not_found"
  | "stale_map_revision"
  | "stale_listing_ledger_revision";

export class PlanningChatError extends Error {
  constructor(
    readonly code: PlanningChatErrorCode,
    message: string = code,
  ) {
    super(message);
  }
}

export async function runPlanningChat(input: {
  apiKey: string;
  clientInstallationSecret: string;
  request: PlanningChatRequest;
  geocodeSessionId: string | null;
  store: PlanningStore;
  now: string;
}): Promise<PlanningChatResponse> {
  const threadState = await ensureThreadAndSnapshot(input);
  const userMessage = await input.store.appendMessage({
    threadId: threadState.thread.id,
    role: "user",
    parts: [{ type: "text", text: input.request.message }],
    now: input.now,
  });
  const [preferenceMemory, recentMessages, recentActions] = await Promise.all([
    input.store.getPreferenceMemory(threadState.thread.id),
    input.store.listRecentMessages(threadState.thread.id, 6),
    input.store.listRecentActions(threadState.thread.id, 8),
  ]);
  const contextSummary = buildPlanningContextSummary({
    request: input.request,
    mapState: threadState.mapSnapshot.mapState,
    preferenceMemory,
  });
  await input.store.updatePreferenceMemory({
    threadId: threadState.thread.id,
    context: contextSummary,
    now: input.now,
  });
  const appContext = buildPlanningAppContext({
    context: contextSummary,
    mapState: threadState.mapSnapshot.mapState,
    selectedEntity: input.request.selectedEntity,
    recentMessages,
    recentActions,
  });
  const assistantParts = await buildAssistantParts(input, threadState, contextSummary, appContext);
  const assistantMessage = await input.store.appendMessage({
    threadId: threadState.thread.id,
    role: "assistant",
    parts: assistantParts.parts,
    now: input.now,
  });
  const actionRecords = await createActionsForMessage({
    store: input.store,
    threadId: threadState.thread.id,
    message: assistantMessage,
    actionDrafts: assistantParts.actionDrafts,
    now: input.now,
  });
  const thread = (await input.store.getThread(threadState.thread.id)) ?? threadState.thread;

  return {
    thread,
    userMessage,
    assistantMessage,
    contextSummary,
    actionRecords,
    mapSnapshot: threadState.mapSnapshot,
    listingLedgerRevision: threadState.listingLedgerRevision,
  };
}

async function ensureThreadAndSnapshot(input: {
  clientInstallationSecret: string;
  request: PlanningChatRequest;
  store: PlanningStore;
  now: string;
}): Promise<ThreadState> {
  const installationSecretHash = await hashInstallationSecret(input.clientInstallationSecret);

  if (!input.request.threadId) {
    const created = await input.store.createThread({
      clientInstallationId: input.request.clientInstallationId,
      clientInstallationSecretHash: installationSecretHash,
      initialMapState: input.request.mapState,
      now: input.now,
    });

    if (!created.ok) {
      throw new PlanningChatError(created.error);
    }

    return {
      thread: created.thread,
      mapSnapshot: created.mapSnapshot,
      listingLedgerRevision: created.listingLedgerRevision,
    };
  }

  const ownsThread = await input.store.verifyThreadOwnership(
    input.request.threadId,
    installationSecretHash,
  );

  if (!ownsThread) {
    throw new PlanningChatError("thread_not_found");
  }

  const [thread, initialMapSnapshot, listingLedgerRevision] = await Promise.all([
    input.store.getThread(input.request.threadId),
    input.store.getMapSnapshot(input.request.threadId),
    input.store.getListingLedgerRevision(input.request.threadId),
  ]);

  if (!thread || !initialMapSnapshot || !listingLedgerRevision) {
    throw new PlanningChatError("thread_not_found");
  }

  if (input.request.mapRevision && input.request.mapRevision !== initialMapSnapshot.revision) {
    throw new PlanningChatError("stale_map_revision");
  }

  if (
    input.request.listingLedgerRevision &&
    input.request.listingLedgerRevision !== listingLedgerRevision
  ) {
    throw new PlanningChatError("stale_listing_ledger_revision");
  }

  let mapSnapshot = initialMapSnapshot;

  if (!isDeepStrictEqual(input.request.mapState, mapSnapshot.mapState)) {
    const updatedSnapshot = await input.store.updateMapSnapshot({
      threadId: input.request.threadId,
      expectedRevision: mapSnapshot.revision,
      mapState: input.request.mapState,
      now: input.now,
    });

    if (!updatedSnapshot.ok) {
      throw new PlanningChatError(
        updatedSnapshot.error === "stale_map_revision" ? "stale_map_revision" : "thread_not_found",
      );
    }

    mapSnapshot = updatedSnapshot.snapshot;
  }

  return { thread, mapSnapshot, listingLedgerRevision };
}

async function buildAssistantParts(
  input: {
    apiKey: string;
    request: PlanningChatRequest;
    geocodeSessionId: string | null;
    store: PlanningStore;
    now: string;
  },
  threadState: ThreadState,
  contextSummary: PlanningContextSummary,
  appContext: ReturnType<typeof buildPlanningAppContext>,
): Promise<AssistantPartsResult> {
  if (classifyPlanningIntent(input.request.message) === "listing") {
    return buildListingAssistantParts(input, threadState, contextSummary, appContext);
  }

  return buildMapAssistantParts(input, threadState, contextSummary, appContext);
}

async function buildMapAssistantParts(
  input: {
    apiKey: string;
    request: PlanningChatRequest;
    geocodeSessionId: string | null;
    store: PlanningStore;
  },
  threadState: ThreadState,
  contextSummary: PlanningContextSummary,
  appContext: ReturnType<typeof buildPlanningAppContext>,
): Promise<AssistantPartsResult> {
  const selectedZoneIds = buildSelectedZoneIds({
    mapState: threadState.mapSnapshot.mapState,
    request: input.request,
    context: contextSummary,
  });
  const outcome = await runMapAssistant({
    apiKey: input.apiKey,
    message: input.request.message,
    mapState: threadState.mapSnapshot.mapState,
    selectedZoneIds,
    activeFilters: buildListingFilters(contextSummary),
    appContext,
    geocodeSessionId: input.geocodeSessionId,
  });

  if (outcome.kind === "needsMoreInfo") {
    return {
      parts: [
        { type: "text", text: outcome.assistantMessage },
        {
          type: "followUpQuestion",
          question: outcome.assistantMessage,
          missingInformation: outcome.missingInformation,
        },
      ],
      actionDrafts: [],
    };
  }

  if (outcome.kind === "noAction") {
    return {
      parts: [{ type: "text", text: outcome.assistantMessage }],
      actionDrafts: [],
    };
  }

  const actionId = createActionId("map-proposal");
  const partIndex = 1;

  return {
    parts: [
      { type: "text", text: outcome.assistantMessage },
      {
        type: "mapProposal",
        actionId,
        proposal: outcome.proposal,
        researchSummary: outcome.researchSummary,
      },
    ],
    actionDrafts: [
      {
        id: actionId,
        partIndex,
        kind: "mapProposal",
        buildTarget: (messageId) => ({
          kind: "mapProposal",
          messageId,
          partIndex,
          proposalHash: input.store.hashPayload(outcome.proposal),
          allowedOperationIndexes: outcome.proposal.operations.map((_operation, index) => index),
          mapRevision: threadState.mapSnapshot.revision,
        }),
      },
    ],
  };
}

async function buildListingAssistantParts(
  input: {
    apiKey: string;
    request: PlanningChatRequest;
    store: PlanningStore;
    now: string;
  },
  threadState: ThreadState,
  contextSummary: PlanningContextSummary,
  appContext: ReturnType<typeof buildPlanningAppContext>,
): Promise<AssistantPartsResult> {
  const filters = buildListingFilters(contextSummary);
  const selectedZoneIds = buildSelectedZoneIds({
    mapState: threadState.mapSnapshot.mapState,
    request: input.request,
    context: contextSummary,
  });
  const result = await runListingSearch({
    apiKey: input.apiKey,
    query: input.request.message,
    filters,
    appContext,
    selectedContext: buildListingSelectedContext({
      mapState: threadState.mapSnapshot.mapState,
      selectedZoneIds,
    }),
  });
  const resultSetId = createActionId("result-set");
  const existingLeads = new Map(
    await Promise.all(
      result.candidates.map(async (candidate) => {
        const canonicalUrl = candidate.url.trim();
        return [canonicalUrl, await input.store.getListingLead(threadState.thread.id, canonicalUrl)] as const;
      }),
    ),
  );
  const listingCards = result.candidates.map((candidate) =>
    buildListingCard({
      candidate,
      existingLead: existingLeads.get(candidate.url.trim()) ?? null,
      resultSetId,
      listingLedgerRevision: threadState.listingLedgerRevision,
      store: input.store,
      mapState: threadState.mapSnapshot.mapState,
      selectedZoneIds,
      filters,
      searchQuery: input.request.message,
      now: input.now,
    }),
  );
  const partIndex = 1;
  const listingPart: PlanningChatPart = {
    type: "listingResults",
    resultSetId,
    listings: listingCards.map((card) => ({
      lead: card.lead,
      display: card.display,
      saveActionId: card.saveActionId,
      dismissActionId: card.dismissActionId,
    })),
    sourceSummary: result.sourceSummary,
    caveats: result.caveats,
    geocodeAuthorization: result.geocodeAuthorization,
  };

  return {
    parts: [
      {
        type: "text",
        text:
          result.candidates.length === 1
            ? "I found 1 listing candidate."
            : `I found ${result.candidates.length} listing candidates.`,
      },
      listingPart,
    ],
    actionDrafts: listingCards.flatMap((card) =>
      card.actionDrafts.map((draft) => ({
        ...draft,
        partIndex,
      })),
    ),
  };
}

function buildListingCard(input: {
  candidate: ListingCandidate;
  existingLead: ListingLead | null;
  resultSetId: string;
  listingLedgerRevision: string;
  store: PlanningStore;
  mapState: MapSnapshot["mapState"];
  selectedZoneIds: string[];
  filters: ReturnType<typeof buildListingFilters>;
  searchQuery: string;
  now: string;
}) {
  const seenLead = buildSeenListingLead({
    candidate: input.candidate,
    searchQuery: input.searchQuery,
    now: input.now,
  });
  const lead = mergeReappearingListingLead(input.existingLead, seenLead);
  const listingSnapshotHash = input.store.hashPayload(lead.candidate);
  const display = scoreListingLead({
    lead,
    filters: input.filters,
    mapState: input.mapState,
    selectedZoneIds: input.selectedZoneIds,
  });
  const saveActionId = createActionId("listing-save");
  const dismissActionId = createActionId("listing-dismiss");
  const actionDrafts: ActionDraft[] = [
    {
      id: saveActionId,
      partIndex: 0,
      kind: "listingSave",
      buildTarget: () => ({
        kind: "listingLead",
        resultSetId: input.resultSetId,
        canonicalUrl: lead.canonicalUrl,
        listingSnapshotHash,
        listingLedgerRevision: input.listingLedgerRevision,
      }),
    },
    {
      id: dismissActionId,
      partIndex: 0,
      kind: "listingDismiss",
      buildTarget: () => ({
        kind: "listingLead",
        resultSetId: input.resultSetId,
        canonicalUrl: lead.canonicalUrl,
        listingSnapshotHash,
        listingLedgerRevision: input.listingLedgerRevision,
      }),
    },
  ];

  return {
    lead,
    display,
    saveActionId,
    dismissActionId,
    actionDrafts,
  };
}

async function createActionsForMessage(input: {
  store: PlanningStore;
  threadId: string;
  message: PlanningMessage;
  actionDrafts: ActionDraft[];
  now: string;
}) {
  const records: PlanningActionRecord[] = [];

  for (const draft of input.actionDrafts) {
    records.push(
      await input.store.createAction({
        id: draft.id,
        threadId: input.threadId,
        messageId: input.message.id,
        partIndex: draft.partIndex,
        kind: draft.kind,
        target: draft.buildTarget(input.message.id),
        now: input.now,
      }),
    );
  }

  return records;
}

function createActionId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}
