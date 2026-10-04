import { describe, expect, it } from "vitest";
import {
  ACTION_TYPES,
  AUTONOMIES,
  COMMANDS,
  CONFLICT_REASONS,
  DEVIATION_PROPOSALS,
  DEVIATION_REASONS,
  DOCUMENTS,
  DRAFT_KINDS,
  DRAFT_TEMPLATES,
  ERROR_CODES,
  LETTER_STATUSES,
  MATCH_FIELDS,
  OBJECT_KINDS,
  PROGRESS_PHASES,
  REQUEST_STATUSES,
  RISKS,
  SERVICES,
  SKIP_REASONS,
  STEP_STATUSES,
  SUMMARY_CODES,
  SUPPLIER_COUNT,
  TASK_CODES,
  UNDO_CODES,
  applyDeviation,
  generatePlan,
  generateScenario,
  findConflicts,
  type LogEntry,
} from "ariadne-runner";
import { makeFmt } from "./format";
import { fullRun } from "./fullRun";
import { LANGS, LOCALES, strings, type Lang } from "./i18n";
import { STREAM_ERRORS } from "./transport";
import { draftLines, errorText, logLine, objectLine, stepTitle, summaryText, undoText, type Text } from "./text";
import { WORKER_ERRORS } from "./worker";

/** Every key path of a table, with the kind of value at it (a function's
 * arity included, an array's length). */
function shape(v: unknown, path = ""): string[] {
  if (Array.isArray(v)) return [`${path}: array/${v.length}`];
  if (typeof v === "function") return [`${path}: function/${v.length}`];
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => shape(x, path ? `${path}.${k}` : k));
  return [`${path}: ${typeof v}`];
}

