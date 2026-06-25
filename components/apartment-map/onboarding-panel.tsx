"use client";

import type { OnboardingStepId } from "@/lib/domain/types";
import { onboardingSteps } from "@/lib/onboarding/steps";
import { Button } from "@/components/ui/button";

export function OnboardingPanel({
  completedCount,
  onDismiss,
  onReset,
  onReview,
  onShowStep,
  highlightMessage,
  persistenceError,
  progress,
}: {
  completedCount: number;
  progress: {
    dismissed: boolean;
    expanded: boolean;
    completedSteps: Partial<Record<OnboardingStepId, string>>;
  };
  highlightMessage: string | null;
  persistenceError: string | null;
  onDismiss: () => void;
  onReset: () => void;
  onReview: () => void;
  onShowStep: (stepId: OnboardingStepId) => void;
}) {
  const totalCount = onboardingSteps.length;
  const isComplete = completedCount === totalCount;
  const nextStepId = onboardingSteps.find((step) => !progress.completedSteps[step.id])?.id ?? null;

  if (progress.dismissed) {
    return (
      <section className="border-b border-sidebar-border p-3 text-xs">
        <Button size="sm" variant="outline" onClick={onReview}>
          Show getting started
        </Button>
      </section>
    );
  }

  if (isComplete && !progress.expanded) {
    return (
      <section className="border-b border-sidebar-border p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">Getting started complete</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onReview}>
              Review steps
            </Button>
            <Button size="sm" variant="outline" onClick={onReset}>
              Reset onboarding
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="border-b border-sidebar-border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">Getting started</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {completedCount} of {totalCount} complete
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
          <Button size="sm" variant="outline" onClick={onReset}>
            Reset onboarding
          </Button>
        </div>
      </div>

      <ol className="mt-3 space-y-2">
        {onboardingSteps.map((step) => {
          const completedAt = progress.completedSteps[step.id];
          const statusLabel = completedAt ? "Complete" : step.id === nextStepId ? "Next" : "Pending";
          return (
            <li key={step.id} className="border border-border p-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium">
                    {statusLabel}: {step.title}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {step.description}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => onShowStep(step.id)}>
                  Show me
                </Button>
              </div>
            </li>
          );
        })}
      </ol>

      {persistenceError ? (
        <p className="mt-3 text-xs text-destructive">{persistenceError}</p>
      ) : null}
      {highlightMessage ? (
        <p className="mt-3 text-xs text-muted-foreground">{highlightMessage}</p>
      ) : null}
    </section>
  );
}
