import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const headersMock = vi.hoisted(() => vi.fn<() => Promise<Headers>>());
const getSessionMock = vi.hoisted(() => vi.fn());
const getAuthMock = vi.hoisted(() => vi.fn(() => ({ api: { getSession: getSessionMock } })));
const originalEnv = { ...process.env };

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

describe("auth session helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    headersMock.mockReset();
    getSessionMock.mockReset();
    getAuthMock.mockClear();
    vi.doUnmock("@/lib/server/auth/config");
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_URL;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.SF_APT_E2E_AUTH_ENABLED;
    process.env.SF_APT_E2E_USER_ID = "user-1";
    process.env.SF_APT_E2E_AUTH_TOKEN = "playwright";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("does not enable the Playwright auth bypass without the explicit test flag", async () => {
    setEnv("NODE_ENV", "test");
    headersMock.mockResolvedValue(
      new Headers({
        cookie: "sf-apt-e2e-auth=playwright",
      }),
    );

    const { getCurrentUserId } = await import("@/lib/server/auth/session");
    const userId = await getCurrentUserId();

    expect(userId).toBeNull();
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  test("enables the Playwright auth bypass when the explicit test flag is set", async () => {
    setEnv("NODE_ENV", "test");
    process.env.SF_APT_E2E_AUTH_ENABLED = "true";
    headersMock.mockResolvedValue(
      new Headers({
        cookie: "sf-apt-e2e-auth=playwright",
      }),
    );

    const { getCurrentUserId } = await import("@/lib/server/auth/session");
    const userId = await getCurrentUserId();

    expect(userId).toBe("user-1");
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  test("development request auth returns signed-out when DATABASE_URL is absent", async () => {
    setEnv("NODE_ENV", "development");

    const { getCurrentUserId } = await import("@/lib/server/auth/session");
    const userId = await getCurrentUserId(new Request("http://localhost/api/workspace"));

    expect(userId).toBeNull();
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  test("production request auth fails clearly when DATABASE_URL is absent", async () => {
    setEnv("NODE_ENV", "production");
    process.env.SF_APT_E2E_AUTH_ENABLED = "true";

    const { getCurrentUserId } = await import("@/lib/server/auth/session");

    await expect(
      getCurrentUserId(
        new Request("https://example.com/api/workspace", {
          headers: {
            cookie: "sf-apt-e2e-auth=playwright",
          },
        }),
      ),
    ).rejects.toThrow("DATABASE_URL is required for production authentication.");

    expect(getSessionMock).not.toHaveBeenCalled();
  });

  test("disables the Playwright auth bypass in production when persistence is configured", async () => {
    setEnv("NODE_ENV", "production");
    process.env.SF_APT_E2E_AUTH_ENABLED = "true";
    process.env.DATABASE_URL = "postgres://example:example@127.0.0.1:5432/sf_apt_hunt";
    vi.doMock("@/lib/server/auth/config", () => ({
      getAuth: getAuthMock,
    }));
    getSessionMock.mockResolvedValue(null);

    const { getCurrentUserId } = await import("@/lib/server/auth/session");
    const userId = await getCurrentUserId(
      new Request("https://example.com/api/workspace", {
        headers: {
          cookie: "sf-apt-e2e-auth=playwright",
        },
      }),
    );

    expect(userId).toBeNull();
    expect(getSessionMock).toHaveBeenCalledTimes(1);
  });

  test("reaches the lazy auth session path when persistence is enabled", async () => {
    process.env.DATABASE_URL = "postgres://example:example@127.0.0.1:5432/sf_apt_hunt";
    vi.doMock("@/lib/server/auth/config", () => ({
      getAuth: getAuthMock,
    }));
    getSessionMock.mockResolvedValue({
      user: {
        id: "user-db-1",
      },
    });
    headersMock.mockResolvedValue(new Headers());

    const { getCurrentUserId } = await import("@/lib/server/auth/session");
    const userId = await getCurrentUserId();

    expect(userId).toBe("user-db-1");
    expect(getAuthMock).toHaveBeenCalledTimes(1);
    expect(getSessionMock).toHaveBeenCalledTimes(1);
  });

  test("fails clearly when the request-time auth path is used without auth env", async () => {
    process.env.DATABASE_URL = "postgres://example:example@127.0.0.1:5432/sf_apt_hunt";
    headersMock.mockResolvedValue(new Headers());

    const { getCurrentUserId } = await import("@/lib/server/auth/session");

    await expect(getCurrentUserId()).rejects.toThrow(
      "Missing Better Auth environment variables: BETTER_AUTH_SECRET, BETTER_AUTH_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.",
    );
  });
});

function setEnv(name: string, value: string) {
  Reflect.set(process.env, name, value);
}
