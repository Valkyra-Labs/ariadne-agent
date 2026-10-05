// One agent session: the engine's plan machine and the stream that feeds it.
//
// The page owns the approved plan and the ordered decision log; the stream
// is stateless. Each segment is opened with the plan, the log and the id of
// the last event the page has, and ends at the next decision the log does
// not hold or at the end of the run. A decision goes to the plan machine at
// once (so the interface never waits for the network) and opens the next
// segment. Stop is a decision too: it reopens the stream with "stop" placed
// after the last event seen, and the engine ends the run there: a step that
// is running finishes (an action is never cut in half), no new step starts.
//
// Pause is this application's, not the engine's: it closes the open segment
// between two events, and Resume opens the next one after the last event,
// so nothing is lost and nothing runs twice.
import { createActor, type Actor } from "xstate";
import {
  canDecide,
  encodeDecisions,
  encodePlanPayload,
  planMachine,
  type Autonomy,
  type Decidable,
  type Decision,
  type RunEvent,
  type WaitingNotice,
} from "ariadne-runner";
import { RETRY_MS } from "ariadne-runner/sse";
import { mark } from "./marks";
import type { Segment, StreamError, Transport, TransportKind } from "./transport";

export type StreamStatus =
  /** No run yet, or the run was reset. */
  | "idle"
  /** A segment was requested and has not answered yet. */
  | "connecting"
  /** Events are arriving. */
  | "streaming"
  /** The person paused between events; no segment is open. */
  | "paused"
  /** The run waits for the person's decision; no segment is open. */
  | "waiting"
  /** The connection dropped; the next segment opens shortly. */
  | "reconnecting"
  /** A segment failed; Retry opens it again. */
  | "failed"
  /** The run finished or stopped. */
  | "ended";

export type SessionSnapshot = {
  status: StreamStatus;
  failure: StreamError | null;
  /** The step and commands of the decision the run waits for. */
  waiting: WaitingNotice | null;
  lastEventId: number;
  transport: TransportKind | null;
  /** Times a new worker took over while this session was open. */
  workerChanges: number;
};

export type SessionNotice =
  /** A finished step can be undone until `deadline` (a time in ms). */
  | { kind: "undoable"; stepId: string; deadline: number }
  | { kind: "reconnected" };

export type SessionOptions = {
  seed: number;
  autonomy?: Autonomy;
  /** Extra stream parameters (speed, drop, undoWindow, scale). */
  streamParams?: URLSearchParams;
  now?: () => number;
};

export type PlanActor = Actor<typeof planMachine>;

/** Drops in a row, with no event between them, before the session gives up. */
export const MAX_DROPS = 5;

let sessions = 0;
function sessionId(): string {
  sessions += 1;
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "") ?? Math.random().toString(36).slice(2);
  return `${random}${sessions}`;
}

