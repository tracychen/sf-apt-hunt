import { defineConfig, devices } from "@playwright/test";

const e2ePort = 3340;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    viewport: { width: 1440, height: 1000 },
    trace: "on-first-retry",
  },
  webServer: {
    command:
      `SF_APT_E2E_AUTH_ENABLED=true SF_APT_E2E_USER_ID=user-1 SF_APT_E2E_AUTH_TOKEN=playwright ` +
      `npx next dev --hostname 127.0.0.1 --port ${e2ePort}`,
    url: `http://127.0.0.1:${e2ePort}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
});
