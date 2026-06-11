import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["tests/setup/vitest.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/routes/**/*.test.ts"],
  },
});
