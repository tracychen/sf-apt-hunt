import { appOrigin, extensionIdHeader } from "./config.js";
import { clearConnection, getAllowlistedGroups, getConnection, setConnection } from "./storage.js";

const pendingCaptures = new Map();
const safeImportErrors = new Set([
  "not_connected",
  "invalid_request",
  "unauthorized",
  "token_expired",
  "idempotency_conflict",
  "import_failed",
]);
const reviewCaptureFields = [
  "sourceSurface",
  "sourceGroupId",
  "sourceGroupName",
  "sourceGroupUrl",
  "sourcePostUrl",
  "capturedText",
  "capturedAt",
];
const sourceSurfaceValues = new Set(["homeFeed", "groupFeed", "postPermalink"]);
const listingTypeValues = new Set([
  "full_apartment",
  "private_room",
  "shared_room",
  "roommate_search",
  "unknown",
]);
const tenancyTypeValues = new Set(["new_lease", "lease_takeover", "sublet", "month_to_month", "unknown"]);
const bathroomValues = new Set(["private", "shared", "unknown"]);
const dateFlexibilityValues = new Set(["fixed", "flexible", "unknown"]);
const petsValues = new Set(["allowed", "not_allowed", "unknown"]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (typeof chrome !== "undefined" && chrome.runtime?.onMessageExternal && chrome.runtime?.onMessage) {
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (readSenderOrigin(sender) !== appOrigin) {
      sendResponse({ ok: false, error: "forbidden_origin" });
      return false;
    }

    const payload = readConnectionPayload(message);
    if (!payload?.token) {
      sendResponse({ ok: false, error: "invalid_message" });
      return false;
    }

    setConnection({
      token: payload.token,
      expiresAt: payload.expiresAt,
      accountEmail: payload.account?.email,
      workspaceName: payload.workspace?.name,
    })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, error: "storage_failed" }));

    return true;
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "apt-hunt-review-capture") {
      queueCaptureForReview(message.capture)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, error: "review_window_failed" }));
      return true;
    }

    if (message?.type === "apt-hunt-get-pending-capture") {
      sendResponse({
        ok: true,
        capture: pendingCaptures.get(message.captureId) ?? null,
      });
      return false;
    }

    if (message?.type === "apt-hunt-import-capture") {
      importCapture(message.request)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, error: "import_failed" }));
      return true;
    }

    if (message?.type === "apt-hunt-get-allowlist") {
      getAllowlistedGroups()
        .then((groups) => sendResponse({ ok: true, groups }))
        .catch(() => sendResponse({ ok: false, error: "storage_failed", groups: [] }));
      return true;
    }

    if (message?.type === "apt-hunt-get-connection") {
      getConnection()
        .then((connection) => sendResponse({ ok: true, connection: toDisplayConnection(connection) }))
        .catch(() => sendResponse({ ok: false, error: "storage_failed", connection: null }));
      return true;
    }

    if (message?.type === "apt-hunt-disconnect") {
      disconnect()
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, error: "disconnect_failed" }));
      return true;
    }

    return false;
  });
}

async function queueCaptureForReview(capture) {
  const normalizedCapture = normalizeCaptureForReview(capture);

  if (!normalizedCapture) {
    return { ok: false, error: "invalid_capture" };
  }

  const captureId = crypto.randomUUID();
  pendingCaptures.set(captureId, normalizedCapture);

  await chrome.windows.create({
    url: chrome.runtime.getURL(`review.html?captureId=${encodeURIComponent(captureId)}`),
    type: "popup",
    width: 460,
    height: 680,
  });

  return { ok: true, captureId };
}

