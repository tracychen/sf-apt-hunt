import "server-only";

import { eq } from "drizzle-orm";

import { requireDb } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";
import { onboardingProgressSchema } from "@/lib/domain/schemas";
import type { OnboardingOperation } from "@/lib/domain/types";
import {
  applyOnboardingOperation,
  createDefaultOnboardingProgress,
} from "@/lib/onboarding/progress";

export async function updateWorkspaceOnboarding({
  now = new Date().toISOString(),
  operation,
  workspaceId,
}: {
  workspaceId: string;
  operation: OnboardingOperation;
  now?: string;
}) {
  return requireDb().transaction(async (tx) => {
    const [workspace] = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for("update");

    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    const currentParse = onboardingProgressSchema.safeParse(workspace.onboardingProgress);
    const current = currentParse.success ? currentParse.data : createDefaultOnboardingProgress(now);
    const nextProgress = applyOnboardingOperation(current, operation, now);

    const [updated] = await tx
      .update(workspaces)
      .set({
        onboardingProgress: nextProgress,
        updatedAt: new Date(now),
      })
      .where(eq(workspaces.id, workspaceId))
      .returning();

    return onboardingProgressSchema.parse(updated.onboardingProgress);
  });
}
