# Ariadne

[![CI](https://github.com/Valkyra-Labs/ariadne-agent/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Valkyra-Labs/ariadne-agent/actions/workflows/ci.yml)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/License-MIT%20OR%20Apache--2.0-blue.svg)](#license)
[![Unit tests](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Valkyra-Labs/ariadne-agent/badges/unit-tests.json)](#badges)
[![e2e](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Valkyra-Labs/ariadne-agent/badges/e2e.json)](#badges)
[![axe](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Valkyra-Labs/ariadne-agent/badges/axe.json)](#badges)
[![Lighthouse accessibility](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Valkyra-Labs/ariadne-agent/badges/lighthouse-accessibility.json)](#badges)
[![Lighthouse best practices](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Valkyra-Labs/ariadne-agent/badges/lighthouse-best-practices.json)](#badges)
[![Lighthouse SEO](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Valkyra-Labs/ariadne-agent/badges/lighthouse-seo.json)](#badges)
[![Bundle gzip](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Valkyra-Labs/ariadne-agent/badges/bundle-size.json)](#badges)

The test, axe, Lighthouse and size badges are measured and published by
CI from `main`; what each one counts is under [Badges](#badges).

An agent run you can stop. Give the agent a task and say how much it may
do without asking; read its plan, reorder it, remove steps, mark the ones
that must ask first; run it and watch every step. Risky steps wait for
your confirmation with a draft of what they will do, a failed step waits
for Retry, Skip or Stop, the agent asks before it leaves the plan, Stop is
one key away at every moment, and what was done can be undone: internal
changes at any time, outgoing letters within a window that is counted
down on screen. A summary closes the run.

There is no model behind it. The agent is
[ariadne-runner](https://github.com/Valkyra-Labs/ariadne-runner), a
deterministic engine: a seeded scenario (twelve incoming supplier
requests), a consent rule, and a run that replays the same way from the
same plan and the same decisions. The page says so. The interface is
React and TypeScript on the [Stoa](https://github.com/Valkyra-Labs/stoa-system)
design system.

## How the run streams

The deployment is static: there is no server. The run streams as
server-sent events from a Service Worker in the browser (`src/sw.ts`,
built to `sw.js` at the base path), which answers the engine's request
shape with `ariadne-runner/sse`. The page owns the approved plan and the
decision log; each segment of the run is a request with both and the id of
the last event the page has, and ends at the next decision or at the end
of the run.

- First visit: the worker installs, takes over the page at once
  (`skipWaiting`, `clients.claim`) and the page waits for it before the
  first stream. A forced reload (Shift+Reload) loads the page without the
  worker; the page asks it to claim the page again.
- A new deployment of the worker takes over the open page as soon as the
  browser sees it; a stream that is open moves to the new worker and goes
  on after the last event.
- A dropped connection is resumed by the page with the engine's `after`
  parameter. In Chromium the request with which EventSource reconnects
  through a Service Worker carries no `Last-Event-ID`, so the browser's
  own reconnection would replay the segment from its start.
- Where service workers cannot run (a private window, a privacy setting),
  the page says so and offers to run the engine inside the tab.

Stop sends a stop decision placed after the last event seen. The engine
ends the run there: a step that is running finishes (it never cuts an
action in half) and no new step starts; a step waiting for a decision is
skipped at once. Pause is this application's: it closes the stream
between two events, and Resume opens the next segment after the last one.

## Using it

- Keys: R runs the plan, S stops, P pauses or resumes, ? lists the
  shortcuts. In a confirmation the focus is on the safe action (Skip step,
  Keep the plan), so an Enter pressed by habit does not confirm.
- Languages: English, Russian and Arabic (right to left, with
  Arabic-Indic digits). The engine sends codes only; every code has its
  words in all three languages, and the tests fail if one is missing.
- Theme: System (the default), Light or Dark.
- Link parameters: `?lang=en|ru|ar`, `?theme=system|light|dark` (both
  also kept in localStorage), `?seed=` (the scenario number), and for the
  stream `?speed=fast`, `?undoWindow=<seconds>`, `?drop=1` (cut the first
  segment once, to see a reconnection) and `?scale=<factor>` (multiplies
  every delay between events; 0 sends a segment at once).

## Development

Stoa and the engine are linked from sibling checkouts: clone
[stoa-system](https://github.com/Valkyra-Labs/stoa-system) and
[ariadne-runner](https://github.com/Valkyra-Labs/ariadne-runner) next to
this repository and build both (`pnpm build`).

```bash
pnpm install --frozen-lockfile
pnpm dev          # http://localhost:5177
pnpm build && pnpm preview   # the production build on http://localhost:4177
pnpm typecheck && pnpm test && pnpm e2e
pnpm measure      # docs/MEASUREMENTS.md
```

`pnpm e2e` builds the app and runs Playwright with axe-core against the
production build on port 4177, Service Worker included; `E2E_PORT`
moves it to another port, as CI does:

```bash
E2E_PORT=4181 pnpm e2e
```

### Badges

CI checks out this repository, stoa-system and ariadne-runner side by
side, builds the engine and Stoa, then builds and tests the app. Each
green run on `main` publishes the dynamic badges to the `badges` branch,
as JSON that img.shields.io reads; `scripts/badges.mjs` builds them from
that run's own output and stops, publishing nothing, when a value cannot
be read.

- Unit tests: Vitest tests passed (`pnpm test`).
- e2e: Playwright tests passed in Chromium against `vite preview` of the
  build, Service Worker included (`e2e/`).
- axe: axe-core 4.13.0 in the e2e, on each of the eight states listed
  under [Accessibility](#accessibility) in English, Russian and Arabic,
  light and dark; a serious or critical violation fails the run. The
  scans outside that matrix (in `e2e/agent.spec.ts` and
  `e2e/worker.spec.ts`) fail the run too but are not counted.
- Lighthouse: Lighthouse 12 accessibility, best practices and SEO scores
  for the home page served by `vite preview` with the built Service
  Worker, the lower of the desktop and mobile runs. Performance is not
  shown: on a shared CI runner it measures the runner.
- Bundle gzip: every JavaScript and CSS file in `dist/`, gzip level 9,
  summed, the Service Worker (`sw.js`) included. The fonts and
  `index.html` are not included.

## Accessibility

What the tests check, and nothing wider: axe-core finds no serious or
critical violation on the plan, a confirmation, a failed step with the
undo countdown, a stopped run with its summary and toasts, New plan asking
before it ends an open undo window, an empty plan, the run service
starting, and the run service failed, in English, Russian
and Arabic, light and dark (Chromium only). The main tasks are tested by
keyboard: editing the plan, running, confirming and skipping, retrying a
failed step, stopping from a confirmation, pausing and resuming. The
Arabic interface is right to left and has no Latin words outside the
language codes and the keys. No page scrolls sideways at 1280 and 375 px.
The header stays at the top while the page scrolls under it, and the
scrollbars are Stoa's. Status changes are announced politely and only at
the run's turns (started, stopping, stopped, finished, paused, resumed,
connection dropped); a confirmation and a failed step announce
themselves. Under reduced motion the undo countdown still counts, without
animating. Not tested: screen readers themselves, other browsers.

## Measurements

See [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md), with the commit, the
machine and the browser they were taken on.

## License

MIT OR Apache-2.0, at your option.
