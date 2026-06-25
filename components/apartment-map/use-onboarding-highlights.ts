"use client";

import { useCallback, useRef, useState } from "react";
import { driver, type DriveStep } from "driver.js";

import type { OnboardingStepId } from "@/lib/domain/types";
import type { OnboardingHighlightTarget } from "@/lib/onboarding/steps";
import { onboardingSteps } from "@/lib/onboarding/steps";

const targetSelectors = {
  apiKey: '[data-onboarding-target="api-key"]',
  planningChatInput: '[data-onboarding-target="planning-chat-input"]',
  proposalCard: '[data-onboarding-target="proposal-card"]',
  anchorEditor: '[data-onboarding-target="anchor-editor"]',
  mapLayers: '[data-onboarding-target="map-layers"]',
  listingCard: '[data-onboarding-target="listing-card"]',
} as const satisfies Record<OnboardingHighlightTarget, string>;

export function useOnboardingHighlights() {
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const showOnboardingStep = useCallback((stepId: OnboardingStepId) => {
    const step = onboardingSteps.find((item) => item.id === stepId);
    if (!step) {
      return;
    }

    const selector = targetSelectors[step.highlightTarget];
    const element = document.querySelector(selector);
    if (!element) {
      setMessage(missingTargetMessage(stepId));
      return;
    }

    driverRef.current?.destroy();
    const driverObj = driver({
      allowClose: true,
      animate: true,
      showButtons: ["close"],
      onDestroyStarted: () => {
        driverObj.destroy();
      },
    });
    driverRef.current = driverObj;
    setMessage(null);

    const driveStep: DriveStep = {
      element: selector,
      popover: {
        title: step.title,
        description: step.description,
      },
    };
    driverObj.highlight(driveStep);
  }, []);

  return { message, showOnboardingStep };
}

function missingTargetMessage(stepId: OnboardingStepId) {
  if (stepId === "apply_map_suggestion") {
    return "Ask chat for a map suggestion first.";
  }

  if (stepId === "edit_anchor_meaning") {
    return "Select a pin or corridor to edit it.";
  }

  if (stepId === "review_listing") {
    return "Ask for listings first.";
  }

  return "Open the relevant sidebar section first.";
}
