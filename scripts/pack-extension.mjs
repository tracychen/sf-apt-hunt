#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

const DEFAULT_PRODUCTION_ORIGIN = "https://hunt.apartments";
const EXCLUDED_FILE_PATTERNS = [/\.DS_Store$/, /\.map$/, /\.zip$/, /(^|\/)notes\.local\.md$/];
const REQUIRED_ICON_SIZES = ["16", "48", "128"];
const REQUIRED_ROOT_FILES = [
  "manifest.json",
  "background.js",
  "config.js",
  "storage.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "review.html",
  "review.js",
  "review.css",
  "content-script.js",
  "content-style.css",
  "capture.js",
  "group-context.js",
  "openai-parser.js",
];

export async function packExtension({
  rootDir,
  outputDir,
  productionOrigin,
  includeLocalhost = false,
}) {
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedOutputDir = path.resolve(outputDir);
  const extensionDir = path.join(resolvedRootDir, "extension");
  const origin = productionOrigin ?? DEFAULT_PRODUCTION_ORIGIN;
  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = await readManifest(manifestPath);
  const productionManifest = rewriteManifest(manifest, origin, includeLocalhost);
  const zip = new JSZip();
  const entries = [];

  await validateManifestIcons(productionManifest, extensionDir);

  await addDirectoryToZip({
    zip,
    entries,
    directoryPath: extensionDir,
    basePath: extensionDir,
    productionManifest,
    productionOrigin: origin,
  });

  validateEntries(entries, productionManifest);

  const zipPath = path.join(resolvedOutputDir, `apt-hunt-saver-${productionManifest.version}.zip`);
  const archive = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  await mkdir(resolvedOutputDir, { recursive: true });
  await writeFile(zipPath, archive);

  return {
    zipPath,
    manifest: productionManifest,
    entries: [...entries].sort(),
  };
}

async function readManifest(manifestPath) {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read extension manifest: ${errorMessage(error)}`);
  }
}

function rewriteManifest(manifest, productionOrigin, includeLocalhost) {
  const productionPermission = `${productionOrigin}/*`;
  const localhostPermission = "http://localhost/*";
  const hostPermissions = manifest.host_permissions ?? [];
  const filteredPermissions = includeLocalhost
    ? hostPermissions
    : hostPermissions.filter((permission) => permission !== localhostPermission);
  const externalMatches = includeLocalhost
    ? unique([productionPermission, localhostPermission])
    : [productionPermission];

  return {
    ...manifest,
    host_permissions: unique([...filteredPermissions, productionPermission]),
    externally_connectable: {
      matches: externalMatches,
    },
  };
}

async function addDirectoryToZip({
  zip,
  entries,
  directoryPath,
  basePath,
  productionManifest,
  productionOrigin,
}) {
  const dirents = await readdir(directoryPath, { withFileTypes: true });

  for (const dirent of dirents) {
    const filePath = path.join(directoryPath, dirent.name);
    const zipEntry = toZipEntry(path.relative(basePath, filePath));

    if (isExcluded(zipEntry)) {
      continue;
    }

    if (dirent.isDirectory()) {
      await addDirectoryToZip({
        zip,
        entries,
        directoryPath: filePath,
        basePath,
        productionManifest,
        productionOrigin,
      });
      continue;
    }

    if (!dirent.isFile()) {
      continue;
    }

    const content = await readZipEntry(filePath, zipEntry, productionManifest, productionOrigin);
    zip.file(zipEntry, content);
    entries.push(zipEntry);
  }
}

async function readZipEntry(filePath, zipEntry, productionManifest, productionOrigin) {
  if (zipEntry === "manifest.json") {
    return `${JSON.stringify(productionManifest, null, 2)}\n`;
  }

  if (zipEntry === "config.js") {
    return [
      `export const appOrigin = ${JSON.stringify(productionOrigin)};`,
      'export const extensionIdHeader = "x-sf-apt-extension-id";',
      "",
    ].join("\n");
  }

  return readFile(filePath);
}

function validateEntries(entries, manifest) {
  const entrySet = new Set(entries);
  const requiredEntries = [...REQUIRED_ROOT_FILES, ...manifestIconEntries(manifest)];

  for (const entry of requiredEntries) {
    if (!entrySet.has(entry)) {
      throw new Error(`Extension archive is missing required entry: ${entry}`);
    }
  }

  const nestedEntry = entries.find((entry) => entry.startsWith("extension/"));
  if (nestedEntry) {
    throw new Error(`Extension archive entry must be rooted at extension contents: ${nestedEntry}`);
  }
}

async function validateManifestIcons(manifest, extensionDir) {
  if (!manifest.icons || typeof manifest.icons !== "object" || Array.isArray(manifest.icons)) {
    throw new Error("Extension manifest is missing required icons");
  }

  for (const size of REQUIRED_ICON_SIZES) {
    if (!(size in manifest.icons)) {
      throw new Error(`Extension manifest is missing required icon size ${size}`);
    }
  }

  for (const [size, iconPath] of Object.entries(manifest.icons)) {
    if (typeof iconPath !== "string" || !iconPath.endsWith(".png")) {
      throw new Error(`Extension manifest icon size ${size} must reference a .png path`);
    }
  }

  for (const size of REQUIRED_ICON_SIZES) {
    const iconPath = manifest.icons[size];
    const iconFilePath = path.join(extensionDir, iconPath);
    const iconBytes = await readFile(iconFilePath).catch((error) => {
      throw new Error(`Unable to read extension icon size ${size}: ${errorMessage(error)}`);
    });

    validatePngIconBytes(iconBytes, size);
  }
}

function validatePngIconBytes(iconBytes, size) {
  const expectedSize = Number(size);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  if (iconBytes.length < 24 || !iconBytes.subarray(0, 8).equals(pngSignature)) {
    throw new Error(`Extension manifest icon size ${size} must be a valid PNG file`);
  }

  const width = iconBytes.readUInt32BE(16);
  const height = iconBytes.readUInt32BE(20);

  if (width !== expectedSize || height !== expectedSize) {
    throw new Error(
      `Extension manifest icon size ${size} must be ${expectedSize}x${expectedSize}; got ${width}x${height}`,
    );
  }
}

function manifestIconEntries(manifest) {
  if (!manifest.icons || typeof manifest.icons !== "object") {
    return [];
  }

  return Object.values(manifest.icons).filter((entry) => typeof entry === "string");
}

function isExcluded(zipEntry) {
  return EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(zipEntry));
}

function toZipEntry(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function unique(values) {
  return [...new Set(values)];
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = await packExtension({
    rootDir,
    outputDir: path.join(rootDir, "dist", "extensions"),
    productionOrigin: DEFAULT_PRODUCTION_ORIGIN,
  });

  console.log(`Packed extension: ${result.zipPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
