"use client";

import type { ListingCandidate, MapPatchProposal, MapState } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";

export function AssistantPanel(props: {
  apiKey: string | null;
  mapState: MapState;
  selectedZoneIds: string[];
  onProposalChange: (proposal: MapPatchProposal | null) => void;
  onListingsChange: (listings: ListingCandidate[]) => void;
}) {
  const { apiKey, mapState, selectedZoneIds } = props;
  const disabled = !apiKey;

  function handleSubmit() {
    props.onProposalChange(null);
    props.onListingsChange([]);
  }

  return (
    <section className="border border-sidebar-border bg-background p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">Assistant</h2>
        <span className="text-xs text-muted-foreground">
          {selectedZoneIds.length} selected / {mapState.zones.length} zones
        </span>
      </div>

      <label className="mt-3 block text-xs font-medium" htmlFor="assistant-message">
        Search and map update request
      </label>
      <textarea
        id="assistant-message"
        className="mt-2 min-h-28 w-full resize-y border border-input bg-background p-2 text-sm outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        disabled={disabled}
        placeholder={
          disabled
            ? "Add an OpenAI key before asking for listing searches or map proposals."
            : "Find studio or 1BR listings under $3k near high-priority zones."
        }
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-52 text-xs text-muted-foreground">
          {disabled ? "Disabled until API key entry is wired." : "Ready to send a request."}
        </p>
        <Button disabled={disabled} onClick={handleSubmit}>
          Send
        </Button>
      </div>
    </section>
  );
}
