"use client";

import type { ListingCandidate, MapPatchProposal, MapState } from "@/lib/domain/types";
import { ApiKeyDialog } from "@/components/apartment-map/api-key-dialog";
import { AssistantPanel } from "@/components/apartment-map/assistant-panel";
import { ListingResults } from "@/components/apartment-map/listing-results";
import { ProposalReviewDialog } from "@/components/apartment-map/proposal-review-dialog";
import { Button } from "@/components/ui/button";

export function Sidebar({
  mapState,
  selectedZoneIds,
  listings,
  proposal,
  onListingsChange,
  onProposalChange,
  onApplyProposal,
  onRejectProposal,
  onUndo,
  onReset,
  canUndo,
}: {
  mapState: MapState;
  selectedZoneIds: string[];
  listings: ListingCandidate[];
  proposal: MapPatchProposal | null;
  onListingsChange: (listings: ListingCandidate[]) => void;
  onProposalChange: (proposal: MapPatchProposal | null) => void;
  onApplyProposal: () => void;
  onRejectProposal: () => void;
  onUndo: () => void;
  onReset: () => void;
  canUndo: boolean;
}) {
  return (
    <aside className="flex min-h-[42vh] flex-col bg-sidebar text-sidebar-foreground lg:max-h-screen lg:min-h-screen lg:overflow-y-auto">
      <div className="border-b border-sidebar-border p-4">
        <p className="text-xs uppercase text-muted-foreground">Local-first workspace</p>
        <h1 className="mt-1 text-xl font-semibold">SF Apartment Hunt</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          {mapState.zones.length} zones, {selectedZoneIds.length} selected,{" "}
          {listings.length} listings staged.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-sidebar-border p-3">
        <Button disabled={!canUndo} variant="outline" onClick={onUndo}>
          Undo
        </Button>
        <Button variant="outline" onClick={onReset}>
          Reset local map
        </Button>
      </div>

      <div className="space-y-4 p-4">
        <ApiKeyDialog apiKey={null} remembered={false} onApiKeyChange={() => {}} />
        <AssistantPanel
          apiKey={null}
          mapState={mapState}
          selectedZoneIds={selectedZoneIds}
          onProposalChange={onProposalChange}
          onListingsChange={onListingsChange}
        />
        <ListingResults listings={listings} />
        <ProposalReviewDialog
          proposal={proposal}
          onApply={onApplyProposal}
          onReject={onRejectProposal}
        />
      </div>
    </aside>
  );
}
