import { expect, test, type Page } from "@playwright/test";
import { samplePlanningMapState, seedMapState } from "../../lib/map/seed-data";

const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);
const openAiKeyStorageKey = "sf-apt-hunt:openai-key";
const mapStateStorageKey = "sf-apt-hunt:map-state:v1";
const listingLedgerStorageKey = "sf-apt-hunt:listing-ledger:v1";
const planningInstallationStorageKey = "sf-apt-hunt:planning-installation:v1";
const planningThreadCacheStorageKey = "sf-apt-hunt:planning-thread-cache:v1";
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
  await expect(page.getByText("Neighborhood outlines are approximate references")).toBeVisible();
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.locator(".leaflet-pm-toolbar")).toBeVisible();
  await expect(page.locator(".leaflet-pm-icon-edit")).toBeVisible();
  await expect(page.locator(".target-anchor-marker")).toHaveCount(0);
  await expect(page.locator(".target-anchor-radius")).toHaveCount(0);
  await expect(page.locator(".target-corridor")).toHaveCount(0);
});

test("styles onboarding highlight popovers with app chrome", async ({ page }) => {
  await page.goto("/");

  await page
    .getByRole("listitem")
    .filter({ hasText: "Add your OpenAI key" })
    .getByRole("button", { name: "Show me" })
    .click();

  await expect(page.locator(".driver-popover-title")).toHaveText("Add your OpenAI key");

  const styles = await page.evaluate(() => {
    const popover = document.querySelector<HTMLElement>(".driver-popover");
    const title = document.querySelector<HTMLElement>(".driver-popover-title");

    if (!popover || !title) {
      throw new Error("Driver popover was not rendered.");
    }

    const appFontFamily = getComputedStyle(document.documentElement).fontFamily;
    const popoverStyles = getComputedStyle(popover);
    const titleStyles = getComputedStyle(title);

    return {
      appFontFamily,
      borderRadius: popoverStyles.borderRadius,
      borderWidth: popoverStyles.borderTopWidth,
      popoverFontFamily: popoverStyles.fontFamily,
      titleFontFamily: titleStyles.fontFamily,
    };
  });

  expect(styles.popoverFontFamily).toBe(styles.appFontFamily);
  expect(styles.titleFontFamily).toBe(styles.appFontFamily);
  expect(styles.borderRadius).toBe("0px");
  expect(styles.borderWidth).toBe("1px");
});

test("shows getting started overlay on the map instead of in the sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const sidebar = page.locator("aside");
  const overlay = page.getByTestId("map-onboarding-overlay");

  await expect(sidebar.getByRole("heading", { name: "Getting started" })).toHaveCount(0);
  await expect(overlay.getByRole("heading", { name: "Getting started" })).toBeVisible();

  const mapBox = await page.locator(".leaflet-container").boundingBox();
  const overlayBox = await overlay.boundingBox();
  const sidebarBox = await sidebar.boundingBox();

  expect(mapBox).not.toBeNull();
  expect(overlayBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(overlayBox!.x).toBeGreaterThanOrEqual(mapBox!.x);
  expect(overlayBox!.x).toBeLessThan(sidebarBox!.x);
  expect(overlayBox!.y).toBeGreaterThanOrEqual(mapBox!.y);
});

test("map UI chrome keeps controls separate from onboarding and uses app scrollbars", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const overlay = page.getByTestId("map-onboarding-overlay");
  const geomanToolbar = page.locator(".leaflet-pm-toolbar").first();
  await expect(overlay.getByRole("heading", { name: "Getting started" })).toBeVisible();
  await expect(geomanToolbar).toBeVisible();

  const overlayBox = await overlay.boundingBox();
  const toolbarBox = await geomanToolbar.boundingBox();
  expect(overlayBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  expect(boxesOverlap(overlayBox!, toolbarBox!)).toBe(false);

  const styles = await page.evaluate(() => {
    const overlayElement = document.querySelector<HTMLElement>(
      "[data-testid='map-onboarding-overlay'] > section",
    );
    const controlButton = document.querySelector<HTMLElement>(".leaflet-pm-toolbar a");

    if (!overlayElement || !controlButton) {
      throw new Error("Expected onboarding overlay and map control button.");
    }

    const overlayStyles = getComputedStyle(overlayElement);
    const buttonStyles = getComputedStyle(controlButton);

    return {
      buttonBackground: buttonStyles.backgroundColor,
      buttonBorderRadius: buttonStyles.borderRadius,
      buttonBoxShadow: buttonStyles.boxShadow,
      scrollbarColor: overlayStyles.scrollbarColor,
      scrollbarWidth: overlayStyles.scrollbarWidth,
    };
  });

  expect(styles.buttonBackground).not.toBe("rgb(255, 255, 255)");
  expect(styles.buttonBorderRadius).toBe("0px");
  expect(styles.buttonBoxShadow).toBe("none");
  expect(styles.scrollbarColor).not.toBe("auto");
  expect(styles.scrollbarWidth).toBe("thin");
});

test("target planning anchors show purpose labels and radius rings", async ({ page }) => {
  await loadSamplePlanningMap(page);
  await page.goto("/");

  await expect(page.locator(".target-anchor-radius")).toHaveCount(3);
  await expect(
    page.locator(".target-anchor-marker-positive[title='Mission favorite block · Valencia & 20th']"),
  ).toBeVisible();
  await expect(page.locator(".target-anchor-marker-positive").first()).toBeVisible();
  await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible();
});

test("creates and edits a planning area from a neighborhood outline", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("Areas")).toBeChecked();
  await page.locator(".neighborhood-outline-lower-pac-heights").click({ force: true });
  await page.getByRole("button", { name: "Use as planning area" }).click();

  await expect(page.locator(".planning-area-positive")).toHaveCount(1);
  await expect(page.getByText("Selected item: Lower Pac Heights area")).toBeVisible();
  await expect(page.getByLabel("Area purpose")).toHaveValue(
    "Preferred apartment search area around Lower Pac Heights.",
  );

  await page.getByLabel("Area purpose").fill("Prefer Fillmore access");
  await page.getByLabel("Area purpose").blur();
  await page.getByLabel("Area influence").selectOption("negative");
  await page.getByLabel("Area priority").selectOption("high");
  await page.getByLabel("Area notes").fill("Avoid this exact polygon for now.");
  await page.getByLabel("Area notes").blur();

  await expect(page.getByText("Selected item: Lower Pac Heights area")).toBeVisible();
  await expect(page.getByLabel("Area influence")).toHaveValue("negative");
  await expect(page.locator(".planning-area-negative")).toHaveCount(1);

  await page.reload();
  await expect(page.locator(".planning-area-negative")).toHaveCount(1);
});

