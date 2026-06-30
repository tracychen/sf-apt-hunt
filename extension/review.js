import { parseHousingDetailsWithOpenAI } from "./openai-parser.js";
import { getOpenAiKey } from "./storage.js";

const reviewCaptureFields = [
  "sourceSurface",
  "sourceGroupId",
  "sourceGroupName",
  "sourceGroupUrl",
  "sourcePostUrl",
  "capturedText",
  "capturedAt",
];
const listingTypeValues = new Set([
  "full_apartment",
  "private_room",
  "shared_room",
  "roommate_search",
  "unknown",
]);
const tenancyTypeValues = new Set(["new_lease", "lease_takeover", "sublet", "month_to_month", "unknown"]);
const bathroomValues = new Set(["private", "shared", "unknown"]);

export function normalizeCaptureForReview(capture) {
  if (!isPlainObject(capture)) {
    return null;
  }

  const normalizedCapture = {};

  for (const field of reviewCaptureFields) {
    if (typeof capture[field] !== "string") {
      return null;
    }

    normalizedCapture[field] = capture[field];
  }

  return normalizedCapture;
}

export function buildImportRequest(capture, reviewedDetails, incompleteFlags) {
  const normalizedCapture = normalizeCaptureForReview(capture);

  return {
    ...(normalizedCapture ?? {}),
    idempotencyKey: crypto.randomUUID(),
    parsedDraft: null,
    reviewedDetails,
    incompleteFlags,
  };
}

const importErrorMessages = {
  not_connected: "Connect the extension to Apt Hunt before saving.",
  invalid_request: "The listing details were rejected. Review the form and try again.",
  unauthorized: "Your extension connection is no longer authorized. Reconnect and try again.",
  token_expired: "Your extension session expired. Reconnect and try again.",
  idempotency_conflict: "This save request conflicts with an earlier import. Refresh the review window and try again.",
  import_failed: "The listing could not be imported. Try again.",
};

export function getImportErrorMessage(errorCode) {
  const safeErrorCode =
    typeof errorCode === "string" && Object.hasOwn(importErrorMessages, errorCode) ? errorCode : "import_failed";

  return importErrorMessages[safeErrorCode];
}

export function createImportRequestCache(capture) {
  let cachedSignature = null;
  let cachedRequest = null;

  return {
    getReviewedRequest(formData) {
      return getOrCreateRequest({
        mode: "reviewed",
        reviewedDetails: readDetails(formData),
        incompleteFlags: [],
      });
    },
    getIncompleteRequest() {
      return getOrCreateRequest({
        mode: "incomplete",
        reviewedDetails: null,
        incompleteFlags: ["saved_incomplete"],
      });
    },
  };

  function getOrCreateRequest({ mode, reviewedDetails, incompleteFlags }) {
    const signature = JSON.stringify({
      mode,
      reviewedDetails,
      incompleteFlags,
    });

    if (signature !== cachedSignature) {
      cachedSignature = signature;
      cachedRequest = buildImportRequest(capture, reviewedDetails, incompleteFlags);
    }

    return cachedRequest;
  }
}

