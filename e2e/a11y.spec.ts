// Accessibility and layout: axe on every main state in each language and
// theme, the theme and language switches and what they keep, the Arabic
// interface right to left and without Latin words, no sideways scroll, and
// the page frame (a fixed header, Stoa's scrollbars).
import { expect, test, type Page } from "@playwright/test";
import { strings, type Lang } from "../src/i18n";
import { en, expectNoSeriousViolations, expectPlanState, ready, confirmation } from "./helpers";

const LANGS: Lang[] = ["en", "ru", "ar"];
const THEMES = ["light", "dark"] as const;

async function answer(page: Page, which: "safe" | "primary") {
  const alert = confirmation(page);
  await expect(alert).toBeVisible({ timeout: 20_000 });
  await alert.getByRole("button").nth(which === "safe" ? 0 : 1).click();
}

for (const lang of LANGS)
  for (const theme of THEMES)
    test(`axe: every state in ${lang}, ${theme}`, async ({ page }) => {
      const t = strings[lang];
      await page.goto(`/?lang=${lang}&theme=${theme}&scale=0.05`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      await ready(page, t.plan.run);
      await expectNoSeriousViolations(page, "plan", { lang, theme });

      await page.getByRole("button", { name: t.plan.run }).click();
      await expect(confirmation(page)).toBeVisible();
      await expectNoSeriousViolations(page, "confirmation", { lang, theme });
      await answer(page, "primary");

      // The failed step, with its Retry, Skip and Stop, and the undo countdown above.
      await expect(page.getByRole("button", { name: t.step.retry, exact: true })).toBeVisible();
      await expectNoSeriousViolations(page, "failed step and undo window", { lang, theme });
      await page.getByRole("button", { name: t.step.retry, exact: true }).click();
      await expect(confirmation(page)).toBeVisible();
      await page.keyboard.press("p"); // no effect while waiting; the dialog stays
      await page.keyboard.press("s");
      await expectPlanState(page, "stopped");
      await expect(page.locator(".summary")).toBeVisible();
      await expectNoSeriousViolations(page, "stopped, with summary and toasts", { lang, theme });

      await page.getByRole("button", { name: t.run.newPlan }).click();
      for (let i = 0; i < 12; i += 1) await page.locator(".stoa-reorder__remove").first().click();
      await expect(page.getByText(t.plan.emptyTitle)).toBeVisible();
      await expectNoSeriousViolations(page, "empty plan", { lang, theme });
    });

for (const lang of LANGS)
  for (const theme of THEMES) {
    test(`axe: starting and failed run service in ${lang}, ${theme}`, async ({ browser }) => {
      const t = strings[lang];
      // Starting: the worker's script is held back for a while.
      const slow = await browser.newContext();
      await slow.route("**/sw.js", async (route) => {
        await new Promise((r) => setTimeout(r, 3000));
        await route.continue();
      });
      const page = await slow.newPage();
      await page.goto(`/?lang=${lang}&theme=${theme}`);
      await expect(page.getByRole("progressbar", { name: t.service.starting })).toBeVisible();
      await expectNoSeriousViolations(page, "starting", { lang, theme });
      await slow.close();
      // Failed: workers blocked.
      const blocked = await browser.newContext({ serviceWorkers: "block" });
      const second = await blocked.newPage();
      await second.goto(`/?lang=${lang}&theme=${theme}`);
      await expect(second.getByText(t.service.failedTitle)).toBeVisible();
      await expectNoSeriousViolations(second, "worker failed", { lang, theme });
      await blocked.close();
    });
  }

test("the theme follows the system until one is chosen, and the choice is kept", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/?from=link");
  const html = page.locator("html");
  await expect(page.getByRole("radio", { name: "System" })).toBeChecked();
  await expect(html).not.toHaveAttribute("data-theme");
  await page.getByRole("radio", { name: "Light" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  expect(new URL(page.url()).searchParams.get("theme")).toBe("light");
  expect(new URL(page.url()).searchParams.get("from")).toBe("link");
  // Kept for the next visit without the link.
  await page.goto("/");
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
  await page.getByRole("radio", { name: "Dark" }).click();
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  // ?theme=system asks for System; choosing System clears both.
  await page.goto("/?theme=system");
  await expect(html).not.toHaveAttribute("data-theme");
  await expect(page.getByRole("radio", { name: "System" })).toBeChecked();
  await page.goto("/");
  await page.getByRole("radio", { name: "System" }).click();
  await expect(html).not.toHaveAttribute("data-theme");
  expect(await page.evaluate(() => localStorage.getItem("ariadne-agent.theme"))).toBeNull();
  await page.reload();
  await expect(html).not.toHaveAttribute("data-theme");
});

test("the language switches the whole interface and is kept", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await page.getByRole("radio", { name: "RU", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page).toHaveTitle(strings.ru.title);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(strings.ru.title);
  await expect(page.getByRole("button", { name: strings.ru.plan.run })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("lang")).toBe("ru");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await page.getByRole("radio", { name: "AR", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page).toHaveTitle(strings.ar.title);
  // Arabic-Indic digits: the plan's numbers and the step numbers.
  await expect(page.getByText("الخطوات: ١٢. ستسأل قبل التنفيذ: ٦.")).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("radio", { name: "EN", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page).toHaveTitle(en.title);
});

/** Latin letters the Arabic interface shows. Excluded: the language
 * switch's codes and the keys drawn by Kbd. Read: every text node,
 * shown or visually hidden, and the aria-label, title, placeholder and
 * alt attributes, and the page title. */
async function latin(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const languages = document.querySelector('[role="radiogroup"][aria-label="اللغة"]');
    // Stoa's tone symbols (the "i" of a note) are drawn glyphs, hidden from
    // assistive technology; they are left out and reported to Stoa.
    const skip = (el: Element) => languages?.contains(el) || el.closest("kbd, script, style, .stoa-tone-symbol");
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      if (skip(el)) continue;
      for (const w of (n.textContent ?? "").match(/[A-Za-z]+/g) ?? []) out.push(`${w} in "${n.textContent!.trim().slice(0, 60)}"`);
    }
    for (const el of document.querySelectorAll("[aria-label], [title], [placeholder], [alt], [aria-keyshortcuts]")) {
      if (skip(el)) continue;
      for (const name of ["aria-label", "title", "placeholder", "alt"])
        for (const w of el.getAttribute(name)?.match(/[A-Za-z]+/g) ?? []) out.push(`${w} in ${name}`);
    }
    for (const w of document.title.match(/[A-Za-z]+/g) ?? []) out.push(`${w} in the title`);
    return out;
  });
}

test("the Arabic interface is right to left and has no Latin words", async ({ page }) => {
  const t = strings.ar;
  await page.goto("/?lang=ar&scale=0.05");
  await ready(page, t.plan.run);
  expect(await latin(page)).toEqual([]);
  await page.getByRole("button", { name: t.plan.run }).click();
  await answer(page, "primary");
  await expect(page.getByRole("button", { name: t.step.retry, exact: true })).toBeVisible();
  expect(await latin(page)).toEqual([]);
  await page.getByRole("button", { name: t.step.retry, exact: true }).click();
  await expect(confirmation(page)).toBeVisible();
  expect(await latin(page)).toEqual([]);
  await page.keyboard.press("s");
  await expectPlanState(page, "stopped");
  expect(await latin(page)).toEqual([]);
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: t.shortcuts.title })).toBeVisible();
  expect(await latin(page)).toEqual([]);
  // The check finds a Latin word when there is one.
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.body.append(Object.assign(document.createElement("p"), { textContent: "اضغط Enter" })));
  expect(await latin(page)).toEqual(['Enter in "اضغط Enter"']);
});