function leaves(v: unknown, path = ""): [string, string][] {
  if (typeof v === "string") return [[path, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => leaves(x, path ? `${path}.${k}` : k));
  return [];
}

const text = (lang: Lang): Text => ({ t: strings[lang], f: makeFmt(LOCALES[lang]) });

describe("language tables", () => {
  it("English, Russian and Arabic have the same keys, with the same kinds of value", () => {
    const en = shape(strings.en).sort();
    expect(shape(strings.ru).sort()).toEqual(en);
    expect(shape(strings.ar).sort()).toEqual(en);
  });

  it("no string is empty", () => {
    for (const lang of LANGS) for (const [path, value] of leaves(strings[lang])) expect(value.trim(), `${lang}.${path}`).not.toBe("");
  });

  it("every supplier the engine can name has a name", () => {
    for (const lang of LANGS) expect(strings[lang].suppliers).toHaveLength(SUPPLIER_COUNT);
  });

  it("every code of the engine has words in every language", () => {
    const tables: [string, readonly string[], (lang: Lang) => object][] = [
      ["actionType", ACTION_TYPES, (l) => strings[l].actionType],
      ["risk", RISKS, (l) => strings[l].risk],
      ["autonomy", AUTONOMIES, (l) => strings[l].autonomy],
      ["autonomyHelp", AUTONOMIES, (l) => strings[l].autonomyHelp],
      ["command", COMMANDS, (l) => strings[l].command],
      ["phase", PROGRESS_PHASES, (l) => strings[l].phase],
      ["skipReason", SKIP_REASONS, (l) => strings[l].skipReason],
      ["stepStatus", STEP_STATUSES, (l) => strings[l].stepStatus],
      ["objectKind", OBJECT_KINDS, (l) => strings[l].objectKind],
      ["requestStatus", REQUEST_STATUSES, (l) => strings[l].requestStatus],
      ["letterStatus", LETTER_STATUSES, (l) => strings[l].letterStatus],
      ["document", DOCUMENTS, (l) => strings[l].document],
      ["matchField", MATCH_FIELDS, (l) => strings[l].matchField],
      ["draftKind", DRAFT_KINDS, (l) => strings[l].draftKind],
      ["draft", DRAFT_TEMPLATES, (l) => strings[l].draft],
      ["serviceName", SERVICES, (l) => strings[l].serviceName],
      ["errorText", ERROR_CODES, (l) => strings[l].errorText],
      ["streamError", STREAM_ERRORS, (l) => strings[l].streamError],
      ["workerError", WORKER_ERRORS, (l) => strings[l].service.errors],
      ["taskName", TASK_CODES, (l) => strings[l].taskName],
      ["summaryText", SUMMARY_CODES, (l) => strings[l].summaryText],
      ["undoText", UNDO_CODES, (l) => strings[l].undoText],
      ["deviationReason", DEVIATION_REASONS, (l) => strings[l].deviationReason],
      ["deviationProposal", DEVIATION_PROPOSALS, (l) => strings[l].deviationProposal],
      ["conflict", CONFLICT_REASONS, (l) => strings[l].conflict],
      ["stepTitle", [...ACTION_TYPES, ...DEVIATION_PROPOSALS], (l) => strings[l].stepTitle],
    ];
    for (const [name, codes, table] of tables)
      for (const lang of LANGS) expect(Object.keys(table(lang)).sort(), `${lang}.${name}`).toEqual([...codes].sort());
  });
});

/** Every sentence the interface writes from the engine's data over a whole
 * run: titles, drafts, changes, results, undos, errors and log lines. */
function runSentences(lang: Lang, seed: number): string[] {
  const x = text(lang);
  const steps = generatePlan(seed);
  const scenario = generateScenario(seed);
  const deviated = scenario.steps.filter((s) => s.deviation).map(applyDeviation);
  const out: string[] = [];
  for (const step of [...steps, ...deviated]) {
    out.push(stepTitle(x, step), ...draftLines(x, step.draft), ...step.objects.map((o) => objectLine(x, o)));
    out.push(summaryText(x, step.summary), undoText(x, step.undo));
    if (step.error) out.push(errorText(x, step.error));
  }
  for (const c of findConflicts(steps)) out.push(x.t.conflict[c.reason](x.f.int(10), x.f.int(11), x.f.id(1050)));
  for (const autonomy of AUTONOMIES) {
    const run = fullRun(steps, autonomy);
    const entries: LogEntry[] = [
      { at: 0, kind: "approved", total: steps.length, autonomy, confirmations: 3 },
      ...run.events.map((e): LogEntry => ({ at: 0, kind: "event", event: e.event })),
      ...run.decisions.flatMap((d): LogEntry[] => (d.command === "stop" || !d.stepId ? [] : [{ at: 0, kind: "decision", stepId: d.stepId, command: d.command }])),
      { at: 0, kind: "stop_requested" },
      { at: 0, kind: "undo", stepId: "s1", undo: steps[0]!.undo },
      { at: 0, kind: "event", event: { type: "plan.stopped", at: 0, afterStepId: null } },
      { at: 0, kind: "event", event: { type: "step.skipped", stepId: "s2", reason: "stopped_by_user" } },
    ];
    for (const entry of entries) {
      const line = logLine(x, entry, () => x.f.int(3), (id) => stepTitle(x, steps.find((s) => s.id === id)!));
      out.push(line.level, line.text);
    }
  }
  return out;
}

describe("sentences from the engine's data", () => {
  it("have no Latin letters in Arabic or Russian (Russian keeps the tax number's abbreviation)", () => {
    for (const seed of [1, 7, 42, 999])
      for (const lang of ["ar", "ru"] as const)
        for (const sentence of runSentences(lang, seed)) expect(sentence.match(/[A-Za-z]+/g), `${lang}: ${sentence}`).toBeNull();
  });

  it("never end a sentence twice (a date that ends in a full stop)", () => {
    for (const lang of LANGS) for (const sentence of runSentences(lang, 7)) expect(sentence, `${lang}: ${sentence}`).not.toMatch(/\.\./);
  });

  it("use Arabic-Indic digits in Arabic and Latin digits elsewhere", () => {
    for (const sentence of runSentences("ar", 7)) expect(sentence, sentence).not.toMatch(/[0-9]/);
    expect(runSentences("en", 7).join(" ")).toMatch(/[0-9]/);
  });

  it("read as expected in each language", () => {
    const steps = generatePlan(7);
    const third = steps[2]!;
    expect(stepTitle(text("en"), third)).toBe("Ask Cedar Office Supply for documents on request 1043");
    expect(stepTitle(text("ru"), third)).toBe("Запросить у «Кедр-Офис» документы по заявке 1043");
    expect(stepTitle(text("ar"), third)).toBe("طلب مستندات من الأرز للوازم المكتبية للطلب ١٠٤٣");
    expect(draftLines(text("en"), third.draft)).toEqual([
      "Letter to Cedar Office Supply about request 1043.",
      "Please send a registry extract no older than 30 days, the company card, and a copy of the licence by Sep 12, 2026.",
    ]);
    expect(draftLines(text("ru"), third.draft)[1]).toBe("До 12 сент. 2026 г. просим прислать выписку из реестра не старше 30 дней, карточку компании и копию лицензии.");
    const error = steps[3]!.error!;
    expect(errorText(text("en"), error)).toBe("The contracts service did not answer within 5 s.");
    expect(errorText(text("ar"), error)).toBe("لم تستجب خدمة العقود خلال ٥ ث.");
  });
});
