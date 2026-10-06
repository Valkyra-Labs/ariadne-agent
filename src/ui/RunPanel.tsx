// The run as it happens: the controls (Stop always first), what the stream
// is doing, and every step with its live status, its result and its undo.
import { useEffect, useRef, type ReactNode } from "react";
import { Button, ButtonGroup, Callout, Panel, ProgressBar, StatusBadge, StepList, Toolbar, keepFocusInPlace, type Step, type StatusTone } from "@valkyra-labs/stoa-react";
import { requiresConfirmation, stepStatusOf, type Autonomy } from "ariadne-runner";
import type { SessionSnapshot, StreamStatus } from "../session";
import { errorText, stepTitle, summaryText, undoText, type Text } from "../text";
import { useNow, type StepView } from "./hooks";
import { StepFacts } from "./PlanPanel";

const STATUS_TONE: Record<StreamStatus, StatusTone> = {
  idle: "neutral",
  connecting: "neutral",
  streaming: "positive",
  paused: "warning",
  waiting: "warning",
  reconnecting: "warning",
  failed: "negative",
  ended: "neutral",
};

function UndoWindow({ x, position, deadline, total }: { x: Text; position: string; deadline: number; total: number }) {
  const now = useNow(true, 250);
  const left = Math.max(0, deadline - now);
  return (
    <ProgressBar
      label={x.t.step.undoWindow(position)}
      value={Math.ceil(left / 1000)}
      maxValue={Math.round(total / 1000)}
      formatValue={(seconds) => x.f.countdown(seconds * 1000)}
    />
  );
}

export type RunPanelProps = {
  x: Text;
  steps: StepView[];
  autonomy: Autonomy;
  session: SessionSnapshot;
  /** Stop was asked for (the run may not have started yet). */
  stopRequested: boolean;
  ended: boolean;
  canStop: boolean;
  /** Pause can be pressed (the session's own rule). */
  canPause: boolean;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onRetryStream: () => void;
  onNewPlan: () => void;
  onDecide: (stepId: string, command: "retry" | "skip") => void;
  onUndo: (stepId: string) => void;
  /** The service notice (the run streams in this tab). */
  notice: ReactNode;
};

