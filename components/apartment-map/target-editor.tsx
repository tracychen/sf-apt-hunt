"use client";

import { flushSync } from "react-dom";

import { applyTargetPlanningFieldEdit } from "@/components/apartment-map/leaflet-map-state";
import type { MapState, TargetPoint } from "@/lib/domain/types";

export type AnchorSemanticEdit =
  | {
      kind: "target";
      targetId: string;
      field: "purpose" | "influence" | "priority" | "radiusMinutes" | "notes" | "name";
    }
  | {
      kind: "corridor";
      corridorId: string;
      field: "name" | "priority" | "tags" | "notes";
    }
  | {
      kind: "area";
      areaId: string;
      field: "name" | "purpose" | "influence" | "priority" | "notes";
    };

type TargetEditorProps = {
  mapState: MapState;
  target: TargetPoint;
  onMapStateChange: (state: MapState) => void;
  onSemanticEdit?: (edit: AnchorSemanticEdit) => void;
};

const MAX_TARGET_NAME_LENGTH = 160;
const MAX_TARGET_TEXT_LENGTH = 2_000;
const MAX_TARGET_NOTES = 50;

export function TargetEditor({
  mapState,
  target,
  onMapStateChange,
  onSemanticEdit,
}: TargetEditorProps) {
  const notesValue = target.notes.join("\n");

  function commitPurpose(input: HTMLInputElement) {
    const value = readRequiredText(input, target.purpose, MAX_TARGET_TEXT_LENGTH);
    if (!value) {
      return;
    }

    const nextState = applyTargetPlanningFieldEdit(mapState, target.id, { purpose: value });
    if (nextState) {
      commitMapState(nextState);
      onSemanticEdit?.({ kind: "target", targetId: target.id, field: "purpose" });
    }
  }

  function commitName(input: HTMLInputElement) {
    const value = readRequiredText(input, target.name, MAX_TARGET_NAME_LENGTH);
    if (!value) {
      return;
    }

    const nextState = applyTargetPlanningFieldEdit(mapState, target.id, { name: value });
    if (nextState) {
      commitMapState(nextState);
      onSemanticEdit?.({ kind: "target", targetId: target.id, field: "name" });
    }
  }

  function commitNotes(input: HTMLTextAreaElement) {
    const nextNotes = readNotes(input);
    const nextState = applyTargetPlanningFieldEdit(mapState, target.id, { notes: nextNotes });

    if (nextState) {
      commitMapState(nextState);
      onSemanticEdit?.({ kind: "target", targetId: target.id, field: "notes" });
    }
  }

  function commitSelectField(
    field: "influence" | "priority" | "radiusMinutes",
    value: string,
  ) {
    const patch = readSelectPatch(field, value);
    if (!patch) {
      return;
    }

    const nextState = applyTargetPlanningFieldEdit(mapState, target.id, patch);

    if (nextState) {
      commitMapState(nextState);
      onSemanticEdit?.({ kind: "target", targetId: target.id, field });
    }
  }

  function commitMapState(nextState: MapState) {
    flushSync(() => onMapStateChange(nextState));
    closeOpenTargetPopup();
  }

  return (
    <section
      className="border border-sidebar-border bg-background p-3 text-sm"
      data-onboarding-target="anchor-editor"
    >
      <h2 className="font-medium">Selected target</h2>
      <div className="mt-3 space-y-3">
        <label className="block text-xs font-medium" htmlFor="target-purpose">
          Purpose
        </label>
        <input
          key={`${target.id}:purpose:${target.purpose}`}
          id="target-purpose"
          aria-label="Target purpose"
          className="w-full border border-input bg-background p-2 text-sm"
          defaultValue={target.purpose}
          onBlur={(event) => commitPurpose(event.currentTarget)}
        />

        <label className="block text-xs font-medium" htmlFor="target-name">
          Location label
        </label>
        <input
          key={`${target.id}:name:${target.name}`}
          id="target-name"
          aria-label="Target location label"
          className="w-full border border-input bg-background p-2 text-sm"
          defaultValue={target.name}
          onBlur={(event) => commitName(event.currentTarget)}
        />

        <label className="block text-xs font-medium" htmlFor="target-influence">
          Influence
        </label>
        <select
          id="target-influence"
          aria-label="Target influence"
          className="w-full border border-input bg-background p-2 text-sm"
          value={target.influence}
          onChange={(event) => commitSelectField("influence", event.target.value)}
        >
          <option value="positive">Positive</option>
          <option value="negative">Negative</option>
          <option value="neutral">Neutral</option>
        </select>

        <label className="block text-xs font-medium" htmlFor="target-priority">
          Priority
        </label>
        <select
          id="target-priority"
          aria-label="Target priority"
          className="w-full border border-input bg-background p-2 text-sm"
          value={target.priority}
          onChange={(event) => commitSelectField("priority", event.target.value)}
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <label className="block text-xs font-medium" htmlFor="target-radius">
          Radius
        </label>
        <select
          id="target-radius"
          aria-label="Target radius"
          className="w-full border border-input bg-background p-2 text-sm"
          value={String(target.radiusMinutes)}
          onChange={(event) => commitSelectField("radiusMinutes", event.target.value)}
        >
          <option value="5">5 minutes</option>
          <option value="10">10 minutes</option>
          <option value="15">15 minutes</option>
          <option value="20">20 minutes</option>
        </select>

        <label className="block text-xs font-medium" htmlFor="target-notes">
          Notes
        </label>
        <textarea
          key={`${target.id}:notes:${notesValue}`}
          id="target-notes"
          aria-label="Target notes"
          className="min-h-24 w-full border border-input bg-background p-2 text-sm"
          defaultValue={notesValue}
          onBlur={(event) => commitNotes(event.currentTarget)}
        />
        <p className="text-xs text-muted-foreground">
          Coordinates: {target.coordinates[1].toFixed(5)}, {target.coordinates[0].toFixed(5)}
        </p>
      </div>
    </section>
  );
}

function closeOpenTargetPopup() {
  // Marker clicks open a transient Leaflet popup; after sidebar edits, avoid a stale duplicate label.
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
    .map((note) => clampText(note.trim(), MAX_TARGET_TEXT_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_TARGET_NOTES);

  input.value = notes.join("\n");
  return notes;
}

function clampText(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function readSelectPatch(
  field: "influence" | "priority" | "radiusMinutes",
  value: string,
): Partial<Pick<TargetPoint, "influence" | "priority" | "radiusMinutes">> | null {
  if (field === "radiusMinutes") {
    const radiusMinutes = Number(value);

    return radiusMinutes === 5 ||
      radiusMinutes === 10 ||
      radiusMinutes === 15 ||
      radiusMinutes === 20
      ? { radiusMinutes }
      : null;
  }

  if (field === "influence") {
    return value === "positive" || value === "negative" || value === "neutral"
      ? { influence: value }
      : null;
  }

  return value === "high" || value === "medium" || value === "low" ? { priority: value } : null;
}
