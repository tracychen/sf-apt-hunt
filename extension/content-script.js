const buttonClass = "apt-hunt-save-button";

observe();
injectButtons();

function observe() {
  if (!document.body) {
    return;
  }

  const observer = new MutationObserver(() => injectButtons());
  observer.observe(document.body, { childList: true, subtree: true });
}

async function injectButtons() {
  const response = await chrome.runtime
    .sendMessage({ type: "apt-hunt-get-allowlist" })
    .catch(() => null);
  const allowlist = Array.isArray(response?.groups) ? response.groups : [];
  const pageGroupContext = readPageGroupContext();

  for (const post of findPosts()) {
    const postGroupContext = resolvePostGroupContext(post, pageGroupContext);
    const existingButton = post.querySelector(`.${buttonClass}`);
    const isAllowlisted =
      !!postGroupContext && allowlist.some((group) => group.id === postGroupContext.id);

    if (!isAllowlisted) {
      existingButton?.remove();
      continue;
    }

    if (existingButton) {
      continue;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = buttonClass;
    button.textContent = "Save to Apt Hunt";
    button.addEventListener("click", () => {
      const latestPostGroupContext = resolvePostGroupContext(post, readPageGroupContext());
      const capture = globalThis.AptHuntCapture?.capturePost?.(post, latestPostGroupContext);
      if (capture) {
        chrome.runtime.sendMessage({ type: "apt-hunt-review-capture", capture });
      }
    });
    post.append(button);
  }
}

function findPosts() {
  return Array.from(document.querySelectorAll('[role="article"], article'));
}

function resolvePostGroupContext(post, pageGroupContext) {
  if (isGroupPage()) {
    return pageGroupContext;
  }

  return globalThis.AptHuntGroupContext?.readGroupContextFromDocument?.(post, window.location);
}

function readPageGroupContext() {
  if (!isGroupPage()) {
    return null;
  }

  return globalThis.AptHuntGroupContext?.readGroupContextFromDocument?.(
    document,
    window.location,
  );
}

function isGroupPage() {
  return /^\/groups\/[^/?#]+(?:\/|$)/.test(window.location.pathname);
}
