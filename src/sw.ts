/// <reference lib="webworker" />
// The Service Worker: the run's server, inside the browser. It answers the
// engine's stream requests (`<base>api/agent?plan=...`) with server-sent
// events and lets every other request through to the network.
//
// It takes control at once: skipWaiting on install, so a new version does
// not wait for every tab to close, and clients.claim on activate, so the
// page that registered it is controlled without a reload. A page loaded
// with a forced reload is not controlled even when the worker is active;
// it asks with a "claim" message.
import { createAgentHandler, handleAgentRequest } from "ariadne-runner/sse";
import { timeScaleOf } from "./scale";

declare const self: ServiceWorkerGlobalScope;

type Handler = (request: Request) => Response | null;
const scaled = new Map<number, Handler>();

function handlerFor(scale: number | null): Handler {
  if (scale === null) return handleAgentRequest;
  let handler = scaled.get(scale);
  if (!handler) {
    handler = createAgentHandler({ timeScale: scale });
    scaled.set(scale, handler);
  }
  return handler;
}

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data: unknown = event.data;
  if (data && typeof data === "object" && (data as { type?: unknown }).type === "claim") {
    event.waitUntil(self.clients.claim());
  }
});

self.addEventListener("fetch", (event) => {
  const scale = timeScaleOf(new URL(event.request.url).searchParams);
  const response = handlerFor(scale)(event.request);
  if (response) event.respondWith(response);
});
