// The main tasks, by keyboard where a person would use it: editing the
// plan, running it, the confirmations, Stop, Pause, the undo window, the
// agent's request to change a step, the shortcuts and the log.
import { expect, test } from "@playwright/test";
import { dialog, en, expectNoSeriousViolations, expectPlanState, logLines, ready, runSteps, confirmation } from "./helpers";

test("the plan is edited with the keyboard: moved, marked, removed, emptied and restored", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  const plan = page.getByRole("grid", { name: en.plan.list });
  const rows = plan.getByRole("row");
  await expect(rows).toHaveCount(12);
  await expect(page.getByText("Steps: 12. Will ask before running: 6.")).toBeVisible();

  await page.getByRole("button", { name: "Move down: Check request 1041 from Northwind Metals" }).focus();
  await page.keyboard.press("Enter");
  await expect(rows.nth(0)).toContainText("Extend contract 190 with Harbour Logistics");
  await expect(rows.nth(1)).toContainText("Check request 1041 from Northwind Metals");

  // Ask first on step 1 (now the extension): one more step will ask.
  const ask = rows.nth(0).getByRole("switch", { name: en.plan.askFirst });
  await ask.focus();
  await page.keyboard.press("Space");
  await expect(ask).toBeChecked();
  await expect(page.getByText("Steps: 12. Will ask before running: 7.")).toBeVisible();
  // A high-risk step's switch is on and cannot be turned off, and says why.
  await expect(rows.nth(2).getByRole("switch")).toBeDisabled();
  await expect(rows.nth(2)).toContainText(en.plan.alwaysAsks);

  await page.getByRole("button", { name: "Remove: Check request 1041 from Northwind Metals" }).focus();
  await page.keyboard.press("Enter");
  await expect(rows).toHaveCount(11);
  await expect(page.getByText("Steps: 11. Will ask before running: 7.")).toBeVisible();

  // Every step removed: the empty state, with a way back.
  for (let left = 11; left > 0; left -= 1) {
    await rows.first().getByRole("button", { name: /^Remove: / }).click();
    await expect(rows).toHaveCount(left - 1);
  }
  await expect(page.getByText(en.plan.emptyTitle)).toBeVisible();
  await expect(page.getByRole("button", { name: en.plan.run })).toHaveCount(0);
  await expectNoSeriousViolations(page, "empty plan");
  await page.getByRole("button", { name: en.plan.restore }).click();
  await expect(rows).toHaveCount(12);
  await expect(rows.nth(0)).toContainText("Check request 1041 from Northwind Metals");
});

test("a run by keyboard: R runs, confirmations focus the safe action, a failed step focuses Retry, S stops", async ({ page }) => {
  await page.goto("/?scale=0.05");
  await ready(page);
  await page.keyboard.press("r");

  // Step 3 sends a letter: the dialog opens on Skip step, so Enter skips.
  let alert = await dialog(page);
  await expect(alert.getByRole("heading")).toHaveText("Step 3: Ask Cedar Office Supply for documents on request 1043");
  await expect(alert.getByRole("button", { name: en.confirm.skip })).toBeFocused();
  await expect(alert).toContainText("Letter to Cedar Office Supply about request 1043.");
  await expect(alert).toContainText("Nothing has been sent or changed yet.");
  await page.keyboard.press("Enter");
  await expect(alert).toBeHidden();
  await expect(runSteps(page).nth(2)).toContainText("Skipped");

  // Step 4 fails once: its Retry button takes focus.
  const retry = page.getByRole("button", { name: en.step.retry, exact: true });
  await expect(retry).toBeFocused({ timeout: 15_000 });
  await expect(runSteps(page).nth(3)).toContainText("The contracts service did not answer within 5 s.");
  await page.keyboard.press("Enter");
  await expect(runSteps(page).nth(3)).toContainText("Done");

  // Step 5 rejects a duplicate: Tab to the primary action and confirm.
  alert = await dialog(page);
  await expect(alert.getByRole("heading")).toContainText("Step 5:");
  await page.keyboard.press("Tab");
  await expect(alert.getByRole("button", { name: en.confirm.confirm.decision })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(runSteps(page).nth(4)).toContainText("Request 1045 rejected as a duplicate", { timeout: 15_000 });

  // Step 7: the agent asks to change it; S stops the run from the dialog.
  alert = await dialog(page);
  await expect(alert.getByRole("button", { name: en.deviation.deny })).toBeFocused();
  await page.keyboard.press("s");
  await expectPlanState(page, "stopped");
  await expect(confirmation(page)).toHaveCount(0);
  await expect(page.locator(".summary")).toContainText("The run was stopped after step 6.");
  await expect(runSteps(page).nth(6)).toContainText("the run was stopped");
  for (let i = 7; i < 12; i += 1) await expect(runSteps(page).nth(i)).toContainText("Waiting");
  await expect(page.locator('[role="status"][aria-live="polite"][aria-atomic="true"]').last()).toHaveText(en.announce.stopped);
  const log = await logLines(page);
  expect(log.filter((l) => l.includes("You skipped step 3."))).toHaveLength(1);
  expect(log.filter((l) => l.includes("You asked to retry step 4."))).toHaveLength(1);
  expect(log.filter((l) => l.includes("You confirmed step 5."))).toHaveLength(1);
  expect(log.at(-1)).toContain("Run stopped after step 6.");
});

test("Stop while a step runs: that step finishes, no new step starts", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await page.getByRole("radio", { name: en.autonomy.ask_none }).click();
  await page.getByRole("button", { name: en.plan.run }).click();
  await expect(runSteps(page).nth(0)).toContainText("Running");
  await page.getByRole("button", { name: en.run.stop }).click();
  await expect(page.locator(".run")).toContainText(en.run.stoppingTitle);
  await expect(page.getByRole("button", { name: en.run.stop })).toBeDisabled();
  await expectPlanState(page, "stopped");
  const log = await logLines(page);
  const after = log.slice(log.findIndex((l) => l.includes(en.log.stopRequested)) + 1);
  // At most the rest of the running step (running, done) and the stop.
  expect(after.length).toBeLessThanOrEqual(3);
  expect(after.filter((l) => l.includes("started"))).toEqual([]);
  expect(after.at(-1)).toMatch(/Run stopped after step [12]\./);
  for (let i = 2; i < 12; i += 1) await expect(runSteps(page).nth(i)).toContainText("Waiting");
});

