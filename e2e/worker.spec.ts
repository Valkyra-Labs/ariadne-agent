// The Service Worker that streams the run, in Chromium: first load, reload,
// a forced reload, an update while a run streams, a dropped connection, and
// a browser where workers are blocked.
import { expect, test, type Page } from "@playwright/test";
import { dialog, en, expectNoSeriousViolations, expectPlanState, logLines, ready, runSteps, confirmation } from "./helpers";

const controlled = (page: Page) => page.evaluate(() => navigator.serviceWorker.controller !== null);

/** Answers every pause the agreeing way until the run ends. */
async function finish(page: Page) {
  for (;;) {
    if ((await page.locator(".layout").getAttribute("data-plan-state")) === "finished") return;
    const alert = confirmation(page);
    const retry = page.getByRole("button", { name: en.step.retry, exact: true });
    await expect(alert.or(retry).or(page.locator('.layout[data-plan-state="finished"]'))).toBeVisible({ timeout: 20_000 });
    if (await alert.isVisible()) await alert.getByRole("button").last().click();
    else if (await retry.isVisible()) await retry.click();
  }
}

/** Every step started and finished exactly once in the log. */
async function expectNoRepeats(page: Page) {
  const log = await logLines(page);
  for (let n = 1; n <= 12; n += 1) {
    expect(log.filter((l) => l.includes(`Step ${n} started`)), `step ${n} started`).toHaveLength(1);
    expect(log.filter((l) => l.includes(`Step ${n} done`)), `step ${n} done`).toHaveLength(1);
  }
}

test("first load: the worker takes control without a reload and serves the stream", async ({ page, baseURL }) => {
  // Without the worker the static server answers with the page itself.
  expect((await page.request.get("/api/agent")).headers()["content-type"]).toContain("text/html");
  await page.goto("/?scale=0.05");
  await ready(page);
  expect(await controlled(page)).toBe(true);
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope);
  expect(scope).toBe(`${baseURL}/`);
  // The worker answers the engine's request shape; a bad request gets its code.
  const answer = await page.evaluate(() => fetch("api/agent").then(async (r) => ({ status: r.status, body: await r.json() })));
  expect(answer).toEqual({ status: 400, body: { ok: false, error: "missing_plan" } });
  await page.getByRole("button", { name: en.plan.run }).click();
  await expect(runSteps(page).nth(0)).toContainText("Done");
  const marks = await page.evaluate(() => performance.getEntriesByType("mark").map((m) => m.name));
  expect(marks).toEqual(expect.arrayContaining(["ariadne:sw-register", "ariadne:sw-controlled", "ariadne:run", "ariadne:first-event"]));
});

test("a reload is controlled from the start, and a forced reload is claimed again", async ({ page, context }) => {
  await page.goto("/?scale=0.05");
  await ready(page);
  await page.reload();
  expect(await controlled(page)).toBe(true);
  await ready(page);

  // Shift+Reload: the page bypasses the worker and loads uncontrolled.
  const cdp = await context.newCDPSession(page);
  const loaded = page.waitForEvent("load");
  await cdp.send("Page.reload", { ignoreCache: true });
  await loaded;
  await ready(page);
  expect(await controlled(page)).toBe(true);
  await page.getByRole("button", { name: en.plan.run }).click();
  await dialog(page);
  await expect(runSteps(page).nth(1)).toContainText("Done");
});

test("a new worker deployed during a run takes over, and the run goes on without a gap or a repeat", async ({ page, context, baseURL }) => {
  await page.goto("/?scale=0.3");
  await ready(page);
  await page.getByRole("button", { name: en.plan.run }).click();
  await expect(runSteps(page).nth(0)).toContainText(/Running|Done/);
  // The next deployment: the served script changes, the browser updates it.
  await context.addCookies([{ name: "ariadne-sw-revision", value: "2", url: baseURL }]);
  const changed = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const change = new Promise<string>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve("changed"), { once: true }));
    await registration?.update();
    return Promise.race([change, new Promise<string>((resolve) => setTimeout(() => resolve("no change"), 10_000))]);
  });
  expect(changed).toBe("changed");
  await expect(page.locator(".stoa-toast").filter({ hasText: en.service.updated })).toBeVisible();
  await finish(page);
  await expectNoRepeats(page);
});

test("a dropped connection resumes after the last event, losing nothing", async ({ page }) => {
  await page.goto("/?scale=0.05&drop=1");
  await ready(page);
  await page.getByRole("button", { name: en.plan.run }).click();
  await expect(page.locator(".stoa-toast").filter({ hasText: en.toast.reconnected })).toBeVisible({ timeout: 15_000 });
  await finish(page);
  await expectNoRepeats(page);
});

test.describe("where service workers are blocked", () => {
  test.use({ serviceWorkers: "block" });

  test("the page says so, and the run can go on in the tab", async ({ page }) => {
    await page.goto("/?scale=0.05");
    const alert = page.getByRole("alert").filter({ hasText: en.service.failedTitle });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(en.service.errors.sw_registration_failed);
    await expect(page.getByRole("button", { name: en.plan.run })).toBeDisabled();
    await expectNoSeriousViolations(page, "worker error");
    await page.getByRole("button", { name: en.service.usePage }).click();
    await expect(page.getByText(en.service.pageNote)).toBeVisible();
    await page.getByRole("button", { name: en.plan.run }).click();
    await dialog(page);
    await page.keyboard.press("s");
    await expectPlanState(page, "stopped");
    await expect(page.locator(".run")).toContainText(en.service.pageNote);
  });
});
