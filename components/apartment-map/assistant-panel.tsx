"use client";

import { type FormEvent, useMemo, useState } from "react";

import { listingSearchResponseSchema, mapPatchProposalSchema } from "@/lib/domain/schemas";
import type {
  ListingSearchFilters,
  ListingSearchResponse,
  MapPatchProposal,
  MapState,
} from "@/lib/domain/types";
import { Button } from "@/components/ui/button";

export function AssistantPanel(props: {
  apiKey: string | null;
  mapState: MapState;
  selectedZoneIds: string[];
  activeListingSearchRequestId: number;
  onProposalChange: (proposal: MapPatchProposal | null) => void;
  onListingSearchStart: () => number;
  isListingSearchRequestCurrent: (requestId: number) => boolean;
  onListingSearchResponse: (
    response: ListingSearchResponse,
    request: { query: string; filters: ListingSearchFilters; requestId: number },
  ) => boolean;
}) {
  const { apiKey, mapState, selectedZoneIds } = props;
  const disabled = !apiKey;
  const [message, setMessage] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [beds, setBeds] = useState<ListingSearchFilters["beds"]>("any");
  const [timing, setTiming] = useState("");
  const [shortTerm, setShortTerm] = useState(false);
  const [furnished, setFurnished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeListingRequestId, setActiveListingRequestId] = useState<number | null>(null);
  const activeFilters = useMemo<ListingSearchFilters>(
    () => ({
      maxBudget: parseBudget(maxBudget),
      beds,
      timing: timing.trim(),
      shortTerm,
      furnished,
    }),
    [beds, furnished, maxBudget, shortTerm, timing],
  );
  const hasStaleListingRequest =
    activeListingRequestId !== null &&
    activeListingRequestId !== props.activeListingSearchRequestId;
  const isCurrentlySubmitting = isSubmitting && !hasStaleListingRequest;
  const visibleError = hasStaleListingRequest ? null : error;
  const visibleStatus = hasStaleListingRequest ? null : status;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!apiKey || isCurrentlySubmitting) {
      return;
    }

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setError("Enter a request before sending.");
      return;
    }

    const requestKind = isListingSearchPrompt(trimmedMessage) ? "listing" : "map";
    const listingRequest =
      requestKind === "listing"
        ? {
            query: trimmedMessage,
            filters: activeFilters,
            requestId: props.onListingSearchStart(),
          }
        : null;
    setActiveListingRequestId(listingRequest?.requestId ?? null);
    setError(null);
    setStatus(requestKind === "listing" ? "Searching listings..." : "Requesting map proposal...");
    setIsSubmitting(true);

    try {
      const response = await fetch(
        requestKind === "listing" ? "/api/ai/listing-search" : "/api/ai/map-assistant",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(
            requestKind === "listing"
              ? {
                  query: trimmedMessage,
                  filters: listingRequest?.filters ?? activeFilters,
                  selectedContext: buildSelectedContext(mapState, selectedZoneIds),
                }
              : {
                  message: trimmedMessage,
                  mapState,
                  selectedZoneIds,
                  activeFilters,
                },
          ),
        },
      );
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getFriendlyError(body, requestKind));
      }

      if (requestKind === "listing") {
        const listingResponse = parseListingSearchResponse(body);
        if (!listingResponse) {
          throw new Error("Listing search returned an unexpected response.");
        }

        if (!listingRequest || !props.isListingSearchRequestCurrent(listingRequest.requestId)) {
          return;
        }

        props.onProposalChange(null);
        const accepted = props.onListingSearchResponse(listingResponse, listingRequest);
        if (!accepted || !props.isListingSearchRequestCurrent(listingRequest.requestId)) {
          return;
        }

        setStatus(`${listingResponse.candidates.length} listing candidates returned.`);
        return;
      }

      const proposal = readProposal(body);
      props.onProposalChange(proposal);
      setStatus(proposal ? "Map proposal ready for review." : "No map changes were proposed.");
    } catch (requestError) {
      if (listingRequest && !props.isListingSearchRequestCurrent(listingRequest.requestId)) {
        return;
      }

      setError(
        requestError instanceof Error
          ? requestError.message
          : "The assistant request could not be completed.",
      );
      setStatus(null);
    } finally {
      if (!listingRequest || props.isListingSearchRequestCurrent(listingRequest.requestId)) {
        setActiveListingRequestId(null);
        setIsSubmitting(false);
      }
    }
  }

  return (
    <form className="border border-sidebar-border bg-background p-3 text-sm" onSubmit={handleSubmit}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">Assistant</h2>
        <span className="text-xs text-muted-foreground">
          {selectedZoneIds.length} selected / {mapState.zones.length} zones
        </span>
      </div>

      <label className="mt-3 block text-xs font-medium" htmlFor="assistant-message">
        Ask the assistant
      </label>
      <textarea
        id="assistant-message"
        className="mt-2 min-h-28 w-full resize-y border border-input bg-background p-2 text-sm outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        disabled={disabled}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder={
          disabled
            ? "Add an OpenAI key before asking for listing searches or map proposals."
            : "Find studio or 1BR listings under $3k near high-priority zones."
        }
      />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-xs font-medium" htmlFor="assistant-budget">
          Budget
          <input
            id="assistant-budget"
            className="mt-1 w-full border border-input bg-background px-2 py-1.5 text-sm font-normal outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted"
            disabled={disabled}
            inputMode="numeric"
            placeholder="Any"
            value={maxBudget}
            onChange={(event) => setMaxBudget(event.target.value)}
          />
        </label>
        <label className="text-xs font-medium" htmlFor="assistant-beds">
          Beds
          <select
            id="assistant-beds"
            className="mt-1 w-full border border-input bg-background px-2 py-1.5 text-sm font-normal outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted"
            disabled={disabled}
            value={beds}
            onChange={(event) => setBeds(event.target.value as ListingSearchFilters["beds"])}
          >
            <option value="any">Any</option>
            <option value="studio">Studio</option>
            <option value="1br">1BR</option>
          </select>
        </label>
      </div>

      <label className="mt-2 block text-xs font-medium" htmlFor="assistant-timing">
        Timing
        <input
          id="assistant-timing"
          className="mt-1 w-full border border-input bg-background px-2 py-1.5 text-sm font-normal outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted"
          disabled={disabled}
          placeholder="Flexible"
          value={timing}
          onChange={(event) => setTiming(event.target.value)}
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <label className="flex items-center gap-2">
          <input
            className="size-3.5"
            disabled={disabled}
            type="checkbox"
            checked={shortTerm}
            onChange={(event) => setShortTerm(event.target.checked)}
          />
          Short-term
        </label>
        <label className="flex items-center gap-2">
          <input
            className="size-3.5"
            disabled={disabled}
            type="checkbox"
            checked={furnished}
            onChange={(event) => setFurnished(event.target.checked)}
          />
          Furnished
        </label>
      </div>

      {visibleError ? (
        <p className="mt-3 border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {visibleError}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-52 text-xs text-muted-foreground">
          {disabled
            ? "Save a key to enable assistant requests."
            : visibleStatus ?? "Ready to send a request."}
        </p>
        <Button disabled={disabled || isCurrentlySubmitting} type="submit">
          {isCurrentlySubmitting ? "Sending..." : "Send"}
        </Button>
      </div>
    </form>
  );
}

