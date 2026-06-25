"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  executePlanningActionResponseSchema,
  planningChatResponseSchema,
} from "@/lib/domain/schemas";
import type {
  ExecutePlanningActionRequest,
  GeocodeAuthorization,
  ListingDisplayCandidate,
  ListingLead,
  MapPatchProposal,
  MapState,
  PlanningActionRecord,
  PlanningChatPart,
  PlanningChatResponse,
  PlanningContextSummary,
  SelectedMapEntity,
} from "@/lib/domain/types";
import {
  clearPlanningChatState,
  loadOrCreatePlanningInstallation,
  loadPlanningThreadCache,
  savePlanningThreadCache,
  type PlanningThreadCache,
} from "@/lib/storage/planning-chat-storage";
import {
  dismissListingLead,
  mergeListingCandidatesIntoLedger,
  saveListingLead,
} from "@/lib/storage/listing-ledger-storage";

import type { VisibleMapLayers } from "@/components/apartment-map/leaflet-map";

const planningChatPlaceholder = [
  "Add pins for all Solidcore locations in SF",
  "Find studio or 1BR listings under $3k near my high-priority pins",
  "Create a corridor for the 1 California bus",
  "Make this selected pin a negative anchor for noise",
].join("\n");

export type PlanningChatOnboardingMilestone =
  | {
      kind: "anchorProposalReceived";
      messageId: string;
      proposalType: "mapProposal" | "targetEditProposal";
    }
  | { kind: "listingResultsReceived"; messageId: string; resultSetId: string };