test("Pause holds the run between events; Resume goes on from the next one", async ({ page }) => {
  await page.goto("/?scale=0.5");
  await ready(page);
  await page.getByRole("button", { name: en.plan.run }).click();
  await expect.poll(async () => (await logLines(page)).length).toBeGreaterThanOrEqual(3);
  await page.keyboard.press("p");
  await expect(page.locator(".run-bar")).toContainText(en.run.status.paused);
  await expect(page.locator(".run")).toContainText(en.run.pausedText);
  await expect(page.getByRole("button", { name: en.run.resume })).toBeVisible();
  const held = await logLines(page);
  await page.waitForTimeout(1500);
  expect(await logLines(page)).toEqual(held);
  await page.keyboard.press("p");
  await expect(page.locator(".run-bar")).toContainText(en.run.status.streaming);
  await expect.poll(async () => (await logLines(page)).length).toBeGreaterThan(held.length);
  // Nothing was repeated: every step started once.
  await dialog(page);
  const log = await logLines(page);
  for (const n of [1, 2, 3]) expect(log.filter((l) => l.includes(`Step ${n} started`))).toHaveLength(1);
});

test("the undo window: a toast with Undo, a countdown, then final", async ({ page }) => {
  await page.goto("/?scale=0.05&undoWindow=4");
  await ready(page);
  await page.getByRole("button", { name: en.plan.run }).click();
  let alert = await dialog(page);
  await alert.getByRole("button", { name: en.confirm.confirm.email }).click();

  // Sent: a toast offers Undo, and the step shows the time left.
  const toast = page.locator(".stoa-toast").filter({ hasText: "Letter sent to Cedar Office Supply about request 1043." });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Undo is possible until");
  const countdown = runSteps(page).nth(2).getByRole("progressbar", { name: "Undo window of step 3" });
  await expect(countdown).toHaveAttribute("aria-valuetext", /0:0[1-4]\u2069? of \u2068?0:04/);
  await toast.getByRole("button", { name: en.step.undo }).click();
  await expect(runSteps(page).nth(2)).toContainText("Undone");
  await expect(runSteps(page).nth(2)).toContainText("The letter to Cedar Office Supply about request 1043 was recalled.");
  await expect(page.locator(".stoa-toast").filter({ hasText: "Undone." })).toBeVisible();

  await page.getByRole("button", { name: en.step.retry, exact: true }).click();
  alert = await dialog(page);
  await alert.getByRole("button", { name: en.confirm.confirm.decision }).click();
  const fifth = runSteps(page).nth(4);
  await expect(fifth.getByRole("button", { name: /^Undo: / })).toBeVisible();
  // The window closes: the step says it is final, Undo and the toast go.
  await expect(fifth).toContainText("Final since", { timeout: 10_000 });
  await expect(fifth.getByRole("button", { name: /^Undo: / })).toHaveCount(0);
  await expect(page.locator(".stoa-toast").filter({ hasText: "Request 1045 rejected" })).toHaveCount(0);
  // An internal change can be undone at any time, even after the run.
  await expect(runSteps(page).nth(0)).toContainText(en.step.undoPermanent);
});

