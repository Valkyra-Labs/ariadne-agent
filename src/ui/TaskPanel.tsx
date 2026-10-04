// The task the agent is given: which task, which scenario, and how much it
// may do without asking. Editable before the run, a plain record during it.
import { useId } from "react";
import { ChoiceGroup, NumberField, Panel, Select } from "@valkyra-labs/stoa-react";
import { AUTONOMIES, TASK, TASK_CODES, type Autonomy, type TaskCode } from "ariadne-runner";
import type { Text } from "../text";

export type TaskPanelProps = {
  x: Text;
  seed: number;
  autonomy: Autonomy;
  editable: boolean;
  onSeed: (seed: number) => void;
  onAutonomy: (autonomy: Autonomy) => void;
};

export function TaskPanel({ x, seed, autonomy, editable, onSeed, onAutonomy }: TaskPanelProps) {
  const { t, f } = x;
  const helpId = useId();
  const requests = f.int(TASK.requests);
  if (!editable) {
    return (
      <Panel title={t.task.panel} className="task">
        <dl className="facts">
          <div>
            <dt>{t.task.task}</dt>
            <dd>{t.taskName[TASK.code](requests)}</dd>
          </div>
          <div>
            <dt>{t.task.scenario}</dt>
            <dd>{f.id(seed)}</dd>
          </div>
          <div>
            <dt>{t.task.autonomy}</dt>
            <dd>{t.autonomy[autonomy]}</dd>
          </div>
        </dl>
      </Panel>
    );
  }
  return (
    <Panel title={t.task.panel} className="task">
      <div className="task__fields">
        <Select<TaskCode>
          label={t.task.task}
          value={TASK.code}
          onChange={() => {}}
          options={TASK_CODES.map((code) => ({ id: code, label: t.taskName[code](requests) }))}
        />
        <NumberField label={t.task.scenario} value={seed} minValue={1} maxValue={9999} step={1} onChange={onSeed} aria-describedby={helpId} />
      </div>
      <p id={helpId} className="muted">
        {t.task.scenarioHelp}
      </p>
      <div className="task__autonomy">
        <ChoiceGroup<Autonomy>
          label={t.task.autonomy}
          value={autonomy}
          onChange={onAutonomy}
          choices={AUTONOMIES.map((level) => ({ id: level, label: t.autonomy[level] }))}
        />
        <p className="muted">{t.autonomyHelp[autonomy]}</p>
      </div>
      <p className="muted">{t.task.scripted}</p>
    </Panel>
  );
}
