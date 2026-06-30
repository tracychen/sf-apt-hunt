import { JSDOM } from "jsdom";
import { afterEach, describe, expect, test, vi } from "vitest";

import { normalizeImportCaptureRequest, normalizeImportCaptureResponse } from "../../extension/background.js";
import {
  buildImportRequest,
  createImportRequestCache,
  getImportErrorMessage,
  normalizeCaptureForReview,
  readDetails,
  writeDetailsToForm,
} from "../../extension/review.js";

describe("extension review import request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("builds an incomplete save request with idempotency key", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
    });

    expect(
      buildImportRequest(
        {
          sourceSurface: "groupFeed",
          sourceGroupId: "12345",
          sourceGroupName: "SF Housing",
          sourceGroupUrl: "https://www.facebook.com/groups/12345",
          sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
          capturedText: "Room in Hayes Valley",
          capturedAt: "2026-06-30T02:00:00.000Z",
        },
        null,
        ["missing_price"],
      ),
    ).toMatchObject({
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      reviewedDetails: null,
      incompleteFlags: ["missing_price"],
    });
  });

  test("does not allow capture idempotencyKey to override the generated key", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "00000000-0000-4000-8000-000000000002",
    });

    expect(
      buildImportRequest(
        {
          sourceSurface: "groupFeed",
          sourceGroupId: "12345",
          sourceGroupName: "SF Housing",
          sourceGroupUrl: "https://www.facebook.com/groups/12345",
          sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
          capturedText: "Room in Hayes Valley",
          capturedAt: "2026-06-30T02:00:00.000Z",
          idempotencyKey: "capture-supplied-key",
        },
        null,
        ["saved_incomplete"],
      ).idempotencyKey,
    ).toBe("00000000-0000-4000-8000-000000000002");
  });

  test("normalizes capture input to the expected review fields only", () => {
    expect(
      normalizeCaptureForReview({
        sourceSurface: "groupFeed",
        sourceGroupId: "12345",
        sourceGroupName: "SF Housing",
        sourceGroupUrl: "https://www.facebook.com/groups/12345",
        sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
        capturedText: "Room in Hayes Valley",
        capturedAt: "2026-06-30T02:00:00.000Z",
        lead: { id: "lead-1" },
        parsedDraft: { listingType: "private_room" },
        arbitrary: "unexpected",
      }),
    ).toEqual({
      sourceSurface: "groupFeed",
      sourceGroupId: "12345",
      sourceGroupName: "SF Housing",
      sourceGroupUrl: "https://www.facebook.com/groups/12345",
      sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
      capturedText: "Room in Hayes Valley",
      capturedAt: "2026-06-30T02:00:00.000Z",
    });
  });

  test("buildImportRequest omits extra capture fields", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "00000000-0000-4000-8000-000000000003",
    });

    expect(
      buildImportRequest(
        {
          sourceSurface: "groupFeed",
          sourceGroupId: "12345",
          sourceGroupName: "SF Housing",
          sourceGroupUrl: "https://www.facebook.com/groups/12345",
          sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
          capturedText: "Room in Hayes Valley",
          capturedAt: "2026-06-30T02:00:00.000Z",
          arbitrary: "unexpected",
          lead: { id: "lead-1" },
        },
        null,
        ["saved_incomplete"],
      ),
    ).toEqual({
      sourceSurface: "groupFeed",
      sourceGroupId: "12345",
      sourceGroupName: "SF Housing",
      sourceGroupUrl: "https://www.facebook.com/groups/12345",
      sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
      capturedText: "Room in Hayes Valley",
      capturedAt: "2026-06-30T02:00:00.000Z",
      idempotencyKey: "00000000-0000-4000-8000-000000000003",
      parsedDraft: null,
      reviewedDetails: null,
      incompleteFlags: ["saved_incomplete"],
    });
  });

  test("reuses the reviewed save request across retries until the form changes", () => {
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000010")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000011");

    vi.stubGlobal("crypto", { randomUUID });

    const requestCache = createImportRequestCache({
      sourceSurface: "groupFeed",
      sourceGroupId: "12345",
      sourceGroupName: "SF Housing",
      sourceGroupUrl: "https://www.facebook.com/groups/12345",
      sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
      capturedText: "Room in Hayes Valley",
      capturedAt: "2026-06-30T02:00:00.000Z",
    });

    const firstAttempt = new FormData();
    firstAttempt.set("listingType", "private_room");
    firstAttempt.set("priceMonthly", "1800");

    const retryAttempt = new FormData();
    retryAttempt.set("listingType", "private_room");
    retryAttempt.set("priceMonthly", "1800");

    const changedAttempt = new FormData();
    changedAttempt.set("listingType", "private_room");
    changedAttempt.set("priceMonthly", "1850");

    const firstRequest = requestCache.getReviewedRequest(firstAttempt);
    const retriedRequest = requestCache.getReviewedRequest(retryAttempt);
    const changedRequest = requestCache.getReviewedRequest(changedAttempt);

    expect(retriedRequest).toBe(firstRequest);
    expect(retriedRequest.idempotencyKey).toBe("00000000-0000-4000-8000-000000000010");
    expect(changedRequest).not.toBe(firstRequest);
    expect(changedRequest.idempotencyKey).toBe("00000000-0000-4000-8000-000000000011");
  });

  test("reuses the incomplete save request across retries and mints a new key for the other save mode", () => {
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000020")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000021");

    vi.stubGlobal("crypto", { randomUUID });

    const requestCache = createImportRequestCache({
      sourceSurface: "groupFeed",
      sourceGroupId: "12345",
      sourceGroupName: "SF Housing",
      sourceGroupUrl: "https://www.facebook.com/groups/12345",
      sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
      capturedText: "Room in Hayes Valley",
      capturedAt: "2026-06-30T02:00:00.000Z",
    });

    const firstIncompleteRequest = requestCache.getIncompleteRequest();
    const retriedIncompleteRequest = requestCache.getIncompleteRequest();

    const reviewedAttempt = new FormData();
    reviewedAttempt.set("listingType", "private_room");

    const reviewedRequest = requestCache.getReviewedRequest(reviewedAttempt);

    expect(retriedIncompleteRequest).toBe(firstIncompleteRequest);
    expect(retriedIncompleteRequest.idempotencyKey).toBe("00000000-0000-4000-8000-000000000020");
    expect(reviewedRequest).not.toBe(firstIncompleteRequest);
    expect(reviewedRequest.idempotencyKey).toBe("00000000-0000-4000-8000-000000000021");
  });

  test("falls back to unknown for tampered fixed-set review form values", () => {
    const formData = new FormData();
    formData.set("listingType", "penthouse");
    formData.set("tenancyType", "lease_to_own");
    formData.set("bathroom", "ensuite");
    formData.set("priceMonthly", "1800");

    expect(readDetails(formData)).toMatchObject({
      listingType: "unknown",
      tenancyType: "unknown",
      bathroom: "unknown",
      priceMonthly: 1800,
    });
  });

  test("normalizes validated import requests and drops extra fields", () => {
    expect(
      normalizeImportCaptureRequest({
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        sourceSurface: "groupFeed",
        sourceGroupId: "12345",
        sourceGroupName: "SF Housing",
        sourceGroupUrl: "https://www.facebook.com/groups/12345",
        sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
        capturedText: "Room in Hayes Valley",
        capturedAt: "2026-06-30T02:00:00.000Z",
        parsedDraft: null,
        reviewedDetails: {
          listingType: "private_room",
          tenancyType: "sublet",
          priceMonthly: 1800,
          bedrooms: 2,
          bathroom: "shared",
          roommateCount: 1,
          locationText: "Hayes Valley",
          neighborhoodGuess: "Hayes Valley",
          availabilityStart: "2026-07-15",
          availabilityEnd: null,
          dateFlexibility: "flexible",
          durationText: "3 months",
          furnished: null,
          pets: "unknown",
          notes: ["Utilities not confirmed"],
          arbitrary: "unexpected",
        },
        incompleteFlags: ["saved_incomplete"],
        arbitrary: "unexpected",
      }),
    ).toEqual({
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      sourceSurface: "groupFeed",
      sourceGroupId: "12345",
      sourceGroupName: "SF Housing",
      sourceGroupUrl: "https://www.facebook.com/groups/12345",
      sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
      capturedText: "Room in Hayes Valley",
      capturedAt: "2026-06-30T02:00:00.000Z",
      parsedDraft: null,
      reviewedDetails: {
        listingType: "private_room",
        tenancyType: "sublet",
        priceMonthly: 1800,
        bedrooms: 2,
        bathroom: "shared",
        roommateCount: 1,
        locationText: "Hayes Valley",
        neighborhoodGuess: "Hayes Valley",
        availabilityStart: "2026-07-15",
        availabilityEnd: null,
        dateFlexibility: "flexible",
        durationText: "3 months",
        furnished: null,
        pets: "unknown",
        notes: ["Utilities not confirmed"],
      },
      incompleteFlags: ["saved_incomplete"],
    });
  });

  test("rejects malformed import requests before forwarding them", () => {
    expect(
      normalizeImportCaptureRequest({
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        sourceSurface: "marketplace",
        sourceGroupId: "12345",
        sourceGroupName: "SF Housing",
        sourceGroupUrl: "https://www.facebook.com/groups/12345",
        sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
        capturedText: "Room in Hayes Valley",
        capturedAt: "2026-06-30T02:00:00.000Z",
        parsedDraft: null,
        reviewedDetails: {
          listingType: "private_room",
          tenancyType: "sublet",
          priceMonthly: 1800,
          bedrooms: 2,
          bathroom: "ensuite",
          roommateCount: 1,
          locationText: "Hayes Valley",
          neighborhoodGuess: "Hayes Valley",
          availabilityStart: "2026-07-15",
          availabilityEnd: null,
          dateFlexibility: "flexible",
          durationText: "3 months",
          furnished: null,
          pets: "unknown",
          notes: ["Utilities not confirmed"],
        },
        incompleteFlags: ["saved_incomplete"],
      }),
    ).toBeNull();
  });

  test("normalizes malformed and unknown import responses to import_failed", () => {
    expect(normalizeImportCaptureResponse(null)).toEqual({ ok: false, error: "import_failed" });
    expect(
      normalizeImportCaptureResponse({
        ok: false,
        error: "<script>alert('xss')</script>",
      }),
    ).toEqual({ ok: false, error: "import_failed" });
    expect(
      normalizeImportCaptureResponse({
        ok: true,
        captureId: "capture-1",
        listingLedgerRevision: "rev-1",
        lead: { id: "lead-1", price: 1800 },
      }),
    ).toEqual({
      ok: true,
      captureId: "capture-1",
      listingLedgerRevision: "rev-1",
    });
    expect(
      normalizeImportCaptureResponse({
        ok: true,
        captureId: "capture-1",
      }),
    ).toEqual({ ok: false, error: "import_failed" });
  });

  test("maps unsafe import errors to fixed local copy", () => {
    const message = getImportErrorMessage("<img src=x onerror=alert('xss')>");

    expect(message).toBe("The listing could not be imported. Try again.");
    expect(message).not.toContain("<img");
    expect(message).not.toContain("onerror");
  });

  test("writes parsed housing details into the review form without touching unknown fields", () => {
    const dom = new JSDOM(`
      <form>
        <input name="priceMonthly" />
        <input name="neighborhoodGuess" />
        <textarea name="notes"></textarea>
      </form>
    `);
    const form = dom.window.document.querySelector("form");

    if (!form) {
      throw new Error("Expected review form");
    }

    writeDetailsToForm(form, {
      priceMonthly: 1800,
      neighborhoodGuess: "Hayes Valley",
      notes: ["Utilities not confirmed", "Laundry in building"],
      arbitrary: "ignored",
    });

    const priceMonthly = form.elements.namedItem("priceMonthly");
    const neighborhoodGuess = form.elements.namedItem("neighborhoodGuess");
    const notes = form.elements.namedItem("notes");

    if (
      !(priceMonthly instanceof dom.window.HTMLInputElement) ||
      !(neighborhoodGuess instanceof dom.window.HTMLInputElement) ||
      !(notes instanceof dom.window.HTMLTextAreaElement)
    ) {
      throw new Error("Expected review form fields");
    }

    expect(priceMonthly.value).toBe("1800");
    expect(neighborhoodGuess.value).toBe("Hayes Valley");
    expect(notes.value).toBe(
      "Utilities not confirmed\nLaundry in building",
    );
    expect(form.elements.namedItem("arbitrary")).toBeNull();
  });
});