export class RunSession {
  readonly plan: PlanActor;
  #transport: Transport | null = null;
  #segment: Segment | null = null;
  #decisions: Decision[] = [];
  #pendingStop = false;
  #reconnecting = false;
  #drops = 0;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #snapshot: SessionSnapshot = {
    status: "idle",
    failure: null,
    waiting: null,
    lastEventId: 0,
    transport: null,
    workerChanges: 0,
  };
  readonly #listeners = new Set<() => void>();
  readonly #notices = new Set<(notice: SessionNotice) => void>();
  readonly #streamParams: URLSearchParams;
  readonly #now: () => number;

  constructor({ seed, autonomy, streamParams, now }: SessionOptions) {
    this.plan = createActor(planMachine, { input: autonomy ? { seed, autonomy } : { seed } }).start();
    this.#streamParams = streamParams ?? new URLSearchParams();
    this.#now = now ?? Date.now;
  }

  // Subscription, for useSyncExternalStore.
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  getSnapshot = (): SessionSnapshot => this.#snapshot;
  onNotice(listener: (notice: SessionNotice) => void): () => void {
    this.#notices.add(listener);
    return () => this.#notices.delete(listener);
  }

  #set(patch: Partial<SessionSnapshot>) {
    this.#snapshot = { ...this.#snapshot, ...patch };
    for (const listener of this.#listeners) listener();
  }
  #notify(notice: SessionNotice) {
    for (const listener of this.#notices) listener(notice);
  }

  get decisions(): readonly Decision[] {
    return this.#decisions;
  }

  setTransport(transport: Transport) {
    this.#transport = transport;
    this.#set({ transport: transport.kind });
  }

  /** The query of the next segment: plan, decisions, the last event. */
  query(): URLSearchParams {
    const ctx = this.plan.getSnapshot().context;
    const askFirst = new Map(ctx.steps.map((s) => [s.id, s.askFirst]));
    const params = new URLSearchParams(this.#streamParams);
    params.set(
      "plan",
      encodePlanPayload({
        seed: ctx.seed,
        autonomy: ctx.autonomy,
        steps: ctx.order.map((id) => ({ id, askFirst: askFirst.get(id) ?? false })),
      }),
    );
    if (this.#decisions.length > 0) params.set("decisions", encodeDecisions(this.#decisions));
    const after = this.#snapshot.lastEventId;
    if (after > 0) params.set("after", String(after));
    return params;
  }

  #close() {
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#segment?.close();
    this.#segment = null;
  }

  #open(resuming = false) {
    this.#close();
    const transport = this.#transport;
    if (!transport) return;
    this.#reconnecting = resuming;
    if (!resuming) this.#drops = 0;
    this.#set({ status: resuming ? "reconnecting" : "connecting", failure: null, waiting: null });
    const segment: Segment = transport.open(this.query(), {
      onOpen: () => {
        if (this.#segment !== segment) return;
        if (this.#reconnecting) {
          this.#reconnecting = false;
          this.#notify({ kind: "reconnected" });
        }
        if (this.#snapshot.status === "connecting" || this.#snapshot.status === "reconnecting") this.#set({ status: "streaming" });
      },
      onEvent: (id, event) => {
        if (this.#segment !== segment) return;
        this.#receive(id, event);
      },
      onWaiting: (notice) => {
        if (this.#segment !== segment) return;
        this.#segment = null;
        this.#set({ status: "waiting", waiting: notice });
      },
      onDropped: () => {
        if (this.#segment !== segment) return;
        this.#segment = null;
        this.#drops += 1;
        if (this.#drops > MAX_DROPS) {
          this.#set({ status: "failed", failure: "stream_lost" });
          return;
        }
        // The next segment, after the last event the page has; a little
        // later each time, as EventSource would.
        this.#set({ status: "reconnecting" });
        this.#retryTimer = setTimeout(() => {
          this.#retryTimer = null;
          if (this.#snapshot.status === "reconnecting") this.#open(true);
        }, RETRY_MS * this.#drops);
      },
      onFailed: (error) => {
        if (this.#segment !== segment) return;
        this.#segment = null;
        this.#set({ status: "failed", failure: error });
      },
    });
    this.#segment = segment;
  }

  #receive(id: number, event: RunEvent) {
    // A resumed segment never repeats an event; this keeps it so if one did.
    if (id <= this.#snapshot.lastEventId) return;
    this.#drops = 0;
    const at = this.#now();
    this.plan.send({ type: "RUN_EVENT", event, at });
    if (event.type === "plan.started" && this.#pendingStop) {
      this.#pendingStop = false;
      this.plan.send({ type: "STOP", at });
    }
    if (event.type === "step.finished" && event.result.undoWindowSec !== null) {
      this.#notify({ kind: "undoable", stepId: event.stepId, deadline: at + event.result.undoWindowSec * 1000 });
    }
    const ended = event.type === "plan.finished" || event.type === "plan.stopped";
    if (ended) this.#close();
    this.#set({ lastEventId: id, status: ended ? "ended" : "streaming" });
  }

  /** Approves the plan and opens the first segment. */
  start() {
    if (!this.plan.getSnapshot().can({ type: "APPROVE", sessionId: "", at: 0 })) return;
    mark("run");
    this.#decisions = [];
    this.#pendingStop = false;
    this.#set({ lastEventId: 0, failure: null, waiting: null });
    this.plan.send({ type: "APPROVE", sessionId: sessionId(), at: this.#now() });
    this.#open();
  }

  /** A decision on the step the run waits at. False when the step is no
   * longer at the point this decision answers (a repeated press, a stale
   * dialog): such a decision would shift every later one in the log. */
  decide(stepId: string, command: Decidable): boolean {
    const at = this.#now();
    const ref = this.plan.getSnapshot().context.stepRefs[stepId];
    if (!ref || !canDecide(ref, command, at)) return false;
    if (this.plan.getSnapshot().context.stopRequested) return false;
    this.#decisions = [...this.#decisions, { command, stepId, afterEventId: this.#snapshot.lastEventId }];
    this.plan.send({ type: "DECIDE", stepId, command, at });
    this.#open();
    return true;
  }

  /** Stop was asked for and the run has not ended yet: the step in
   * progress finishes, no new one starts. */
  isStopping(): boolean {
    const snapshot = this.plan.getSnapshot();
    if (snapshot.matches("stopped") || snapshot.matches("finished")) return false;
    return this.#pendingStop || snapshot.context.stopRequested;
  }

  canStop(): boolean {
    const snapshot = this.plan.getSnapshot();
    return (snapshot.matches("running") || snapshot.matches("approved")) && !snapshot.context.stopRequested && !this.#pendingStop;
  }

  /** Stops the run after the step in progress. */
  stop(): boolean {
    if (!this.canStop()) return false;
    mark("stop");
    const at = this.#now();
    this.#decisions = [...this.#decisions, { command: "stop", stepId: null, afterEventId: this.#snapshot.lastEventId }];
    // Before plan.started the machine is not running yet and would drop
    // STOP; it is sent as soon as the run starts.
    if (this.plan.getSnapshot().matches("running")) this.plan.send({ type: "STOP", at });
    else this.#pendingStop = true;
    this.#open();
    return true;
  }

  canPause(): boolean {
    const status = this.#snapshot.status;
    return status === "streaming" || status === "connecting" || status === "reconnecting";
  }

  pause(): boolean {
    if (!this.canPause()) return false;
    this.#close();
    this.#set({ status: "paused" });
    return true;
  }

  resume(): boolean {
    if (this.#snapshot.status !== "paused") return false;
    this.#open();
    return true;
  }

  /** Opens the failed segment again. */
  retry(): boolean {
    if (this.#snapshot.status !== "failed") return false;
    this.#open();
    return true;
  }

  /** A new worker took over: an open segment is reopened on it. */
  workerChanged() {
    this.#set({ workerChanges: this.#snapshot.workerChanges + 1 });
    if (this.#segment && this.#transport?.kind === "worker") this.#open();
  }

  undo(stepId: string): boolean {
    const at = this.#now();
    const snapshot = this.plan.getSnapshot();
    if (!snapshot.can({ type: "UNDO", stepId, at })) return false;
    this.plan.send({ type: "UNDO", stepId, at });
    return true;
  }

  /** Back to a fresh plan for the same scenario. */
  reset() {
    this.#close();
    this.#decisions = [];
    this.#pendingStop = false;
    this.plan.send({ type: "RESET", at: this.#now() });
    this.#set({ status: "idle", failure: null, waiting: null, lastEventId: 0 });
  }

  dispose() {
    this.#close();
    this.plan.stop();
  }
}
