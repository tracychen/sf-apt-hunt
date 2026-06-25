import { onboardingProgressSchema } from "@/lib/domain/schemas";
import type { OnboardingProgress } from "@/lib/domain/types";
import { createDefaultOnboardingProgress } from "@/lib/onboarding/progress";

export const onboardingProgressStorageKey = "sf-apt-hunt:onboarding-progress:v1";

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function getBrowserLocalStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function resolveLocalStorage(storage?: StorageLike): StorageLike | null {
  try {
    return storage ?? getBrowserLocalStorage();
  } catch {
    return null;
  }
}

function parseJson(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function loadOnboardingProgress(
  storage?: StorageLike,
  now = new Date().toISOString(),
): OnboardingProgress {
  const localStorage = resolveLocalStorage(storage);
  if (!localStorage) {
    return createDefaultOnboardingProgress(now);
  }

  try {
    const raw = localStorage.getItem(onboardingProgressStorageKey);
    if (!raw) {
      return createDefaultOnboardingProgress(now);
    }

    const parsed = onboardingProgressSchema.safeParse(parseJson(raw));
    return parsed.success ? parsed.data : createDefaultOnboardingProgress(now);
  } catch (error) {
    console.warn("[onboarding-storage] failed to load onboarding progress", error);
    return createDefaultOnboardingProgress(now);
  }
}

export function saveOnboardingProgress(
  progress: OnboardingProgress,
  storage?: StorageLike,
) {
  const localStorage = resolveLocalStorage(storage);
  if (!localStorage) {
    return false;
  }

  try {
    localStorage.setItem(onboardingProgressStorageKey, JSON.stringify(progress));
    return true;
  } catch (error) {
    console.warn("[onboarding-storage] failed to save onboarding progress", error);
    return false;
  }
}

export function clearOnboardingProgress(storage?: StorageLike) {
  const localStorage = resolveLocalStorage(storage);
  if (!localStorage) {
    return;
  }

  try {
    localStorage.removeItem(onboardingProgressStorageKey);
  } catch (error) {
    console.warn("[onboarding-storage] failed to clear onboarding progress", error);
  }
}
