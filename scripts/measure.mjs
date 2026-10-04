// Measurements for docs/MEASUREMENTS.md, in headless Chromium against the
// production build served by `vite preview` (port 5191). Every number is
// printed with its sample count, and the run is stamped with the commit,
// the machine and the browser.
//
//   node scripts/measure.mjs            all measurements
//   node scripts/measure.mjs --quick    fewer samples, for a smoke run
import { execSync, spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { cpus, totalmem, release, platform } from "node:os";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const QUICK = process.argv.includes("--quick");
const PORT = 5191;
const BASE = `http://localhost:${PORT}`;
const N = QUICK ? 5 : 30;
const N_LOAD = QUICK ? 5 : 20;

const sh = (cmd, env = {}) => execSync(cmd, { encoding: "utf8", env: { ...process.env, ...env } }).trim();

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  const r = (v) => Math.round(v * 10) / 10;
  return { n: sorted.length, median: r(at(0.5)), p95: r(at(0.95)), min: r(sorted[0]), max: r(sorted.at(-1)) };
}

// A fixed sequence of delays, so two runs of the script press Stop at the
// same moments.
let seed = 12345;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

const commit = sh("git rev-parse --short HEAD");
const dirty = sh("git status --porcelain") !== "";

console.log("Building the app and the bench page...");
sh("pnpm exec vite build", { GITHUB_PAGES: "" });
const bundle = {};
for (const file of readdirSync("dist/assets").filter((f) => /\.(js|css)$/.test(f)).map((f) => `dist/assets/${f}`).concat("dist/sw.js")) {
  const bytes = readFileSync(file);
  bundle[file.replace(/-[\w-]{8}\./, ".")] = { raw: statSync(file).size, gzip: gzipSync(bytes).length };
}
sh("pnpm exec vite build", { ARIADNE_BENCH: "1" });

