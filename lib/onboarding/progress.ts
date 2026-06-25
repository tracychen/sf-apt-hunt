import type {
  ListingLead,
  MapState,
  OnboardingOperation,
  OnboardingProgress,
  OnboardingStepId,
  PlanningChatPart,
} from "@/lib/domain/types";
import { onboardingStepIds } from "@/lib/onboarding/steps";
import type { PlanningThreadCache } from "@/lib/storage/planning-chat-storage";

export type DeriveCompletedOnboardingStepsInput = {
  apiKey: string | null;
  planningThreadCache?: Pick<PlanningThreadCache, "messages" | "actionRecords"> | null;
  listingLeads: ListingLead[];
  // Supply these only from an editor semantic-edit path, not generic map writes.
  previousMapState?: MapState | null;
  mapState?: MapState | null;
};

export function createDefaultOnboardingProgress(now: string): OnboardingProgress {
  return {
    version: 1,
    dismissed: false,
    expanded: true,
    completedSteps: {},
    lastHighlightedStepId: null,
    updatedAt: now,
  };
}

export function completeOnboardingSteps(
  progress: OnboardingProgress,
  stepIds: OnboardingStepId[],
  now: string,
): OnboardingProgress {
  const wasComplete = isOnboardingComplete(progress);
  const nextCompletedSteps = { ...progress.completedSteps };
  let changed = false;

  for (const stepId of stepIds) {
    if (nextCompletedSteps[stepId]) {
      continue;
    }

    nextCompletedSteps[stepId] = now;
    changed = true;
  }

  if (!changed) {
    return progress;
  }

  const next: OnboardingProgress = {
    ...progress,
    completedSteps: nextCompletedSteps,
    updatedAt: now,
  };

  if (!wasComplete && isOnboardingComplete(next)) {
    return {
      ...next,
      expanded: false,
    };
  }

  return next;
}

export function applyOnboardingOperation(
  progress: OnboardingProgress,
  operation: OnboardingOperation,
  now: string,
): OnboardingProgress {
  if (operation.type === "completeSteps") {
    return completeOnboardingSteps(progress, operation.stepIds, now);
  }

  if (operation.type === "reset") {
    return createDefaultOnboardingProgress(now);
  }

  return {
    ...progress,
    dismissed: operation.dismissed ?? progress.dismissed,
    expanded: operation.expanded ?? progress.expanded,
    lastHighlightedStepId:
      "lastHighlightedStepId" in operation
        ? operation.lastHighlightedStepId ?? null
        : progress.lastHighlightedStepId,
    updatedAt: now,
  };
}

export function deriveCompletedOnboardingSteps({
  apiKey,
  listingLeads,
  mapState,
  planningThreadCache,
  previousMapState,
}: DeriveCompletedOnboardingStepsInput): OnboardingStepId[] {
  const completed = new Set<OnboardingStepId>();

  if (apiKey) {
    completed.add("set_ai_key");
  }

  if (planningThreadCache?.messages.some((message) => message.parts.some(isListingResultsPart))) {
    completed.add("ask_for_listings");
  }

  if (
    planningThreadCache?.messages.some((message) =>
      message.parts.some(
        (part) => part.type === "mapProposal" || part.type === "targetEditProposal",
      ),
    )
  ) {
    completed.add("ask_for_anchors");
  }

  if (
    planningThreadCache?.actionRecords.some(
      (action) =>
        action.status === "applied" &&
        (action.kind === "mapProposal" || action.kind === "targetEdit"),
    )
  ) {
    completed.add("apply_map_suggestion");
  }

  if (listingLeads.some((lead) => lead.status === "saved" || lead.status === "dismissed")) {
    completed.add("review_listing");
  }

  if (previousMapState && mapState && hasAnchorSemanticEdit(previousMapState, mapState)) {
    completed.add("edit_anchor_meaning");
  }

  return Array.from(completed);
}

export function hasAnchorSemanticEdit(previousMapState: MapState, mapState: MapState) {
  for (const previousTarget of previousMapState.targets) {
    const target = mapState.targets.find((item) => item.id === previousTarget.id);

    if (!target) {
      continue;
    }

    if (
      previousTarget.name !== target.name ||
      previousTarget.purpose !== target.purpose ||
      previousTarget.influence !== target.influence ||
      previousTarget.priority !== target.priority ||
      previousTarget.radiusMinutes !== target.radiusMinutes ||
      !stringArraysEqual(previousTarget.notes, target.notes)
    ) {
      return true;
    }
  }

  for (const previousCorridor of previousMapState.corridors) {
    const corridor = mapState.corridors.find((item) => item.id === previousCorridor.id);

    if (!corridor) {
      continue;
    }

    if (
      previousCorridor.name !== corridor.name ||
      previousCorridor.priority !== corridor.priority ||
      !stringArraysEqual(previousCorridor.tags, corridor.tags) ||
      !stringArraysEqual(previousCorridor.notes, corridor.notes)
    ) {
      return true;
    }
  }

  return false;
}

function isListingResultsPart(part: PlanningChatPart) {
  return part.type === "listingResults";
}

export function isOnboardingComplete(progress: Pick<OnboardingProgress, "completedSteps">) {
  return onboardingStepIds.every((stepId) => Boolean(progress.completedSteps[stepId]));
}

function stringArraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