test("edits selected target planning fields from the sidebar", async ({ page }) => {
  await loadSamplePlanningMap(page);
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
  await expect(page.getByText("Selected item: favorite dinner block · Valencia & 20th")).toBeVisible();
  await expect(page.getByLabel("Target influence")).toHaveValue("negative");
  await expect(page.getByLabel("Target radius")).toHaveValue("15");
});

test("deselects a selected target without changing map data", async ({ page }) => {
  await loadSamplePlanningMap(page);
  await page.goto("/");

  await page.getByTitle("Mission favorite block · Valencia & 20th").click();
  await expect(page.getByLabel("Target purpose")).toHaveValue("Mission favorite block");

  await page.getByRole("button", { name: "Deselect item" }).click();

  await expect(page.getByText("Selected item: None")).toBeVisible();
  await expect(page.getByLabel("Target purpose")).toHaveCount(0);
  await expect(
    page.locator(".target-anchor-marker[title='Mission favorite block · Valencia & 20th']"),
  ).toBeVisible();

  await page.getByTitle("Mission favorite block · Valencia & 20th").click();
  await expect(page.getByLabel("Target purpose")).toHaveValue("Mission favorite block");
  await page.getByRole("heading", { name: "SF Apartment Hunt" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Selected item: None")).toBeVisible();
  await expect(page.getByLabel("Target purpose")).toHaveCount(0);
});

test("edits selected corridor metadata from the sidebar", async ({ page }) => {
  await loadSamplePlanningMap(page);
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

  await expect(page.getByText("Selected item: Polk Gulch spine")).toBeVisible();
  await expect(page.getByLabel("Corridor priority")).toHaveValue("high");
  await expect(page.getByLabel("Corridor tag transit")).toBeChecked();

  await page.reload();
  await clickPolkCorridor(page);
  await expect(page.getByLabel("Corridor notes")).toHaveValue("Prioritize this north-side run.");
});

test("target field edits are undoable and resettable", async ({ page }) => {
  await loadSamplePlanningMap(page);
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
  await page.getByRole("button", { name: "Reset selected item" }).click();
  await expect(page.getByText("Selected item: None")).toBeVisible();
  await expect(
    page.locator(".target-anchor-marker[title='Mission favorite block · Valencia & 20th']"),
  ).toHaveCount(0);
});

test("corridor field edits are undoable and resettable", async ({ page }) => {
  await loadSamplePlanningMap(page);
  await page.goto("/");

  await clickPolkCorridor(page);
  await page.getByLabel("Corridor name").fill("Polk Gulch spine");
  await page.getByLabel("Corridor name").blur();
  await expect(page.getByText("Selected item: Polk Gulch spine")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Selected item: Polk Street")).toBeVisible();

  await page.getByLabel("Corridor name").fill("Polk Gulch spine");
  await page.getByLabel("Corridor name").blur();
  await expect(page.getByLabel("Corridor name")).toHaveValue("Polk Gulch spine");
  await page.getByRole("button", { name: "Reset selected item" }).click();
  await expect(page.getByText("Selected item: None")).toBeVisible();
  await expect(page.getByLabel("Corridor name")).toHaveCount(0);
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
  await expect(page.getByText("Selected item: easy grocery run · Custom grocery")).toBeVisible();

  await page.getByRole("button", { name: "Reset selected item" }).click();

  await expect(page.getByText("Selected item: None")).toBeVisible();
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
  await expect(page.getByText("Selected item: Custom corridor")).toBeVisible();

  await page.getByRole("button", { name: "Reset selected item" }).click();

  await expect(page.getByText("Selected item: None")).toBeVisible();
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

  await loadSamplePlanningMap(page);
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

  await loadSamplePlanningMap(page);
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

  await expect(page.getByRole("heading", { name: "OpenAI key required" })).toBeVisible();
  await expect(
    page.locator("form").getByText("AI requests are disabled until you save an OpenAI key."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
});

test("OpenAI key form hides the extra add-key action while editing", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Add OpenAI key" }).click();

  await expect(page.getByLabel("OpenAI API key")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save key" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add OpenAI key" })).toHaveCount(0);
});

test("imports map json only after replace confirmation", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".target-anchor-marker")).toHaveCount(0);

  await page.getByLabel("Import map JSON file").setInputFiles({
    name: "sample-map.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(samplePlanningMapState)),
  });

  await expect(page.getByText("Ready to import sample-map.json.")).toBeVisible();
  await expect(
    page.getByText("Importing this file will replace the current map."),
  ).toBeVisible();
  await expect(page.locator(".target-anchor-marker")).toHaveCount(0);

  await page.getByRole("button", { name: "Replace current map" }).click();

  await expect(page.getByText("Imported sample-map.json.")).toBeVisible();
  await expect(page.locator(".target-anchor-marker")).toHaveCount(3);
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) {
          return [];
        }

        const mapState = JSON.parse(raw) as { targets?: Array<{ id: string }> };
        return mapState.targets?.map((target) => target.id) ?? [];
      }, mapStateStorageKey),
    )
    .toContain("valencia-20th");
});

test("planning chat adds reviewed pins through an action card", async ({ page }) => {
  await page.route("**/api/ai/planning-chat", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer sk-test");
    expect(route.request().headers()["x-sf-apt-installation-secret"]).toBeTruthy();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPlanningChatMapProposalResponse()),
    });
  });
  await page.route("**/api/planning/actions/execute", async (route) => {
    expect(route.request().headers()["x-sf-apt-installation-secret"]).toBeTruthy();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPlanningActionExecuteMapResponse()),
    });
  });

  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, value);
    window.sessionStorage.setItem(key, value);
  }, { key: openAiKeyStorageKey, value: "sk-test" });
  await page.goto("/");
  await page.getByLabel("Ask planning chat").fill("Add pins for all Solidcore locations in SF");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Add 1 map change").first()).toBeVisible();
  await page.getByRole("button", { name: "Apply selected" }).click();
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) {
          return [];
        }

        const mapState = JSON.parse(raw) as { targets?: Array<{ id: string }> };
        return mapState.targets?.map((target) => target.id) ?? [];
      }, mapStateStorageKey),
    )
    .toContain("solidcore-fidi");
});

test("planning chat applies only selected proposal operations", async ({ page }) => {
  let appliedOperationIndexes: number[] | null = null;

  await page.route("**/api/ai/planning-chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPlanningChatMultiOperationMapProposalResponse()),
    });
  });
  await page.route("**/api/planning/actions/execute", async (route) => {
    const body = route.request().postDataJSON() as {
      payload?: { operationIndexes?: number[] };
    };
    appliedOperationIndexes = body.payload?.operationIndexes ?? null;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPlanningActionExecuteMultiOperationMapResponse()),
    });
  });

  await page.goto("/");
  await saveOpenAiKeyThroughUi(page);
  await page.getByLabel("Ask planning chat").fill("Add two planning notes");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByRole("checkbox", { name: "Include Add note to NOPA" })).toBeChecked();
  await page.getByRole("checkbox", { name: "Include Add note to NOPA" }).uncheck();
  await page.getByRole("button", { name: "Apply selected" }).click();

  expect(appliedOperationIndexes).toEqual([0]);
});

