import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const originalEnv = { ...process.env };

describe("auth route module import", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_URL;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    Reflect.set(process.env, "NODE_ENV", "production");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("can be imported in production without persistence env or eager auth init", async () => {
    const routeModule = await import("@/app/api/auth/[...all]/route");

    expect(typeof routeModule.GET).toBe("function");
    expect(typeof routeModule.POST).toBe("function");
  });
});
