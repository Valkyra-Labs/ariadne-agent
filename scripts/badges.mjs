// Shields.io endpoint badges from what CI measured on this commit.
//
// Usage (CI runs it after the tests; see .github/workflows/ci.yml):
//   node scripts/badges.mjs --out <dir>
//     --unit <log of `pnpm test`>
//     --e2e <Playwright JSON report>
//     --lighthouse-desktop <Lighthouse JSON> --lighthouse-mobile <Lighthouse JSON>
//     --dist dist
//
// Each badge is one JSON file, {"schemaVersion":1,"label","message","color"},
// which CI commits to the `badges` branch for img.shields.io/endpoint to
// read. A value that cannot be read, or a run that did not pass, stops the
// script with an error: a badge is never written from a guess. No
// dependencies: Node 18 or later.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

class BadgeError extends Error {}
const fail = (message) => {
  throw new BadgeError(message);
};

const read = (path) => {
  try {
    return readFileSync(path);
  } catch (e) {
    return fail(`cannot read ${path}: ${e.message}`);
  }
};
const readJson = (path) => {
  try {
    return JSON.parse(read(path).toString("utf8"));
  } catch (e) {
    if (e instanceof BadgeError) throw e;
    return fail(`${path} is not JSON: ${e.message}`);
  }
};

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const SUMMARY = (name) => new RegExp(`^\\s*${name}\\s+(.+?)\\s+\\((\\d+)\\)\\s*$`);

/** The counts on one Vitest summary line ("Test Files" or "Tests"); there
 * must be exactly one, and its parts must add up to its total. */
function vitestLine(lines, name, kinds) {
  const re = SUMMARY(name);
  const found = lines.filter((l) => re.test(l));
  if (found.length !== 1) fail(`expected one Vitest "${name}" summary in the unit test log, found ${found.length}`);
  const [, parts, total] = re.exec(found[0]);
  const counts = Object.fromEntries(kinds.map((k) => [k, 0]));
  for (const part of parts.split("|")) {
    const p = new RegExp(`^\\s*(\\d+) (${kinds.join("|")})\\s*$`).exec(part);
    if (!p) fail(`unrecognised Vitest summary: "${found[0].trim()}"`);
    counts[p[2]] += Number(p[1]);
  }
  if (Object.values(counts).reduce((a, b) => a + b, 0) !== Number(total)) fail(`Vitest summary does not add up: "${found[0].trim()}"`);
  return counts;
}

/** Counts from the one Vitest summary in the output of `pnpm test`. A test
 * file that failed to load counts as a failure even when no test in it
 * ran. */
export function parseVitest(text) {
  const lines = text.replace(ANSI, "").split(/\r?\n/);
  const files = vitestLine(lines, "Test Files", ["passed", "failed", "skipped"]);
  if (files.failed > 0) fail(`${files.failed} unit test file(s) failed`);
  const counts = vitestLine(lines, "Tests", ["passed", "failed", "skipped", "todo"]);
  if (counts.failed > 0) fail(`${counts.failed} unit test(s) failed`);
  if (counts.passed === 0) fail("no unit test passed");
  return { passed: counts.passed, skipped: counts.skipped + counts.todo };
}

/** Pass counts from a Playwright JSON report (reporter "json"). */
export function readPlaywright(report) {
  const s = report?.stats;
  if (!s || ![s.expected, s.unexpected, s.flaky, s.skipped].every(Number.isInteger)) fail("the e2e report has no Playwright stats");
  if (s.unexpected > 0) fail(`${s.unexpected} e2e test(s) failed`);
  if (s.expected + s.flaky === 0) fail("no e2e test passed");
  return { passed: s.expected, flaky: s.flaky, skipped: s.skipped };
}

function* playwrightTests(suite) {
  for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) yield { title: spec.title, ...test };
  for (const child of suite.suites ?? []) yield* playwrightTests(child);
}

/** The axe matrix, from the "axe-scan" annotations the e2e records: one
 * per scan, naming the language, the theme and the state of the screen. */