test("planning chat disables proposal apply when no operations are selected", async ({ page }) => {
  await page.route("**/api/ai/planning-chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPlanningChatMultiOperationMapProposalResponse()),
    });
  });

  await page.goto("/");
  await saveOpenAiKeyThroughUi(page);
  await page.getByLabel("Ask planning chat").fill("Add two planning notes");
  await page.getByRole("button", { name: "Send" }).click();

  await page.getByRole("checkbox", { name: "Include Add note to Lower Pac Heights" }).uncheck();
  await page.getByRole("checkbox", { name: "Include Add note to NOPA" }).uncheck();

  await expect(page.getByRole("button", { name: "Apply selected" })).toBeDisabled();
});

test("planning chat renders listing cards without persisting the listing ledger first", async ({ page }) => {
  let geocodeRequestSeen = false;

  await page.route("**/api/ai/planning-chat", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer sk-test");
    expect(route.request().headers()["x-sf-apt-installation-secret"]).toBeTruthy();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPlanningChatListingResponse()),
    });
  });
  await page.route("**/api/planning/actions/execute", async (route) => {
    expect(route.request().headers()["x-sf-apt-installation-secret"]).toBeTruthy();
    const body = route.request().postDataJSON() as {
      payload?: Record<string, unknown>;
    };

    expect(body.payload).toMatchObject({
      kind: "listingSave",
      expectedListingLedgerRevision: "ledger-rev-1",
      expectedListingSnapshotHash: "listing-snapshot-hash-1",
    });
    expect(body.payload && "canonicalUrl" in body.payload).toBe(false);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
        body: JSON.stringify(createPlanningActionExecuteListingResponse()),
      });
  });
  await page.route("**/api/geocode/listing", async (route) => {
    geocodeRequestSeen = true;
    expect(route.request().headers()["x-sf-apt-session"]).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({
      nonce: "nonce-1",
      candidateId: "candidate-1",
      geocodeQuery: "1234 Fillmore St, San Francisco, CA",
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
          formattedAddress: "1234 Fillmore St, San Francisco, CA 94115, USA",
        },
      }),
    });
  });

  await page.addInitScript(({ key, value }) => {
    window.sessionStorage.setItem(key, value);
  }, { key: openAiKeyStorageKey, value: "sk-test" });
  await page.goto("/");
  await page.getByLabel("Ask planning chat").fill("Find studio listings near Fillmore");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByRole("link", { name: "Studio near Fillmore" })).toBeVisible();
  await expect(page.getByText("One listing matched.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" }).first()).toBeVisible();
  await expect(page.getByText("0 listings staged.")).toBeVisible();
  await expect
    .poll(() => page.evaluate((key) => window.localStorage.getItem(key), listingLedgerStorageKey))
    .toBeNull();

  await page.getByRole("button", { name: "Save" }).first().click();

  await expect(page.getByText("1 listings staged.")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) {
          return null;
        }

        const ledger = JSON.parse(raw) as {
          "https://example.com/listings/1"?: {
            candidate?: { coordinates?: [number, number] | null; markerPrecision?: string };
          };
        };

        return ledger["https://example.com/listings/1"]?.candidate ?? null;
      }, listingLedgerStorageKey),
    )
    .toMatchObject({
      coordinates: [-122.433, 37.789],
      markerPrecision: "exact",
    });
  expect(geocodeRequestSeen).toBe(true);
});

test("task-based onboarding completes local workflow milestones", async ({ page }) => {
  await page.route("**/api/ai/planning-chat", async (route) => {
    const body = route.request().postDataJSON() as { message: string };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        body.message.includes("listing")
          ? createPlanningChatListingResponse()
          : createPlanningChatMapProposalResponse(),
      ),
    });
  });
  await page.route("**/api/planning/actions/execute", async (route) => {
    const body = route.request().postDataJSON() as {
      payload?: { kind?: string };
    };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        body.payload?.kind === "listingSave"
          ? createPlanningActionExecuteListingResponse()
          : createPlanningActionExecuteMapResponse(),
      ),
    });
  });
  await page.route("**/api/geocode/listing", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        geocode: {
          status: "ok",
          coordinates: [-122.433, 37.789],
          markerPrecision: "exact",
          formattedAddress: "1234 Fillmore St, San Francisco, CA 94115, USA",
        },
      }),
    });
  });

  await page.goto("/");
  await saveOpenAiKeyThroughUi(page);
  await expect(page.getByText("Complete: Add your OpenAI key")).toBeVisible();

  await page.getByLabel("Ask planning chat").fill("Add pins for all Solidcore locations in SF");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Complete: Ask chat to add pins or corridors")).toBeVisible();

  await page.getByRole("button", { name: "Apply selected" }).click();
  await expect(page.getByText("Complete: Review a suggested map change")).toBeVisible();

  await page.locator(".target-anchor-marker").first().click();
  await page.getByLabel("Target purpose").fill("Favorite workout anchor");
  await page.getByLabel("Target purpose").blur();
  await expect(page.getByText("Complete: Give an anchor planning meaning")).toBeVisible();

  await page.getByLabel("Ask planning chat").fill("Find listing near my pins");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Complete: Ask for listings near your priorities")).toBeVisible();

  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Getting started complete")).toBeVisible();
});

test("onboarding show me opens a highlight without completing the step", async ({ page }) => {
  await page.goto("/");

  await page
    .locator("li", { hasText: "Ask chat to add pins or corridors" })
    .getByRole("button", { name: "Show me" })
    .click();

  await expect(page.locator(".driver-popover")).toBeVisible();
  await expect(page.getByText(/Complete: Ask chat to add pins or corridors/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".driver-popover")).toHaveCount(0);
});

