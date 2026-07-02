const CHROME_EXTENSION_ID_PATTERN = "[a-p]{32}";
const MODERN_CHROME_STORE_PATH = new RegExp(`^/detail/(?:[^/]+/)?${CHROME_EXTENSION_ID_PATTERN}$`);
const LEGACY_CHROME_STORE_PATH = new RegExp(`^/webstore/detail/(?:[^/]+/)?${CHROME_EXTENSION_ID_PATTERN}$`);

export function getValidChromeExtensionUrl(rawUrl?: string | null): string | null {
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl);

    if (url.protocol !== "https:") {
      return null;
    }

    if (url.hostname === "chromewebstore.google.com" && MODERN_CHROME_STORE_PATH.test(url.pathname)) {
      return url.toString();
    }

    if (url.hostname === "chrome.google.com" && LEGACY_CHROME_STORE_PATH.test(url.pathname)) {
      return url.toString();
    }

    return null;
  } catch {
    return null;
  }
}
