function capturePost(postElement, groupContext) {
  if (!postElement || !groupContext) {
    return null;
  }

  const sourceGroupUrl = safeUrl(groupContext.url);

  if (!isHttpsFacebookUrl(sourceGroupUrl)) {
    return null;
  }

  const sourcePostUrl = findPostUrl(postElement);
  const capturedText = readCapturedText(postElement);

  if (!sourcePostUrl || !capturedText) {
    return null;
  }

  return {
    sourceSurface: inferSurface(sourcePostUrl),
    sourceGroupId: groupContext.id,
    sourceGroupName: groupContext.name,
    sourceGroupUrl: sourceGroupUrl.toString(),
    sourcePostUrl,
    capturedText,
    capturedAt: new Date().toISOString(),
  };
}

function findPostUrl(postElement) {
  const links = Array.from(postElement.querySelectorAll("a[href]"));

  for (const link of links) {
    const url = safeUrl(link.href);

    if (!isHttpsFacebookUrl(url)) {
      continue;
    }

    if (/^\/groups\/[^/]+\/posts\/[^/]+/.test(url.pathname)) {
      return url.toString();
    }
  }

  return null;
}

function inferSurface(sourcePostUrl) {
  const sourcePost = safeUrl(sourcePostUrl);

  if (sourcePost && /^\/groups\/[^/]+\/posts\/[^/]+/.test(sourcePost.pathname)) {
    return "postPermalink";
  }

  return window.location.pathname.startsWith("/groups/") ? "groupFeed" : "homeFeed";
}

function readCapturedText(postElement) {
  const clone = postElement.cloneNode(true);
  clone.querySelectorAll(".apt-hunt-save-button").forEach((element) => element.remove());
  return clone.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function isFacebookHostname(hostname) {
  return hostname === "facebook.com" || hostname.endsWith(".facebook.com");
}

function isHttpsFacebookUrl(url) {
  return !!url && url.protocol === "https:" && isFacebookHostname(url.hostname);
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

globalThis.AptHuntCapture = {
  capturePost,
};

if (typeof exports !== "undefined") {
  exports.capturePost = capturePost;
}