test("reset local map clears planning chat cache and warns when server reset fails", async ({ page }) => {
  await page.route("**/api/planning/reset", async (route) => {
    expect(route.request().headers()["x-sf-apt-installation-secret"]).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({ clientInstallationId: "install-1" });

    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "Server reset failed." }),
    });
  });

  await page.addInitScript(
    ({ cacheKey, installationKey, ledgerKey, mapKey, threadCache, installation, listingLedger, mapState, value }) => {
      window.sessionStorage.setItem(value.key, value.apiKey);
      window.localStorage.setItem(cacheKey, JSON.stringify(threadCache));
      window.localStorage.setItem(installationKey, JSON.stringify(installation));
      window.localStorage.setItem(ledgerKey, JSON.stringify(listingLedger));
      window.localStorage.setItem(mapKey, JSON.stringify(mapState));
    },
    {
      cacheKey: planningThreadCacheStorageKey,
      installationKey: planningInstallationStorageKey,
      ledgerKey: listingLedgerStorageKey,
      mapKey: mapStateStorageKey,
      threadCache: createPlanningThreadCache(),
      installation: {
        clientInstallationId: "install-1",
        clientInstallationSecret: "secret-1",
      },
      listingLedger: {
        "https://example.com/listings/1": createPlanningActionExecuteListingResponse().listingLead,
      },
      mapState: samplePlanningMapState,
      value: { key: openAiKeyStorageKey, apiKey: "sk-test" },
    },
  );

  await page.goto("/");

  await expect(page.getByText("I found 1 listing candidate.")).toBeVisible();
  await expect
    .poll(() => page.evaluate((key) => window.localStorage.getItem(key), planningThreadCacheStorageKey))
    .not.toBeNull();
  await expect
    .poll(() => page.evaluate((key) => window.localStorage.getItem(key), listingLedgerStorageKey))
    .not.toBeNull();

  await page.getByRole("button", { name: "Reset local map" }).click();

  await expect(page.getByText("Server planning history could not be cleared.")).toBeVisible();
  await expect(page.getByText("No planning chat messages yet.")).toBeVisible();
  await expect(page.getByText("0 listings staged.")).toBeVisible();
  await expect(
    page.locator(".target-anchor-marker[title='Mission favorite block · Valencia & 20th']"),
  ).toHaveCount(0);
  await expect
    .poll(() => page.evaluate((key) => window.localStorage.getItem(key), planningThreadCacheStorageKey))
    .toBeNull();
  await expect
    .poll(() => page.evaluate((key) => window.localStorage.getItem(key), listingLedgerStorageKey))
    .toBeNull();
});

test("reset local map ignores an in-flight planning chat response", async ({ page }) => {
  let releasePlanningChatResponse: () => void = () => {};
  const planningChatResponseReleased = new Promise<void>((resolve) => {
    releasePlanningChatResponse = resolve;
  });
  let markPlanningChatRequestStarted: () => void = () => {};
  const planningChatRequestStarted = new Promise<void>((resolve) => {
    markPlanningChatRequestStarted = resolve;
  });

  await page.route("**/api/ai/planning-chat", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer sk-test");
    expect(route.request().headers()["x-sf-apt-installation-secret"]).toBeTruthy();
    markPlanningChatRequestStarted();
    await planningChatResponseReleased;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPlanningChatMapProposalResponse()),
    });
  });
  await page.route("**/api/planning/reset", async (route) => {
    expect(route.request().headers()["x-sf-apt-installation-secret"]).toBeTruthy();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, value);
    window.sessionStorage.setItem(key, value);
  }, { key: openAiKeyStorageKey, value: "sk-test" });
  await page.goto("/");
  await page.getByLabel("Ask planning chat").fill("Add pins for all Solidcore locations in SF");
  await page.getByRole("button", { name: "Send" }).click();

  try {
    await planningChatRequestStarted;
    await expect(page.getByRole("button", { name: "Sending..." })).toBeVisible();
    await page.getByRole("button", { name: "Reset local map" }).click();

    await expect(page.getByText("No planning chat messages yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();

    releasePlanningChatResponse();
    await expect(page.getByText("Add 1 map change").first()).toHaveCount(0);
    await expect(page.getByText("No planning chat messages yet.")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate((key) => window.localStorage.getItem(key), planningThreadCacheStorageKey),
      )
      .toBeNull();
  } finally {
    releasePlanningChatResponse();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

test("planning chat clears stale local thread cache when server memory is lost", async ({ page }) => {
  let requestCount = 0;

  await page.route("**/api/ai/planning-chat", async (route) => {
    requestCount += 1;
    const body = route.request().postDataJSON() as { threadId: string | null };

    if (requestCount === 1) {
      expect(body.threadId).toBe("thread-1");
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: "Planning thread is not owned by this installation.",
        }),
      });
      return;
    }

    expect(body.threadId).toBeNull();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPlanningChatMapProposalResponse()),
    });
  });

  await page.addInitScript(
    ({ cacheKey, installationKey, threadCache, installation, value }) => {
      window.sessionStorage.setItem(value.key, value.apiKey);
      window.localStorage.setItem(cacheKey, JSON.stringify(threadCache));
      window.localStorage.setItem(installationKey, JSON.stringify(installation));
    },
    {
      cacheKey: planningThreadCacheStorageKey,
      installationKey: planningInstallationStorageKey,
      threadCache: createPlanningThreadCache(),
      installation: {
        clientInstallationId: "install-1",
        clientInstallationSecret: "secret-1",
      },
      value: { key: openAiKeyStorageKey, apiKey: "sk-test" },
    },
  );

  await page.goto("/");
  await expect(page.getByText("I found 1 listing candidate.")).toBeVisible();

  await page.getByLabel("Ask planning chat").fill("Add pins for all CorePower locations in SF");
  await page.getByRole("button", { name: "Send" }).click();

  await expect.poll(() => requestCount).toBe(2);
  await expect(page.getByText("Planning thread is not owned by this installation.")).toHaveCount(0);
  await expect(page.getByText("Planning proposal ready for review.")).toBeVisible();
  await expect(page.getByText("Add 1 map change").first()).toBeVisible();
});

test("planning chat clears stale action cards when server action memory is lost", async ({ page }) => {
  await page.route("**/api/planning/actions/execute", async (route) => {
    expect(route.request().headers()["x-sf-apt-installation-secret"]).toBeTruthy();
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: "Planning action is not owned by this installation.",
      }),
    });
  });

  const staleResponse = createPlanningChatMapProposalResponse();
  await page.addInitScript(
    ({ cacheKey, installationKey, threadCache, installation, value }) => {
      window.sessionStorage.setItem(value.key, value.apiKey);
      window.localStorage.setItem(cacheKey, JSON.stringify(threadCache));
      window.localStorage.setItem(installationKey, JSON.stringify(installation));
    },
    {
      cacheKey: planningThreadCacheStorageKey,
      installationKey: planningInstallationStorageKey,
      threadCache: {
        thread: staleResponse.thread,
        messages: [staleResponse.userMessage, staleResponse.assistantMessage],
        actionRecords: staleResponse.actionRecords,
        contextSummary: staleResponse.contextSummary,
        contextSummariesByMessageId: {
          [staleResponse.assistantMessage.id]: staleResponse.contextSummary,
        },
        mapSnapshot: staleResponse.mapSnapshot,
        listingLedgerRevision: staleResponse.listingLedgerRevision,
      },
      installation: {
        clientInstallationId: "install-1",
        clientInstallationSecret: "secret-1",
      },
      value: { key: openAiKeyStorageKey, apiKey: "sk-test" },
    },
  );

  await page.goto("/");
  await expect(page.getByText("Add 1 map change").first()).toBeVisible();

  await page.getByRole("button", { name: "Apply selected" }).click();

  await expect(page.getByText("No planning chat messages yet.")).toBeVisible();
  await expect(
    page.getByText("That planning action expired. I cleared the stale chat; send the request again."),
  ).toBeVisible();
  await expect(page.getByText("Planning action is not owned by this installation.")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate((key) => window.localStorage.getItem(key), planningThreadCacheStorageKey))
    .toBeNull();
});