test("the agent asks to change a step: Allow replaces it", async ({ page }) => {
  await page.goto("/?scale=0.05");
  await ready(page);
  await page.getByRole("button", { name: en.plan.run }).click();
  await (await dialog(page)).getByRole("button", { name: en.confirm.skip }).click();
  await page.getByRole("button", { name: en.step.retry, exact: true }).click();
  await (await dialog(page)).getByRole("button", { name: en.confirm.skip }).click();
  const alert = await dialog(page);
  await expect(alert.getByRole("heading")).toHaveText("Step 7: the agent asks to change the plan");
  await expect(alert).toContainText("Instead: Check request 1047 against archived documents (low risk).");
  await alert.getByRole("button", { name: en.deviation.allow }).click();
  await expect(runSteps(page).nth(6)).toContainText("Check request 1047 against archived documents");
  await expect(runSteps(page).nth(6)).toContainText("Done", { timeout: 15_000 });
  const log = await logLines(page);
  expect(log.some((l) => l.includes("You allowed the change to step 7."))).toBe(true);
});

test("a whole run to the end gives a summary", async ({ page }) => {
  await page.goto("/?scale=0.02");
  await ready(page);
  await page.getByRole("radio", { name: en.autonomy.ask_none }).click();
  await page.getByRole("button", { name: en.plan.run }).click();
  for (;;) {
    const state = await page.locator(".layout").getAttribute("data-plan-state");
    if (state === "finished") break;
    const alert = confirmation(page);
    const retry = page.getByRole("button", { name: en.step.retry, exact: true });
    await expect(alert.or(retry).or(page.locator('.layout[data-plan-state="finished"]'))).toBeVisible({ timeout: 15_000 });
    if (await alert.isVisible()) await alert.getByRole("button").last().click();
    else if (await retry.isVisible()) await retry.click();
  }
  const summary = page.locator(".summary");
  await expect(summary).toContainText(en.summary.finished);
  await expect(summary.getByRole("term")).toHaveText([en.summary.done, en.summary.skipped, en.summary.undone, en.summary.asked, en.summary.errors, en.summary.duration, en.summary.events]);
  await expect(summary.getByRole("definition").first()).toHaveText("12");
  await expect(page.locator('[role="status"][aria-live="polite"][aria-atomic="true"]').last()).toHaveText("Run finished: 12 of 12 steps done.");
  // New plan: back to the editor, with a fresh plan.
  await page.getByRole("button", { name: en.run.newPlan }).click();
  await expectPlanState(page, "draft");
  await expect(page.getByRole("grid", { name: en.plan.list }).getByRole("row")).toHaveCount(12);
});

test("the shortcuts dialog lists every shortcut with its keys", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: en.shortcuts.title });
  await expect(help).toBeVisible();
  for (const [key, description] of [
    ["R", en.shortcuts.start],
    ["S", en.shortcuts.stop],
    ["P", en.shortcuts.pauseResume],
    ["?", en.shortcuts.help],
  ] as const)
    await expect(help.locator(".stoa-shortcuts__row", { hasText: description }).locator("kbd.stoa-kbd")).toHaveText(key);
  await expectNoSeriousViolations(page, "shortcuts dialog");
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await page.getByRole("button", { name: en.shortcutsButton }).click();
  await expect(help).toBeVisible();
});

test("the log is copied as text", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?scale=0.05");
  await ready(page);
  await expect(page.getByText(en.log.emptyTitle)).toBeVisible();
  await page.getByRole("button", { name: en.plan.run }).click();
  await dialog(page);
  await page.keyboard.press("s");
  await expectPlanState(page, "stopped");
  await page.locator(".log").getByRole("button", { name: "Copy" }).click();
  await expect(page.locator(".log")).toContainText("Copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Plan approved: 12 steps, Ask for marked steps, 6 will ask first.");
  expect(copied).toContain("Run stopped after step 2.");
});

test("under reduced motion the undo countdown still counts, without animating", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?scale=0.05&undoWindow=6");
  await ready(page);
  await page.getByRole("button", { name: en.plan.run }).click();
  await (await dialog(page)).getByRole("button", { name: en.confirm.confirm.email }).click();
  const countdown = runSteps(page).nth(2).getByRole("progressbar");
  await expect(countdown).toBeVisible();
  const first = await countdown.getAttribute("aria-valuetext");
  await expect(countdown).not.toHaveAttribute("aria-valuetext", first ?? "", { timeout: 3000 });
  const fill = countdown.locator(".stoa-progress__fill");
  expect(await fill.evaluate((el) => getComputedStyle(el).transitionDuration)).toMatch(/^0s/);
});
