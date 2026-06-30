function parseFacebookGroupFromUrl(value) {
  const url = safeUrl(value);

  if (!url || !isFacebookHostname(url.hostname)) {
    return null;
  }

  const match = url.pathname.match(/^\/groups\/([^/?#]+)(?:\/posts\/[^/?#]+)?/);

  if (!match) {
    return null;
  }

  const id = safeDecodeURIComponent(match[1]);

  if (!id) {
    return null;
  }

  return {
    id,
    name: `Facebook group ${id}`,
    url: `https://www.facebook.com/groups/${encodeURIComponent(id)}`,
  };
}

function readGroupContextFromDocument(root, location) {
  const fromLocation = parseFacebookGroupFromUrl(location?.href);

  if (fromLocation) {
    const heading =
      root?.querySelector?.("h1")?.textContent?.trim() ||
      root?.ownerDocument?.querySelector?.("h1")?.textContent?.trim();
    return heading ? { ...fromLocation, name: heading } : fromLocation;
  }

  const links = Array.from(root?.querySelectorAll?.('a[href*="/groups/"]') ?? []);

  for (const link of links) {
    const linkUrl = safeUrl(link.href);

    if (!isVisibleGroupAttributionUrl(linkUrl)) {
      continue;
    }

    const visibleName = readVisibleText(link);

    if (!visibleName) {
      continue;
    }

    const parsed = parseFacebookGroupFromUrl(link.href);

    if (parsed) {
      return {
        ...parsed,
        name: visibleName,
      };
    }
  }

  return null;
}

const hiddenClassNames = new Set([
  "sr-only",
  "sr_only",
  "screen-reader-only",
  "screen-reader-text",
  "visually-hidden",
  "visuallyhidden",
  "hidden-visually",
  "u-hiddenvisually",
  "u-visually-hidden",
]);
const textNodeType = 3;
const elementNodeType = 1;
const documentNodeType = 9;
const documentFragmentNodeType = 11;

function readVisibleText(root) {
  const parts = [];
  collectVisibleText(root, parts);

  return parts.join("").replace(/\s+/g, " ").trim();
}

function collectVisibleText(node, parts) {
  if (!node) {
    return;
  }

  if (node.nodeType === textNodeType) {
    parts.push(node.textContent ?? "");
    return;
  }

  if (
    node.nodeType !== elementNodeType &&
    node.nodeType !== documentNodeType &&
    node.nodeType !== documentFragmentNodeType
  ) {
    return;
  }

  if (node.nodeType === elementNodeType && isHiddenElement(node)) {
    return;
  }

  for (const child of node.childNodes) {
    collectVisibleText(child, parts);
  }
}

function isHiddenElement(element) {
  for (let current = element; current; current = current.parentElement) {
    if (current.hasAttribute("hidden")) {
      return true;
    }

    if (current.getAttribute("aria-hidden")?.trim().toLowerCase() === "true") {
      return true;
    }

    if (hasInlineHiddenStyle(current.getAttribute("style"))) {
      return true;
    }

    if (hasComputedHiddenStyle(current)) {
      return true;
    }

    if (
      Array.from(current.classList ?? []).some((className) =>
        hiddenClassNames.has(className.trim().toLowerCase()),
      )
    ) {
      return true;
    }
  }

  return false;
}

function hasComputedHiddenStyle(element) {
  const computedStyle = element.ownerDocument?.defaultView?.getComputedStyle?.(element);

  if (!computedStyle) {
    return false;
  }

  return (
    computedStyle.display === "none" ||
    computedStyle.visibility === "hidden" ||
    computedStyle.visibility === "collapse"
  );
}

function hasInlineHiddenStyle(styleValue) {
  if (!styleValue) {
    return false;
  }

  return (
    /(^|;)\s*display\s*:\s*none\s*(;|$)/i.test(styleValue) ||
    /(^|;)\s*visibility\s*:\s*hidden\s*(;|$)/i.test(styleValue)
  );
}

function isFacebookHostname(hostname) {
  return hostname === "facebook.com" || hostname.endsWith(".facebook.com");
}

function isVisibleGroupAttributionUrl(url) {
  return (
    !!url &&
    isFacebookHostname(url.hostname) &&
    /^\/groups\/[^/?#]+\/?$/.test(url.pathname)
  );
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

globalThis.AptHuntGroupContext = {
  parseFacebookGroupFromUrl,
  readGroupContextFromDocument,
};

if (typeof exports !== "undefined") {
  exports.parseFacebookGroupFromUrl = parseFacebookGroupFromUrl;
  exports.readGroupContextFromDocument = readGroupContextFromDocument;
}