function buildSelectedContext(mapState: MapState, selectedZoneIds: string[]) {
  const selectedZoneSet = new Set(selectedZoneIds);

  return {
    zones: mapState.zones
      .filter((zone) => selectedZoneSet.has(zone.id))
      .map((zone) => ({
        id: zone.id,
        name: zone.name,
        fitnessScore: zone.fitnessScore,
        affordabilityScore: zone.affordabilityScore,
        carFreeScore: zone.carFreeScore,
        notes: zone.notes,
      })),
    corridors: mapState.corridors.map((corridor) => ({
      id: corridor.id,
      name: corridor.name,
      priority: corridor.priority,
      tags: corridor.tags,
      notes: corridor.notes,
    })),
    targets: mapState.targets.map((target) => ({
      id: target.id,
      name: target.name,
      purpose: target.purpose,
      coordinates: target.coordinates,
      priority: target.priority,
      influence: target.influence,
      radiusMinutes: target.radiusMinutes,
      notes: target.notes,
    })),
  };
}

function parseBudget(value: string) {
  const normalized = value.replace(/[$,\s]/g, "");
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function isListingSearchPrompt(message: string) {
  const normalized = message.toLowerCase();
  return ["listing", "studio", "1br", "1 bedroom", "under", "rent", "available"].some((term) =>
    normalized.includes(term),
  );
}

function getFriendlyError(body: unknown, kind: "listing" | "map") {
  if (isRecord(body) && typeof body.error === "string" && body.error.includes("key")) {
    return "Check your OpenAI key and try again.";
  }

  return kind === "listing"
    ? "Listing search could not be completed. Try again with a narrower request."
    : "The map assistant could not create a proposal. Try again with a narrower request.";
}

function parseListingSearchResponse(value: unknown): ListingSearchResponse | null {
  const parsed = listingSearchResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function readProposal(value: unknown): MapPatchProposal | null {
  if (!isRecord(value)) {
    throw new Error("Map assistant returned an unexpected response.");
  }

  if (value.proposal === null) {
    return null;
  }

  const parsed = mapPatchProposalSchema.safeParse(value.proposal);
  if (!parsed.success) {
    throw new Error("Map assistant returned an unexpected response.");
  }

  return parsed.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
