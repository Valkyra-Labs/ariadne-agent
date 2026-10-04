# Measurements

Every number here comes from `node scripts/measure.mjs` (`pnpm measure`),
taken on commit `666da5b` with a clean tree, on 2026-10-04.

- Machine: Apple M4 Pro (12 cores), 24 GB, macOS (Darwin 25.6.0).
- Browser: Playwright's headless Chromium 153.0.8010.12, viewport
  1280 x 720 (the bench page 1440 x 900); Node v22.18.0.
- Build: `vite build` (production, minified), served by `vite preview` on
  localhost; the bench page comes from a second build with
  `ARIADNE_BENCH=1`, which adds `bench.html` and changes nothing else.
- Engine: ariadne-runner `26f4de2`, linked; Stoa `components/batch-1`
  built in place (linked).

Statistics: the median and the 95th percentile by nearest rank, with the
sample count. Times are from `performance.mark` calls in the app
(`src/marks.ts`); a mark that says "in the DOM" is set in a React effect
after the commit that renders it, which is after the DOM changed and not
necessarily after the browser painted it.

## Bundle

| file | raw | gzip |
|---|---|---|
| `assets/index.js` (app, React, React Aria, Stoa, XState, the engine) | 801,867 B | 230,499 B |
| `assets/index.css` (Stoa and the app) | 81,074 B | 17,657 B |
| `sw.js` (the Service Worker with the engine's stream handler) | 13,545 B | 4,847 B |

Gzip is Node's zlib at its default level, over the built files; it is not
what a given server sends. Fonts are not counted (they load per script and
weight as the page needs them).

## First render and the Service Worker

| measure | n | median | p95 |
|---|---|---|---|
| First visit: first contentful paint (from navigation start) | 20 | 96 ms | 104 ms |
| First visit: worker registered to page controlled (`sw-register` to `sw-controlled`: install, activate, claim) | 20 | 30.2 ms | 35.1 ms |
| First visit: navigation start to page controlled (Run can be pressed) | 20 | 88.5 ms | 93.6 ms |
| Reload: first contentful paint | 20 | 48 ms | 56 ms |
| Reload: `register()` call to its resolution (the page is controlled from its first request) | 20 | 17.4 ms | 19.6 ms |

A first visit is a new browser context each time: no worker, an empty
cache, the server on the same machine. Not measured: a real network, a
slow device, a cold browser start.

## Run and Stop

| measure | n | median | p95 |
|---|---|---|---|
| Run pressed to the first event in the DOM (normal speed) | 30 | 16.4 ms | 17.1 ms |
| Stop pressed while a step runs, to the stopped run in the DOM | 30 | 445.6 ms | 752.5 ms |
| Events logged between that Stop and the end (the rest of the step, and the stop) | 30 | 2 | 3 |
| Stop pressed at a confirmation, to the stopped run in the DOM | 30 | 15.2 ms | 19.0 ms |

Run to first event covers the approval, the EventSource request, the
worker replaying the plan and sending `plan.started` (the engine puts no
delay before it), the plan machine and React. Stop while running is
pressed 0.1 to 1.4 s after Run (a fixed pseudo-random sequence), with
autonomy "Ask only when required", so the first two steps run without
asking. Its time is mostly the engine's rule, not the interface: the step
in progress finishes before the run ends (300 to 900 ms per step at
normal speed), so the time depends on where in the step Stop lands. At a
confirmation nothing is running, and the engine ends the run on the next
request. What these do not show: other speeds, other plans, a busy page.

## Event throughput

The bench page renders the app's run view and log (RunPanel and LogPanel
on the engine's plan machine) and feeds them the 73 events of a complete
run of scenario 7 over and over, each event in its own task (a
MessageChannel message, as EventSource delivers one task per event), at a
fixed rate for 5 s. A frame is dropped when its interval exceeds 1.5 times
the idle median (16.7 ms over 3 s idle, 178 frames). The bench leaves out
the stream (the worker and EventSource parsing) and the confirmation
dialogs (decisions are applied at once).

| target events/s | delivered/s | frames | frame median | frame p95 | dropped |
|---|---|---|---|---|---|
| 50 | 50 | 298 | 16.7 ms | 16.7 ms | 0 |
| 100 | 100 | 298 | 16.7 ms | 16.7 ms | 0 |
| 200 | 200 | 298 | 16.7 ms | 16.8 ms | 0 |
| 400 | 400 | 298 | 16.7 ms | 16.8 ms | 0 |
| 800 | 800 | 299 | 16.7 ms | 16.8 ms | 0 |
| 1600 | 1599 | 298 | 16.7 ms | 16.8 ms | 0 |
| 3200 | 2692 | 76 | 83.3 ms | 100.1 ms | 54 (71%) |

The interface kept up with 1,600 events a second with no dropped frame on
this machine; at a target of 3,200 it fell behind (2,692 handled a second,
most frames dropped). No long task (over 50 ms) was reported at any rate:
at 3,200 the frames starve because the event tasks never stop, not because
one of them is long. For scale, a run at the engine's normal speed sends
about 9 events a second while it streams (73 events over about 8 s of
step time for scenario 7), and at `speed=fast` about 45. Not measured: a
slower machine, a headed browser, the Arabic layout, the full page with
dialogs and toasts.
