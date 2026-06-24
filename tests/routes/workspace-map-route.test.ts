import { beforeEach, describe, expect, test, vi } from "vitest";

import { GET as EXPORT_GET } from "@/app/api/workspace/map/export/route";
import { POST as IMPORT_POST } from "@/app/api/workspace/map/import/route";
import { PUT } from "@/app/api/workspace/map/route";
import { seedMapState } from "@/lib/map/seed-data";

const routeMocks = vi.hoisted(() => ({
  importWorkspaceMap: vi.fn(),
  updateWorkspaceMap: vi.fn(),
}));

vi.mock("@/lib/server/auth/session", async () => {
  class MockUnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
    }
  }

  return {
    UnauthorizedError: MockUnauthorizedError,
    requireCurrentUserId: async () => "user-1",
  };
});

vi.mock("@/lib/server/workspaces", () => ({
  getOrCreateDefaultWorkspace: async () => ({
    workspace: {
      id: "workspace-1",
      userId: "user-1",
      name: "Apartment hunt",
      listingLedgerRevision: "ledger-1",
      createdAt: "2026-06-23T12:00:00.000Z",
      updatedAt: "2026-06-23T12:00:00.000Z",
    },
    mapSnapshot: {
      id: "snapshot-1",
      workspaceId: "workspace-1",
      revision: "map-1",
      mapState: seedMapState,
      createdAt: "2026-06-23T12:00:00.000Z",
      updatedAt: "2026-06-23T12:00:00.000Z",
    },
  }),
}));

vi.mock("@/lib/server/workspace-state", () => ({
  importWorkspaceMap: routeMocks.importWorkspaceMap,
  updateWorkspaceMap: routeMocks.updateWorkspaceMap,
}));

describe("workspace map routes", () => {
  beforeEach(() => {
    routeMocks.importWorkspaceMap.mockReset();
    routeMocks.updateWorkspaceMap.mockReset();
    routeMocks.importWorkspaceMap.mockResolvedValue({
      ok: true,
      mapSnapshot: {
        id: "snapshot-1",
        workspaceId: "workspace-1",
        revision: "map-2",
        mapState: seedMapState,
        createdAt: "2026-06-23T12:00:00.000Z",
        updatedAt: "2026-06-23T12:01:00.000Z",
      },
      invalidatedActionIds: [],
    });
    routeMocks.updateWorkspaceMap.mockResolvedValue({
      ok: true,
      mapSnapshot: {
        id: "snapshot-1",
        workspaceId: "workspace-1",
        revision: "map-2",
        mapState: seedMapState,
        createdAt: "2026-06-23T12:00:00.000Z",
        updatedAt: "2026-06-23T12:01:00.000Z",
      },
      invalidatedActionIds: [],
    });
  });

  describe("PUT /api/workspace/map", () => {
    test("rejects cross-site mutating requests", async () => {
      const response = await PUT(
        createMapWriteRequest(
          "http://localhost/api/workspace/map",
          {
            expectedMapRevision: "map-1",
            mapState: seedMapState,
          },
          {
            origin: "https://evil.example",
            "sec-fetch-site": "cross-site",
          },
          "PUT",
        ),
      );

      expect(response.status).toBe(403);
    });

    test("returns 409 for stale map revisions", async () => {
      routeMocks.updateWorkspaceMap.mockResolvedValueOnce({
        ok: false,
        error: "stale_map_revision",
        currentMapRevision: "map-2",
      });

      const response = await PUT(
        createMapWriteRequest("http://localhost/api/workspace/map", {
          expectedMapRevision: "map-1",
          mapState: seedMapState,
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body).toEqual({
        ok: false,
        error: "stale_map_revision",
        currentMapRevision: "map-2",
      });
    });

    test("returns invalidated action ids after successful writes", async () => {
      routeMocks.updateWorkspaceMap.mockResolvedValueOnce({
        ok: true,
        mapSnapshot: {
          id: "snapshot-1",
          workspaceId: "workspace-1",
          revision: "map-2",
          mapState: seedMapState,
          createdAt: "2026-06-23T12:00:00.000Z",
          updatedAt: "2026-06-23T12:01:00.000Z",
        },
        invalidatedActionIds: ["action-1"],
      });

      const response = await PUT(
        createMapWriteRequest("http://localhost/api/workspace/map", {
          expectedMapRevision: "map-1",
          mapState: seedMapState,
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.invalidatedActionIds).toEqual(["action-1"]);
    });
  });

  describe("POST /api/workspace/map/import", () => {
    test("returns 409 for stale import revisions", async () => {
      routeMocks.importWorkspaceMap.mockResolvedValueOnce({
        ok: false,
        error: "stale_map_revision",
        currentMapRevision: "map-2",
      });

      const response = await IMPORT_POST(
        createMapWriteRequest("http://localhost/api/workspace/map/import", {
          expectedMapRevision: "map-1",
          mapState: seedMapState,
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body).toEqual({
        ok: false,
        error: "stale_map_revision",
        currentMapRevision: "map-2",
      });
    });
  });

  describe("GET /api/workspace/map/export", () => {
    test("returns the current map state", async () => {
      const response = await EXPORT_GET(
        new Request("http://localhost/api/workspace/map/export", {
          method: "GET",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(seedMapState);
    });
  });
});

function createMapWriteRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  method: "PUT" | "POST" = "PUT",
) {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
