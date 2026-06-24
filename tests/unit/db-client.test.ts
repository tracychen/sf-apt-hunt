import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const originalEnv = { ...process.env };

describe("db client env handling", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    Reflect.set(process.env, "NODE_ENV", "production");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("can be imported during production builds without DATABASE_URL", async () => {
    const dbClient = await import("@/lib/db/client");

    expect(dbClient.db).toBeNull();
    expect(() => dbClient.requireDb()).toThrow(
      "DATABASE_URL is required for persistent workspace operations.",
    );
  });
});