export function PlanningChatPanel({
  apiKey,
  mapState,
  ownershipMode,
  selectedEntity,
  selectedZoneIds,
  visibleLayers,
  resetToken,
  onPlanningMapStateChange,
  onPlanningListingLeadChange,
  onOnboardingMilestone,
}: {
  apiKey: string | null;
  mapState: MapState;
  ownershipMode:
    | { kind: "local" }
    | {
        kind: "workspace";
        mapRevision: string;
        listingLedgerRevision: string;
        invalidatedActionIds: string[];
        threadCache: PlanningThreadCache | null;
      };
  selectedEntity: SelectedMapEntity;
  selectedZoneIds: string[];
  visibleLayers: VisibleMapLayers;
  resetToken: number;
  onPlanningMapStateChange: (input: {
    mapState: MapState;
    mapRevision?: string | null;
  }) => void;
  onPlanningListingLeadChange: (input: {
    lead: ListingLead;
    contextSummary: PlanningContextSummary | null;
    geocodeAuthorization: GeocodeAuthorization | null;
    listingLedgerRevision?: string | null;
  }) => void;
  onOnboardingMilestone?: (milestone: PlanningChatOnboardingMilestone) => void;
}) {
  const installationRef = useRef(
    ownershipMode.kind === "local"
      ? loadOrCreatePlanningInstallation()
      : { clientInstallationId: "workspace", clientInstallationSecret: "" },
  );
  const [message, setMessage] = useState("");
  const [threadCache, setThreadCache] = useState<PlanningThreadCache | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetWarning, setResetWarning] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyActionIds, setBusyActionIds] = useState<string[]>([]);
  const busyActionIdsRef = useRef(new Set<string>());
  const resetGenerationRef = useRef(0);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const actionAbortControllersRef = useRef(new Map<string, AbortController>());
  const lastHandledResetTokenRef = useRef(resetToken);
  const disabled = !apiKey;
  const hasBusyActions = busyActionIds.length > 0;
  const activeThreadCache = threadCache;
  const currentContext = useMemo(
    () => buildVisibleContext({ mapState, selectedEntity, selectedZoneIds, visibleLayers }),
    [mapState, selectedEntity, selectedZoneIds, visibleLayers],
  );
  const workspaceThreadCache =
    ownershipMode.kind === "workspace" ? ownershipMode.threadCache : null;
  const workspaceInvalidatedActionIds =
    ownershipMode.kind === "workspace" ? ownershipMode.invalidatedActionIds : null;

  useEffect(() => {
    if (ownershipMode.kind === "workspace") {
      const frame = window.requestAnimationFrame(() => {
        setThreadCache(workspaceThreadCache);
      });

      return () => window.cancelAnimationFrame(frame);
    }

    const frame = window.requestAnimationFrame(() => {
      setThreadCache(loadPlanningThreadCache());
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [ownershipMode.kind, workspaceThreadCache]);

  const invalidatedActionIdsKey =
    workspaceInvalidatedActionIds?.join("|") ?? "";

  useEffect(() => {
    if (!workspaceInvalidatedActionIds || workspaceInvalidatedActionIds.length === 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setThreadCache((current) => {
        const nextCache = invalidateCachedActionCards(current, workspaceInvalidatedActionIds);
        return nextCache;
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [invalidatedActionIdsKey, workspaceInvalidatedActionIds]);

  useEffect(() => {
    if (resetToken === 0 || resetToken === lastHandledResetTokenRef.current) {
      return;
    }

    lastHandledResetTokenRef.current = resetToken;
    const resetGeneration = resetGenerationRef.current + 1;
    resetGenerationRef.current = resetGeneration;
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = null;
    for (const controller of actionAbortControllersRef.current.values()) {
      controller.abort();
    }
    actionAbortControllersRef.current.clear();
    busyActionIdsRef.current.clear();
    setBusyActionIds([]);
    setMessage("");
    setError(null);
    setResetWarning(null);
    setStatus(null);
    setIsSubmitting(false);
    if (ownershipMode.kind === "local") {
      clearPlanningChatState();
    }
    setThreadCache(null);

    void (async () => {
      try {
        const response = await fetch("/api/planning/reset", {
          method: "POST",
          headers: buildPlanningHeaders(
            ownershipMode,
            installationRef.current.clientInstallationSecret,
            {
            "content-type": "application/json",
            },
          ),
          body: JSON.stringify({
            clientInstallationId: installationRef.current.clientInstallationId,
          }),
        });

        if (!response.ok) {
          throw new Error("Planning reset failed.");
        }
      } catch {
        if (resetGenerationRef.current === resetGeneration) {
          setResetWarning("Server planning history could not be cleared.");
        }
      }
    })();
  }, [ownershipMode, resetToken]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!apiKey || isSubmitting || hasBusyActions) {
      return;
    }

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setError("Enter a request before sending.");
      return;
    }

    setError(null);
    setResetWarning(null);
    setStatus("Sending planning chat request...");
    setIsSubmitting(true);
    const requestGeneration = resetGenerationRef.current;
    const abortController = new AbortController();
    chatAbortControllerRef.current = abortController;

    async function sendPlanningChatRequest(
      requestThreadCache: PlanningThreadCache | null,
    ): Promise<PlanningChatResponse> {
      const response = await fetch("/api/ai/planning-chat", {
        method: "POST",
        headers: buildPlanningHeaders(
          ownershipMode,
          installationRef.current.clientInstallationSecret,
          {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          },
        ),
        body: JSON.stringify({
          threadId: requestThreadCache?.thread.id ?? null,
          clientInstallationId: installationRef.current.clientInstallationId,
          message: trimmedMessage,
          mapState,
          mapRevision:
            ownershipMode.kind === "workspace"
              ? ownershipMode.mapRevision
              : requestThreadCache?.mapSnapshot.revision ?? null,
          listingLedgerRevision:
            ownershipMode.kind === "workspace"
              ? ownershipMode.listingLedgerRevision
              : requestThreadCache?.listingLedgerRevision ?? null,
          selectedEntity,
          visibleContext: currentContext,
        }),
        signal: abortController.signal,
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getFriendlyError(body, "Planning chat request failed."));
      }

      return planningChatResponseSchema.parse(body);
    }

    try {
      let requestThreadCache = activeThreadCache;
      let recoveryAttempted = false;
      let parsed: PlanningChatResponse | null = null;

      while (!parsed) {
        try {
          parsed = await sendPlanningChatRequest(requestThreadCache);
        } catch (requestError) {
          if (
            abortController.signal.aborted ||
            resetGenerationRef.current !== requestGeneration
          ) {
            return;
          }

          const nextError =
            requestError instanceof Error
              ? requestError.message
              : "Planning chat request failed.";

          if (
            !recoveryAttempted &&
            requestThreadCache &&
            isRecoverablePlanningCacheError(nextError)
          ) {
            recoveryAttempted = true;
            requestThreadCache = null;
            clearStoredThreadCache();
            setStatus("Starting a fresh planning thread...");
            continue;
          }

          throw requestError;
        }
      }

      if (resetGenerationRef.current !== requestGeneration) {
        return;
      }

      setThreadCache((current) => {
        const nextCache = mergeThreadCache(current, parsed);
        persistThreadCacheForCurrentMode(nextCache);
        return nextCache;
      });

      for (const part of parsed.assistantMessage.parts) {
        if (part.type === "mapProposal" || part.type === "targetEditProposal") {
          onOnboardingMilestone?.({
            kind: "anchorProposalReceived",
            messageId: parsed.assistantMessage.id,
            proposalType: part.type,
          });
        }

        if (part.type === "listingResults") {
          onOnboardingMilestone?.({
            kind: "listingResultsReceived",
            messageId: parsed.assistantMessage.id,
            resultSetId: part.resultSetId,
          });
        }
      }

      setMessage("");
      setStatus(buildSuccessStatus(parsed.assistantMessage.parts));
    } catch (requestError) {
      if (
        abortController.signal.aborted ||
        resetGenerationRef.current !== requestGeneration
      ) {
        return;
      }

      const nextError =
        requestError instanceof Error
          ? requestError.message
          : "Planning chat request failed.";
      setError(nextError);
      setStatus(null);

      if (isRecoverablePlanningCacheError(nextError)) {
        clearStoredThreadCache();
      }
    } finally {
      if (chatAbortControllerRef.current === abortController) {
        chatAbortControllerRef.current = null;
      }

      if (resetGenerationRef.current === requestGeneration) {
        setIsSubmitting(false);
      }
    }
  }

  async function applyProposal(
    actionId: string,
    action: PlanningActionRecord | undefined,
    operationIndexes?: number[],
  ) {
    if (
      !action ||
      (action.target.kind !== "mapProposal" &&
        action.target.kind !== "mapProposalItem" &&
        action.target.kind !== "targetEdit")
    ) {
      setError("Planning proposal action metadata is missing.");
      return;
    }

    await runAction(actionId, {
      threadId: action.threadId,
      actionId,
      idempotencyKey: `idem-${crypto.randomUUID()}`,
      payload: {
        kind: action.kind === "targetEdit" ? "targetEdit" : "mapProposal",
        operationIndexes: operationIndexes ?? getAllowedOperationIndexes(action),
        expectedMapRevision:
          ownershipMode.kind === "workspace"
            ? ownershipMode.mapRevision
            : action.target.mapRevision,
      },
    });
  }

  async function dismissActionCard(actionId: string, action: PlanningActionRecord | undefined) {
    if (!action) {
      setError("Planning action metadata is missing.");
      return;
    }

    await runAction(actionId, {
      threadId: action.threadId,
      actionId,
      idempotencyKey: `idem-${crypto.randomUUID()}`,
      payload: { kind: "dismiss" },
    });
  }

  async function updateListingStatus(
    actionId: string,
    action: PlanningActionRecord | undefined,
    kind: "listingSave" | "listingDismiss",
    contextSummary: PlanningContextSummary | null,
    geocodeAuthorization: GeocodeAuthorization | null,
  ) {
    if (!action || action.target.kind !== "listingLead") {
      setError("Listing action metadata is missing.");
      return;
    }

    await runAction(
      actionId,
      {
        threadId: action.threadId,
        actionId,
        idempotencyKey: `idem-${crypto.randomUUID()}`,
        payload: {
          kind,
          expectedListingLedgerRevision:
            ownershipMode.kind === "workspace"
              ? ownershipMode.listingLedgerRevision
              : threadCache?.listingLedgerRevision ?? action.target.listingLedgerRevision,
          expectedListingSnapshotHash: action.target.listingSnapshotHash,
        },
      },
      contextSummary,
      geocodeAuthorization,
    );
  }

  async function runAction(
    actionId: string,
    request: ExecutePlanningActionRequest,
    contextSummary: PlanningContextSummary | null = null,
    geocodeAuthorization: GeocodeAuthorization | null = null,
  ) {
    if (busyActionIdsRef.current.has(actionId)) {
      return;
    }

    busyActionIdsRef.current.add(actionId);
    setBusyActionIds((current) => [...current, actionId]);
    setError(null);
    setResetWarning(null);
    setStatus("Applying planning action...");
    const requestGeneration = resetGenerationRef.current;
    const abortController = new AbortController();
    actionAbortControllersRef.current.set(actionId, abortController);

    try {
      const response = await fetch("/api/planning/actions/execute", {
        method: "POST",
        headers: buildPlanningHeaders(
          ownershipMode,
          installationRef.current.clientInstallationSecret,
          {
          "content-type": "application/json",
          },
        ),
        body: JSON.stringify(request),
        signal: abortController.signal,
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getFriendlyError(body, "Planning action failed."));
      }

      if (!isSuccessfulPlanningActionBody(body)) {
        throw new Error("Planning action returned an unexpected response.");
      }

      const { ok, ...result } = body;
      void ok;
      const parsed = executePlanningActionResponseSchema.parse(result);
      if (resetGenerationRef.current !== requestGeneration) {
        return;
      }

      const listingLead = parsed.listingLead;

      if (listingLead) {
        if (ownershipMode.kind === "local") {
          mergeListingCandidatesIntoLedger({
            candidates: [listingLead.candidate],
            query: listingLead.lastSearchQuery,
            now: listingLead.lastSeenAt,
          });

          if (listingLead.status === "saved") {
            saveListingLead(listingLead.canonicalUrl);
          } else if (listingLead.status === "dismissed") {
            dismissListingLead(listingLead.canonicalUrl);
          }
        }

        onPlanningListingLeadChange({
          lead: listingLead,
          contextSummary,
          geocodeAuthorization,
          listingLedgerRevision: parsed.listingLedgerRevision ?? null,
        });
      }

      setThreadCache((current) => {
        const nextThreadCache = applyActionResult(current, parsed);
        persistThreadCacheForCurrentMode(nextThreadCache);
        return nextThreadCache;
      });

      if (parsed.mapState) {
        onPlanningMapStateChange({
          mapState: parsed.mapState,
          mapRevision: parsed.mapSnapshot?.revision ?? null,
        });
      } else if (parsed.mapSnapshot?.mapState) {
        onPlanningMapStateChange({
          mapState: parsed.mapSnapshot.mapState,
          mapRevision: parsed.mapSnapshot.revision,
        });
      }

      setStatus(renderActionStatus(parsed.action));
    } catch (actionError) {
      if (
        abortController.signal.aborted ||
        resetGenerationRef.current !== requestGeneration
      ) {
        return;
      }

      const nextError =
        actionError instanceof Error ? actionError.message : "Planning action failed.";

      if (isRecoverablePlanningActionCacheError(nextError)) {
        clearStoredThreadCache();
        setError("That planning action expired. I cleared the stale chat; send the request again.");
        setStatus(null);
        return;
      }

      setError(nextError);
      setStatus(null);
    } finally {
      if (actionAbortControllersRef.current.get(actionId) === abortController) {
        actionAbortControllersRef.current.delete(actionId);
      }

      if (resetGenerationRef.current === requestGeneration) {
        busyActionIdsRef.current.delete(actionId);
        setBusyActionIds((current) => current.filter((id) => id !== actionId));
      }
    }
  }

  function clearStoredThreadCache() {
    if (ownershipMode.kind === "local") {
      clearPlanningChatState();
    }
    setThreadCache(null);
  }

  function persistThreadCacheForCurrentMode(nextCache: PlanningThreadCache | null) {
    if (ownershipMode.kind !== "local") {
      return;
    }

    persistThreadCache(nextCache);
  }

  return (
    <section className="border border-sidebar-border bg-background p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">Planning chat</h2>
        <span className="text-xs text-muted-foreground">
          {activeThreadCache ? activeThreadCache.thread.title || "Active thread" : "New thread"}
        </span>
      </div>

      {currentContext ? (
        <div className="mt-3 border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground">
          <div className="flex flex-wrap gap-2">
            {currentContext.selectedZones.length > 0 ? (
              <span>Zones: {currentContext.selectedZones.join(", ")}</span>
            ) : null}
            {currentContext.positiveAnchors.length > 0 ? (
              <span>Positive: {currentContext.positiveAnchors.join(", ")}</span>
            ) : null}
            {currentContext.avoidAnchors.length > 0 ? (
              <span>Avoid: {currentContext.avoidAnchors.join(", ")}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-3 max-h-[34rem] space-y-3 overflow-y-auto pr-1">
        {activeThreadCache?.messages.length ? (
          activeThreadCache.messages.map((threadMessage) => {
            const messageContextSummary =
              activeThreadCache.contextSummariesByMessageId[threadMessage.id] ?? null;

            return (
              <article
                key={threadMessage.id}
                className="border border-sidebar-border bg-background p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium uppercase text-muted-foreground">
                    {threadMessage.role === "user" ? "You" : "Planning chat"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatTimestamp(threadMessage.createdAt)}
                  </span>
                </div>

                <div className="mt-2 space-y-3">
                  {threadMessage.parts.map((part, index) => (
                    <PlanningChatPartView
                      key={`${threadMessage.id}-${index}`}
                      action={findActionForPart(
                        activeThreadCache.actionRecords,
                        threadMessage.id,
                        index,
                      )}
                      actions={activeThreadCache.actionRecords}
                      busyActionIds={busyActionIds}
                      contextSummary={messageContextSummary}
                      onApplyProposal={applyProposal}
                      onDismissAction={dismissActionCard}
                      onListingDismiss={updateListingStatus}
                      onListingSave={updateListingStatus}
                      part={part}
                    />
                  ))}
                </div>
              </article>
            );
          })
        ) : (
          <p className="border border-dashed border-sidebar-border bg-background p-3 text-xs text-muted-foreground">
            No planning chat messages yet.
          </p>
        )}
      </div>

      <form className="mt-3" onSubmit={handleSubmit}>
        <label className="block text-xs font-medium" htmlFor="planning-chat-message">
          Ask planning chat
        </label>
        <textarea
          id="planning-chat-message"
          data-onboarding-target="planning-chat-input"
          className="mt-2 min-h-28 w-full resize-y border border-input bg-background p-2 text-sm outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
          disabled={disabled || isSubmitting || hasBusyActions}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={
            disabled
              ? "Add an OpenAI key before sending planning chat requests."
              : planningChatPlaceholder
          }
        />

        {!apiKey ? (
          <div className="mt-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">OpenAI key required</p>
            <p className="mt-1">AI requests are disabled until you save an OpenAI key.</p>
          </div>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="space-y-1 text-xs">
            {error ? <p className="text-destructive">{error}</p> : null}
            {resetWarning ? (
              <p className="text-amber-700 dark:text-amber-400">{resetWarning}</p>
            ) : null}
            {status ? (
              <p className="text-muted-foreground">{status}</p>
            ) : hasBusyActions ? (
              <p className="text-muted-foreground">
                Finish the current action before sending another message.
              </p>
            ) : null}
          </div>
          <Button disabled={disabled || isSubmitting || hasBusyActions} type="submit">
            {isSubmitting ? "Sending..." : "Send"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function PlanningChatPartView({
  action,
  actions,
  busyActionIds,
  contextSummary,
  onApplyProposal,
  onDismissAction,
  onListingDismiss,
  onListingSave,
  part,
}: {
  action: PlanningActionRecord | undefined;
  actions: PlanningActionRecord[];
  busyActionIds: string[];
  contextSummary: PlanningContextSummary | null;
  onApplyProposal: (
    actionId: string,
    action: PlanningActionRecord | undefined,
    operationIndexes?: number[],
  ) => Promise<void>;
  onDismissAction: (
    actionId: string,
    action: PlanningActionRecord | undefined,
  ) => Promise<void>;
  onListingDismiss: (
    actionId: string,
    action: PlanningActionRecord | undefined,
    kind: "listingSave" | "listingDismiss",
    contextSummary: PlanningContextSummary | null,
    geocodeAuthorization: GeocodeAuthorization | null,
  ) => Promise<void>;
  onListingSave: (
    actionId: string,
    action: PlanningActionRecord | undefined,
    kind: "listingSave" | "listingDismiss",
    contextSummary: PlanningContextSummary | null,
    geocodeAuthorization: GeocodeAuthorization | null,
  ) => Promise<void>;
  part: PlanningChatPart;
}) {
  if (part.type === "text") {
    return <p className="text-sm leading-6">{part.text}</p>;
  }

  if (part.type === "followUpQuestion") {
    return (
      <div className="border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">{part.question}</p>
        <ul className="mt-1 space-y-1">
          {part.missingInformation.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (part.type === "contextSummary") {
    return (
      <div className="border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
        {part.context.selectedZones.length > 0 ? (
          <p>Zones: {part.context.selectedZones.join(", ")}</p>
        ) : null}
        {part.context.positiveAnchors.length > 0 ? (
          <p>Positive: {part.context.positiveAnchors.join(", ")}</p>
        ) : null}
        {part.context.avoidAnchors.length > 0 ? (
          <p>Avoid: {part.context.avoidAnchors.join(", ")}</p>
        ) : null}
      </div>
    );
  }

  if (part.type === "mapProposal" || part.type === "targetEditProposal") {
    return (
      <ProposalCard
        action={action}
        busyActionIds={busyActionIds}
        key={part.actionId}
        onApplyProposal={onApplyProposal}
        onDismissAction={onDismissAction}
        part={part}
      />
    );
  }

  if (part.type === "listingResults") {
    return (
      <div className="space-y-2">
        <div className="border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{part.sourceSummary}</p>
          {part.caveats.length > 0 ? (
            <p className="mt-1">Caveats: {part.caveats.join(" / ")}</p>
          ) : null}
        </div>
        {part.listings.map((listing) => {
          const saveAction = actions.find((candidate) => candidate.id === listing.saveActionId);
          const dismissAction = actions.find(
            (candidate) => candidate.id === listing.dismissActionId,
          );
          const isSaveBusy = busyActionIds.includes(listing.saveActionId);
          const isDismissBusy = busyActionIds.includes(listing.dismissActionId);
          const isSaved = saveAction?.status === "applied" || listing.lead.status === "saved";
          const isDismissed =
            dismissAction?.status === "applied" || listing.lead.status === "dismissed";

          return (
            <article
              key={`${part.resultSetId}-${listing.lead.canonicalUrl}`}
              className="border border-sidebar-border bg-background p-3"
              data-onboarding-target="listing-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <a
                  className="font-medium underline underline-offset-4 hover:text-primary"
                  href={listing.display.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {listing.display.title}
                </a>
                <div className="flex items-center gap-2">
                  <ActionStatusBadge
                    action={isDismissed ? dismissAction : saveAction}
                    fallbackLabel={
                      isDismissed
                        ? "Dismissed"
                        : isSaved
                          ? "Saved"
                          : listing.display.leadStatus === "new"
                            ? "New"
                            : "Seen"
                    }
                  />
                  <span className="border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                    {listing.display.sourceDomain}
                  </span>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>{formatPrice(listing.display.priceMonthly)}</span>
                <span>{formatBeds(listing.display.beds)}</span>
                <span>{listing.display.neighborhoodGuess}</span>
                <span>Planning score {listing.display.planningScore}/5</span>
                <span>{formatPinStatus(listing.display)}</span>
              </div>

              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {listing.display.whyItFits}
              </p>

              {listing.display.planningSignals.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {listing.display.planningSignals.map((signal) => (
                    <span
                      key={`${listing.display.id}-${signal}`}
                      className="border border-border bg-muted px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground"
                    >
                      {signal}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  disabled={isSaveBusy || isSaved || isDismissed}
                  onClick={() =>
                    void onListingSave(
                      listing.saveActionId,
                      saveAction,
                      "listingSave",
                      contextSummary,
                      part.geocodeAuthorization ?? null,
                    )
                  }
                  size="sm"
                  type="button"
                >
                  Save
                </Button>
                <Button
                  disabled={isDismissBusy || isDismissed}
                  onClick={() =>
                    void onListingDismiss(
                      listing.dismissActionId,
                      dismissAction,
                      "listingDismiss",
                      contextSummary,
                      part.geocodeAuthorization ?? null,
                    )
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Dismiss
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <p className="text-xs text-destructive">
      {part.type === "error" ? part.message : "Unsupported planning chat part."}
    </p>
  );
}

function ActionStatusBadge({
  action,
  fallbackLabel,
}: {
  action?: PlanningActionRecord;
  fallbackLabel?: string;
}) {
  const label = fallbackLabel ?? actionStatusLabel(action?.status);
  if (!label) {
    return null;
  }

  return (
    <span className="border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
      {label}
    </span>
  );
}

function ProposalCard({
  action,
  busyActionIds,
  onApplyProposal,
  onDismissAction,
  part,
}: {
  action: PlanningActionRecord | undefined;
  busyActionIds: string[];
  onApplyProposal: (
    actionId: string,
    action: PlanningActionRecord | undefined,
    operationIndexes?: number[],
  ) => Promise<void>;
  onDismissAction: (
    actionId: string,
    action: PlanningActionRecord | undefined,
  ) => Promise<void>;
  part: Extract<PlanningChatPart, { type: "mapProposal" | "targetEditProposal" }>;
}) {
  const actionId = part.actionId;
  const operationIndexes = useMemo(
    () => part.proposal.operations.map((_operation, index) => index),
    [part.proposal.operations],
  );
  const [selectedOperationIndexes, setSelectedOperationIndexes] = useState(() => operationIndexes);
  const isBusy = busyActionIds.includes(actionId);
  const isTerminal = action ? action.status !== "pending" : false;
  const canApply = selectedOperationIndexes.length > 0 && !isBusy && !isTerminal;

  function toggleOperation(index: number, checked: boolean) {
    setSelectedOperationIndexes((current) => {
      if (checked) {
        return current.includes(index) ? current : [...current, index].sort((left, right) => left - right);
      }

      return current.filter((item) => item !== index);
    });
  }

  return (
    <div
      className="border border-sidebar-border bg-background p-3"
      data-onboarding-target="proposal-card"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{part.proposal.summary}</p>
        <ActionStatusBadge action={action} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {formatProposalOperationCount(part.proposal.operations.length)}
      </p>
      <div className="mt-3 space-y-2">
        {part.proposal.operations.map((operation, index) => (
          <label
            className="flex items-start gap-2 border border-border bg-muted/20 p-2 text-xs"
            key={`${actionId}-${index}`}
          >
            <input
              checked={selectedOperationIndexes.includes(index)}
              className="mt-0.5 size-3.5"
              disabled={isBusy || isTerminal}
              onChange={(event) => toggleOperation(index, event.currentTarget.checked)}
              type="checkbox"
            />
            <span>{`Include ${formatProposalOperationLabel(operation)}`}</span>
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          disabled={!canApply}
          onClick={() => void onApplyProposal(actionId, action, selectedOperationIndexes)}
          size="sm"
          type="button"
        >
          Apply selected
        </Button>
        <Button
          disabled={isBusy || isTerminal}
          onClick={() => void onDismissAction(actionId, action)}
          size="sm"
          type="button"
          variant="outline"
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function buildPlanningHeaders(
  ownershipMode:
    | { kind: "local" }
    | {
        kind: "workspace";
        mapRevision: string;
        listingLedgerRevision: string;
        invalidatedActionIds: string[];
        threadCache: PlanningThreadCache | null;
      },
  installationSecret: string,
  headers: Record<string, string>,
) {
  if (ownershipMode.kind === "workspace") {
    return headers;
  }

  return {
    ...headers,
    "x-sf-apt-installation-secret": installationSecret,
  };
}

function invalidateCachedActionCards(
  threadCache: PlanningThreadCache | null,
  actionIds: string[],
) {
  if (!threadCache || actionIds.length === 0) {
    return threadCache;
  }

  const invalidatedIds = new Set(actionIds);
  let changed = false;
  const nextActionRecords = threadCache.actionRecords.map((record) => {
    if (!invalidatedIds.has(record.id) || record.status !== "pending") {
      return record;
    }

    changed = true;
    return {
      ...record,
      status: "failed" as const,
      failureKind: "permanent" as const,
      error: "Map changed before this proposal was applied.",
      updatedAt: new Date().toISOString(),
    };
  });

  if (!changed) {
    return threadCache;
  }

  return {
    ...threadCache,
    actionRecords: nextActionRecords,
  };
}

function persistThreadCache(nextCache: PlanningThreadCache | null) {
  if (nextCache) {
    savePlanningThreadCache(nextCache);
    return;
  }

  clearPlanningChatState();
}

function mergeThreadCache(
  previous: PlanningThreadCache | null,
  response: PlanningChatResponse,
): PlanningThreadCache {
  const contextSummariesByMessageId =
    previous?.thread.id === response.thread.id
      ? {
          ...previous.contextSummariesByMessageId,
          [response.assistantMessage.id]: response.contextSummary,
        }
      : {
          [response.assistantMessage.id]: response.contextSummary,
        };

  return {
    thread: response.thread,
    messages:
      previous?.thread.id === response.thread.id
        ? mergeMessagesById(previous.messages, [
            response.userMessage,
            response.assistantMessage,
          ])
        : [response.userMessage, response.assistantMessage],
    actionRecords: mergeActionRecords(previous?.actionRecords ?? [], response.actionRecords),
    contextSummary: response.contextSummary,
    contextSummariesByMessageId,
    mapSnapshot: response.mapSnapshot,
    listingLedgerRevision: response.listingLedgerRevision,
  };
}

function mergeMessagesById(
  previous: PlanningThreadCache["messages"],
  next: PlanningThreadCache["messages"],
) {
  const merged = new Map<string, PlanningThreadCache["messages"][number]>();

  for (const message of [...previous, ...next]) {
    merged.set(message.id, message);
  }

  return [...merged.values()];
}

function mergeActionRecords(
  previous: PlanningActionRecord[],
  next: PlanningActionRecord[],
) {
  const merged = new Map<string, PlanningActionRecord>();

  for (const action of [...previous, ...next]) {
    merged.set(action.id, action);
  }

  return [...merged.values()];
}

function applyActionResult(
  threadCache: PlanningThreadCache | null,
  response: {
    action: PlanningActionRecord;
    listingLead?: ListingLead;
    listingLedgerRevision?: string;
    mapSnapshot?: PlanningThreadCache["mapSnapshot"];
  },
) {
  if (!threadCache) {
    return threadCache;
  }

  const nextCache: PlanningThreadCache = {
    ...threadCache,
    actionRecords: threadCache.actionRecords.map((record) =>
      record.id === response.action.id ? response.action : record,
    ),
    listingLedgerRevision:
      response.listingLedgerRevision ?? threadCache.listingLedgerRevision,
    mapSnapshot: response.mapSnapshot ?? threadCache.mapSnapshot,
    messages: threadCache.messages.map((message) => ({
      ...message,
      parts: message.parts.map((part) => {
        if (
          !response.listingLead ||
          part.type !== "listingResults"
        ) {
          return part;
        }

        return {
          ...part,
          listings: part.listings.map((listing) => {
            if (listing.lead.canonicalUrl !== response.listingLead?.canonicalUrl) {
              return listing;
            }

            return {
              ...listing,
              lead: response.listingLead,
              display: {
                ...listing.display,
                leadStatus: response.listingLead.status,
              },
            };
          }),
        };
      }),
    })),
  };

  return nextCache;
}

function getAllowedOperationIndexes(action: PlanningActionRecord) {
  if (action.target.kind === "mapProposal") {
    return action.target.allowedOperationIndexes;
  }

  if (action.target.kind === "mapProposalItem") {
    return [action.target.operationIndex];
  }

  if (action.target.kind === "targetEdit") {
    return action.target.allowedOperationIndexes;
  }

  return [];
}

function findActionForPart(
  actions: PlanningActionRecord[],
  messageId: string,
  partIndex: number,
) {
  return actions.find(
    (action) => action.messageId === messageId && action.partIndex === partIndex,
  );
}
function buildVisibleContext(input: {
  mapState: MapState;
  selectedEntity: SelectedMapEntity;
  selectedZoneIds: string[];
  visibleLayers: VisibleMapLayers;
}): PlanningContextSummary | null {
  const selectedZoneIdSet = new Set(input.selectedZoneIds);
  const selectedZones = input.visibleLayers.zones
    ? input.mapState.zones
        .filter(
          (zone) =>
            selectedZoneIdSet.has(zone.id) ||
            (input.selectedEntity?.kind === "zone" && input.selectedEntity.id === zone.id),
        )
        .map((zone) => zone.name)
    : [];
  const positiveAnchors = input.visibleLayers.targets
    ? input.mapState.targets
        .filter((target) => target.influence === "positive")
        .map((target) => target.purpose || target.name)
    : [];
  const avoidAnchors = input.visibleLayers.targets
    ? input.mapState.targets
        .filter((target) => target.influence === "negative")
        .map((target) => target.purpose || target.name)
    : [];
  const positiveAreas = input.visibleLayers.areas
    ? (input.mapState.areas ?? [])
        .filter((area) => area.influence === "positive")
        .map((area) => area.purpose || area.name)
    : [];
  const avoidAreas = input.visibleLayers.areas
    ? (input.mapState.areas ?? [])
        .filter((area) => area.influence === "negative")
        .map((area) => area.purpose || area.name)
    : [];

  const summary: PlanningContextSummary = {
    budget: null,
    beds: null,
    timing: null,
    furnished: null,
    shortTerm: null,
    positiveAnchors: [...positiveAnchors, ...positiveAreas],
    avoidAnchors: [...avoidAnchors, ...avoidAreas],
    selectedZones,
    sourceStrictness: null,
  };

  return hasContextSummary(summary) ? summary : null;
}

function hasContextSummary(context: PlanningContextSummary | null) {
  return Boolean(
    context &&
      (context.selectedZones.length > 0 ||
        context.positiveAnchors.length > 0 ||
        context.avoidAnchors.length > 0 ||
        context.budget !== null ||
        context.beds !== null ||
        context.timing !== null ||
        context.furnished !== null ||
        context.shortTerm !== null ||
        context.sourceStrictness !== null),
  );
}

function buildSuccessStatus(parts: PlanningChatPart[]) {
  const listingPart = parts.find((part) => part.type === "listingResults");
  if (listingPart && listingPart.type === "listingResults") {
    return `${listingPart.listings.length} listing cards ready.`;
  }

  const mapProposal = parts.find(
    (part) => part.type === "mapProposal" || part.type === "targetEditProposal",
  );
  if (mapProposal) {
    return "Planning proposal ready for review.";
  }

  return "Planning chat updated.";
}

function getFriendlyError(body: unknown, fallback: string) {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string" &&
    body.error.trim()
  ) {
    return body.error;
  }

  return fallback;
}

function isRecoverablePlanningCacheError(message: string) {
  return (
    message === "Map revision is stale." ||
    message === "Listing ledger revision is stale." ||
    message === "Planning thread is not owned by this installation."
  );
}

function isRecoverablePlanningActionCacheError(message: string) {
  return message === "Planning action is not owned by this installation.";
}

function formatProposalOperationCount(count: number) {
  return count === 1 ? "Add 1 map change" : `Add ${count} map changes`;
}

function formatProposalOperationLabel(operation: MapPatchProposal["operations"][number]) {
  if (operation.type === "addTarget") {
    return `Add ${operation.target.name}`;
  }

  if (operation.type === "addCorridor") {
    return `Add ${operation.corridor.name}`;
  }

  if (operation.type === "addArea") {
    return `Add ${operation.area.name}`;
  }

  if (operation.type === "addNote") {
    return `Add note to ${formatEntityLabel(operation.entityId)}`;
  }

  if (operation.type === "updateCorridorPriority") {
    return `Update ${formatEntityLabel(operation.corridorId)} priority`;
  }

  if (operation.type === "updateTargetPriority") {
    return `Update ${formatEntityLabel(operation.targetId)} priority`;
  }

  if (operation.type === "updateTargetPlanningFields") {
    return `Update ${formatEntityLabel(operation.targetId)}`;
  }

  if (operation.type === "updateAreaPlanningFields") {
    return `Update ${formatEntityLabel(operation.areaId)}`;
  }

  if (operation.type === "updateZoneScores") {
    return `Update ${formatEntityLabel(operation.zoneId)} scores`;
  }

  return `Replace ${formatEntityLabel(operation.zoneId)} geometry`;
}

function formatEntityLabel(id: string) {
  const knownLabels: Record<string, string> = {
    nopa: "NOPA",
  };

  if (knownLabels[id]) {
    return knownLabels[id];
  }

  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatPrice(priceMonthly: number | null) {
  if (priceMonthly === null) {
    return "Price unknown";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(priceMonthly);
}

function formatBeds(beds: ListingDisplayCandidate["beds"]) {
  if (beds === "1br") {
    return "1BR";
  }

  if (beds === "studio") {
    return "Studio";
  }

  return "Beds unknown";
}

function formatPinStatus(listing: ListingDisplayCandidate) {
  if (listing.coordinates) {
    return listing.markerPrecision === "exact" ? "Exact pin" : "Approximate pin";
  }

  if (listing.geocodeStatus === "failed") {
    return "Pin unavailable";
  }

  if (listing.geocodeStatus === "outside_sf") {
    return "Outside SF";
  }

  return "Pin pending";
}

function actionStatusLabel(status?: PlanningActionRecord["status"]) {
  if (status === "pending") {
    return "Pending";
  }

  if (status === "applied") {
    return "Applied";
  }

  if (status === "dismissed") {
    return "Dismissed";
  }

  if (status === "failed") {
    return "Failed";
  }

  return null;
}

function renderActionStatus(action: PlanningActionRecord) {
  if (action.status === "applied") {
    return "Planning action applied.";
  }

  if (action.status === "dismissed") {
    return "Planning action dismissed.";
  }

  if (action.status === "failed") {
    return action.error ?? "Planning action failed.";
  }

  return "Planning action updated.";
}

function isSuccessfulPlanningActionBody(
  value: unknown,
): value is { ok: true } & Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    "ok" in value &&
    value.ok === true
  );
}