test("planning chat shows follow-up questions without rendering action cards", async ({ page }) => {
  await page.route("**/api/ai/planning-chat", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer sk-test");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPlanningChatFollowUpResponse()),
    });
  });

  await page.addInitScript(({ key, value }) => {
    window.sessionStorage.setItem(key, value);
  }, { key: openAiKeyStorageKey, value: "sk-test" });
  await page.goto("/");
  await page.getByLabel("Ask planning chat").fill("Add pins for nearby gyms");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Which neighborhoods should I prioritize for the gym search?")).toBeVisible();
  await expect(page.getByText("where to search")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply selected" })).toHaveCount(0);
});

test("planning chat persists dismissed listing cards across refresh", async ({ page }) => {
  await page.route("**/api/ai/planning-chat", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer sk-test");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPlanningChatListingResponse()),
    });
  });
  await page.route("**/api/planning/actions/execute", async (route) => {
    expect(route.request().headers()["x-sf-apt-installation-secret"]).toBeTruthy();
    const body = route.request().postDataJSON() as {
      payload?: Record<string, unknown>;
    };

    expect(body.payload).toMatchObject({
      kind: "listingDismiss",
      expectedListingLedgerRevision: "ledger-rev-1",
      expectedListingSnapshotHash: "listing-snapshot-hash-1",
    });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPlanningActionExecuteListingDismissResponse()),
    });
  });

  await page.addInitScript(({ key, value }) => {
    window.sessionStorage.setItem(key, value);
  }, { key: openAiKeyStorageKey, value: "sk-test" });
  await page.goto("/");
  await page.getByLabel("Ask planning chat").fill("Find studio listings near Fillmore");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Apartment planning")).toBeVisible();
  const listingCard = page
    .locator("[data-onboarding-target='listing-card']")
    .filter({ has: page.getByRole("link", { name: "Studio near Fillmore" }) });
  await expect(listingCard).toBeVisible();
  await listingCard.getByRole("button", { name: "Dismiss" }).click();

  await expect(page.getByText("Dismissed")).toBeVisible();
  await expect(listingCard.getByRole("button", { name: "Dismiss" })).toBeDisabled();

  await page.reload();

  await expect(page.getByText("Apartment planning")).toBeVisible();
  await expect(page.getByText("I found 1 listing candidate.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Studio near Fillmore" })).toBeVisible();
  await expect(page.getByText("Dismissed")).toBeVisible();
});

test("undoes planning chat map actions with Ctrl+Z or Cmd+Z", async ({ page }) => {
  await page.route("**/api/ai/planning-chat", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer sk-test");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPlanningChatCorridorPriorityResponse()),
    });
  });
  await page.route("**/api/planning/actions/execute", async (route) => {
    expect(route.request().headers()["x-sf-apt-installation-secret"]).toBeTruthy();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPlanningActionExecuteCorridorPriorityResponse()),
    });
  });

  await loadSamplePlanningMap(page);
  await page.addInitScript(({ key, value }) => {
    window.sessionStorage.setItem(key, value);
  }, { key: openAiKeyStorageKey, value: "sk-test" });
  await page.goto("/");

  await applyPolkPriorityProposal(page);
  await clickPolkCorridor(page);
  await expect(page.getByLabel("Corridor priority")).toHaveValue("high");

  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.getByRole("button", { name: "Copy map JSON" }).focus();
  await page.keyboard.press("Control+Z");
  await expect(page.getByLabel("Corridor priority")).toHaveValue("medium");

  await applyPolkPriorityProposal(page);
  await clickPolkCorridor(page);
  await expect(page.getByLabel("Corridor priority")).toHaveValue("high");

  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.getByRole("button", { name: "Copy map JSON" }).focus();
  await page.keyboard.press("Meta+Z");
  await expect(page.getByLabel("Corridor priority")).toHaveValue("medium");
});

async function applyPolkPriorityProposal(page: Page) {
  await page.getByLabel("Ask planning chat").fill("Make Polk corridor high priority");
  await page.getByRole("button", { name: "Send" }).click();
  const proposalCards = page.getByText("Raise Polk priority.");
  const proposalCount = await proposalCards.count();
  await expect(proposalCards.nth(proposalCount - 1)).toBeVisible();
  const applyButtons = page.getByRole("button", { name: "Apply selected" });
  const applyButtonCount = await applyButtons.count();
  await applyButtons.nth(applyButtonCount - 1).click();
}

async function loadSamplePlanningMap(page: Page) {
  await page.addInitScript(
    ({ key, state }) => {
      if (!window.localStorage.getItem(key)) {
        window.localStorage.setItem(key, JSON.stringify(state));
      }
    },
    { key: mapStateStorageKey, state: samplePlanningMapState },
  );
}

async function saveOpenAiKeyThroughUi(page: Page) {
  await page.getByRole("button", { name: "Add OpenAI key" }).click();
  await page.getByLabel("OpenAI API key").fill("sk-test");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("heading", { name: "OpenAI key saved" })).toBeVisible();
}

type Box = { x: number; y: number; width: number; height: number };

function boxesOverlap(first: Box, second: Box) {
  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  );
}

async function clickPolkCorridor(page: Page) {
  await clickCorridor(page, ".target-corridor-polk");
}

async function clickCustomCorridor(page: Page) {
  await clickCorridor(page, ".target-corridor-custom-corridor");
}

async function clickCorridor(page: Page, selector: string) {
  const corridor = page.locator(selector);
  await expect(corridor).toHaveCount(1);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await corridor.click({ force: true });
    if (await isCorridorEditorVisible(page)) {
      return;
    }

    await corridor.dispatchEvent("click");
    if (await isCorridorEditorVisible(page)) {
      return;
    }
  }

  await expect(page.getByLabel("Corridor name")).toBeVisible();
}

async function isCorridorEditorVisible(page: Page) {
  try {
    await expect(page.getByLabel("Corridor name")).toBeVisible({ timeout: 1_000 });
    return true;
  } catch {
    return false;
  }
}