export function readAxe(report) {
  const scans = [];
  for (const suite of report.suites ?? []) {
    for (const test of playwrightTests(suite)) {
      const notes = (test.annotations ?? []).filter((a) => a.type === "axe-scan");
      if (notes.length === 0) continue;
      if (test.status !== "expected") fail(`axe test "${test.title}" did not pass`);
      for (const note of notes) scans.push(JSON.parse(note.description));
    }
  }
  if (scans.length === 0) fail("no axe scan in the e2e report");
  const distinct = (f) => new Set(scans.map(f)).size;
  const states = distinct((s) => s.state);
  const modes = distinct((s) => `${s.lang}/${s.theme}`);
  if (states * modes !== scans.length || distinct((s) => `${s.lang}/${s.theme}/${s.state}`) !== scans.length) {
    fail(`the axe scans are not a full matrix: ${scans.length} scans, ${states} states, ${modes} language and theme pairs`);
  }
  return { states, modes };
}

const CATEGORIES = { accessibility: "accessibility", "best-practices": "best practices", seo: "SEO" };

/** Lighthouse 12 category scores, 0 to 100, from one JSON report. */
export function readLighthouse(report, formFactor) {
  if (!String(report?.lighthouseVersion ?? "").startsWith("12.")) fail(`the ${formFactor} report is not from Lighthouse 12`);
  if (report.runtimeError) fail(`Lighthouse ${formFactor}: ${report.runtimeError.message ?? report.runtimeError.code}`);
  if (report.configSettings?.formFactor !== formFactor) fail(`the ${formFactor} report was run as ${report.configSettings?.formFactor}`);
  const scores = {};
  for (const id of Object.keys(CATEGORIES)) {
    const score = report.categories?.[id]?.score;
    if (typeof score !== "number") fail(`Lighthouse ${formFactor} has no ${id} score`);
    scores[id] = Math.round(score * 100);
  }
  return scores;
}

const lighthouseColor = (score) => (score >= 90 ? "brightgreen" : score >= 50 ? "orange" : "red");

/** gzip (level 9) of every JavaScript and CSS file the build wrote. */
export function bundleBytes(dist) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return fail(`cannot read ${dir}: ${e.message}`);
    }
    for (const e of entries) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (/\.(m?js|css)$/.test(e.name)) files.push(path);
    }
  };
  walk(dist);
  if (!files.some((f) => f.endsWith(".js"))) fail(`no JavaScript in ${dist}`);
  return files.reduce((n, f) => n + gzipSync(read(f), { level: 9 }).length, 0);
}
const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (!key || argv[i + 1] === undefined) fail(`expected --name value pairs, got "${argv.slice(i).join(" ")}"`);
    args[key] = argv[i + 1];
  }
  for (const key of ["out", "unit", "e2e", "lighthouse-desktop", "lighthouse-mobile", "dist"]) if (!args[key]) fail(`--${key} is required`);
  return args;
}

export function buildBadges(args) {
  const unit = parseVitest(read(args.unit).toString("utf8"));
  const report = readJson(args.e2e);
  const e2e = readPlaywright(report);
  const axe = readAxe(report);
  const desktop = readLighthouse(readJson(args["lighthouse-desktop"]), "desktop");
  const mobile = readLighthouse(readJson(args["lighthouse-mobile"]), "mobile");
  const extra = (skipped, flaky = 0) => `${skipped ? `, ${skipped} skipped` : ""}${flaky ? `, ${flaky} flaky` : ""}`;
  const badges = {
    "unit-tests": { label: "unit tests", message: `${unit.passed} passed${extra(unit.skipped)}`, color: "brightgreen" },
    e2e: { label: "e2e", message: `${e2e.passed} passed${extra(e2e.skipped, e2e.flaky)}`, color: e2e.flaky ? "yellow" : "brightgreen" },
    axe: { label: "axe", message: `0 serious, ${axe.states} states x ${axe.modes}`, color: "brightgreen" },
  };
  for (const [id, name] of Object.entries(CATEGORIES)) {
    const score = Math.min(desktop[id], mobile[id]);
    badges[`lighthouse-${id}`] = { label: `Lighthouse ${name} (min of desktop, mobile)`, message: String(score), color: lighthouseColor(score) };
  }
  badges["bundle-size"] = { label: "bundle gzip (JS + CSS)", message: kB(bundleBytes(args.dist)), color: "blue" };
  return badges;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const badges = buildBadges(args);
    mkdirSync(args.out, { recursive: true });
    for (const [name, { label, message, color }] of Object.entries(badges)) {
      const json = `${JSON.stringify({ schemaVersion: 1, label, message, color })}\n`;
      writeFileSync(join(args.out, `${name}.json`), json);
      process.stdout.write(`${name}.json ${json}`);
    }
  } catch (e) {
    if (!(e instanceof BadgeError)) throw e;
    console.error(`badges: ${e.message}`);
    process.exit(1);
  }
}
