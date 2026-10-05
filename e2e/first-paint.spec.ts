// What the page is before and as its script runs: the language's direction
// from the first layout, and the Arabic faces Stoa's stacks name.
import { expect, test } from "@playwright/test";
import { strings } from "../src/i18n";
import { expectPlanState, ready, confirmation } from "./helpers";

/** Families of the font faces the page has loaded. */
const loadedFamilies = (page: import("@playwright/test").Page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, ""));
  });

test("Arabic digits in the numeric face are Noto Sans Arabic's, and the Arabic face is preloaded", async ({ page }) => {
  const t = strings.ar;
  await page.goto("/?lang=ar&scale=0.05");
  await ready(page, t.plan.run);
  const preload = page.locator('link[rel="preload"][as="font"]');
  await expect(preload).toHaveCount(1);
  expect(await preload.getAttribute("href")).toContain("ibm-plex-sans-arabic-arabic-400-normal");
  // The log's times are in the numeric face, in Arabic-Indic digits.
  await page.getByRole("button", { name: t.plan.run }).click();
  await expect(confirmation(page)).toBeVisible();
  await page.keyboard.press("s");
  await expectPlanState(page, "stopped");
  await expect.poll(() => loadedFamilies(page)).toContain("Noto Sans Arabic");
});

test("a page that is not in Arabic preloads no font and downloads no Arabic face", async ({ page }) => {
  await page.goto("/?lang=en&scale=0.05");
  await ready(page);
  await expect(page.locator('link[rel="preload"][as="font"]')).toHaveCount(0);
  await page.getByRole("button", { name: strings.en.plan.run }).click();
  await expect(confirmation(page)).toBeVisible();
  await page.keyboard.press("s");
  await expectPlanState(page, "stopped");
  const families = await loadedFamilies(page);
  expect(families).toContain("IBM Plex Mono");
  // Stoa's scaled fallbacks are local faces; nothing Arabic is downloaded.
  expect(families.filter((f) => f === "Noto Sans Arabic" || f === "IBM Plex Sans Arabic")).toEqual([]);
});