function createPlanningChatMapProposalResponse() {
  return {
    thread: {
      id: "thread-1",
      clientInstallationId: "install-1",
      createdAt: "2026-06-18T12:00:00.000Z",
      updatedAt: "2026-06-18T12:00:00.000Z",
      title: "Solidcore planning",
      summary: "Reviewed fitness pins",
    },
    userMessage: {
      id: "message-user-1",
      threadId: "thread-1",
      role: "user",
      parts: [{ type: "text", text: "Add pins for all Solidcore locations in SF" }],
      createdAt: "2026-06-18T12:00:00.000Z",
    },
    assistantMessage: {
      id: "message-assistant-1",
      threadId: "thread-1",
      role: "assistant",
      parts: [
        { type: "text", text: "I found one reviewed map change." },
        {
          type: "mapProposal",
          actionId: "action-map-1",
          proposal: {
            summary: "Add 1 map change",
            confidence: "high",
            requiresUserReview: true,
            operations: [
              {
                type: "addTarget",
                target: {
                  id: "solidcore-fidi",
                  name: "Solidcore",
                  purpose: "fitness class",
                  coordinates: [-122.4006, 37.7936],
                  priority: "medium",
                  influence: "positive",
                  radiusMinutes: 10,
                  notes: [],
                },
              },
            ],
          },
          researchSummary: null,
        },
      ],
      createdAt: "2026-06-18T12:00:01.000Z",
    },
    contextSummary: {
      budget: null,
      beds: null,
      timing: null,
      furnished: null,
      shortTerm: null,
      positiveAnchors: [],
      avoidAnchors: [],
      selectedZones: [],
      sourceStrictness: null,
    },
    actionRecords: [
      {
        id: "action-map-1",
        threadId: "thread-1",
        messageId: "message-assistant-1",
        partIndex: 1,
        kind: "mapProposal",
        target: {
          kind: "mapProposal",
          messageId: "message-assistant-1",
          partIndex: 1,
          proposalHash: "proposal-hash-1",
          allowedOperationIndexes: [0],
          mapRevision: "map-rev-1",
        },
        status: "pending",
        createdAt: "2026-06-18T12:00:01.000Z",
        updatedAt: "2026-06-18T12:00:01.000Z",
      },
    ],
    mapSnapshot: {
      id: "snapshot-1",
      threadId: "thread-1",
      clientInstallationId: "install-1",
      mapState: seedMapState,
      revision: "map-rev-1",
      createdAt: "2026-06-18T12:00:00.000Z",
      updatedAt: "2026-06-18T12:00:00.000Z",
    },
    listingLedgerRevision: "ledger-rev-1",
  };
}

function createPlanningChatMultiOperationMapProposalResponse() {
  const response = createPlanningChatMapProposalResponse();
  const proposalPart = response.assistantMessage.parts[1];

  if (proposalPart.type !== "mapProposal") {
    throw new Error("Expected map proposal fixture.");
  }

  return {
    ...response,
    thread: {
      ...response.thread,
      id: "thread-multi-1",
      title: "Multi-operation planning",
    },
    userMessage: {
      ...response.userMessage,
      id: "message-user-multi-1",
      threadId: "thread-multi-1",
      parts: [{ type: "text", text: "Add two planning notes" }],
    },
    assistantMessage: {
      ...response.assistantMessage,
      id: "message-assistant-multi-1",
      threadId: "thread-multi-1",
      parts: [
        { type: "text", text: "I found two reviewed map changes." },
        {
          ...proposalPart,
          actionId: "action-map-multi-1",
          proposal: {
            ...proposalPart.proposal,
            summary: "Add two planning notes",
            operations: [
              {
                type: "addNote",
                entityId: "lower-pac-heights",
                note: "Lower Pac Heights has strong walkability context.",
              },
              {
                type: "addNote",
                entityId: "nopa",
                note: "NOPA should be reviewed for commute tradeoffs.",
              },
            ],
          },
        },
      ],
    },
    actionRecords: [
      {
        ...response.actionRecords[0],
        id: "action-map-multi-1",
        threadId: "thread-multi-1",
        messageId: "message-assistant-multi-1",
        target: {
          kind: "mapProposal",
          messageId: "message-assistant-multi-1",
          partIndex: 1,
          proposalHash: "proposal-hash-multi-1",
          allowedOperationIndexes: [0, 1],
          mapRevision: "map-rev-1",
        },
      },
    ],
    mapSnapshot: {
      ...response.mapSnapshot,
      threadId: "thread-multi-1",
    },
  };
}

function createPlanningActionExecuteMapResponse() {
  const nextMapState = {
    ...seedMapState,
    targets: [
      ...seedMapState.targets,
      {
        id: "solidcore-fidi",
        name: "Solidcore",
        purpose: "fitness class",
        coordinates: [-122.4006, 37.7936] as [number, number],
        priority: "medium" as const,
        influence: "positive" as const,
        radiusMinutes: 10 as const,
        notes: [],
      },
    ],
  };

  return {
    ok: true,
    action: {
      id: "action-map-1",
      threadId: "thread-1",
      messageId: "message-assistant-1",
      partIndex: 1,
      kind: "mapProposal",
      target: {
        kind: "mapProposal",
        messageId: "message-assistant-1",
        partIndex: 1,
        proposalHash: "proposal-hash-1",
        allowedOperationIndexes: [0],
        mapRevision: "map-rev-1",
      },
      status: "applied",
      createdAt: "2026-06-18T12:00:01.000Z",
      updatedAt: "2026-06-18T12:00:02.000Z",
    },
    execution: {
      id: "exec-1",
      actionId: "action-map-1",
      idempotencyKey: "idem-1",
      payloadHash: "payload-hash-1",
      status: "succeeded",
      createdAt: "2026-06-18T12:00:02.000Z",
    },
    mapSnapshot: {
      id: "snapshot-2",
      threadId: "thread-1",
      clientInstallationId: "install-1",
      revision: "map-rev-2",
      createdAt: "2026-06-18T12:00:00.000Z",
      updatedAt: "2026-06-18T12:00:02.000Z",
      mapState: nextMapState,
    },
    mapState: nextMapState,
  };
}

function createPlanningActionExecuteMultiOperationMapResponse() {
  const response = createPlanningActionExecuteMapResponse();

  return {
    ...response,
    action: {
      ...response.action,
      id: "action-map-multi-1",
      threadId: "thread-multi-1",
      messageId: "message-assistant-multi-1",
      target: {
        kind: "mapProposal",
        messageId: "message-assistant-multi-1",
        partIndex: 1,
        proposalHash: "proposal-hash-multi-1",
        allowedOperationIndexes: [0, 1],
        mapRevision: "map-rev-1",
      },
    },
    execution: {
      ...response.execution,
      actionId: "action-map-multi-1",
    },
    mapSnapshot: {
      ...response.mapSnapshot,
      threadId: "thread-multi-1",
    },
  };
}

