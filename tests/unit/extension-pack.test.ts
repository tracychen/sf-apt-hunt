import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";
import JSZip from "jszip";

const repoRoot = path.resolve(__dirname, "../..");
const extensionRoot = path.join(repoRoot, "extension");
const extensionPublishingDocPath = path.join(repoRoot, "docs", "extension-publishing.md");
const reviewerFixtureUrl = "https://hunt.apartments/extension/reviewer-fixture";
const reviewerFixtureGroupUrl = "https://www.facebook.com/groups/apt-hunt-reviewer-fixture";

type PackExtension = (options: {
  rootDir: string;
  outputDir: string;
  productionOrigin: string;
  includeLocalhost?: boolean;
}) => Promise<{ zipPath: string; manifest: object; entries: string[] }>;

function readPngSize(filePath: string) {
  const data = readFileSync(filePath);
  expect(data.subarray(1, 4).toString("ascii")).toBe("PNG");

  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

describe("extension package", () => {
  test("publishing docs include unlisted store release instructions", () => {
    const doc = readFileSync(extensionPublishingDocPath, "utf8");

    expect(doc).toContain("npm run extension:pack");
    expect(doc).toContain("Unlisted");
    expect(doc).toContain("EXTENSION_ALLOWED_IDS");
    expect(doc).toContain("NEXT_PUBLIC_CHROME_EXTENSION_URL");
    expect(doc).toContain("Do not add the public install link before Chrome Web Store approval");
    expect(doc).toContain("Chrome Dashboard Test instructions");
    expect(doc).toContain("deterministic sign-in path");
    expect(doc).toContain("deterministic Facebook test context");
    expect(doc).toContain(reviewerFixtureUrl);
    expect(doc).toContain(reviewerFixtureGroupUrl);
    expect(doc).toContain("Apt Hunt Reviewer Housing");
  });

  test("manifest declares committed PNG icons at required Chrome extension sizes", () => {
    const manifest = JSON.parse(readFileSync(path.join(extensionRoot, "manifest.json"), "utf8")) as {
      icons?: Record<string, unknown>;
    };

    for (const size of ["16", "48", "128"]) {
      const iconPath = manifest.icons?.[size];

      expect(iconPath).toEqual(expect.any(String));
      expect(iconPath).toMatch(/\.png$/);

      const absoluteIconPath = path.join(extensionRoot, iconPath as string);
      expect(existsSync(absoluteIconPath)).toBe(true);
      expect(readPngSize(absoluteIconPath)).toEqual({
        width: Number(size),
        height: Number(size),
      });
    }
  });

  test("manifest runs the content script on the hosted reviewer fixture", () => {
    const manifest = JSON.parse(readFileSync(path.join(extensionRoot, "manifest.json"), "utf8")) as {
      content_scripts?: Array<{ matches?: string[] }>;
    };

    expect(manifest.content_scripts?.[0]?.matches).toContain(
      "https://hunt.apartments/extension/reviewer-fixture*",
    );
  });

  test("rejects invalid manifest JSON with a manifest error", async () => {
    const rootDir = createPackFixture();
    writeFileSync(path.join(rootDir, "extension", "manifest.json"), "{");

    const { packExtension } = (await import("../../scripts/pack-extension.mjs")) as { packExtension: PackExtension };

    await expect(
      packExtension({
        rootDir,
        outputDir: path.join(rootDir, "dist", "extensions"),
        productionOrigin: "https://hunt.apartments",
      }),
    ).rejects.toThrow(/manifest/i);
  });

  test("rejects a manifest missing a required production icon size", async () => {
    const rootDir = createPackFixture();
    const manifestPath = path.join(rootDir, "extension", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      icons?: Record<string, unknown>;
    };
    delete manifest.icons?.["48"];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const { packExtension } = (await import("../../scripts/pack-extension.mjs")) as { packExtension: PackExtension };

    await expect(
      packExtension({
        rootDir,
        outputDir: path.join(rootDir, "dist", "extensions"),
        productionOrigin: "https://hunt.apartments",
      }),
    ).rejects.toThrow(/required icon size 48/i);
  });

  test("rejects a manifest production icon path that is not PNG", async () => {
    const rootDir = createPackFixture();
    const manifestPath = path.join(rootDir, "extension", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      icons?: Record<string, unknown>;
    };
    manifest.icons = {
      ...manifest.icons,
      "16": "icons/icon-16.svg",
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(path.join(rootDir, "extension", "icons", "icon-16.svg"), "<svg />\n");

    const { packExtension } = (await import("../../scripts/pack-extension.mjs")) as { packExtension: PackExtension };

    await expect(
      packExtension({
        rootDir,
        outputDir: path.join(rootDir, "dist", "extensions"),
        productionOrigin: "https://hunt.apartments",
      }),
    ).rejects.toThrow(/icon size 16.+png/i);
  });

  test("rejects a required manifest icon whose PNG dimensions do not match its key", async () => {
    const rootDir = createPackFixture();
    const fixtureIconRoot = path.join(rootDir, "extension", "icons");
    writeFileSync(
      path.join(fixtureIconRoot, "icon-128.png"),
      readFileSync(path.join(fixtureIconRoot, "icon-48.png")),
    );

    const { packExtension } = (await import("../../scripts/pack-extension.mjs")) as { packExtension: PackExtension };

    await expect(
      packExtension({
        rootDir,
        outputDir: path.join(rootDir, "dist", "extensions"),
        productionOrigin: "https://hunt.apartments",
      }),
    ).rejects.toThrow(/icon size 128.+128x128/i);
  });

  test("rejects a missing runtime extension dependency", async () => {
    const rootDir = createPackFixture();
    rmSync(path.join(rootDir, "extension", "review.js"));

    const { packExtension } = (await import("../../scripts/pack-extension.mjs")) as { packExtension: PackExtension };

    await expect(
      packExtension({
        rootDir,
        outputDir: path.join(rootDir, "dist", "extensions"),
        productionOrigin: "https://hunt.apartments",
      }),
    ).rejects.toThrow(/missing required entry: review\.js/i);
  });

  test("creates a production extension zip with rewritten app config and manifest", async () => {
    const rootDir = createPackFixture();
    const fixtureExtensionRoot = path.join(rootDir, "extension");
    writeFileSync(path.join(fixtureExtensionRoot, ".DS_Store"), "transient");
    writeFileSync(path.join(fixtureExtensionRoot, "notes.local.md"), "transient");
    writeFileSync(path.join(fixtureExtensionRoot, "debug.js.map"), "transient");
    writeFileSync(path.join(fixtureExtensionRoot, "old-build.zip"), "transient");

    const { packExtension } = (await import("../../scripts/pack-extension.mjs")) as { packExtension: PackExtension };

    const result = await packExtension({
      rootDir,
      outputDir: path.join(rootDir, "dist", "extensions"),
      productionOrigin: "https://hunt.apartments",
    });

    expect(result.zipPath).toBe(path.join(rootDir, "dist", "extensions", "apt-hunt-saver-0.1.0.zip"));
    expect(result.entries).toEqual(expect.arrayContaining(["manifest.json", "background.js", "popup.html"]));
    expect(result.entries).toEqual(
      expect.arrayContaining(["icons/icon-16.png", "icons/icon-48.png", "icons/icon-128.png"]),
    );
    expect(result.entries.some((entry) => entry.startsWith("extension/"))).toBe(false);
    expect(result.entries).not.toEqual(
      expect.arrayContaining([".DS_Store", "notes.local.md", "debug.js.map", "old-build.zip"]),
    );

    const zip = await JSZip.loadAsync(readFileSync(result.zipPath));
    const configJs = await zip.file("config.js")?.async("string");
    const manifestJson = await zip.file("manifest.json")?.async("string");
    const manifest = JSON.parse(manifestJson ?? "{}") as {
      host_permissions?: string[];
      externally_connectable?: { matches?: string[] };
    };

    expect(configJs).toContain('export const appOrigin = "https://hunt.apartments";');
    expect(configJs).toContain('export const extensionIdHeader = "x-sf-apt-extension-id";');
    expect(manifest.host_permissions).toContain("https://hunt.apartments/*");
    expect(manifest.host_permissions).not.toContain("http://localhost/*");
    expect(manifest.externally_connectable?.matches).toEqual(["https://hunt.apartments/*"]);
  });

  test("can preserve localhost in host permissions and external connection matches for dev packages", async () => {
    const rootDir = createPackFixture();

    const { packExtension } = (await import("../../scripts/pack-extension.mjs")) as { packExtension: PackExtension };

    const result = await packExtension({
      rootDir,
      outputDir: path.join(rootDir, "dist", "extensions"),
      productionOrigin: "https://hunt.apartments",
      includeLocalhost: true,
    });

    const manifest = result.manifest as {
      host_permissions?: string[];
      externally_connectable?: { matches?: string[] };
    };

    expect(manifest.host_permissions).toEqual(
      expect.arrayContaining(["https://hunt.apartments/*", "http://localhost/*"]),
    );
    expect(manifest.externally_connectable?.matches).toEqual([
      "https://hunt.apartments/*",
      "http://localhost/*",
    ]);
  });
});

function createPackFixture() {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "sf-apt-extension-pack-"));
  cpSync(extensionRoot, path.join(rootDir, "extension"), { recursive: true });
  return rootDir;
}
