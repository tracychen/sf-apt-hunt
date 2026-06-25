"use client";

import { flushSync } from "react-dom";

import {
  applyPlanningAreaMetadataEdit,
  type PlanningAreaMetadataPatch,
} from "@/components/apartment-map/leaflet-map-state";
import type { AnchorSemanticEdit } from "@/components/apartment-map/target-editor";
import type { MapState, PlanningArea } from "@/lib/domain/types";

type AreaEditorProps = {
  area: PlanningArea;
  mapState: MapState;
  onMapStateChange: (state: MapState) => void;
  onSemanticEdit?: (edit: AnchorSemanticEdit) => void;
};

type AreaSemanticField = Extract<AnchorSemanticEdit, { kind: "area" }>["field"];

const MAX_AREA_NAME_LENGTH = 160;
const MAX_AREA_TEXT_LENGTH = 2_000;
const MAX_AREA_NOTES = 50;

export function AreaEditor({
  area,
  mapState,
  onMapStateChange,
  onSemanticEdit,
}: AreaEditorProps) {
  const notesValue = area.notes.join("\n");

  function commitName(input: HTMLInputElement) {
    const value = readRequiredText(input, area.name, MAX_AREA_NAME_LENGTH);
    if (!value) {
      return;
    }

    commitPatch({ name: value }, "name");
  }

  function commitPurpose(input: HTMLInputElement) {
    const value = readRequiredText(input, area.purpose, MAX_AREA_TEXT_LENGTH);
    if (!value) {
      return;
    }

    commitPatch({ purpose: value }, "purpose");
  }

  function commitInfluence(value: string) {
    if (value !== "positive" && value !== "negative" && value !== "neutral") {
      return;
    }

    commitPatch({ influence: value }, "influence");
  }

  function commitPriority(value: string) {
    if (value !== "high" && value !== "medium" && value !== "low") {
      return;
    }

    commitPatch({ priority: value }, "priority");
  }

  function commitNotes(input: HTMLTextAreaElement) {
    commitPatch({ notes: readNotes(input) }, "notes");
  }

  function commitPatch(patch: PlanningAreaMetadataPatch, field: AreaSemanticField) {
    const nextState = applyPlanningAreaMetadataEdit(mapState, area.id, patch);

    if (nextState) {
      flushSync(() => onMapStateChange(nextState));
      closeOpenAreaPopup();
      onSemanticEdit?.({ kind: "area", areaId: area.id, field });
    }
  }

  return (
    <section
      className="border border-sidebar-border bg-background p-3 text-sm"
      data-onboarding-target="anchor-editor"
    >
      <h2 className="font-medium">Selected area</h2>
      <div className="mt-3 space-y-3">
        <label className="block text-xs font-medium" htmlFor="area-purpose">
          Purpose
        </label>
        <input
          key={`${area.id}:purpose:${area.purpose}`}
          id="area-purpose"
          aria-label="Area purpose"
          className="w-full border border-input bg-background p-2 text-sm"
          defaultValue={area.purpose}
          onBlur={(event) => commitPurpose(event.currentTarget)}
        />

        <label className="block text-xs font-medium" htmlFor="area-name">
          Name
        </label>
        <input
          key={`${area.id}:name:${area.name}`}
          id="area-name"
          aria-label="Area name"
          className="w-full border border-input bg-background p-2 text-sm"
          defaultValue={area.name}
          onBlur={(event) => commitName(event.currentTarget)}
        />

        <label className="block text-xs font-medium" htmlFor="area-influence">
          Influence
        </label>
        <select
          id="area-influence"
          aria-label="Area influence"
          className="w-full border border-input bg-background p-2 text-sm"
          value={area.influence}
          onChange={(event) => commitInfluence(event.target.value)}
        >
          <option value="positive">Prefer</option>
          <option value="negative">Avoid</option>
          <option value="neutral">Neutral</option>
        </select>

        <label className="block text-xs font-medium" htmlFor="area-priority">
          Priority
        </label>
        <select
          id="area-priority"
          aria-label="Area priority"
          className="w-full border border-input bg-background p-2 text-sm"
          value={area.priority}
          onChange={(event) => commitPriority(event.target.value)}
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <label className="block text-xs font-medium" htmlFor="area-notes">
          Notes
        </label>
        <textarea
          key={`${area.id}:notes:${notesValue}`}
          id="area-notes"
          aria-label="Area notes"
          className="min-h-24 w-full border border-input bg-background p-2 text-sm"
          defaultValue={notesValue}
          onBlur={(event) => commitNotes(event.currentTarget)}
        />

        <p className="text-xs text-muted-foreground">
          Geometry: {area.geometry.coordinates[0]?.length ?? 0} points
        </p>
      </div>
    </section>
  );
}

function closeOpenAreaPopup() {
  document
    .querySelectorAll<HTMLElement>(".leaflet-popup-pane .leaflet-popup")
    .forEach((popup) => popup.remove());
}

function readRequiredText(input: HTMLInputElement, currentValue: string, maxLength: number) {
  const value = clampText(input.value.trim(), maxLength);

  if (!value) {
    input.value = currentValue;
    return null;
  }

  input.value = value;
  return value;
}

function readNotes(input: HTMLTextAreaElement) {
  const notes = input.value
    .split("\n")
    .map((note) => clampText(note.trim(), MAX_AREA_TEXT_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_AREA_NOTES);

  input.value = notes.join("\n");
  return notes;
}

function clampText(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