export function RunPanel(props: RunPanelProps) {
  const { x, steps, autonomy, session, stopRequested, ended, canStop, canPause } = props;
  const { t, f } = x;
  const processed = steps.filter((s) => {
    const status = stepStatusOf(s.snapshot.value);
    return status === "done" || status === "skipped" || status === "undone";
  }).length;
  const paused = session.status === "paused";
  const retryRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const errorStep = steps.find((s) => s.snapshot.matches("error"))?.id ?? null;

  // Where the focus goes when a decision removes or disables the control
  // that had it (Run, Retry, Skip, Stop): the run's heading, one Tab before
  // Stop. A confirmation opened from there returns the focus there too.
  // Not scrolled to: the steps the person is reading stay in view.
  const focusRun = () => {
    const section = barRef.current?.closest("section");
    const heading = section ? document.getElementById(section.getAttribute("aria-labelledby") ?? "") : null;
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  };
  const decide = (id: string, command: "retry" | "skip") => {
    focusRun();
    props.onDecide(id, command);
  };
  const stop = () => {
    focusRun();
    props.onStop();
  };

  // Run removed the plan, and its button with it: the focus starts at the run.
  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body) focusRun();
  }, []);

  // A failed step waits for a decision: its Retry button takes focus, as a
  // confirmation's dialog does, so the keyboard is where the run is.
  useEffect(() => {
    if (!errorStep || stopRequested) return;
    retryRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [errorStep, stopRequested]);

  const items: Step[] = steps.map(({ id, snapshot }, index) => {
    const ctx = snapshot.context;
    const status = stepStatusOf(snapshot.value);
    const position = f.int(index + 1);
    const title = stepTitle(x, ctx.step);
    let explanation: ReactNode = null;
    let actions: ReactNode = null;
    let progress: number | undefined;
    switch (status) {
      case "waiting":
        explanation = (
          <span className="facts-line">
            <StepFacts x={x} step={ctx.step} />
            {requiresConfirmation(ctx.step, autonomy) && <span>{t.step.willAsk}</span>}
          </span>
        );
        break;
      case "running":
        explanation = [ctx.phase ? t.phase[ctx.phase] : t.step.phaseStart, ctx.attempt > 1 ? t.step.attempt(f.int(ctx.attempt)) : null]
          .filter(Boolean)
          .join(", ");
        progress = ctx.progress / 100;
        break;
      case "awaiting":
        explanation = snapshot.matches("awaitingDeviation") ? t.step.deviationAwaiting : t.step.awaiting;
        break;
      case "error":
        explanation = ctx.error && (
          <Callout tone="negative" role="alert" title={t.step.errorTitle(f.int(ctx.attempt))}>
            <p>{errorText(x, ctx.error)}</p>
            <p>{t.step.nothingChanged}</p>
          </Callout>
        );
        if (!stopRequested)
          actions = (
            <div ref={retryRef} className="actions">
              <Button variant="primary" onPress={() => decide(id, "retry")}>
                {t.step.retry}
              </Button>
              <Button onPress={() => decide(id, "skip")}>{t.step.skip}</Button>
              <Button variant="danger" onPress={stop}>
                {t.step.stopRun}
              </Button>
            </div>
          );
        break;
      case "done": {
        const result = ctx.result;
        if (!result) break;
        const irreversible = snapshot.matches({ done: "irreversible" });
        const deadline = ctx.undoDeadline;
        explanation = (
          <>
            <p className="step-text">{summaryText(x, result.summary)}</p>
            {deadline === null ? (
              <p className="muted">{t.step.undoPermanent}</p>
            ) : irreversible ? (
              <p className="muted">{t.step.irreversible(f.timeShort(deadline))}</p>
            ) : (
              <UndoWindow x={x} position={position} deadline={deadline} total={(result.undoWindowSec ?? 0) * 1000} />
            )}
          </>
        );
        if (!irreversible)
          actions = (
            <Button
              onPress={(e) => {
                keepFocusInPlace(e.target);
                props.onUndo(id);
              }}
              aria-label={`${t.step.undo}: ${title}`}
            >
              {t.step.undo}
            </Button>
          );
        break;
      }
      case "skipped":
        explanation = ctx.skipReason ? t.skipReason[ctx.skipReason] : null;
        break;
      case "undone":
        explanation = ctx.result ? t.step.undoneAt(f.time(ctx.undoneAt ?? Date.now()), undoText(x, ctx.result.undo)) : null;
        break;
    }
    return { id, title, textValue: title, status, explanation, actions, progress };
  });

  return (
    <Panel title={t.run.panel} className="run">
      <div ref={barRef} className="run-bar">
        <Toolbar label={t.run.controls}>
          <Button variant="danger" onPress={stop} isDisabled={!canStop} shortcut={{ key: "s" }}>
            {t.run.stop}
          </Button>
          <ButtonGroup>
            <Button onPress={paused ? props.onResume : props.onPause} isDisabled={!paused && !canPause} shortcut={{ key: "p" }}>
              {paused ? t.run.resume : t.run.pause}
            </Button>
          </ButtonGroup>
          {ended && (
            <Button
              variant="primary"
              onPress={(e) => {
                // The new plan's Run takes the place of the run panel.
                keepFocusInPlace(e.target);
                props.onNewPlan();
              }}
            >
              {t.run.newPlan}
            </Button>
          )}
        </Toolbar>
        <span className="run-bar__progress">{t.run.progress(f.int(processed), f.int(steps.length))}</span>
        {stopRequested && !ended ? (
          // The stream reopens to carry the stop; the run is not "running" on.
          <StatusBadge tone="warning">{t.run.stoppingTitle}</StatusBadge>
        ) : (
          <StatusBadge tone={STATUS_TONE[session.status]}>{t.run.status[session.status]}</StatusBadge>
        )}
      </div>
      {props.notice}
      {stopRequested && !ended && (
        <Callout tone="warning" role="none" title={t.run.stoppingTitle}>
          {t.run.stoppingText}
        </Callout>
      )}
      {paused && (
        <Callout tone="info" role="none">
          {t.run.pausedText}
        </Callout>
      )}
      {session.status === "reconnecting" && (
        <Callout tone="warning" role="none">
          {t.run.reconnectingText(f.int(session.lastEventId))}
        </Callout>
      )}
      {session.status === "failed" && session.failure && (
        <Callout
          tone="negative"
          role="alert"
          title={t.run.failedTitle}
          action={
            <Button variant="primary" onPress={props.onRetryStream}>
              {t.run.retry}
            </Button>
          }
        >
          {t.streamError[session.failure]}
        </Callout>
      )}
      <StepList label={t.run.list} steps={items} />
    </Panel>
  );
}
