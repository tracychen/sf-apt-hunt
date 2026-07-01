import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const rootDir = process.cwd();

describe("Google sign-in links", () => {
  test("do not link to Better Auth's nonexistent provider GET route", () => {
    const files = [
      "components/auth/sign-in-panel.tsx",
      "components/apartment-map/extension-discovery-card.tsx",
      "app/extension/connect/page.tsx",
    ];

    for (const file of files) {
      const source = readFileSync(path.join(rootDir, file), "utf8");
      expect(source).not.toContain("/api/auth/sign-in/google");
    }
  });
});
