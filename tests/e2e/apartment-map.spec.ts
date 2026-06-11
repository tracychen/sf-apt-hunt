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
});

test("fits the apartment map on a mobile viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/");

  await expect(page.locator(".leaflet-container")).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

  expect(hasHorizontalOverflow).toBe(false);
});
