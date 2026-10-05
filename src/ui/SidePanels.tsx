// The log of everything that happened, and the summary once the run ends.
import { useMemo } from "react";
import { Callout, EmptyState, LogView, Panel, StatBar, type LogLine, type StatBarItem } from "@valkyra-labs/stoa-react";
import { stepStatusOf, type LogEntry } from "ariadne-runner";
import { logLine, stepTitle, type Text } from "../text";
import type { StepView } from "./hooks";

export function LogPanel({ x, log, steps }: { x: Text; log: LogEntry[]; steps: StepView[] }) {
  const { t, f } = x;
  const lines = useMemo<LogLine[]>(() => {
    const index = new Map(steps.map((s, i) => [s.id, i]));
    const position = (id: string) => f.int((index.get(id) ?? 0) + 1);
    const title = (id: string) => {
      const view = steps[index.get(id) ?? -1];
      return view ? stepTitle(x, view.snapshot.context.step) : id;
    };
    return log.map((entry) => {
      const { level, text } = logLine(x, entry, position, title);
      // LogView isolates each part: the time stays left to right, the level
      // and the message each take the direction of their own script.
      return { time: f.time(entry.at), level, text };
    });
  }, [x, f, log, steps]);
  return (
    <Panel title={t.log.panel} className="log">
      {lines.length === 0 ? (
        <EmptyState title={t.log.emptyTitle} description={t.log.emptyText} />
      ) : (
        <LogView label={t.log.label} lines={lines} maxLines={16} />
      )}
    </Panel>
  );
}

export type SummaryProps = {
  x: Text;
  steps: StepView[];
  log: LogEntry[];
  stopped: boolean;
  stoppedAfter: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  asked: number;
  events: number;
};

export function SummaryPanel({ x, steps, log, stopped, stoppedAfter, startedAt, finishedAt, asked, events }: SummaryProps) {
  const { t, f } = x;
  const count = (status: string) => steps.filter((s) => stepStatusOf(s.snapshot.value) === status).length;
  const errors = log.filter((e) => e.kind === "event" && e.event.type === "step.error").length;
  const seconds = startedAt !== null && finishedAt !== null ? Math.max(0, finishedAt - startedAt) / 1000 : 0;
  const after = stoppedAfter ? steps.findIndex((s) => s.id === stoppedAfter) : -1;
  const items: StatBarItem[] = [
    { kind: "metric", label: t.summary.done, value: count("done") },
    { kind: "metric", label: t.summary.skipped, value: count("skipped") },
    { kind: "metric", label: t.summary.undone, value: count("undone") },
    { kind: "metric", label: t.summary.asked, value: asked },
    { kind: "metric", label: t.summary.errors, value: errors },
    { kind: "metric", label: t.summary.duration, value: seconds, fractionDigits: 1, unit: t.summary.seconds, basis: t.summary.basisRun },
    { kind: "metric", label: t.summary.events, value: events },
  ];
  return (
    <Panel title={t.summary.panel} className="summary">
      <Callout tone={stopped ? "warning" : "positive"} role="none">
        {stopped ? t.summary.stopped(after >= 0 ? f.int(after + 1) : null) : t.summary.finished}
      </Callout>
      <StatBar label={t.summary.label} items={items} />
    </Panel>
  );
}
