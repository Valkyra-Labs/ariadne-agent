// Throughput bench: how many run events a second the interface renders
// without dropping frames. Built only with ARIADNE_BENCH=1 (bench.html),
// never shipped. It renders the app's own run view and log (RunPanel and
// LogPanel, on the engine's plan machine) and feeds them the events of a
// complete run, over and over, each event in its own task as EventSource
// delivers them, at a fixed rate. What it leaves out: the stream itself
// (the Service Worker and EventSource parsing) and the confirmation
// dialogs (decisions are sent at once, as if answered instantly).
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { useSelector } from "@xstate/react";
import { I18nProvider } from "@valkyra-labs/stoa-react";
import { createActor } from "xstate";
import { generatePlan, planMachine, type Decision, type RunEvent } from "ariadne-runner";
import "@valkyra-labs/stoa-tokens/tokens.css";
import "./styles.css";
import { makeFmt } from "./format";
import { fullRun } from "./fullRun";
import { LOCALES, strings } from "./i18n";
import type { SessionSnapshot } from "./session";
import { useRunSteps } from "./ui/hooks";
import { RunPanel } from "./ui/RunPanel";
import { LogPanel } from "./ui/SidePanels";

const plan = createActor(planMachine, { input: { seed: 7 } }).start();
const run = fullRun(generatePlan(7), "high_only");
const x = { t: strings.en, f: makeFmt(LOCALES.en) };
const SNAPSHOT: SessionSnapshot = { status: "streaming", failure: null, waiting: null, lastEventId: 0, transport: "page", workerChanges: 0 };

type Step = { kind: "event"; id: number; event: RunEvent } | { kind: "decision"; decision: Decision };

/** The run as a sequence: each decision just before the event after it. */
const SEQUENCE: Step[] = (() => {
  const out: Step[] = [];
  const decisions = [...run.decisions];
  for (const item of run.events) {
    while (decisions[0] && decisions[0].afterEventId < item.id) out.push({ kind: "decision", decision: decisions.shift()! });
    out.push({ kind: "event", id: item.id, event: item.event });
  }
  return out;
})();

let cursor = 0;
let delivered = 0;
function deliverOne() {
  if (cursor === 0) {
    if (!plan.getSnapshot().matches("draft")) plan.send({ type: "RESET", at: Date.now() });
    plan.send({ type: "APPROVE", sessionId: "bench", at: Date.now() });
  }
  // A decision goes with the event after it, in the same task.
  for (;;) {
    const step = SEQUENCE[cursor]!;
    const at = Date.now();
    cursor = (cursor + 1) % SEQUENCE.length;
    if (step.kind === "event") {
      plan.send({ type: "RUN_EVENT", event: step.event, at });
      delivered += 1;
      return;
    }
    if (step.decision.stepId && step.decision.command !== "stop") plan.send({ type: "DECIDE", stepId: step.decision.stepId, command: step.decision.command, at });
  }
}

const channel = new MessageChannel();
channel.port1.onmessage = () => deliverOne();

type Result = { rate: number; seconds: number; posted: number; delivered: number; frames: number[]; longTasks: number[] };

/** Feeds events at `rate` a second for `seconds`, each in its own task,
 * and records every frame's interval and every long task. */
function measure(rate: number, seconds: number): Promise<Result> {
  return new Promise((resolve) => {
    const frames: number[] = [];
    const longTasks: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    try {
      observer.observe({ type: "longtask", buffered: false });
    } catch {
      // No long task timing in this browser.
    }
    const start = performance.now();
    const startDelivered = delivered;
    let posted = 0;
    let last = start;
    let running = true;
    const frame = (now: number) => {
      frames.push(now - last);
      last = now;
      if (running) requestAnimationFrame(frame);
    };
    requestAnimationFrame((now) => {
      last = now;
      requestAnimationFrame(frame);
    });
    const tick = () => {
      const elapsed = (performance.now() - start) / 1000;
      if (elapsed >= seconds) {
        running = false;
        observer.disconnect();
        resolve({ rate, seconds, posted, delivered: delivered - startDelivered, frames: frames.slice(1), longTasks });
        return;
      }
      const due = Math.floor(elapsed * rate) - posted;
      for (let i = 0; i < due; i += 1) channel.port2.postMessage(0);
      posted += Math.max(0, due);
      setTimeout(tick, 1);
    };
    tick();
  });
}

declare global {
  interface Window {
    ariadneBench: { measure: typeof measure; idle: (seconds: number) => Promise<number[]> };
  }
}

window.ariadneBench = {
  measure,
  idle: (seconds) => measure(0, seconds).then((r) => r.frames),
};

function Bench() {
  const ctx = useSelector(plan, (s) => s.context);
  const steps = useRunSteps(plan);
  const [snapshot] = useState(SNAPSHOT);
  return (
    <div className="layout">
      <div className="layout__main">
        <RunPanel
          x={x}
          steps={steps}
          autonomy={ctx.autonomy}
          session={snapshot}
          stopRequested={false}
          ended={false}
          canStop
          canPause
          onStop={() => {}}
          onPause={() => {}}
          onResume={() => {}}
          onRetryStream={() => {}}
          onNewPlan={() => {}}
          onDecide={() => {}}
          onUndo={() => {}}
          notice={null}
        />
      </div>
      <div className="layout__side">
        <LogPanel x={x} log={ctx.log} steps={steps} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider locale={LOCALES.en}>
      <Bench />
    </I18nProvider>
  </StrictMode>,
);
