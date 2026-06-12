"use client";

import { flushSync } from "react-dom";

import {
  applyCorridorMetadataEdit,
  type CorridorMetadataPatch,
} from "@/components/apartment-map/leaflet-map-state";
import type { MapState, TargetCorridor } from "@/lib/domain/types";

type CorridorEditorProps = {
  mapState: MapState;
  corridor: TargetCorridor;
  onMapStateChange: (state: MapState) => void;
};

const corridorTags = ["fitness", "rent", "transit", "safety", "short-term"] as const;

export function CorridorEditor({ mapState, corridor, onMapStateChange }: CorridorEditorProps) {
  const notesValue = corridor.notes.join("\n");

  function commitName(input: HTMLInputElement) {
    const value = readRequiredText(input, corridor.name);
    if (!value) {
      return;
    }

    commitPatch({ name: value });
  }

  function commitPriority(value: string) {
    if (value !== "high" && value !== "medium" && value !== "low") {
      return;
    }

    commitPatch({ priority: value });
  }

  function commitTag(tag: TargetCorridor["tags"][number], checked: boolean) {
    const nextTags = checked
      ? [...corridor.tags, tag]
      : corridor.tags.filter((item) => item !== tag);

    commitPatch({ tags: corridorTags.filter((item) => nextTags.includes(item)) });
  }

  function commitNotes(input: HTMLTextAreaElement) {
    commitPatch({ notes: readNotes(input) });
  }

  function commitPatch(patch: CorridorMetadataPatch) {
    const nextState = applyCorridorMetadataEdit(mapState, corridor.id, patch);

    if (nextState) {
      flushSync(() => onMapStateChange(nextState));
      closeOpenCorridorPopup();
    }
  }

  return (
    <section className="border border-sidebar-border bg-background p-3 text-sm">
      <h2 className="font-medium">Selected corridor</h2>
      <div className="mt-3 space-y-3">
        <label className="block text-xs font-medium" htmlFor="corridor-name">
          Name
        </label>
        <input
          key={`${corridor.id}:name:${corridor.name}`}
          id="corridor-name"
          aria-label="Corridor name"
          className="w-full border border-input bg-background p-2 text-sm"
          defaultValue={corridor.name}
          onBlur={(event) => commitName(event.currentTarget)}
        />

        <label className="block text-xs font-medium" htmlFor="corridor-priority">
          Priority
        </label>
        <select
          id="corridor-priority"
          aria-label="Corridor priority"
          className="w-full border border-input bg-background p-2 text-sm"
          value={corridor.priority}
          onChange={(event) => commitPriority(event.target.value)}
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium">Tags</legend>
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            {corridorTags.map((tag) => (
              <label key={tag} className="flex items-center gap-2">
                <input
                  aria-label={`Corridor tag ${tag}`}
                  className="size-3.5"
                  type="checkbox"
                  checked={corridor.tags.includes(tag)}
                  onChange={(event) => commitTag(tag, event.currentTarget.checked)}
                />
                {tag}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block text-xs font-medium" htmlFor="corridor-notes">
          Notes
        </label>
        <textarea
          key={`${corridor.id}:notes:${notesValue}`}
          id="corridor-notes"
          aria-label="Corridor notes"
          className="min-h-24 w-full border border-input bg-background p-2 text-sm"
          defaultValue={notesValue}
          onBlur={(event) => commitNotes(event.currentTarget)}
        />

        <p className="text-xs text-muted-foreground">
          Geometry: {corridor.geometry.coordinates.length} points
        </p>
      </div>
    </section>
  );
}

function closeOpenCorridorPopup() {
  document
    .querySelectorAll<HTMLElement>(".leaflet-popup-pane .leaflet-popup")
    .forEach((popup) => popup.remove());
}

function readRequiredText(input: HTMLInputElement, currentValue: string) {
  const value = input.value.trim();

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
    .map((note) => note.trim())
    .filter(Boolean);

  input.value = notes.join("\n");
  return notes;
}
