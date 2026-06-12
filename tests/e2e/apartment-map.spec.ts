import { expect, test, type Page } from "@playwright/test";
import { seedMapState } from "../../lib/map/seed-data";

const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);
const mapStateStorageKey = "sf-apt-hunt:map-state:v1";
const maxTargetNameLength = 160;
const maxTargetTextLength = 2_000;
const maxTargetNotes = 50;
const maxCorridorNameLength = 160;
const maxCorridorTextLength = 2_000;
const maxCorridorNotes = 50;

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

test("target planning anchors show purpose labels and radius rings", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator(".target-anchor-radius")).toHaveCount(3);
  await expect(
    page.locator(".target-anchor-marker-positive[title='Mission favorite block · Valencia & 20th']"),
  ).toBeVisible();
  await expect(page.locator(".target-anchor-marker-positive").first()).toBeVisible();
  await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible();
});

test("edits selected target planning fields from the sidebar", async ({ page }) => {
  await page.goto("/");

  await page.getByTitle("Mission favorite block · Valencia & 20th").click();
  await expect(page.getByLabel("Target purpose")).toHaveValue("Mission favorite block");

  await page.getByLabel("Target purpose").fill("favorite dinner block");
  await page.getByLabel("Target purpose").blur();
  await page.getByLabel("Target influence").selectOption("negative");
  await page.getByLabel("Target priority").selectOption("medium");
  await page.getByLabel("Target radius").selectOption("15");
  await page.getByLabel("Target notes").fill("Check evening noise before applying.");
  await page.getByLabel("Target notes").blur();

  await expect(
    page.locator(".target-anchor-marker[title='favorite dinner block · Valencia & 20th']"),
  ).toBeVisible();
  await expect(page.getByText("Active shape: favorite dinner block · Valencia & 20th")).toBeVisible();
  await expect(page.getByLabel("Target influence")).toHaveValue("negative");
  await expect(page.getByLabel("Target radius")).toHaveValue("15");
});

test("edits selected corridor metadata from the sidebar", async ({ page }) => {
  await page.goto("/");

  await clickPolkCorridor(page);
  await expect(page.getByLabel("Corridor name")).toHaveValue("Polk Street");

  await page.getByLabel("Corridor name").fill("Polk Gulch spine");
  await page.getByLabel("Corridor name").blur();
  await page.getByLabel("Corridor priority").selectOption("high");
  await page.getByLabel("Corridor tag transit").check();
  await page.getByLabel("Corridor tag rent").uncheck();
  await page.getByLabel("Corridor notes").fill("Prioritize this north-side run.");
  await page.getByLabel("Corridor notes").blur();

  await expect(page.getByText("Active shape: Polk Gulch spine")).toBeVisible();
  await expect(page.getByLabel("Corridor priority")).toHaveValue("high");
  await expect(page.getByLabel("Corridor tag transit")).toBeChecked();

  await page.reload();
  await clickPolkCorridor(page);
  await expect(page.getByLabel("Corridor notes")).toHaveValue("Prioritize this north-side run.");
});