async function disconnect() {
  const connection = await getConnection();

  if (!connection?.token) {
    await clearConnection();
    return { ok: true };
  }

  const response = await fetch(`${appOrigin}/api/extension/connections/token`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${connection.token}`,
      [extensionIdHeader]: chrome.runtime.id,
    },
  });

  if (response.ok || response.status === 401) {
    await clearConnection();
    return { ok: true };
  }

  return { ok: false, error: "disconnect_failed" };
}

async function importCapture(request) {
  const connection = await getConnection();

  if (!connection?.token) {
    return { ok: false, error: "not_connected" };
  }

  const normalizedRequest = normalizeImportCaptureRequest(request);

  if (!normalizedRequest) {
    return { ok: false, error: "invalid_request" };
  }

  try {
    const response = await fetch(`${appOrigin}/api/imports/facebook-listings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${connection.token}`,
        [extensionIdHeader]: chrome.runtime.id,
      },
      body: JSON.stringify(normalizedRequest),
    });

    const payload = await response.json().catch(() => null);
    return normalizeImportCaptureResponse(payload);
  } catch (error) {
    console.error("[extension/background#importCapture]", error);
  }

  return { ok: false, error: "import_failed" };
}

export function normalizeImportCaptureRequest(request) {
  if (!isPlainObject(request)) {
    return null;
  }

  const idempotencyKey = readUuid(request.idempotencyKey);
  const normalizedCapture = normalizeImportCaptureSource(request);
  const parsedDraft = normalizeHousingDetails(request.parsedDraft);
  const reviewedDetails = normalizeHousingDetails(request.reviewedDetails);
  const incompleteFlags = normalizeStringArray(request.incompleteFlags);

  if (
    !idempotencyKey ||
    !normalizedCapture ||
    parsedDraft === undefined ||
    reviewedDetails === undefined ||
    !incompleteFlags
  ) {
    return null;
  }

  return {
    idempotencyKey,
    ...normalizedCapture,
    parsedDraft,
    reviewedDetails,
    incompleteFlags,
  };
}

export function normalizeImportCaptureResponse(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, error: "import_failed" };
  }

  if (payload.ok === true) {
    if (
      typeof payload.captureId === "string" &&
      payload.captureId &&
      typeof payload.listingLedgerRevision === "string" &&
      payload.listingLedgerRevision
    ) {
      return {
        ok: true,
        captureId: payload.captureId,
        listingLedgerRevision: payload.listingLedgerRevision,
      };
    }

    return { ok: false, error: "import_failed" };
  }

  if (payload.ok === false && typeof payload.error === "string" && safeImportErrors.has(payload.error)) {
    return { ok: false, error: payload.error };
  }

  return { ok: false, error: "import_failed" };
}

function readConnectionPayload(message) {
  if (message?.ok === true && typeof message?.token === "string") {
    return message;
  }

  if (message?.type === "apt-hunt-extension-connected" && message.payload?.ok === true) {
    return message.payload;
  }

  return null;
}

function toDisplayConnection(connection) {
  if (!isPlainObject(connection)) {
    return null;
  }

  return {
    expiresAt: typeof connection.expiresAt === "string" ? connection.expiresAt : undefined,
    accountEmail: typeof connection.accountEmail === "string" ? connection.accountEmail : undefined,
    workspaceName: typeof connection.workspaceName === "string" ? connection.workspaceName : undefined,
  };
}

function readSenderOrigin(sender) {
  if (typeof sender?.origin === "string" && sender.origin) {
    return sender.origin;
  }

  if (typeof sender?.url === "string" && sender.url) {
    try {
      return new URL(sender.url).origin;
    } catch {
      return null;
    }
  }

  return null;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCaptureForReview(capture) {
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

function normalizeImportCaptureSource(request) {
  const normalizedCapture = normalizeCaptureForReview(request);

  if (!normalizedCapture || !sourceSurfaceValues.has(normalizedCapture.sourceSurface)) {
    return null;
  }

  const sourceGroupUrl = safeHttpUrl(normalizedCapture.sourceGroupUrl);
  const sourcePostUrl = safeHttpUrl(normalizedCapture.sourcePostUrl);

  if (!sourceGroupUrl || !sourcePostUrl || !readIsoDatetime(normalizedCapture.capturedAt)) {
    return null;
  }

  return {
    sourceSurface: normalizedCapture.sourceSurface,
    sourceGroupId: normalizedCapture.sourceGroupId,
    sourceGroupName: normalizedCapture.sourceGroupName,
    sourceGroupUrl,
    sourcePostUrl,
    capturedText: normalizedCapture.capturedText,
    capturedAt: normalizedCapture.capturedAt,
  };
}

function normalizeHousingDetails(details) {
  if (details === null) {
    return null;
  }

  if (!isPlainObject(details)) {
    return undefined;
  }

  const listingType = readEnum(details.listingType, listingTypeValues);
  const tenancyType = readEnum(details.tenancyType, tenancyTypeValues);
  const priceMonthly = normalizeNullableInteger(details.priceMonthly, { min: 1 });
  const bedrooms = normalizeBedrooms(details.bedrooms);
  const bathroom = readEnum(details.bathroom, bathroomValues);
  const roommateCount = normalizeNullableInteger(details.roommateCount, { min: 0 });
  const locationText = normalizeNullableString(details.locationText);
  const neighborhoodGuess = normalizeRequiredString(details.neighborhoodGuess);
  const availabilityStart = normalizeNullableString(details.availabilityStart);
  const availabilityEnd = normalizeNullableString(details.availabilityEnd);
  const dateFlexibility = readEnum(details.dateFlexibility, dateFlexibilityValues);
  const durationText = normalizeNullableString(details.durationText);
  const furnished = normalizeNullableBoolean(details.furnished);
  const pets = readEnum(details.pets, petsValues);
  const notes = normalizeStringArray(details.notes);

  if (
    !listingType ||
    !tenancyType ||
    priceMonthly === undefined ||
    bedrooms === undefined ||
    !bathroom ||
    roommateCount === undefined ||
    locationText === undefined ||
    !neighborhoodGuess ||
    availabilityStart === undefined ||
    availabilityEnd === undefined ||
    !dateFlexibility ||
    durationText === undefined ||
    furnished === undefined ||
    !pets ||
    !notes
  ) {
    return undefined;
  }

  return {
    listingType,
    tenancyType,
    priceMonthly,
    bedrooms,
    bathroom,
    roommateCount,
    locationText,
    neighborhoodGuess,
    availabilityStart,
    availabilityEnd,
    dateFlexibility,
    durationText,
    furnished,
    pets,
    notes,
  };
}

function normalizeBedrooms(value) {
  if (value === null) {
    return null;
  }

  if (value === "studio") {
    return "studio";
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  return undefined;
}

function normalizeNullableInteger(value, { min }) {
  if (value === null) {
    return null;
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= min) {
    return value;
  }

  return undefined;
}

function normalizeNullableString(value) {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return undefined;
}

function normalizeNullableBoolean(value) {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  return undefined;
}

function normalizeRequiredString(value) {
  if (typeof value === "string" && value) {
    return value;
  }

  return null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return null;
  }

  return [...value];
}

function readEnum(value, allowedValues) {
  return typeof value === "string" && allowedValues.has(value) ? value : null;
}

function readIsoDatetime(value) {
  if (typeof value !== "string" || !value) {
    return null;
  }

  return Number.isNaN(Date.parse(value)) ? null : value;
}

function readUuid(value) {
  return typeof value === "string" && uuidPattern.test(value) ? value : null;
}

function safeHttpUrl(value) {
  if (typeof value !== "string" || !value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