function createPlanningActionExecuteListingResponse() {
  const listingCandidate = {
    id: "candidate-1",
    title: "Studio near Fillmore",
    url: "https://example.com/listings/1",
    sourceDomain: "example.com",
    neighborhoodGuess: "Lower Pac Heights",
    locationText: "1234 Fillmore St",
    geocodeQuery: "1234 Fillmore St, San Francisco, CA",
    locationConfidence: "medium",
    coordinates: null,
    geocodeStatus: "not_attempted",
    markerPrecision: "none",
    priceMonthly: 2800,
    beds: "studio",
    shortTermSignal: false,
    furnishedSignal: false,
    fitScore: 5,
    whyItFits: "Close to Fillmore and under budget.",
    citations: [
      {
        url: "https://example.com/listings/1",
        title: "Studio near Fillmore",
        sourceDomain: "example.com",
      },
    ],
    caveats: [],
  };

  return {
    ok: true,
    action: {
      id: "listing-save-1",
      threadId: "thread-1",
      messageId: "message-assistant-1",
      partIndex: 1,
      kind: "listingSave",
      target: {
        kind: "listingLead",
        resultSetId: "result-set-1",
        canonicalUrl: listingCandidate.url,
        listingSnapshotHash: "listing-snapshot-hash-1",
        listingLedgerRevision: "ledger-rev-1",
      },
      status: "applied",
      createdAt: "2026-06-18T12:00:01.000Z",
      updatedAt: "2026-06-18T12:00:02.000Z",
    },
    execution: {
      id: "exec-2",
      actionId: "listing-save-1",
      idempotencyKey: "idem-2",
      payloadHash: "payload-hash-2",
      status: "succeeded",
      createdAt: "2026-06-18T12:00:02.000Z",
    },
    listingLead: {
      canonicalUrl: listingCandidate.url,
      firstSeenAt: "2026-06-18T12:00:01.000Z",
      lastSeenAt: "2026-06-18T12:00:02.000Z",
      lastSearchQuery: "Find studio listings near Fillmore",
      seenCount: 1,
      status: "saved",
      candidate: listingCandidate,
    },
    listingLedgerRevision: "ledger-rev-2",
  };
}

function createPlanningActionExecuteListingDismissResponse() {
  const response = createPlanningActionExecuteListingResponse();

  return {
    ...response,
    action: {
      ...response.action,
      id: "listing-dismiss-1",
      kind: "listingDismiss",
    },
    execution: {
      ...response.execution,
      id: "exec-3",
      actionId: "listing-dismiss-1",
      idempotencyKey: "idem-3",
      payloadHash: "payload-hash-3",
    },
    listingLead: {
      ...response.listingLead,
      status: "dismissed",
    },
  };
}

function createPlanningThreadCache() {
  const response = createPlanningChatListingResponse();

  return {
    thread: response.thread,
    messages: [response.userMessage, response.assistantMessage],
    actionRecords: response.actionRecords,
    contextSummary: response.contextSummary,
    contextSummariesByMessageId: {
      [response.assistantMessage.id]: response.contextSummary,
    },
    mapSnapshot: response.mapSnapshot,
    listingLedgerRevision: response.listingLedgerRevision,
  };
}

function createPlanningChatFollowUpResponse() {
  return {
    thread: {
      id: "thread-follow-up-1",
      clientInstallationId: "install-1",
      createdAt: "2026-06-18T12:00:00.000Z",
      updatedAt: "2026-06-18T12:00:01.000Z",
      title: "Gym planning",
      summary: "",
    },
    userMessage: {
      id: "message-user-follow-up-1",
      threadId: "thread-follow-up-1",
      role: "user",
      parts: [{ type: "text", text: "Add pins for nearby gyms" }],
      createdAt: "2026-06-18T12:00:00.000Z",
    },
    assistantMessage: {
      id: "message-assistant-follow-up-1",
      threadId: "thread-follow-up-1",
      role: "assistant",
      parts: [
        { type: "text", text: "I need one detail before I can search." },
        {
          type: "followUpQuestion",
          question: "Which neighborhoods should I prioritize for the gym search?",
          missingInformation: ["where to search"],
        },
      ],
      createdAt: "2026-06-18T12:00:01.000Z",
    },
    contextSummary: {
      budget: null,
      beds: null,
      timing: null,
      furnished: null,
      shortTerm: null,
      positiveAnchors: [],
      avoidAnchors: [],
      selectedZones: [],
      sourceStrictness: null,
    },
    actionRecords: [],
    mapSnapshot: {
      id: "snapshot-follow-up-1",
      threadId: "thread-follow-up-1",
      clientInstallationId: "install-1",
      mapState: seedMapState,
      revision: "map-rev-follow-up-1",
      createdAt: "2026-06-18T12:00:00.000Z",
      updatedAt: "2026-06-18T12:00:00.000Z",
    },
    listingLedgerRevision: "ledger-rev-1",
  };
}

function createPlanningChatCorridorPriorityResponse() {
  return {
    thread: {
      id: "thread-corridor-1",
      clientInstallationId: "install-1",
      createdAt: "2026-06-18T12:00:00.000Z",
      updatedAt: "2026-06-18T12:00:01.000Z",
      title: "Corridor planning",
      summary: "",
    },
    userMessage: {
      id: "message-user-corridor-1",
      threadId: "thread-corridor-1",
      role: "user",
      parts: [{ type: "text", text: "Make Polk corridor high priority" }],
      createdAt: "2026-06-18T12:00:00.000Z",
    },
    assistantMessage: {
      id: "message-assistant-corridor-1",
      threadId: "thread-corridor-1",
      role: "assistant",
      parts: [
        { type: "text", text: "I found one reviewed corridor change." },
        {
          type: "mapProposal",
          actionId: "action-corridor-priority-1",
          proposal: {
            summary: "Raise Polk priority.",
            confidence: "high",
            requiresUserReview: true,
            operations: [
              {
                type: "updateCorridorPriority",
                corridorId: "polk",
                priority: "high",
                reason: "Closer to the requested north-side search area.",
              },
            ],
          },
          researchSummary: null,
        },
      ],
      createdAt: "2026-06-18T12:00:01.000Z",
    },
    contextSummary: {
      budget: null,
      beds: null,
      timing: null,
      furnished: null,
      shortTerm: null,
      positiveAnchors: [],
      avoidAnchors: [],
      selectedZones: [],
      sourceStrictness: null,
    },
    actionRecords: [
      {
        id: "action-corridor-priority-1",
        threadId: "thread-corridor-1",
        messageId: "message-assistant-corridor-1",
        partIndex: 1,
        kind: "mapProposal",
        target: {
          kind: "mapProposal",
          messageId: "message-assistant-corridor-1",
          partIndex: 1,
          proposalHash: "proposal-corridor-priority-1",
          allowedOperationIndexes: [0],
          mapRevision: "map-rev-1",
        },
        status: "pending",
        createdAt: "2026-06-18T12:00:01.000Z",
        updatedAt: "2026-06-18T12:00:01.000Z",
      },
    ],
    mapSnapshot: {
      id: "snapshot-corridor-1",
      threadId: "thread-corridor-1",
      clientInstallationId: "install-1",
      mapState: samplePlanningMapState,
      revision: "map-rev-1",
      createdAt: "2026-06-18T12:00:00.000Z",
      updatedAt: "2026-06-18T12:00:00.000Z",
    },
    listingLedgerRevision: "ledger-rev-1",
  };
}

