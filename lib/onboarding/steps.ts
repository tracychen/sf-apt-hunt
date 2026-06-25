import type { OnboardingStepId } from "@/lib/domain/types";

export type OnboardingHighlightTarget =
  | "apiKey"
  | "planningChatInput"
  | "proposalCard"
  | "anchorEditor"
  | "mapLayers"
  | "listingCard";

export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  description: string;
  highlightTarget: OnboardingHighlightTarget;
};

export const onboardingStepIds = [
  "set_ai_key",
  "ask_for_anchors",
  "apply_map_suggestion",
  "edit_anchor_meaning",
  "ask_for_listings",
  "review_listing",
] as const satisfies readonly OnboardingStepId[];

export const onboardingSteps: OnboardingStep[] = [
  {
    id: "set_ai_key",
    title: "Add your OpenAI key",
    description: "Enable chat so the app can help with map anchors and listings.",
    highlightTarget: "apiKey",
  },
  {
    id: "ask_for_anchors",
    title: "Ask chat to add pins or corridors",
    description: "Start with the places and routes that matter to your search.",
    highlightTarget: "planningChatInput",
  },
  {
    id: "apply_map_suggestion",
    title: "Review a suggested map change",
    description: "Apply only the pins or corridors you want to keep.",
    highlightTarget: "proposalCard",
  },
  {
    id: "edit_anchor_meaning",
    title: "Give an anchor planning meaning",
    description: "Set priority, purpose, influence, tags, or notes.",
    highlightTarget: "anchorEditor",
  },
  {
    id: "ask_for_listings",
    title: "Ask for listings near your priorities",
    description: "Use your map context to search for matching leads.",
    highlightTarget: "planningChatInput",
  },
  {
    id: "review_listing",
    title: "Save or dismiss a listing",
    description: "Keep promising leads and remove poor fits.",
    highlightTarget: "listingCard",
  },
];
