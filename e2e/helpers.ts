import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { strings } from "../src/i18n";

export const en = strings.en;

export async function expectNoSeriousViolations(page: Page, where: string) {
  // A dialog or a toast that is still fading in has a contrast it will not
  // keep; axe looks at the page once every animation has ended.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity));
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${where}: ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

export const layout = (page: Page) => page.locator(".layout");

export async function expectPlanState(page: Page, state: string, timeout = 30_000) {
  await expect(layout(page)).toHaveAttribute("data-plan-state", state, { timeout });
}

/** Waits until the worker controls the page and Run can be pressed. */
export async function ready(page: Page, runLabel = en.plan.run) {
  await expect(page.getByRole("button", { name: runLabel })).toBeEnabled({ timeout: 15_000 });
}

/** The run's step rows, in order. */
export const runSteps = (page: Page) => page.getByRole("list", { name: en.run.list }).getByRole("listitem");

/** The log's lines, as text. */
export async function logLines(page: Page): Promise<string[]> {
  const pre = page.locator(".log .stoa-code__scroll");
  if ((await pre.count()) === 0) return [];
  return (await pre.locator(".stoa-code__line").allInnerTexts()).map((l) => l.replace(/[\u2066-\u2069]/g, "").trim());
}

/** A confirmation the run waits for: Stoa's AlertDialog, a modal. (A
 * toast has the role alertdialog too, as React Aria draws it.) */
export const confirmation = (page: Page) => page.locator('section.stoa-dialog[role="alertdialog"]');

export async function dialog(page: Page) {
  const alert = confirmation(page);
  await expect(alert).toBeVisible({ timeout: 20_000 });
  return alert;
}