for (const width of [1280, 375])
  for (const lang of ["en", "ar"] as const)
    test(`no sideways scroll at ${width} px in ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/?lang=${lang}&scale=0.05`);
      await ready(page, strings[lang].plan.run);
      const sideways = () =>
        page.evaluate(() => {
          const scroll = document.querySelector(".stoa-page-shell__scroll")!;
          return [document.documentElement.scrollWidth - document.documentElement.clientWidth, scroll.scrollWidth - scroll.clientWidth];
        });
      expect(await sideways()).toEqual([0, 0]);
      await page.getByRole("button", { name: strings[lang].plan.run }).click();
      await answer(page, "primary");
      await expect(page.getByRole("button", { name: strings[lang].step.retry, exact: true })).toBeVisible();
      expect(await sideways()).toEqual([0, 0]);
      await page.keyboard.press("s");
      await expectPlanState(page, "stopped");
      expect(await sideways()).toEqual([0, 0]);
    });

for (const theme of THEMES)
  test(`the header stays put and the scrollbars are Stoa's, ${theme}`, async ({ page }) => {
    await page.goto(`/?theme=${theme}&scale=0.05`);
    await ready(page);
    // A log long enough to scroll inside itself, and a page that scrolls.
    await page.getByRole("button", { name: en.plan.run }).click();
    await answer(page, "primary");
    await page.getByRole("button", { name: en.step.retry, exact: true }).click();
    await answer(page, "primary");
    await expect(confirmation(page)).toBeVisible();
    await page.keyboard.press("s");
    await expectPlanState(page, "stopped");
    const header = page.locator(".stoa-app-header");
    const before = await header.boundingBox();
    const region = page.locator(".stoa-page-shell__scroll");
    await region.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    expect(await region.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await header.boundingBox()).toEqual(before);
    expect(await page.evaluate(() => [window.scrollY, document.documentElement.scrollHeight <= window.innerHeight])).toEqual([0, true]);
    const regionTop = await region.evaluate((el) => el.getBoundingClientRect().top);
    expect(regionTop).toBeGreaterThanOrEqual(before!.y + before!.height - 0.5);
    const log = page.locator(".log .stoa-code__scroll");
    expect(await log.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const tokens = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.color = "var(--stoa-color-scrollbar-thumb)";
      probe.style.backgroundColor = "var(--stoa-color-scrollbar-track)";
      document.body.append(probe);
      const style = getComputedStyle(probe);
      const value = `${style.color} ${style.backgroundColor}`;
      probe.remove();
      return value;
    });
    for (const scroller of [region, log]) {
      const style = await scroller.evaluate((el) => [getComputedStyle(el).scrollbarColor, getComputedStyle(el).scrollbarWidth]);
      expect(style).toEqual([tokens, "thin"]);
    }
  });