function createPlanningChatListingResponse() {
  const listingCandidate = {
    id: "candidate-1",
    title: "Studio near Fillmore",
    url: "https://example.com/listings/1",
    sourceDomain: "example.com",
    neighborhoodGuess: "Lower Pac Heights",
    locationText: "1234 Fillmore St",
    geocodeQuery: "1234 Fillmore St, San Francisco, CA",
    locationConfidence: "medium",
    coordinates: null,
    geocodeStatus: "not_attempted",
    markerPrecision: "none",
    priceMonthly: 2800,
    beds: "studio",
    shortTermSignal: false,
    furnishedSignal: false,
    fitScore: 5,
    whyItFits: "Close to Fillmore and under budget.",
    citations: [
      {
        url: "https://example.com/listings/1",
        title: "Studio near Fillmore",
        sourceDomain: "example.com",
      },
    ],
    caveats: [],
  };

  return {
    thread: {
      id: "thread-1",
      clientInstallationId: "install-1",
      createdAt: "2026-06-18T12:00:00.000Z",
      updatedAt: "2026-06-18T12:00:01.000Z",
      title: "Apartment planning",
      summary: "",
    },
    userMessage: {
      id: "message-user-1",
      threadId: "thread-1",
      role: "user",
      parts: [{ type: "text", text: "Find studio listings near Fillmore" }],
      createdAt: "2026-06-18T12:00:01.000Z",
    },
    assistantMessage: {
      id: "message-assistant-1",
      threadId: "thread-1",
      role: "assistant",
      parts: [
        { type: "text", text: "I found 1 listing candidate." },
        {
          type: "listingResults",
          resultSetId: "result-set-1",
          sourceSummary: "One listing matched.",
          caveats: ["Inventory changes quickly."],
          geocodeAuthorization: {
            nonce: "nonce-1",
            expiresAt: "2026-06-19T12:10:00.000Z",
            maxAttempts: 1,
            allowedQueries: [{ candidateId: listingCandidate.id, geocodeQueryHash: "hash-1" }],
          },
          listings: [
            {
              lead: {
                canonicalUrl: listingCandidate.url,
                firstSeenAt: "2026-06-18T12:00:01.000Z",
                lastSeenAt: "2026-06-18T12:00:01.000Z",
                lastSearchQuery: "Find studio listings near Fillmore",
                seenCount: 1,
                status: "seen",
                candidate: listingCandidate,
              },
              display: {
                ...listingCandidate,
                canonicalUrl: listingCandidate.url,
                firstSeenAt: "2026-06-18T12:00:01.000Z",
                lastSeenAt: "2026-06-18T12:00:01.000Z",
                seenCount: 1,
                planningScore: 5,
                leadStatus: "seen",
                planningSignals: ["Near Fillmore"],
              },
              saveActionId: "listing-save-1",
              dismissActionId: "listing-dismiss-1",
            },
          ],
        },
      ],
      createdAt: "2026-06-18T12:00:01.000Z",
    },
    contextSummary: {
      budget: null,
      beds: null,
      timing: null,
      furnished: null,
      shortTerm: null,
      positiveAnchors: [],
      avoidAnchors: [],
      selectedZones: [],
      sourceStrictness: null,
    },
    actionRecords: [
      {
        id: "listing-save-1",
        threadId: "thread-1",
        messageId: "message-assistant-1",
        partIndex: 1,
        kind: "listingSave",
        target: {
          kind: "listingLead",
          resultSetId: "result-set-1",
          canonicalUrl: listingCandidate.url,
          listingSnapshotHash: "listing-snapshot-hash-1",
          listingLedgerRevision: "ledger-rev-1",
        },
        status: "pending",
        createdAt: "2026-06-18T12:00:01.000Z",
        updatedAt: "2026-06-18T12:00:01.000Z",
      },
      {
        id: "listing-dismiss-1",
        threadId: "thread-1",
        messageId: "message-assistant-1",
        partIndex: 1,
        kind: "listingDismiss",
        target: {
          kind: "listingLead",
          resultSetId: "result-set-1",
          canonicalUrl: listingCandidate.url,
          listingSnapshotHash: "listing-snapshot-hash-1",
          listingLedgerRevision: "ledger-rev-1",
        },
        status: "pending",
        createdAt: "2026-06-18T12:00:01.000Z",
        updatedAt: "2026-06-18T12:00:01.000Z",
      },
    ],
    mapSnapshot: {
      id: "snapshot-1",
      threadId: "thread-1",
      clientInstallationId: "install-1",
      mapState: seedMapState,
      revision: "map-rev-1",
      createdAt: "2026-06-18T12:00:00.000Z",
      updatedAt: "2026-06-18T12:00:00.000Z",
    },
    listingLedgerRevision: "ledger-rev-1",
  };
}

function createPlanningActionExecuteCorridorPriorityResponse() {
  const nextMapState = {
    ...samplePlanningMapState,
    corridors: samplePlanningMapState.corridors.map((corridor) =>
      corridor.id === "polk" ? { ...corridor, priority: "high" as const } : corridor,
    ),
  };

  return {
    ok: true,
    action: {
      id: "action-corridor-priority-1",
      threadId: "thread-corridor-1",
      messageId: "message-assistant-corridor-1",
      partIndex: 1,
      kind: "mapProposal",
      target: {
        kind: "mapProposal",
        messageId: "message-assistant-corridor-1",
        partIndex: 1,
        proposalHash: "proposal-corridor-priority-1",
        allowedOperationIndexes: [0],
        mapRevision: "map-rev-1",
      },
      status: "applied",
      createdAt: "2026-06-18T12:00:01.000Z",
      updatedAt: "2026-06-18T12:00:02.000Z",
    },
    execution: {
      id: "exec-corridor-priority-1",
      actionId: "action-corridor-priority-1",
      idempotencyKey: "idem-corridor-priority-1",
      payloadHash: "payload-corridor-priority-1",
      status: "succeeded",
      createdAt: "2026-06-18T12:00:02.000Z",
    },
    mapSnapshot: {
      id: "snapshot-corridor-2",
      threadId: "thread-corridor-1",
      clientInstallationId: "install-1",
      revision: "map-rev-2",
      createdAt: "2026-06-18T12:00:00.000Z",
      updatedAt: "2026-06-18T12:00:02.000Z",
      mapState: nextMapState,
    },
    mapState: nextMapState,
  };
}
