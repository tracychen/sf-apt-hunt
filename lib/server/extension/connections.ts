import "server-only";

import { createHash, randomBytes, randomUUID } from "crypto";
import { and, eq, isNull } from "drizzle-orm";

import { requireDb } from "@/lib/db/client";
import { extensionConnectionTokens } from "@/lib/db/schema";
import type {
  CreateExtensionConnectionResponse,
  RevokeExtensionTokenResponse,
} from "@/lib/domain/types";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

const extensionIdPattern = /^[a-p]{32}$/;
const extensionScope = "facebook_listing_import";
const tokenByteLength = 32;
const tokenLifetimeMs = 30 * 24 * 60 * 60 * 1000;

export type ExtensionBearerValidation =
  | {
      ok: true;
      userId: string;
      workspaceId: string;
      extensionId: string;
    }
  | { ok: false; error: "unauthorized" | "token_expired" };

export function isAllowedExtensionId(extensionId: string): boolean {
  return extensionIdPattern.test(extensionId) && readAllowedExtensionIds().includes(extensionId);
}

export async function createExtensionConnection(input: {
  user: {
    id: string;
    email: string;
  };
  extensionId: string;
  now?: Date;
}): Promise<CreateExtensionConnectionResponse> {
  if (!isAllowedExtensionId(input.extensionId)) {
    return { ok: false, error: "extension_not_allowed" };
  }

  const now = input.now ?? new Date();
  const { workspace } = await getOrCreateDefaultWorkspace(input.user.id, now);
  const token = randomBytes(tokenByteLength).toString("base64url");
  const expiresAt = new Date(now.getTime() + tokenLifetimeMs);

  await requireDb().insert(extensionConnectionTokens).values({
    id: `extension-token-${randomUUID()}`,
    userId: input.user.id,
    workspaceId: workspace.id,
    extensionId: input.extensionId,
    tokenHash: hashToken(token),
    scope: extensionScope,
    expiresAt,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return {
    ok: true,
    token,
    expiresAt: expiresAt.toISOString(),
    account: { email: input.user.email },
    workspace: {
      id: workspace.id,
      name: workspace.name,
    },
  };
}

export async function validateExtensionBearer(input: {
  token: string;
  extensionId: string;
  now?: Date;
}): Promise<ExtensionBearerValidation> {
  if (!isAllowedExtensionId(input.extensionId)) {
    return { ok: false, error: "unauthorized" };
  }

  const row = await requireDb().query.extensionConnectionTokens.findFirst({
    where: and(
      eq(extensionConnectionTokens.tokenHash, hashToken(input.token)),
      eq(extensionConnectionTokens.extensionId, input.extensionId),
      eq(extensionConnectionTokens.scope, extensionScope),
      isNull(extensionConnectionTokens.revokedAt),
    ),
  });

  if (!row) {
    return { ok: false, error: "unauthorized" };
  }

  const now = input.now ?? new Date();

  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, error: "token_expired" };
  }

  return {
    ok: true,
    userId: row.userId,
    workspaceId: row.workspaceId,
    extensionId: row.extensionId,
  };
}

export async function revokeExtensionBearer(input: {
  token: string;
  extensionId: string;
  now?: Date;
}): Promise<RevokeExtensionTokenResponse> {
  const validation = await validateExtensionBearer(input);

  if (!validation.ok) {
    return validation.error === "token_expired"
      ? { ok: false, error: "token_expired" }
      : { ok: false, error: "unauthorized" };
  }

  const now = input.now ?? new Date();

  await requireDb()
    .update(extensionConnectionTokens)
    .set({
      revokedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(extensionConnectionTokens.tokenHash, hashToken(input.token)),
        eq(extensionConnectionTokens.extensionId, input.extensionId),
        eq(extensionConnectionTokens.scope, extensionScope),
        isNull(extensionConnectionTokens.revokedAt),
      ),
    );

  return { ok: true };
}

export async function revokeWorkspaceExtensionConnections(input: {
  userId: string;
  workspaceId: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();

  await requireDb()
    .update(extensionConnectionTokens)
    .set({
      revokedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(extensionConnectionTokens.userId, input.userId),
        eq(extensionConnectionTokens.workspaceId, input.workspaceId),
        eq(extensionConnectionTokens.scope, extensionScope),
        isNull(extensionConnectionTokens.revokedAt),
      ),
    );
}

function readAllowedExtensionIds(): string[] {
  return (process.env.EXTENSION_ALLOWED_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => extensionIdPattern.test(value));
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
