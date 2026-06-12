import { mapPatchProposalSchema } from "@/lib/domain/schemas";
import type { MapPatchProposal, MapState } from "@/lib/domain/types";
import {
  isCoordinateInSfBounds,
  isLineStringInSfBounds,
  isPolygonInSfBounds,
} from "@/lib/map/sf-bounds";
import { applyTargetPlanningFieldPatch } from "@/lib/map/target-points";

export type ProposalApplyResult =
  | { ok: true; state: MapState }
  | { ok: false; error: string };

function hasEntityId(state: MapState, id: string) {
  return (
    state.zones.some((zone) => zone.id === id) ||
    state.corridors.some((corridor) => corridor.id === id) ||
    state.targets.some((target) => target.id === id)
  );
}

export function applyProposal(state: MapState, proposal: MapPatchProposal): ProposalApplyResult {
  const parsed = mapPatchProposalSchema.safeParse(proposal);

  if (!parsed.success) {
    return { ok: false, error: "Invalid proposal shape." };
  }

  let nextState: MapState = structuredClone(state);

  for (const operation of parsed.data.operations) {
    switch (operation.type) {
      case "addTarget": {
        if (!isCoordinateInSfBounds(operation.target.coordinates)) {
          return { ok: false, error: "Target coordinates are outside San Francisco." };
        }

        if (hasEntityId(nextState, operation.target.id)) {
          return { ok: false, error: "Map entity ID already exists." };
        }

        nextState = {
          ...nextState,
          targets: [...nextState.targets, structuredClone(operation.target)],
        };
        break;
      }

      case "addCorridor": {
        if (!isLineStringInSfBounds(operation.corridor.geometry)) {
          return { ok: false, error: "Corridor geometry is outside San Francisco." };
        }

        if (hasEntityId(nextState, operation.corridor.id)) {
          return { ok: false, error: "Map entity ID already exists." };
        }

        nextState = {
          ...nextState,
          corridors: [...nextState.corridors, structuredClone(operation.corridor)],
        };
        break;
      }

      case "updateCorridorPriority": {
        if (!nextState.corridors.some((corridor) => corridor.id === operation.corridorId)) {
          return { ok: false, error: "Unknown corridor ID." };
        }

        nextState = {
          ...nextState,
          corridors: nextState.corridors.map((corridor) =>
            corridor.id === operation.corridorId
              ? {
                  ...corridor,
                  priority: operation.priority,
                  notes: [...corridor.notes, operation.reason],
                }
              : corridor,
          ),
        };
        break;
      }

      case "updateTargetPriority": {
        if (!nextState.targets.some((target) => target.id === operation.targetId)) {
          return { ok: false, error: "Unknown target ID." };
        }

        nextState = {
          ...nextState,
          targets: nextState.targets.map((target) =>
            target.id === operation.targetId
              ? {
                  ...target,
                  priority: operation.priority,
                  notes: [...target.notes, operation.reason],
                }
              : target,
          ),
        };
        break;
      }

      case "updateTargetPlanningFields": {
        if (!nextState.targets.some((target) => target.id === operation.targetId)) {
          return { ok: false, error: "Unknown target ID." };
        }

        const nextTargetState = applyTargetPlanningFieldPatch(nextState, operation.targetId, {
          name: operation.name,
          purpose: operation.purpose,
          influence: operation.influence,
          priority: operation.priority,
          radiusMinutes: operation.radiusMinutes,
          notes: operation.notes,
        });

        if (!nextTargetState) {
          return { ok: false, error: "Target planning fields did not change." };
        }

        nextState = nextTargetState;
        break;
      }

      case "updateZoneScores": {
        if (!nextState.zones.some((zone) => zone.id === operation.zoneId)) {
          return { ok: false, error: "Unknown zone ID." };
        }

        nextState = {
          ...nextState,
          zones: nextState.zones.map((zone) =>
            zone.id === operation.zoneId
              ? {
                  ...zone,
                  fitnessScore: operation.fitnessScore ?? zone.fitnessScore,
                  affordabilityScore: operation.affordabilityScore ?? zone.affordabilityScore,
                  carFreeScore: operation.carFreeScore ?? zone.carFreeScore,
                }
              : zone,
          ),
        };
        break;
      }

      case "replaceZoneGeometry": {
        if (!nextState.zones.some((zone) => zone.id === operation.zoneId)) {
          return { ok: false, error: "Unknown zone ID." };
        }

        if (!isPolygonInSfBounds(operation.geometry)) {
          return { ok: false, error: "Zone geometry is outside San Francisco." };
        }

        nextState = {
          ...nextState,
          zones: nextState.zones.map((zone) =>
            zone.id === operation.zoneId
              ? {
                  ...zone,
                  geometry: structuredClone(operation.geometry),
                  notes: [...zone.notes, operation.reason],
                }
              : zone,
          ),
        };
        break;
      }

      case "addNote": {
        if (!hasEntityId(nextState, operation.entityId)) {
          return { ok: false, error: "Unknown entity ID." };
        }

        nextState = {
          ...nextState,
          zones: nextState.zones.map((zone) =>
            zone.id === operation.entityId
              ? { ...zone, notes: [...zone.notes, operation.note] }
              : zone,
          ),
          corridors: nextState.corridors.map((corridor) =>
            corridor.id === operation.entityId
              ? { ...corridor, notes: [...corridor.notes, operation.note] }
              : corridor,
          ),
          targets: nextState.targets.map((target) =>
            target.id === operation.entityId
              ? { ...target, notes: [...target.notes, operation.note] }
              : target,
          ),
        };
        break;
      }
    }
  }

  return { ok: true, state: nextState };
}
