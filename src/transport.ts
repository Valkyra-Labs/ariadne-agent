// How one segment of the run reaches the page.
//
// - "worker": an EventSource on `<base>api/agent`, answered by the Service
//   Worker (src/sw.ts). A dropped connection is resumed by the browser with
//   Last-Event-ID; a request the engine refuses is answered with JSON and an
//   error code, which EventSource cannot read, so the page asks again with
//   fetch to learn the code.
// - "page": the engine's in-process transport, in this tab, for a browser
//   where the worker cannot run. Same segments, same events.
import { REQUEST_ERRORS, RUN_EVENT_TYPES, WAITING_EVENT, connectInProcess, type RequestError, type RunEvent, type WaitingNotice } from "ariadne-runner";
import { timeScaleOf } from "./scale";

/** Why a segment ended without its last frame: an error code from the
 * engine, or the connection lost for another reason. */
export type StreamError = RequestError | "stream_lost";

export const STREAM_ERRORS: readonly StreamError[] = [...REQUEST_ERRORS, "stream_lost"];

export type SegmentHandlers = {
  onOpen(): void;
  onEvent(id: number, event: RunEvent): void;
  /** The segment reached a decision the page has not made; it has ended. */
  onWaiting(notice: WaitingNotice): void;
  /** The connection dropped; the browser is reconnecting. */
  onReconnecting(): void;
  /** The segment failed and will not resume by itself. */
  onFailed(error: StreamError): void;
};

export type Segment = { close(): void };

export type TransportKind = "worker" | "page";

export type Transport = {
  kind: TransportKind;
  open(query: URLSearchParams, handlers: SegmentHandlers): Segment;
};

const isRequestError = (value: unknown): value is RequestError =>
  typeof value === "string" && (REQUEST_ERRORS as readonly string[]).includes(value);

/** The engine's error code for a refused request, read from its JSON
 * answer; "stream_lost" when the answer is anything else. */
export async function readStreamError(url: string, fetcher: typeof fetch = fetch): Promise<StreamError> {
  try {
    const controller = new AbortController();
    const response = await fetcher(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
      controller.abort();
      return "stream_lost";
    }
    const body: unknown = await response.json();
    const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
    return isRequestError(error) ? error : "stream_lost";
  } catch {
    return "stream_lost";
  }
}

function parse<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/** Segments from the Service Worker, over EventSource. */
export function workerTransport(endpoint: string): Transport {
  return {
    kind: "worker",
    open(query, handlers) {
      const url = `${endpoint}?${query.toString()}`;
      const source = new EventSource(url);
      let closed = false;
      const close = () => {
        closed = true;
        source.close();
      };
      source.onopen = () => {
        if (!closed) handlers.onOpen();
      };
      source.onerror = () => {
        if (closed) return;
        if (source.readyState === EventSource.CLOSED) {
          close();
          void readStreamError(url).then((error) => handlers.onFailed(error));
        } else {
          handlers.onReconnecting();
        }
      };
      const onEvent = (raw: Event) => {
        if (closed) return;
        const message = raw as MessageEvent<string>;
        const event = parse<RunEvent>(message.data);
        const id = Number(message.lastEventId);
        if (event && Number.isInteger(id) && id > 0) handlers.onEvent(id, event);
      };
      for (const type of RUN_EVENT_TYPES) source.addEventListener(type, onEvent);
      source.addEventListener(WAITING_EVENT, (raw) => {
        if (closed) return;
        const notice = parse<WaitingNotice>((raw as MessageEvent<string>).data);
        close();
        if (notice) handlers.onWaiting(notice);
        else handlers.onFailed("stream_lost");
      });
      return { close };
    },
  };
}

/** Segments from the engine running in this tab. */
export function pageTransport(): Transport {
  return {
    kind: "page",
    open(query, handlers) {
      const controller = new AbortController();
      const scale = timeScaleOf(query);
      const result = connectInProcess(query, { signal: controller.signal }, scale === null ? {} : { timeScale: scale });
      if (!result.ok) {
        const error = result.error;
        queueMicrotask(() => {
          if (!controller.signal.aborted) handlers.onFailed(error);
        });
        return { close: () => controller.abort() };
      }
      const items = result.items;
      void (async () => {
        // Handlers run after open() has returned, as they do for EventSource.
        await Promise.resolve();
        if (controller.signal.aborted) return;
        handlers.onOpen();
        try {
          for await (const item of items) {
            if (controller.signal.aborted) return;
            if (item.kind === "event") handlers.onEvent(item.id, item.event);
            else {
              handlers.onWaiting(item.notice);
              return;
            }
          }
        } catch {
          if (!controller.signal.aborted) handlers.onFailed("stream_lost");
        }
      })();
      return { close: () => controller.abort() };
    },
  };
}