export function readDetails(formData) {
  const price = Number.parseInt(readText(formData.get("priceMonthly")), 10);
  const roommateCount = Number.parseInt(readText(formData.get("roommateCount")), 10);
  const bedroomsText = readText(formData.get("bedrooms")).toLowerCase();
  const bedroomsNumber = Number.parseInt(bedroomsText, 10);

  return {
    listingType: readEnum(formData.get("listingType"), listingTypeValues, "unknown"),
    tenancyType: readEnum(formData.get("tenancyType"), tenancyTypeValues, "unknown"),
    priceMonthly: Number.isFinite(price) ? price : null,
    bedrooms: bedroomsText === "studio" ? "studio" : Number.isFinite(bedroomsNumber) ? bedroomsNumber : null,
    bathroom: readEnum(formData.get("bathroom"), bathroomValues, "unknown"),
    roommateCount: Number.isFinite(roommateCount) ? roommateCount : null,
    locationText: stringOrNull(formData.get("locationText")),
    neighborhoodGuess: readText(formData.get("neighborhoodGuess")) || "Unknown",
    availabilityStart: stringOrNull(formData.get("availabilityStart")),
    availabilityEnd: stringOrNull(formData.get("availabilityEnd")),
    dateFlexibility: "unknown",
    durationText: stringOrNull(formData.get("durationText")),
    furnished: null,
    pets: "unknown",
    notes: readText(formData.get("notes"))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

export function renderCapture(container, capture) {
  if (!container) {
    return;
  }

  container.replaceChildren();

  const normalizedCapture = normalizeCaptureForReview(capture);

  if (!normalizedCapture) {
    const empty = document.createElement("p");
    empty.className = "capture-text";
    empty.textContent = "Capture not found.";
    container.append(empty);
    return;
  }

  const meta = document.createElement("div");
  meta.className = "capture-meta";
  meta.append(
    createCaptureLine("Group", normalizedCapture.sourceGroupName),
    createCaptureLine("Surface", normalizedCapture.sourceSurface),
    createCaptureLine("Captured at", normalizedCapture.capturedAt),
    createCaptureLine("Group URL", normalizedCapture.sourceGroupUrl, true),
    createCaptureLine("Post URL", normalizedCapture.sourcePostUrl, true),
  );

  const text = document.createElement("p");
  text.className = "capture-text";
  text.textContent = normalizedCapture.capturedText;

  container.append(meta, text);
}

export function writeDetailsToForm(form, details) {
  if (!form || !isPlainObject(details)) {
    return;
  }

  for (const [key, value] of Object.entries(details)) {
    const field = form.elements.namedItem(key);

    if (!isTextualFormField(field)) {
      continue;
    }

    field.value = Array.isArray(value) ? value.join("\n") : value == null ? "" : String(value);
  }
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  const form = document.querySelector("#review-form");
  const statusEl = document.querySelector("#status");
  const captureEl = document.querySelector("#capture");
  const incompleteButton = document.querySelector("#save-incomplete");
  const parseWithAiButton = document.querySelector("#parse-with-ai");
  const captureId = new URLSearchParams(window.location.search).get("captureId");

  if (captureId && form && statusEl && captureEl && incompleteButton && parseWithAiButton) {
    initReviewPage({
      captureId,
      form,
      statusEl,
      captureEl,
      incompleteButton,
      parseWithAiButton,
      runtime: chrome.runtime,
    });
  }
}

async function initReviewPage({ captureId, form, statusEl, captureEl, incompleteButton, parseWithAiButton, runtime }) {
  const response = await runtime.sendMessage({
    type: "apt-hunt-get-pending-capture",
    captureId,
  });
  const capture = response?.ok ? response.capture : null;

  renderCapture(captureEl, capture);

  if (!capture) {
    statusEl.textContent = "Capture not found.";
    setControlsDisabled(form, true);
    incompleteButton.disabled = true;
    parseWithAiButton.disabled = true;
    return;
  }

  const requestCache = createImportRequestCache(capture);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await save({
      request: requestCache.getReviewedRequest(new FormData(form)),
      form,
      statusEl,
      runtime,
      incompleteButton,
    });
  });

  incompleteButton.addEventListener("click", async () => {
    await save({
      request: requestCache.getIncompleteRequest(),
      form,
      statusEl,
      runtime,
      incompleteButton,
    });
  });

  parseWithAiButton.addEventListener("click", async () => {
    const apiKey = await getOpenAiKey();

    if (!apiKey) {
      statusEl.textContent = "Add an OpenAI key in the extension popup first.";
      return;
    }

    statusEl.textContent = "Parsing...";
    parseWithAiButton.disabled = true;

    try {
      const parsed = await parseHousingDetailsWithOpenAI({
        apiKey,
        capturedText: capture.capturedText,
        sourceGroupName: capture.sourceGroupName,
      });

      if (!parsed.ok) {
        statusEl.textContent = "Parsing failed.";
        return;
      }

      writeDetailsToForm(form, parsed.details);
      statusEl.textContent = "Parsed. Review before saving.";
    } finally {
      parseWithAiButton.disabled = false;
    }
  });
}

async function save({ request, form, statusEl, runtime, incompleteButton }) {
  statusEl.textContent = "Saving...";
  setControlsDisabled(form, true);
  incompleteButton.disabled = true;

  try {
    const response = await runtime.sendMessage({
      type: "apt-hunt-import-capture",
      request,
    });

    statusEl.textContent = response?.ok ? "Saved" : `Save failed: ${getImportErrorMessage(response?.error)}`;
    return response;
  } catch (error) {
    console.error("[extension/review#save]", error);
    statusEl.textContent = `Save failed: ${getImportErrorMessage("import_failed")}`;
    return { ok: false, error: "import_failed" };
  } finally {
    setControlsDisabled(form, false);
    incompleteButton.disabled = false;
  }
}

function createCaptureLine(label, value, asLink = false) {
  const line = document.createElement("div");
  line.className = "capture-line";

  const labelEl = document.createElement("span");
  labelEl.className = "capture-label";
  labelEl.textContent = label;

  if (asLink) {
    const link = document.createElement("a");
    link.className = "capture-link";
    link.textContent = value;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.href = safeHttpUrl(value) ?? "#";
    line.append(labelEl, link);
    return line;
  }

  const valueEl = document.createElement("span");
  valueEl.className = "capture-value";
  valueEl.textContent = value;
  line.append(labelEl, valueEl);
  return line;
}

function setControlsDisabled(form, disabled) {
  for (const control of form.querySelectorAll("input, select, textarea, button")) {
    control.disabled = disabled;
  }
}

function readEnum(value, allowedValues, fallback) {
  const text = readText(value);
  return allowedValues.has(text) ? text : fallback;
}

function stringOrNull(value) {
  const text = readText(value);
  return text || null;
}

function readText(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextualFormField(field) {
  return (
    field !== null &&
    typeof field === "object" &&
    "value" in field &&
    typeof field.value === "string"
  );
}

function safeHttpUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
