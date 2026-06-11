import { expect, test } from "@playwright/test";

const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async ({ page }) => {
  await page.route("**/{tile.openstreetmap.org,*.tile.openstreetmap.org}/**", async (route) => {
    await route.fulfill({
      body: transparentPng,
      contentType: "image/png",
    });
  });
});

test("renders editable apartment map shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("SF Apartment Hunt")).toBeVisible();
  await expect(page.getByText("Boundaries are approximate apartment-search zones")).toBeVisible();
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.locator(".leaflet-pm-toolbar")).toBeVisible();
  await expect(page.locator(".leaflet-pm-icon-edit")).toBeVisible();
});

test("fits the apartment map on a mobile viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/");

  await expect(page.locator(".leaflet-container")).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

  expect(hasHorizontalOverflow).toBe(false);
});

test("shows disabled AI state until a key is saved", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("OpenAI key required")).toBeVisible();
  await expect(page.getByText("AI requests are disabled until you save an OpenAI key.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
});

test("shows proposal review before applying AI changes", async ({ page }) => {
  let applyProposalCalled = false;

  await page.route("**/api/ai/map-assistant", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer sk-test");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        explanation: "I can raise Valencia priority.",
        intent: "prioritization",
        proposal: {
          summary: "Raise Valencia priority.",
          operations: [
            {
              type: "updateCorridorPriority",
              corridorId: "valencia",
              priority: "high",
              reason: "Best fitness fit.",
            },
          ],
          confidence: "high",
          requiresUserReview: true,
        },
        confidence: "high",
        caveats: [],
      }),
    });
  });
  await page.route("**/api/map/apply-proposal", async (route) => {
    applyProposalCalled = true;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "Apply should wait for user review." }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Add OpenAI key" }).click();
  await page.getByLabel("OpenAI API key").fill("sk-test");
  await page.getByRole("button", { name: "Save key" }).click();
  await page.getByLabel("Ask the assistant").fill("Make Valencia target corridor more important");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Raise Valencia priority.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply changes" })).toBeVisible();
  expect(applyProposalCalled).toBe(false);
});

test("renders listing cards and geocodes authorized candidates", async ({ page }) => {
  let geocodeSessionHeader: string | undefined;

  await page.route("**/api/ai/listing-search", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer sk-test");
    const body = route.request().postDataJSON();

    expect(body).toMatchObject({
      query: "Find studio listing under 3000 near Fillmore",
      filters: {
        maxBudget: null,
        beds: "any",
        timing: "",
        shortTerm: false,
        furnished: false,
      },
    });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        candidates: [
          {
            id: "listing-1",
            title: "Sunny Fillmore Studio",
            url: "https://example.com/listings/1",
            sourceDomain: "example.com",
            neighborhoodGuess: "Lower Pac Heights",
            locationText: "Fillmore and California",
            geocodeQuery: "Fillmore and California",
            locationConfidence: "medium",
            coordinates: null,
            geocodeStatus: "not_attempted",
            markerPrecision: "none",
            priceMonthly: 2800,
            beds: "studio",
            shortTermSignal: false,
            furnishedSignal: false,
            fitScore: 4,
            whyItFits: "Under budget near the target corridor.",
            citations: [
              {
                url: "https://example.com/listings/1",
                title: "Listing 1",
                sourceDomain: "example.com",
              },
            ],
            caveats: ["Availability can change quickly."],
          },
        ],
        sourceSummary: "One listing matched.",
        citations: [
          {
            url: "https://example.com/listings/1",
            title: "Listing 1",
            sourceDomain: "example.com",
          },
        ],
        caveats: [],
        geocodeAuthorization: {
          nonce: "nonce-1",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          maxAttempts: 1,
          allowedQueries: [
            {
              candidateId: "listing-1",
              geocodeQueryHash: "hash-1",
            },
          ],
        },
      }),
    });
  });
  await page.route("**/api/geocode/listing", async (route) => {
    geocodeSessionHeader = route.request().headers()["x-sf-apt-session"];
    expect(route.request().postDataJSON()).toEqual({
      nonce: "nonce-1",
      candidateId: "listing-1",
      geocodeQuery: "Fillmore and California",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        geocode: {
          status: "ok",
          coordinates: [-122.433, 37.789],
          markerPrecision: "exact",
          formattedAddress: "Fillmore St & California St, San Francisco, CA 94115, USA",
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Add OpenAI key" }).click();
  await page.getByLabel("OpenAI API key").fill("sk-test");
  await page.getByRole("button", { name: "Save key" }).click();
  await page.getByLabel("Ask the assistant").fill("Find studio listing under 3000 near Fillmore");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Sunny Fillmore Studio")).toBeVisible();
  await expect(page.getByText("Under budget near the target corridor.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Listing 1" })).toBeVisible();
  await expect(page.getByText("Exact pin")).toBeVisible();
  await expect(page.getByText("1 listing pin.")).toBeVisible();
  expect(geocodeSessionHeader).toBeTruthy();
});
