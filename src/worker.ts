// Starting the Service Worker that streams the run, and waiting until it
// controls this page: only a controlled page's requests reach it, so the
// first stream must not open before. Three ways a page starts:
//
// - First visit: the worker installs, activates and claims the page
//   (controllerchange).
// - Reload: the page is controlled from its first request.
// - Forced reload (Shift+Reload): the page bypasses the worker and is not
//   controlled although the worker is active; the page asks it to claim.
//
// Later, when a new version of the worker is deployed, the browser installs
// it on a navigation or an update check, and it takes over at once
// (skipWaiting, then claim): `onChange` reports it, and the session reopens
// an open stream on the new worker, which replays the run from the plan and
// the decisions and goes on after the last event the page has.
import { mark } from "./marks";

export type WorkerError = "sw_unsupported" | "sw_registration_failed" | "sw_not_controlling";

export const WORKER_ERRORS: readonly WorkerError[] = ["sw_unsupported", "sw_registration_failed", "sw_not_controlling"];

export type WorkerStart =
  | { ok: true; how: "claimed" | "controlled" | "reclaimed"; registration: ServiceWorkerRegistration }
  | { ok: false; error: WorkerError; detail?: string };

/** How long the page waits for the worker to take control. */
export const CONTROL_TIMEOUT_MS = 10_000;

function controlled(container: ServiceWorkerContainer, timeoutMs: number): Promise<boolean> {
  if (container.controller) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (value: boolean) => {
      clearTimeout(timer);
      container.removeEventListener("controllerchange", onChange);
      resolve(value);
    };
    const onChange = () => done(true);
    const timer = setTimeout(() => done(container.controller !== null), timeoutMs);
    container.addEventListener("controllerchange", onChange);
  });
}

/** Registers the worker at `<base>sw.js` and resolves once it controls the
 * page, or with the reason it does not. */
export async function startWorker(base: string, timeoutMs = CONTROL_TIMEOUT_MS): Promise<WorkerStart> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return { ok: false, error: "sw_unsupported" };
  const container = navigator.serviceWorker;
  const wasControlled = container.controller !== null;
  mark("sw-register");
  let registration: ServiceWorkerRegistration;
  try {
    registration = await container.register(`${base}sw.js`, { scope: base, updateViaCache: "none" });
  } catch (error) {
    return { ok: false, error: "sw_registration_failed", detail: String(error) };
  }
  if (wasControlled) {
    mark("sw-controlled");
    return { ok: true, how: "controlled", registration };
  }
  // Active from the start with nothing installing: the worker was there
  // before this page, which a forced reload left uncontrolled. Ask it to
  // claim the page; claiming a page twice is harmless.
  const active = registration.active;
  const reclaimed = active !== null && registration.installing === null && registration.waiting === null && !container.controller;
  if (reclaimed) active.postMessage({ type: "claim" });
  if (!(await controlled(container, timeoutMs))) return { ok: false, error: "sw_not_controlling" };
  mark("sw-controlled");
  return { ok: true, how: reclaimed ? "reclaimed" : "claimed", registration };
}

/** Calls `onChange` each time a new worker takes control of this page,
 * after it was first controlled. Returns the unsubscribe function. */
export function watchWorker(onChange: () => void): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => {};
  const container = navigator.serviceWorker;
  container.addEventListener("controllerchange", onChange);
  return () => container.removeEventListener("controllerchange", onChange);
}
