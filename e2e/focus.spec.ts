// Where the keyboard focus goes after a decision removes or disables the
// control that had it: never to the page's body, from which the next Tab
// would start again at the top of the page. During a run that place is the
// run's heading, one Tab before Stop.
import { expect, test, type Page } from "@playwright/test";
import { dialog, en, expectPlanState, ready, runSteps } from "./helpers";

/** What has the focus, in words; "body" when nothing does. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "body";
    return `${el.tagName.toLowerCase()} ${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}`;
  });

const runHeading = (page: Page) => page.getByRole("heading", { name: en.run.panel, exact: true });

/** The focus is on the run's heading. */
async function expectAtRun(page: Page, what: string) {
  await expect(runHeading(page), what).toBeFocused();
}

test("after Run the focus is at the run, and Tab goes on to Stop", async ({ page }) => {
  await page.goto("/?scale=0.05");
  await ready(page);
  await page.getByRole("button", { name: en.plan.run }).click();
  await expectAtRun(page, "after Run");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: en.run.stop })).toBeFocused();
});

test("a run's decisions keep the focus at the run, from Run to Stop", async ({ page }) => {
  await page.goto("/?scale=0.05");
  await ready(page);
  await page.getByRole("button", { name: en.plan.run }).click();
  await expectAtRun(page, "after Run");

  // Step 3's letter: confirmed from the keyboard.
  let alert = await dialog(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(alert).toBeHidden();
  await expectAtRun(page, "after a confirmation");

  // Step 4 fails: Retry has the focus; once pressed, the run has it.
  const retry = page.getByRole("button", { name: en.step.retry, exact: true });
  await expect(retry).toBeFocused({ timeout: 15_000 });
  await page.keyboard.press("Enter");
  await expect(retry).toHaveCount(0);
  expect(await focused(page)).not.toBe("body");

  // Step 5: Escape skips it.
  alert = await dialog(page);
  await page.keyboard.press("Escape");
  await expect(alert).toBeHidden();
  await expectAtRun(page, "after Escape");

  // Step 7: S stops the run from the agent's request.
  alert = await dialog(page);
  await page.keyboard.press("s");
  await expectPlanState(page, "stopped");
  await expect(runHeading(page)).toBeFocused();
});

test("Skip and Stop on a failed step keep the focus at the run", async ({ page }) => {
  await page.goto("/?scale=0.05");
  await ready(page);
  await page.getByRole("button", { name: en.plan.run }).click();
  await (await dialog(page)).getByRole("button", { name: en.confirm.skip }).click();
  await page.getByRole("button", { name: en.step.skip, exact: true }).click();
  await expect(runSteps(page).nth(3)).toContainText("Skipped");
  await expectAtRun(page, "after Skip");
  // The same failure in a new run: Stop this time.
  await page.goto("/?scale=0.05&seed=7");
  await ready(page);
  await page.getByRole("button", { name: en.plan.run }).click();
  await (await dialog(page)).getByRole("button", { name: en.confirm.skip }).click();
  await page.getByRole("button", { name: en.step.stopRun, exact: true }).click();
  await expectPlanState(page, "stopped");
  await expect(runHeading(page)).toBeFocused();
});

test("Stop pressed in the run bar leaves the focus at the run", async ({ page }) => {
  await page.goto("/?scale=4");
  await ready(page);
  await page.getByRole("radio", { name: en.autonomy.ask_none }).click();
  await page.getByRole("button", { name: en.plan.run }).click();
  await expect(runSteps(page).nth(0)).toContainText("Running");
  await page.getByRole("button", { name: en.run.stop }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: en.run.stop })).toBeDisabled();
  await expect(runHeading(page)).toBeFocused();
});

test("Undo on a step leaves the focus in place", async ({ page }) => {
  await page.goto("/?scale=0.05");
  await ready(page);
  await page.getByRole("button", { name: en.plan.run }).click();
  await (await dialog(page)).getByRole("button", { name: en.confirm.confirm.email }).click();
  const undo = runSteps(page).nth(2).getByRole("button", { name: /^Undo: / });
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(runSteps(page).nth(2)).toContainText("Undone");
  expect(await focused(page)).not.toBe("body");
});

test("removing the last step gives the focus to Restore", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  const removes = page.locator(".stoa-reorder__remove");
  while ((await removes.count()) > 1) await removes.first().click();
  await removes.first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(en.plan.emptyTitle)).toBeVisible();
  await expect(page.getByRole("button", { name: en.plan.restore })).toBeFocused();
});

test("New plan gives the focus to Run on the new plan", async ({ page }) => {
  await page.goto("/?scale=0.05&undoWindow=1");
  await ready(page);
  await page.getByRole("button", { name: en.plan.run }).click();
  await dialog(page);
  await page.keyboard.press("s");
  await expectPlanState(page, "stopped");
  await page.getByRole("button", { name: en.run.newPlan }).focus();
  await page.keyboard.press("Enter");
  await expectPlanState(page, "draft");
  await expect(page.getByRole("button", { name: en.plan.run })).toBeFocused();
});

test("New plan confirmed in its dialog gives the focus to Run on the new plan", async ({ page }) => {
  await page.goto("/?scale=0.05");
  await ready(page);
  await page.getByRole("button", { name: en.plan.run }).click();
  await (await dialog(page)).getByRole("button", { name: en.confirm.confirm.email }).click();
  await expect(page.getByRole("button", { name: en.step.retry, exact: true })).toBeVisible();
  await page.keyboard.press("s");
  await expectPlanState(page, "stopped");
  await page.getByRole("button", { name: en.run.newPlan }).focus();
  await page.keyboard.press("Enter");
  const ask = await dialog(page);
  await ask.getByRole("button", { name: en.newPlanAsk.confirm }).focus();
  await page.keyboard.press("Enter");
  await expectPlanState(page, "draft");
  await expect(page.getByRole("button", { name: en.plan.run })).toBeFocused();
});

test("the run service's buttons leave the focus in place when their notice goes", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByText(en.service.failedTitle)).toBeVisible();
  await page.getByRole("button", { name: en.service.usePage }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: en.service.usePage })).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.plan.run })).toBeFocused();
  await context.close();
});
