// The plan before it runs: the steps in their order, which can be moved,
// removed and marked to ask first; conflicts between steps; Run.
import type { ReactNode } from "react";
import { Button, Callout, EmptyState, Kbd, Panel, StepList, Switch, Tag, type Step, type TagTone } from "@valkyra-labs/stoa-react";
import { findConflicts, requiresConfirmation, type Autonomy, type PlanStep, type Risk } from "ariadne-runner";
import { stepTitle, type Text } from "../text";

const RISK_TONE: Record<Risk, TagTone> = { low: "neutral", medium: "warning", high: "negative" };

export type PlanPanelProps = {
  x: Text;
  steps: PlanStep[];
  autonomy: Autonomy;
  /** Shown under Run while the run service starts or after it failed. */
  service: ReactNode;
  canRun: boolean;
  onRun: () => void;
  onRestore: () => void;
  onReorder: (ids: string[]) => void;
  onRemove: (id: string) => void;
  onAskFirst: (id: string, askFirst: boolean) => void;
};

/** A step's risk, kind and confidence: a line under its title. */
export function StepFacts({ x, step }: { x: Text; step: Pick<PlanStep, "risk" | "type" | "confidence"> }) {
  const { t, f } = x;
  return (
    <span className="facts-line">
      <Tag size="small" tone={RISK_TONE[step.risk]}>
        {t.risk[step.risk]}
      </Tag>
      <span>{t.actionType[step.type]}</span>
      <span>{t.plan.confidence(f.percent(step.confidence))}</span>
    </span>
  );
}

function AskFirst({ x, step, autonomy, onAskFirst }: { x: Text; step: PlanStep; autonomy: Autonomy; onAskFirst: PlanPanelProps["onAskFirst"] }) {
  const { t } = x;
  const reason = step.risk === "high" ? t.plan.alwaysAsks : autonomy === "ask_all" ? t.autonomyHelp.ask_all : autonomy === "ask_none" ? t.plan.ignoredAtLevel : null;
  return (
    <Switch
      size="small"
      isSelected={requiresConfirmation(step, autonomy)}
      onChange={(value) => onAskFirst(step.id, value)}
      isDisabled={reason !== null}
      disabledReason={reason ?? undefined}
    >
      {t.plan.askFirst}
    </Switch>
  );
}

export function PlanPanel({ x, steps, autonomy, service, canRun, onRun, onRestore, onReorder, onRemove, onAskFirst }: PlanPanelProps) {
  const { t, f } = x;
  const position = new Map(steps.map((s, i) => [s.id, f.int(i + 1)]));
  const conflicts = findConflicts(steps);
  const asks = steps.filter((s) => requiresConfirmation(s, autonomy)).length;
  const items: Step[] = steps.map((step) => {
    const title = stepTitle(x, step);
    return {
      id: step.id,
      title,
      textValue: title,
      status: "waiting",
      explanation: <StepFacts x={x} step={step} />,
      actions: <AskFirst x={x} step={step} autonomy={autonomy} onAskFirst={onAskFirst} />,
    };
  });

  return (
    <Panel title={t.plan.panel} className="plan">
      {steps.length === 0 ? (
        <EmptyState
          title={t.plan.emptyTitle}
          description={t.plan.emptyText}
          action={
            <Button variant="primary" onPress={onRestore}>
              {t.plan.restore}
            </Button>
          }
        />
      ) : (
        <>
          {/* Run first, so it is on the first screen; it stays in view while
              the steps scroll under it, as the run's own controls do. */}
          <div className="plan-bar">
            <div className="actions">
              <Button variant="primary" onPress={onRun} isDisabled={!canRun} aria-keyshortcuts="R">
                {t.plan.run}{" "}
                <span aria-hidden="true">
                  <Kbd>R</Kbd>
                </span>
              </Button>
              <Button variant="secondary" onPress={onRestore}>
                {t.plan.restore}
              </Button>
            </div>
            <p className="muted">{t.plan.summary(f.int(steps.length), f.int(asks))}</p>
          </div>
          {service}
          {conflicts.length > 0 && (
            <Callout tone="warning" role="none" title={t.plan.conflictTitle}>
              {conflicts.map((c) => {
                const request = c.object.kind === "request" ? f.id(c.object.request) : "";
                return <p key={`${c.a}-${c.b}`}>{t.conflict[c.reason](position.get(c.a) ?? "", position.get(c.b) ?? "", request)}</p>;
              })}
            </Callout>
          )}
          <StepList
            label={t.plan.list}
            steps={items}
            reorderable
            onReorder={(next) => onReorder(next.map((s) => s.id))}
            onRemove={(step) => onRemove(step.id)}
          />
        </>
      )}
    </Panel>
  );
}
