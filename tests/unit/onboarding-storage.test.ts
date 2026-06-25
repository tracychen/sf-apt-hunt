import { describe, expect, test } from "vitest";

import {
  clearOnboardingProgress,
  loadOnboardingProgress,
  onboardingProgressStorageKey,
  saveOnboardingProgress,
} from "@/lib/storage/onboarding-storage";

const now = "2026-06-24T12:00:00.000Z";

class FakeStorage implements Pick<Storage, "getItem" | "removeItem" | "setItem"> {
  values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class ThrowingStorage implements Pick<Storage, "getItem" | "removeItem" | "setItem"> {
  getItem(): string | null {
    throw new Error("storage unavailable");
  }

  removeItem(): void {
    throw new Error("storage unavailable");
  }

  setItem(): void {
    throw new Error("storage unavailable");
  }
}

describe("onboarding storage", () => {
  test("loads default progress when storage is empty", () => {
    expect(loadOnboardingProgress(new FakeStorage(), now)).toEqual({
      version: 1,
      dismissed: false,
      expanded: true,
      completedSteps: {},
      lastHighlightedStepId: null,
      updatedAt: now,
    });
  });

  test("saves and reloads valid progress", () => {
    const storage = new FakeStorage();
    const progress = {
      version: 1 as const,
      dismissed: false,
      expanded: true,
      completedSteps: { set_ai_key: now },
      lastHighlightedStepId: "set_ai_key" as const,
      updatedAt: now,
    };

    expect(saveOnboardingProgress(progress, storage)).toBe(true);
    expect(JSON.parse(storage.getItem(onboardingProgressStorageKey) ?? "{}")).toEqual(progress);
    expect(loadOnboardingProgress(storage, "2026-06-24T13:00:00.000Z")).toEqual(progress);
  });

  test("invalid JSON falls back to default progress", () => {
    const storage = new FakeStorage();
    storage.setItem(onboardingProgressStorageKey, "{");

    expect(loadOnboardingProgress(storage, now)).toEqual({
      version: 1,
      dismissed: false,
      expanded: true,
      completedSteps: {},
      lastHighlightedStepId: null,
      updatedAt: now,
    });
  });

  test("schema mismatch falls back to default progress", () => {
    const storage = new FakeStorage();
    storage.setItem(onboardingProgressStorageKey, JSON.stringify({ version: 2 }));

    expect(loadOnboardingProgress(storage, now).version).toBe(1);
    expect(loadOnboardingProgress(storage, now).completedSteps).toEqual({});
  });

  test("clear removes stored progress", () => {
    const storage = new FakeStorage();
    saveOnboardingProgress(loadOnboardingProgress(storage, now), storage);

    clearOnboardingProgress(storage);

    expect(storage.getItem(onboardingProgressStorageKey)).toBeNull();
  });

  test("storage failures return safe defaults", () => {
    const storage = new ThrowingStorage();

    expect(loadOnboardingProgress(storage, now).version).toBe(1);
    expect(saveOnboardingProgress(loadOnboardingProgress(undefined, now), storage)).toBe(false);
    expect(() => clearOnboardingProgress(storage)).not.toThrow();
  });
});
