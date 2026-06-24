import "server-only";

import { headers } from "next/headers";

const e2eAuthCookieName = "sf-apt-e2e-auth";

export async function getCurrentUserId(request?: Request) {
  const requestHeaders = request ? request.headers : await headers();
  const e2eUserId = readPlaywrightUserId(requestHeaders);

  if (e2eUserId) {
    return e2eUserId;
  }

  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("DATABASE_URL is required for production authentication.");
    }

    return null;
  }

  const { getAuth } = await import("@/lib/server/auth/config");

  const session = await getAuth().api.getSession({
    headers: requestHeaders,
  });

  return session?.user?.id ?? null;
}

export async function requireCurrentUserId(request?: Request) {
  const userId = await getCurrentUserId(request);

  if (!userId) {
    throw new UnauthorizedError();
  }

  return userId;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
  }
}

function readPlaywrightUserId(requestHeaders: Headers) {
  if (!isPlaywrightAuthEnabled()) {
    return null;
  }

  const userId = process.env.SF_APT_E2E_USER_ID?.trim();
  const expectedToken = process.env.SF_APT_E2E_AUTH_TOKEN?.trim();

  if (!userId || !expectedToken) {
    return null;
  }

  const cookieToken = readCookieValue(requestHeaders.get("cookie"), e2eAuthCookieName);
  return cookieToken === expectedToken ? userId : null;
}

function isPlaywrightAuthEnabled() {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  return process.env.SF_APT_E2E_AUTH_ENABLED?.trim() === "true";
}

function readCookieValue(cookieHeader: string | null, cookieName: string) {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name !== cookieName) {
      continue;
    }

    const value = valueParts.join("=");
    return value ? decodeURIComponent(value) : "";
  }

  return null;
}
