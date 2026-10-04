// The confirmations the run stops for: a risky step's draft (confirm or
// skip) and the agent's request to leave the plan (allow or keep it). Each
// is an AlertDialog with the focus on the safe action, so an Enter pressed
// by habit skips the step or keeps the plan; Escape does the same. Stop
// stays one key away while the dialog is open.
import { useRef } from "react";
import { AlertDialog, Kbd } from "@valkyra-labs/stoa-react";
import type { WaitingNotice } from "ariadne-runner";
import { draftLines, objectLine, stepTitle, type Text } from "../text";
import type { StepView } from "./hooks";

export type DecisionsProps = {
  x: Text;
  steps: StepView[];
  waiting: WaitingNotice | null;
  open: boolean;
  onDecide: (stepId: string, command: "confirm" | "skip" | "allow" | "deny") => void;
};

function StopHint({ x }: { x: Text }) {
  return (
    <p className="muted">
      {x.t.confirm.stopHint} <Kbd>S</Kbd>
    </p>
  );
}

export function Decisions({ x, steps, waiting, open, onDecide }: DecisionsProps) {
  const { t, f } = x;
  const accepted = useRef(false);
  if (!waiting) return null;
  const index = steps.findIndex((s) => s.id === waiting.stepId);
  const view = steps[index];
  if (!view) return null;
  const ctx = view.snapshot.context;
  const position = f.int(index + 1);
  const key = `${waiting.stepId}-${waiting.accepts.join("-")}`;

  // Pressing the primary action confirms; any other close (the safe
  // button, Escape) is the safe answer.
  const onOpenChange = (safe: "skip" | "deny") => (isOpen: boolean) => {
    if (isOpen) return;
    if (accepted.current) {
      accepted.current = false;
      return;
    }
    onDecide(waiting.stepId, safe);
  };

  if (waiting.accepts.includes("allow") && ctx.deviation) {
    const deviation = ctx.deviation;
    const proposed = stepTitle(x, { ...ctx.step, deviatedTo: deviation.proposal });
    return (
      <AlertDialog
        key={key}
        isOpen={open}
        onOpenChange={onOpenChange("deny")}
        title={t.deviation.title(position)}
        confirmLabel={t.deviation.allow}
        cancelLabel={t.deviation.deny}
        onConfirm={() => {
          accepted.current = true;
          onDecide(waiting.stepId, "allow");
        }}
      >
        <p>{stepTitle(x, ctx.step)}</p>
        <p>{t.deviationReason[deviation.reason](f.id(deviation.archiveRequest), f.date(deviation.archiveUploaded))}</p>
        <p>{t.deviationProposal[deviation.proposal]}</p>
        <p>{t.deviation.instead(proposed, t.risk[deviation.newRisk])}</p>
        <StopHint x={x} />
      </AlertDialog>
    );
  }

  if (waiting.accepts.includes("confirm") && ctx.draft) {
    const draft = ctx.draft;
    return (
      <AlertDialog
        key={key}
        isOpen={open}
        onOpenChange={onOpenChange("skip")}
        title={t.confirm.title(position, stepTitle(x, ctx.step))}
        confirmLabel={t.confirm.confirm[draft.kind]}
        cancelLabel={t.confirm.skip}
        tone={ctx.step.risk === "high" ? "destructive" : "neutral"}
        onConfirm={() => {
          accepted.current = true;
          onDecide(waiting.stepId, "confirm");
        }}
      >
        <p className="draft-kind">
          {t.draftKind[draft.kind]} · {t.risk[ctx.step.risk]}
        </p>
        {draftLines(x, draft).map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p className="draft-heading">{t.confirm.changes}</p>
        <ul className="draft-objects">
          {ctx.step.objects.map((object) => {
            const line = objectLine(x, object);
            return <li key={line}>{line}</li>;
          })}
        </ul>
        <p>{t.confirm.intro}</p>
        <StopHint x={x} />
      </AlertDialog>
    );
  }
  return null;
}
