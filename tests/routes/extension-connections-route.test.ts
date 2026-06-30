import { beforeEach, describe, expect, test, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({
  user: null as null | { id: string; email: string },
}));
const workspaceMocks = vi.hoisted(() => ({
  getOrCreateDefaultWorkspace: vi.fn(),
}));
const connectionMocks = vi.hoisted(() => ({
  createExtensionConnection: vi.fn(),
  revokeWorkspaceExtensionConnections: vi.fn(),
  revokeExtensionBearer: vi.fn(),
}));

vi.mock("@/lib/server/auth/session", () => {
  class MockUnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
    }
  }

  return {
    UnauthorizedError: MockUnauthorizedError,
    requireCurrentUser: async () => {
      if (!sessionMock.user) {
        throw new MockUnauthorizedError();
      }

      return sessionMock.user;
    },
  };
});

vi.mock("@/lib/server/workspaces", () => ({
  getOrCreateDefaultWorkspace: workspaceMocks.getOrCreateDefaultWorkspace,
}));

vi.mock("@/lib/server/extension/connections", () => connectionMocks);

import { POST } from "@/app/api/extension/connections/route";
import { DELETE as DELETE_CURRENT } from "@/app/api/extension/connections/current/route";
import { DELETE as DELETE_TOKEN } from "@/app/api/extension/connections/token/route";

describe("extension connection routes", () => {
  beforeEach(() => {
    sessionMock.user = null;
    connectionMocks.createExtensionConnection.mockReset();
    connectionMocks.revokeWorkspaceExtensionConnections.mockReset();
    connectionMocks.revokeExtensionBearer.mockReset();
    workspaceMocks.getOrCreateDefaultWorkspace.mockReset();
    workspaceMocks.getOrCreateDefaultWorkspace.mockResolvedValue({
      workspace: { id: "workspace-1", name: "Apartment hunt" },
    });
    connectionMocks.createExtensionConnection.mockResolvedValue({
      ok: true,
      token: "token-1",
      expiresAt: "2026-07-30T02:00:00.000Z",
      account: { email: "tracy@example.com" },
      workspace: { id: "workspace-1", name: "Apartment hunt" },
    });
    connectionMocks.revokeExtensionBearer.mockResolvedValue({ ok: true });
    connectionMocks.revokeWorkspaceExtensionConnections.mockResolvedValue(undefined);
  });

  test("POST /api/extension/connections rejects signed-out users", async () => {
    const response = await POST(
      createConnectionRequest({ extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
    );

    expect(response.status).toBe(401);
    expect(connectionMocks.createExtensionConnection).not.toHaveBeenCalled();
  });

  test("POST /api/extension/connections rejects cross-site requests", async () => {
    sessionMock.user = { id: "user-1", email: "tracy@example.com" };

    const response = await POST(
      createConnectionRequest(
        { extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      ),
    );

    expect(response.status).toBe(403);
    expect(connectionMocks.createExtensionConnection).not.toHaveBeenCalled();
  });

  test("POST /api/extension/connections rejects oversized requests", async () => {
    sessionMock.user = { id: "user-1", email: "tracy@example.com" };

    const response = await POST(createConnectionRequest({ padding: "x".repeat(17 * 1024) }));

    expect(response.status).toBe(413);
    expect(connectionMocks.createExtensionConnection).not.toHaveBeenCalled();
  });

  test("POST /api/extension/connections returns token for signed-in allowed extension", async () => {
    sessionMock.user = { id: "user-1", email: "tracy@example.com" };

    const response = await POST(
      createConnectionRequest({ extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(connectionMocks.createExtensionConnection).toHaveBeenCalledWith({
      user: { id: "user-1", email: "tracy@example.com" },
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  test("POST /api/extension/connections returns 403 for disallowed extension", async () => {
    sessionMock.user = { id: "user-1", email: "tracy@example.com" };
    connectionMocks.createExtensionConnection.mockResolvedValueOnce({
      ok: false,
      error: "extension_not_allowed",
    });

    const response = await POST(
      createConnectionRequest({ extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ ok: false, error: "extension_not_allowed" });
  });

  test("DELETE /api/extension/connections/current rejects cross-site requests", async () => {
    sessionMock.user = { id: "user-1", email: "tracy@example.com" };

    const response = await DELETE_CURRENT(
      createDeleteCurrentRequest({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
    );

    expect(response.status).toBe(403);
    expect(connectionMocks.revokeWorkspaceExtensionConnections).not.toHaveBeenCalled();
  });

  test("DELETE /api/extension/connections/current revokes signed-in default workspace connections", async () => {
    sessionMock.user = { id: "user-1", email: "tracy@example.com" };

    const response = await DELETE_CURRENT(createDeleteCurrentRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(connectionMocks.revokeWorkspaceExtensionConnections).toHaveBeenCalledWith({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
  });

  test("DELETE /api/extension/connections/token requires bearer token and extension id", async () => {
    const response = await DELETE_TOKEN(
      new Request("http://localhost/api/extension/connections/token", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(400);
    expect(connectionMocks.revokeExtensionBearer).not.toHaveBeenCalled();
  });

  test("DELETE /api/extension/connections/token revokes bearer token without cookie auth", async () => {
    const response = await DELETE_TOKEN(
      new Request("http://localhost/api/extension/connections/token", {
        method: "DELETE",
        headers: {
          authorization: "Bearer token-1",
          "x-sf-apt-extension-id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(connectionMocks.revokeExtensionBearer).toHaveBeenCalledWith({
      token: "token-1",
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });
});

function createConnectionRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/extension/connections", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function createDeleteCurrentRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/extension/connections/current", {
    method: "DELETE",
    headers: {
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
  });
}
