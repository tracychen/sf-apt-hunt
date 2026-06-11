import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["tests/setup/vitest.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/routes/**/*.test.ts"],
  },
});