test("target field edits are undoable and resettable", async ({ page }) => {
  await page.goto("/");

  await page.getByTitle("Mission favorite block · Valencia & 20th").click();
  await page.getByLabel("Target purpose").fill("favorite dinner block");
  await page.getByLabel("Target purpose").blur();
  await expect(
    page.locator(".target-anchor-marker[title='favorite dinner block · Valencia & 20th']"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(
    page.locator(".target-anchor-marker[title='Mission favorite block · Valencia & 20th']"),
  ).toBeVisible();

  await page.getByLabel("Target purpose").fill("favorite dinner block");
  await page.getByLabel("Target purpose").blur();
  await expect(page.getByLabel("Target purpose")).toHaveValue("favorite dinner block");
  await page.getByRole("button", { name: "Reset selected shape" }).click();
  await expect(page.getByLabel("Target purpose")).toHaveValue("Mission favorite block");
  await expect(
    page.locator(".target-anchor-marker[title='Mission favorite block · Valencia & 20th']"),
  ).toBeVisible();
});

test("corridor field edits are undoable and resettable", async ({ page }) => {
  await page.goto("/");

  await clickPolkCorridor(page);
  await page.getByLabel("Corridor name").fill("Polk Gulch spine");
  await page.getByLabel("Corridor name").blur();
  await expect(page.getByText("Active shape: Polk Gulch spine")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Active shape: Polk Street")).toBeVisible();

  await page.getByLabel("Corridor name").fill("Polk Gulch spine");
  await page.getByLabel("Corridor name").blur();
  await expect(page.getByLabel("Corridor name")).toHaveValue("Polk Gulch spine");
  await page.getByRole("button", { name: "Reset selected shape" }).click();
  await expect(page.getByLabel("Corridor name")).toHaveValue("Polk Street");
});

test("resetting a custom target removes the stale selected target", async ({ page }) => {
  await page.addInitScript(
    ({ key, state }) => {
      window.localStorage.setItem(key, JSON.stringify(state));
    },
    {
      key: mapStateStorageKey,
      state: {
        ...seedMapState,
        targets: [
          ...seedMapState.targets,
          {
            id: "custom-grocery",
            name: "Custom grocery",
            purpose: "easy grocery run",
            coordinates: [-122.437, 37.776],
            priority: "medium",
            influence: "positive",
            radiusMinutes: 5,
            notes: ["Temporary errand anchor."],
          },
        ],
      },
    },
  );

  await page.goto("/");

  await page.getByTitle("easy grocery run · Custom grocery").click();
  await expect(page.getByText("Active shape: easy grocery run · Custom grocery")).toBeVisible();

  await page.getByRole("button", { name: "Reset selected shape" }).click();

  await expect(page.getByText("Active shape: None")).toBeVisible();
  await expect(page.locator(".target-anchor-marker[title='easy grocery run · Custom grocery']")).toHaveCount(0);
});

test("resetting a custom corridor removes the stale selected corridor", async ({ page }) => {
  await page.addInitScript(
    ({ key, state }) => {
      window.localStorage.setItem(key, JSON.stringify(state));
    },
    {
      key: mapStateStorageKey,
      state: {
        ...seedMapState,
        corridors: [
          ...seedMapState.corridors,
          {
            id: "custom-corridor",
            name: "Custom corridor",
            geometry: {
              type: "LineString",
              coordinates: [
                [-122.437, 37.776],
                [-122.431, 37.781],
              ],
            },
            priority: "medium",
            tags: ["transit"],
            notes: ["Temporary corridor."],
          },
        ],
      },
    },
  );

  await page.goto("/");

  await clickCustomCorridor(page);
  await expect(page.getByText("Active shape: Custom corridor")).toBeVisible();

  await page.getByRole("button", { name: "Reset selected shape" }).click();

  await expect(page.getByText("Active shape: None")).toBeVisible();
  await expect(page.getByLabel("Corridor name")).toHaveCount(0);
});

test("clamps selected target planning text fields to persisted schema limits", async ({ page }) => {
  const overlongPurpose = `purpose-${"p".repeat(maxTargetTextLength + 20)}`;
  const overlongName = `location-${"n".repeat(maxTargetNameLength + 20)}`;
  const overlongNotes = [
    `note-${"x".repeat(maxTargetTextLength + 20)}`,
    ...Array.from({ length: maxTargetNotes + 5 }, (_, index) => `note-${index}`),
  ];
  const clampedPurpose = overlongPurpose.slice(0, maxTargetTextLength);
  const clampedName = overlongName.slice(0, maxTargetNameLength);
  const clampedNotes = overlongNotes
    .slice(0, maxTargetNotes)
    .map((note) => note.slice(0, maxTargetTextLength));

  await page.goto("/");

  await page.getByTitle("Mission favorite block · Valencia & 20th").click();
  await page.getByLabel("Target purpose").fill(overlongPurpose);
  await page.getByLabel("Target purpose").blur();
  await page.getByLabel("Target location label").fill(overlongName);
  await page.getByLabel("Target location label").blur();
  await page.getByLabel("Target notes").fill(overlongNotes.join("\n"));
  await page.getByLabel("Target notes").blur();

  await page.reload();

  await page.locator(`.target-anchor-marker-positive[title^="${clampedPurpose.slice(0, 24)}"]`).click();
  await expect(page.getByLabel("Target purpose")).toHaveValue(clampedPurpose);
  await expect(page.getByLabel("Target location label")).toHaveValue(clampedName);
  await expect(page.getByLabel("Target notes")).toHaveValue(clampedNotes.join("\n"));
});

test("clamps selected corridor text fields to persisted schema limits", async ({ page }) => {
  const overlongName = `corridor-${"n".repeat(maxCorridorNameLength + 20)}`;
  const overlongNotes = [
    `note-${"x".repeat(maxCorridorTextLength + 20)}`,
    ...Array.from({ length: maxCorridorNotes + 5 }, (_, index) => `corridor-note-${index}`),
  ];
  const clampedName = overlongName.slice(0, maxCorridorNameLength);
  const clampedNotes = overlongNotes
    .slice(0, maxCorridorNotes)
    .map((note) => note.slice(0, maxCorridorTextLength));

  await page.goto("/");

  await clickPolkCorridor(page);
  await page.getByLabel("Corridor name").fill(overlongName);
  await page.getByLabel("Corridor name").blur();
  await page.getByLabel("Corridor notes").fill(overlongNotes.join("\n"));
  await page.getByLabel("Corridor notes").blur();

  await page.reload();

  await clickPolkCorridor(page);
  await expect(page.getByLabel("Corridor name")).toHaveValue(clampedName);
  await expect(page.getByLabel("Corridor notes")).toHaveValue(clampedNotes.join("\n"));
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
        explanation: "I can replace the Valencia target note.",
        intent: "prioritization",
        proposal: {
          summary: "Replace Valencia target notes.",
          operations: [
            {
              type: "updateTargetPlanningFields",
              targetId: "valencia-20th",
              notes: ["Check evening noise before applying."],
              reason: "The note should carry more useful planning context.",
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

  await expect(page.getByText("Replace Valencia target notes.")).toBeVisible();
  await expect(page.getByText("Before: Mission Dolores / Valencia reference point.")).toBeVisible();
  await expect(page.getByText("After: Check evening noise before applying.")).toBeVisible();
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
      selectedContext: {
        zones: [],
        corridors: expect.any(Array),
      },
    });
    expect(body.selectedContext.corridors.length).toBeGreaterThan(0);

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
  await expect(page.getByText("One listing matched.")).toBeVisible();
  await expect(page.getByText("Under budget near the target corridor.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Listing 1" }).first()).toBeVisible();
  await expect(page.getByText("Exact pin")).toBeVisible();
  await expect(page.getByText("1 listing pin.")).toBeVisible();
  expect(geocodeSessionHeader).toBeTruthy();
});

test("undoes applied map changes with Ctrl+Z or Cmd+Z", async ({ page }) => {
  await page.route("**/api/ai/map-assistant", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer sk-test");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        explanation: "I can raise Polk priority.",
        intent: "prioritization",
        proposal: {
          summary: "Raise Polk priority.",
          operations: [
            {
              type: "updateCorridorPriority",
              corridorId: "polk",
              priority: "high",
              reason: "Closer to the requested north-side search area.",
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

  await page.goto("/");
  await page.getByRole("button", { name: "Add OpenAI key" }).click();
  await page.getByLabel("OpenAI API key").fill("sk-test");
  await page.getByRole("button", { name: "Save key" }).click();

  await applyPolkPriorityProposal(page);
  await expect.poll(() => readCorridorPriority(page, "polk")).toBe("high");

  await page.keyboard.press("Control+Z");
  await expect.poll(() => readCorridorPriority(page, "polk")).toBe("medium");

  await applyPolkPriorityProposal(page);
  await expect.poll(() => readCorridorPriority(page, "polk")).toBe("high");

  await page.keyboard.press("Meta+Z");
  await expect.poll(() => readCorridorPriority(page, "polk")).toBe("medium");
});

async function applyPolkPriorityProposal(page: Page) {
  await page.getByLabel("Ask the assistant").fill("Make Polk corridor high priority");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Raise Polk priority.")).toBeVisible();
  await page.getByRole("button", { name: "Apply changes" }).click();
}

async function readCorridorPriority(page: Page, corridorId: string) {
  return page.evaluate(
    ({ key, id }) => {
      const storedMapState = window.localStorage.getItem(key);
      if (!storedMapState) {
        return null;
      }

      const mapState = JSON.parse(storedMapState) as {
        corridors?: Array<{ id: string; priority: string }>;
      };
      return mapState.corridors?.find((corridor) => corridor.id === id)?.priority ?? null;
    },
    { key: mapStateStorageKey, id: corridorId },
  );
}

async function clickPolkCorridor(page: Page) {
  const mapPaths = page.locator(".leaflet-overlay-pane svg path");
  await expect(mapPaths).toHaveCount(13);
  await mapPaths.nth(9).click({ force: true });
}

async function clickCustomCorridor(page: Page) {
  const mapPaths = page.locator(".leaflet-overlay-pane svg path");
  await expect(mapPaths).toHaveCount(14);
  await mapPaths.nth(10).click({ force: true });
}