const server = spawn("pnpm", ["exec", "vite", "preview", "--outDir", "dist-bench", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
await new Promise((resolve, reject) => {
  const started = Date.now();
  const poll = () =>
    fetch(BASE)
      .then(resolve)
      .catch(() => (Date.now() - started > 20_000 ? reject(new Error("preview did not start")) : setTimeout(poll, 200)));
  poll();
});

const browser = await chromium.launch();
const results = { commit, dirty, machine: `${cpus()[0]?.model} (${cpus().length} cores), ${Math.round(totalmem() / 2 ** 30)} GB, ${platform()} ${release()}`, node: process.version, chromium: browser.version(), bundle };

const mark = (page, name) => page.evaluate((n) => performance.getEntriesByName(`ariadne:${n}`).at(-1)?.startTime ?? null, name);
const between = async (page, from, to) => {
  const a = await mark(page, from);
  const b = await mark(page, to);
  return a === null || b === null ? null : b - a;
};
const runButton = (page) => page.getByRole("button", { name: "Run plan" });

try {
  // First load: a new browser context each time (no worker, cold cache).
  const firstLoad = { fcp: [], register: [], controlledFromNav: [] };
  for (let i = 0; i < N_LOAD; i += 1) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE + "/");
    await runButton(page).isEnabled();
    await page.waitForFunction(() => performance.getEntriesByName("ariadne:sw-controlled").length > 0);
    firstLoad.fcp.push(await page.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? NaN));
    firstLoad.register.push(await between(page, "sw-register", "sw-controlled"));
    firstLoad.controlledFromNav.push(await mark(page, "sw-controlled"));
    await ctx.close();
  }
  // Reload: the worker is installed and controls the page from the start.
  const reload = { fcp: [], register: [] };
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE + "/");
    await page.waitForFunction(() => performance.getEntriesByName("ariadne:sw-controlled").length > 0);
    for (let i = 0; i < N_LOAD; i += 1) {
      await page.reload();
      await page.waitForFunction(() => performance.getEntriesByName("ariadne:sw-controlled").length > 0);
      reload.fcp.push(await page.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? NaN));
      reload.register.push(await between(page, "sw-register", "sw-controlled"));
    }
    await ctx.close();
  }
  results.firstLoad = { fcp: stats(firstLoad.fcp), swRegisterToControlled: stats(firstLoad.register), navigationToControlled: stats(firstLoad.controlledFromNav) };
  results.reload = { fcp: stats(reload.fcp), swRegisterToControlled: stats(reload.register) };

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + "/");
  await page.waitForFunction(() => performance.getEntriesByName("ariadne:sw-controlled").length > 0);
  const newPlan = async () => {
    await page.getByRole("button", { name: "New plan" }).click();
    await page.locator('.layout[data-plan-state="draft"]').waitFor();
  };
  const stopped = () => page.locator('.layout[data-plan-state="stopped"]').waitFor({ timeout: 20_000 });

  // Run to the first event in the DOM, at the engine's normal speed.
  const firstEvent = [];
  for (let i = 0; i < N; i += 1) {
    await runButton(page).click();
    await page.waitForFunction(() => performance.getEntriesByName("ariadne:first-event").length > 0 && performance.getEntriesByName("ariadne:first-event").at(-1).startTime > performance.getEntriesByName("ariadne:run").at(-1).startTime);
    firstEvent.push(await between(page, "run", "first-event"));
    await page.keyboard.press("s");
    await stopped();
    await newPlan();
  }
  results.runToFirstEvent = stats(firstEvent);

  // Stop while a step runs (autonomy "only when required", so the first
  // steps run without asking), pressed after a delay between 0.1 and 1.4 s.
  await page.getByRole("radio", { name: "Ask only when required" }).click();
  const stopRunning = [];
  const eventsAfterStop = [];
  for (let i = 0; i < N; i += 1) {
    await runButton(page).click();
    await page.waitForTimeout(100 + random() * 1300);
    const before = await page.evaluate(() => document.querySelectorAll(".log .stoa-code__line").length);
    await page.keyboard.press("s");
    await stopped();
    stopRunning.push(await between(page, "stop", "stopped"));
    const lines = await page.evaluate(() => [...document.querySelectorAll(".log .stoa-code__line")].map((l) => l.textContent ?? ""));
    const at = lines.findIndex((l) => l.includes("You asked to stop."));
    eventsAfterStop.push(lines.length - at - 1);
    void before;
    await newPlan();
  }
  results.stopWhileRunning = { ms: stats(stopRunning), loggedEventsAfterStop: stats(eventsAfterStop) };

  // Stop at a confirmation (the run waits; the step is skipped at once).
  await page.getByRole("radio", { name: "Ask for marked steps" }).click();
  const stopPause = [];
  for (let i = 0; i < N; i += 1) {
    await runButton(page).click();
    await page.locator('section.stoa-dialog[role="alertdialog"]').waitFor({ timeout: 20_000 });
    await page.keyboard.press("s");
    await stopped();
    stopPause.push(await between(page, "stop", "stopped"));
    await newPlan();
  }
  results.stopAtConfirmation = stats(stopPause);
  await ctx.close();

  // Throughput: the bench page renders the run view at fixed event rates.
  const bench = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await bench.goto(BASE + "/bench.html");
  await bench.waitForFunction(() => "ariadneBench" in window);
  const idle = await bench.evaluate(() => window.ariadneBench.idle(3));
  const refresh = stats(idle).median;
  results.throughput = { idleFrameMs: stats(idle), rates: [] };
  for (const rate of QUICK ? [100, 800] : [50, 100, 200, 400, 800, 1600, 3200]) {
    const r = await bench.evaluate(([rate, seconds]) => window.ariadneBench.measure(rate, seconds), [rate, QUICK ? 2 : 5]);
    const dropped = r.frames.filter((f) => f > refresh * 1.5).length;
    results.throughput.rates.push({
      target: rate,
      deliveredPerSecond: Math.round(r.delivered / r.seconds),
      // Events posted but not yet handled when the window closed.
      backlog: r.posted - r.delivered,
      frames: r.frames.length,
      frameMs: stats(r.frames),
      droppedFrames: dropped,
      droppedShare: Math.round((dropped / Math.max(1, r.frames.length)) * 1000) / 10,
      longTasks: r.longTasks.length,
      longestTaskMs: r.longTasks.length ? Math.round(Math.max(...r.longTasks)) : 0,
    });
  }
} finally {
  await browser.close();
  server.kill();
}

console.log(JSON.stringify(results, null, 2));
