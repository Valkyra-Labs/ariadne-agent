// A complete run of a plan, every pause answered the way a person who
// agrees with the agent would (confirm, allow, retry): the decision log and
// the events it produces. Used by the unit tests and the throughput bench.
import { generatePlan, runPlan, type Autonomy, type Command, type Decision, type PlanStep, type RunEvent } from "ariadne-runner";

export type FullRun = { decisions: Decision[]; events: { id: number; event: RunEvent }[] };

const ANSWER: Partial<Record<Command, true>> = { confirm: true, allow: true, retry: true };

export function fullRun(steps: readonly PlanStep[] = generatePlan(7), autonomy: Autonomy = "high_only"): FullRun {
  const decisions: Decision[] = [];
  for (let guard = 0; guard < 100; guard += 1) {
    const events: { id: number; event: RunEvent }[] = [];
    let paused = false;
    for (const item of runPlan({ steps, autonomy, decisions, undoWindowSec: null, timeScale: 0 })) {
      if (item.kind === "event") events.push({ id: item.id, event: item.event });
      if (item.kind === "pause") {
        const command = item.accepts.find((c) => ANSWER[c]);
        if (!command) throw new Error(`No answer for ${item.stepId}`);
        decisions.push({ command, stepId: item.stepId, afterEventId: events.at(-1)?.id ?? 0 });
        paused = true;
      }
    }
    if (!paused) return { decisions, events };
  }
  throw new Error("The run did not end");
}
