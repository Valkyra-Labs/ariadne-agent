// Sentences from the engine's structured data: a step's title, a draft, the
// objects a step changes, a summary, an undo, an error, a log line. The
// words come from i18n.ts and the numbers and dates from format.ts.
import type { AffectedObject, Draft, LogEntry, PlanStep, StepError, Summary, UndoEffect } from "ariadne-runner";
import type { Fmt } from "./format";
import type { Strings } from "./i18n";

export type Text = { t: Strings; f: Fmt };

export function supplierName({ t, f }: Text, index: number): string {
  return t.suppliers[index] ?? f.id(index + 1);
}

/** What a step does, as a title. A step that took the agent's proposed
 * change is titled by what it does now. */
export function stepTitle(x: Text, step: Pick<PlanStep, "type" | "request" | "contract" | "supplier" | "deviatedTo">): string {
  const { t, f } = x;
  const r = f.id(step.request);
  const s = supplierName(x, step.supplier);
  if (step.deviatedTo === "check_by_archive") return t.stepTitle.check_by_archive(r);
  switch (step.type) {
    case "check":
      return t.stepTitle.check(r, s);
    case "extend":
      return t.stepTitle.extend(f.id(step.contract ?? 0), s);
    case "reject_duplicate":
      return t.stepTitle.reject_duplicate(r, s);
    case "request_documents":
      return t.stepTitle.request_documents(r, s);
  }
}

export function draftLines(x: Text, draft: Draft): string[] {
  const { t, f } = x;
  switch (draft.template) {
    case "check_request":
      return t.draft.check_request(f.id(draft.request), supplierName(x, draft.supplier), draft.externalEffects);
    case "extend_contract":
      return t.draft.extend_contract(
        f.id(draft.contract),
        supplierName(x, draft.supplier),
        { n: draft.extendMonths, text: f.int(draft.extendMonths) },
        f.date(draft.validUntilBefore),
        f.date(draft.validUntilAfter),
        draft.termsChanged,
      );
    case "reject_duplicate":
      return t.draft.reject_duplicate(
        f.id(draft.request),
        supplierName(x, draft.supplier),
        f.id(draft.duplicateOf),
        f.date(draft.duplicateOfDate),
        f.list(draft.matchedFields.map((field) => t.matchField[field])),
        draft.notifySupplier,
      );
    case "request_documents":
      return t.draft.request_documents(
        f.id(draft.request),
        supplierName(x, draft.supplier),
        f.list(
          draft.documents.map((d) =>
            d.maxAgeDays === null ? t.document[d.document] : t.documentAge(t.document[d.document], { n: d.maxAgeDays, text: f.int(d.maxAgeDays) }),
          ),
        ),
        f.date(draft.dueDate),
      );
    case "check_by_archive":
      return t.draft.check_by_archive(f.id(draft.request), f.id(draft.archiveRequest), f.date(draft.archiveUploaded), draft.sendsLetter);
  }
}

export function objectLine(x: Text, object: AffectedObject): string {
  const { t, f } = x;
  switch (object.kind) {
    case "request":
      return t.object.request(f.id(object.request), t.requestStatus[object.before.status], t.requestStatus[object.after.status]);
    case "contract":
      return t.object.contract(f.id(object.contract), f.date(object.before.validUntil), f.date(object.after.validUntil));
    case "letter":
      return t.object.letter(
        supplierName(x, object.supplier),
        f.id(object.request),
        t.letterStatus[object.before.status],
        t.letterStatus[object.after.status],
      );
  }
}

export function summaryText(x: Text, summary: Summary): string {
  const { t, f } = x;
  switch (summary.code) {
    case "request_checked":
      return t.summaryText.request_checked(f.id(summary.request), summary.registryMatch);
    case "contract_extended":
      return t.summaryText.contract_extended(f.id(summary.contract), f.date(summary.validUntil), f.id(summary.request));
    case "request_rejected_duplicate":
      return t.summaryText.request_rejected_duplicate(f.id(summary.request), f.id(summary.duplicateOf), summary.supplierNotified);
    case "documents_requested":
      return t.summaryText.documents_requested(supplierName(x, summary.supplier), f.id(summary.request));
    case "request_checked_by_archive":
      return t.summaryText.request_checked_by_archive(f.id(summary.request), summary.letterSent);
  }
}

export function undoText(x: Text, undo: UndoEffect): string {
  const { t, f } = x;
  switch (undo.code) {
    case "unmark_checked":
      return t.undoText.unmark_checked(f.id(undo.request));
    case "restore_contract_term":
      return t.undoText.restore_contract_term(f.id(undo.contract), f.date(undo.validUntil), f.id(undo.request));
    case "return_to_queue":
      return t.undoText.return_to_queue(f.id(undo.request), undo.noticeRecalled);
    case "recall_letter":
      return t.undoText.recall_letter(supplierName(x, undo.supplier), f.id(undo.request));
    case "unmark_checked_by_archive":
      return t.undoText.unmark_checked_by_archive(f.id(undo.request));
  }
}

export function errorText({ t, f }: Text, error: StepError): string {
  return t.errorText[error.code](t.serviceName[error.service], f.int(error.timeoutSec));
}

export type LogText = { level: string; text: string };

/** One entry of the plan machine's log as a line: who (the agent or you)
 * and what. `position` gives a step's number in the run's order; `title`
 * its current title. Progress is not logged, as in the engine. */
export function logLine(
  x: Text,
  entry: LogEntry,
  position: (stepId: string) => string,
  title: (stepId: string) => string,
): LogText {
  const { t, f } = x;
  const agent = (text: string): LogText => ({ level: t.log.agent, text });
  const you = (text: string): LogText => ({ level: t.log.you, text });
  switch (entry.kind) {
    case "approved":
      return you(t.log.approved(f.int(entry.total), t.autonomy[entry.autonomy], f.int(entry.confirmations)));
    case "decision":
      return you(t.log.decision[entry.command](position(entry.stepId)));
    case "stop_requested":
      return you(t.log.stopRequested);
    case "undo":
      return you(t.log.undo(position(entry.stepId), entry.undo ? undoText(x, entry.undo) : ""));
    case "event": {
      const ev = entry.event;
      switch (ev.type) {
        case "plan.started":
          return agent(t.log.planStarted(f.int(ev.total)));
        case "step.started":
          return agent(t.log.stepStarted(position(ev.stepId), title(ev.stepId)));
        case "step.deviation":
          return agent(t.log.deviation(position(ev.stepId)));
        case "step.deviated":
          return agent(t.log.deviated(position(ev.stepId), title(ev.stepId)));
        case "step.awaiting":
          return agent(t.log.awaiting(position(ev.stepId)));
        case "step.running":
          return agent(t.log.running(position(ev.stepId), { n: ev.attempt, text: f.int(ev.attempt) }));
        case "step.progress":
          return agent(t.phase[ev.phase]);
        case "step.finished":
          return agent(t.log.finished(position(ev.stepId), summaryText(x, ev.result.summary)));
        case "step.skipped":
          return agent(t.log.skipped(position(ev.stepId), t.skipReason[ev.reason]));
        case "step.error":
          return agent(t.log.failed(position(ev.stepId), errorText(x, ev.error)));
        case "plan.finished":
          return agent(t.log.planFinished);
        case "plan.stopped":
          return agent(t.log.planStopped(ev.afterStepId ? position(ev.afterStepId) : null));
      }
    }
  }
}
