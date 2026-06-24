import { describe, expect, test } from "vitest";

import { createRevision } from "@/lib/db/workspace-revisions";

describe("workspace revisions", () => {
  test("creates prefixed unique revision ids", () => {
    const left = createRevision("map");
    const right = createRevision("map");

    expect(left).toMatch(/^map-[0-9a-f-]{36}$/);
    expect(right).toMatch(/^map-[0-9a-f-]{36}$/);
    expect(left).not.toBe(right);
  });
});
