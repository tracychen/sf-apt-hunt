"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { putWorkspaceOnboardingResponseSchema } from "@/lib/domain/schemas";
import type {
  ListingLead,
  OnboardingOperation,
  OnboardingProgress,
  OnboardingStepId,
} from "@/lib/domain/types";
import {
  applyOnboardingOperation,
  createDefaultOnboardingProgress,
  deriveCompletedOnboardingSteps,
  isOnboardingComplete,
} from "@/lib/onboarding/progress";
import {
  loadOnboardingProgress,
  saveOnboardingProgress,
} from "@/lib/storage/onboarding-storage";
import type { PlanningThreadCache } from "@/lib/storage/planning-chat-storage";

type OnboardingPersistenceMode =
  | { kind: "local" }
  | { kind: "workspace"; initialProgress: OnboardingProgress };

export type OnboardingController = {
  progress: OnboardingProgress;
  persistenceError: string | null;
  completedCount: number;
  completeSteps: (stepIds: OnboardingStepId[]) => void;
  setPanelState: (state: {
    dismissed?: boolean;
    expanded?: boolean;
    lastHighlightedStepId?: OnboardingStepId | null;
  }) => void;
  reset: () => void;
};

export function useOnboardingController({
  apiKey,
  listingLeads,
  mode,
  planningThreadCache,
}: {
  apiKey: string | null;
  listingLeads: ListingLead[];
  mode: OnboardingPersistenceMode;
  planningThreadCache: PlanningThreadCache | null;
}): OnboardingController {
  const [progress, setProgress] = useState<OnboardingProgress>(() =>
    mode.kind === "workspace"
      ? mode.initialProgress
      : createDefaultOnboardingProgress(new Date().toISOString()),
  );
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const workspaceInitialProgress = mode.kind === "workspace" ? mode.initialProgress : null;
  const previousWorkspaceInitialProgressRef = useRef(workspaceInitialProgress);

  useEffect(() => {
    if (mode.kind !== "local") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setProgress(loadOnboardingProgress(undefined, new Date().toISOString()));
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [mode.kind]);

  useEffect(() => {
    if (previousWorkspaceInitialProgressRef.current === workspaceInitialProgress) {
      return;
    }
    previousWorkspaceInitialProgressRef.current = workspaceInitialProgress;

    if (workspaceInitialProgress) {
      const timeoutId = window.setTimeout(() => setProgress(workspaceInitialProgress), 0);
      return () => window.clearTimeout(timeoutId);
    }
  }, [workspaceInitialProgress]);

  const persistOperation = useCallback(
    async (operation: OnboardingOperation, optimisticProgress: OnboardingProgress) => {
      if (mode.kind === "local") {
        saveOnboardingProgress(optimisticProgress);
        return;
      }

      try {
        const response = await fetch("/api/workspace/onboarding", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operation }),
        });
        const body: unknown = await response.json().catch(() => null);
        const parsed = putWorkspaceOnboardingResponseSchema.parse(body);

        if (!parsed.ok) {
          setPersistenceError("Getting started progress could not be saved.");
          return;
        }

        setProgress((current) => {
          if (operation.type === "reset") {
            return parsed.progress;
          }

          const completedSteps = {
            ...current.completedSteps,
            ...parsed.progress.completedSteps,
          };

          const mergedProgress =
            operation.type === "completeSteps"
              ? {
                  ...current,
                  completedSteps,
                  updatedAt: parsed.progress.updatedAt,
                }
              : {
                  ...parsed.progress,
                  completedSteps,
                };

          if (!isOnboardingComplete(current) && isOnboardingComplete(mergedProgress)) {
            return {
              ...mergedProgress,
              expanded: false,
            };
          }

          return mergedProgress;
        });
        setPersistenceError(null);
      } catch {
        setPersistenceError("Getting started progress could not be saved.");
      }
    },
    [mode],
  );

  const applyOperation = useCallback(
    (operation: OnboardingOperation) => {
      const now = new Date().toISOString();
      setProgress((current) => {
        const next = applyOnboardingOperation(current, operation, now);
        void persistOperation(operation, next);
        return next;
      });
    },
    [persistOperation],
  );

  const completeSteps = useCallback(
    (stepIds: OnboardingStepId[]) => {
      if (stepIds.length === 0) {
        return;
      }
      applyOperation({ type: "completeSteps", stepIds });
    },
    [applyOperation],
  );

  useEffect(() => {
    const derived = deriveCompletedOnboardingSteps({
      apiKey,
      listingLeads,
      planningThreadCache,
    }).filter((stepId) => !progress.completedSteps[stepId]);

    if (derived.length > 0) {
      const timeoutId = window.setTimeout(() => completeSteps(derived), 0);
      return () => window.clearTimeout(timeoutId);
    }
  }, [apiKey, completeSteps, listingLeads, planningThreadCache, progress.completedSteps]);

  return useMemo(
    () => ({
      progress,
      persistenceError,
      completedCount: Object.keys(progress.completedSteps).length,
      completeSteps,
      setPanelState: (state) => applyOperation({ type: "setPanelState", ...state }),
      reset: () => applyOperation({ type: "reset" }),
    }),
    [applyOperation, completeSteps, persistenceError, progress],
  );
}
