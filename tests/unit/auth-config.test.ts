import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const betterAuthMock = vi.hoisted(() => vi.fn(() => ({ api: { getSession: vi.fn() } })));
const drizzleAdapterMock = vi.hoisted(() => vi.fn(() => ({ adapter: "drizzle" })));
const requireDbMock = vi.hoisted(() => vi.fn(() => ({ db: "mock-db" })));

vi.mock("better-auth", () => ({
  betterAuth: betterAuthMock,
}));

vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: drizzleAdapterMock,
}));

vi.mock("@/lib/db/client", () => ({
  requireDb: requireDbMock,
}));

const originalEnv = { ...process.env };

describe("auth config env handling", () => {
  beforeEach(() => {
    vi.resetModules();
    betterAuthMock.mockClear();
    drizzleAdapterMock.mockClear();
    requireDbMock.mockClear();
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

  test("can be imported during production builds without DATABASE_URL", async () => {
    const authConfig = await import("@/lib/server/auth/config");

    expect(typeof authConfig.getAuth).toBe("function");
  });

  test("fails with a clear error when required auth env is missing at request time", async () => {
    process.env.DATABASE_URL = "postgres://example:example@127.0.0.1:5432/sf_apt_hunt";

    const authConfig = await import("@/lib/server/auth/config");

    expect(() => authConfig.getAuth()).toThrow(
      "Missing Better Auth environment variables: BETTER_AUTH_SECRET, BETTER_AUTH_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.",
    );
    expect(requireDbMock).not.toHaveBeenCalled();
    expect(drizzleAdapterMock).not.toHaveBeenCalled();
    expect(betterAuthMock).not.toHaveBeenCalled();
  });

  test("passes Better Auth's expected Drizzle schema model names to the adapter", async () => {
    process.env.DATABASE_URL = "postgres://example:example@127.0.0.1:5432/sf_apt_hunt";
    process.env.BETTER_AUTH_SECRET = "secret";
    process.env.BETTER_AUTH_URL = "https://hunt.apartments";
    process.env.GOOGLE_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";

    const authConfig = await import("@/lib/server/auth/config");

    authConfig.getAuth();

    expect(drizzleAdapterMock).toHaveBeenCalledWith(
      { db: "mock-db" },
      {
        provider: "pg",
        schema: expect.objectContaining({
          user: expect.any(Object),
          session: expect.any(Object),
          account: expect.any(Object),
          verification: expect.any(Object),
        }),
      },
    );
    expect(betterAuthMock).toHaveBeenCalledTimes(1);
  });
});
