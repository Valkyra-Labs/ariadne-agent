import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "@xstate/react";
import {
  AppHeader,
  Button,
  Callout,
  I18nProvider,
  Kbd,
  LanguageSwitch,
  LiveRegion,
  PageShell,
  ProgressBar,
  ShortcutsDialog,
  ThemeSwitch,
  ToastQueue,
  ToastRegion,
  groupShortcuts,
  useLanguagePreference,
  useShortcuts,
  useThemePreference,
} from "@valkyra-labs/stoa-react";
import { DEFAULT_SEED, type Autonomy, type PlanStateValue } from "ariadne-runner";
import { makeFmt } from "./format";
import { LANGS, LOCALES, isLang, strings, type Lang } from "./i18n";
import { mark } from "./marks";
import { seedFrom, streamParamsFrom } from "./scale";
import { RunSession } from "./session";
import { summaryText, undoText, type Text } from "./text";
import { pageTransport, workerTransport } from "./transport";
import { startWorker, watchWorker, type WorkerError } from "./worker";
import { useRunSteps, useSession } from "./ui/hooks";
import { TaskPanel } from "./ui/TaskPanel";
import { PlanPanel } from "./ui/PlanPanel";
import { RunPanel } from "./ui/RunPanel";
import { Decisions } from "./ui/Decisions";
import { LogPanel, SummaryPanel } from "./ui/SidePanels";

export const THEME_STORE = { storageKey: "ariadne-agent.theme" };
export const LANGUAGE_STORE = { storageKey: "ariadne-agent.lang" };

const BASE = import.meta.env.BASE_URL;

type ServiceState =
  | { status: "starting" }
  | { status: "ready" }
  | { status: "failed"; error: WorkerError }
  /** The person chose to run in this tab, without the worker. */
  | { status: "page" };

function setSeedParam(seed: number) {
  const url = new URL(location.href);
  url.searchParams.set("seed", String(seed));
  history.replaceState(history.state, "", url);
}

export function Root() {
  const theme = useThemePreference(THEME_STORE);
  const language = useLanguagePreference({ languages: LANGS, ...LANGUAGE_STORE });
  const lang: Lang = isLang(language.language) ? language.language : "en";
  return (
    <I18nProvider locale={LOCALES[lang]}>
      <App lang={lang} onLang={language.setLanguage} themeChoice={theme.choice} onTheme={theme.setChoice} />
    </I18nProvider>
  );
}

type AppProps = {
  lang: Lang;
  onLang: (lang: string) => void;
  themeChoice: ReturnType<typeof useThemePreference>["choice"];
  onTheme: ReturnType<typeof useThemePreference>["setChoice"];
};

export function App({ lang, onLang, themeChoice, onTheme }: AppProps) {
  const t = strings[lang];
  const f = makeFmt(LOCALES[lang]);
  const x: Text = useMemo(() => ({ t, f }), [t, f]);
  const [session] = useState(() => new RunSession({ seed: seedFrom(location.search) ?? DEFAULT_SEED, streamParams: streamParamsFrom(location.search) }));
  const [toasts] = useState(() => new ToastQueue());
  const [service, setService] = useState<ServiceState>({ status: "starting" });
  const [attempt, setAttempt] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const stream = useSession(session);
  const planState = useSelector(session.plan, (s) => s.value as PlanStateValue);
  const ctx = useSelector(session.plan, (s) => s.context);
  const steps = useRunSteps(session.plan);
  const draft = planState === "draft";
  const ended = planState === "finished" || planState === "stopped";

  useEffect(() => {
    document.title = t.title;
  }, [t]);

  // The worker: started on load and on each retry.
  useEffect(() => {
    if (service.status !== "starting") return;
    let live = true;
    void startWorker(BASE)
      .catch((error: unknown): Awaited<ReturnType<typeof startWorker>> => ({ ok: false, error: "sw_registration_failed", detail: String(error) }))
      .then((result) => {
      if (!live) return;
      if (result.ok) {
        session.setTransport(workerTransport(`${BASE}api/agent`));
        setService({ status: "ready" });
      } else {
        setService({ status: "failed", error: result.error });
      }
    });
    return () => {
      live = false;
    };
  }, [service.status, attempt, session]);

  // A new worker took over this page: the stream moves to it.
  const latestText = useRef(x);
  latestText.current = x;
  useEffect(() => {
    if (service.status !== "ready") return;
    return watchWorker(() => {
      session.workerChanged();
      toasts.add({ tone: "info", text: latestText.current.t.service.updated });
    });
  }, [service.status, session, toasts]);

  // Undo windows and reconnections, as toasts.
  const undoToasts = useRef(new Map<string, { key: string; timer: ReturnType<typeof setTimeout> }>());
  const closeUndoToast = useCallback(
    (stepId: string) => {
      const entry = undoToasts.current.get(stepId);
      if (!entry) return;
      clearTimeout(entry.timer);
      toasts.close(entry.key);
      undoToasts.current.delete(stepId);
    },
    [toasts],
  );
  const undo = useCallback(
    (stepId: string) => {
      const result = session.plan.getSnapshot().context.stepRefs[stepId]?.getSnapshot().context.result;
      closeUndoToast(stepId);
      if (session.undo(stepId) && result) toasts.add({ tone: "positive", text: latestText.current.t.toast.undone(undoText(latestText.current, result.undo)) });
    },
    [session, toasts, closeUndoToast],
  );
  useEffect(
    () =>
      session.onNotice((notice) => {
        const { t: words, f: format } = latestText.current;
        if (notice.kind === "reconnected") {
          toasts.add({ tone: "positive", text: words.toast.reconnected });
          return;
        }
        const result = session.plan.getSnapshot().context.stepRefs[notice.stepId]?.getSnapshot().context.result;
        if (!result) return;
        const left = notice.deadline - Date.now();
        const key = toasts.add({
          tone: "info",
          text: words.toast.undoable(summaryText(latestText.current, result.summary), format.time(notice.deadline)),
          action: { label: words.step.undo, onAction: () => undo(notice.stepId) },
          timeout: null,
        });
        // The toast's own timer pauses while it is hovered or focused; the
        // undo window does not, so the toast closes when the window does.
        const timer = setTimeout(() => closeUndoToast(notice.stepId), Math.max(0, left));
        undoToasts.current.set(notice.stepId, { key, timer });
      }),
    [session, toasts, undo, closeUndoToast],
  );

  // Marks for the measurements: the first event and the stop, once drawn.
  const firstEventMarked = useRef(false);
  useEffect(() => {
    if (stream.lastEventId === 0) firstEventMarked.current = false;
    else if (!firstEventMarked.current) {
      firstEventMarked.current = true;
      mark("first-event");
    }
  }, [stream.lastEventId]);
  useEffect(() => {
    if (planState === "stopped") mark("stopped");
  }, [planState]);

  // Announcements: the run's turns, not every event.
  const previous = useRef({ planState, stopRequested: ctx.stopRequested, status: stream.status });
  useEffect(() => {
    const before = previous.current;
    previous.current = { planState, stopRequested: ctx.stopRequested, status: stream.status };
    if (before.planState !== planState) {
      if (planState === "running") setAnnouncement(t.announce.started);
      if (planState === "stopped") setAnnouncement(t.announce.stopped);
      if (planState === "finished") {
        const done = steps.filter((s) => s.snapshot.matches("done")).length;
        setAnnouncement(t.announce.finished(f.int(done), f.int(steps.length)));
      }
      return;
    }
    if (!before.stopRequested && ctx.stopRequested) return setAnnouncement(t.announce.stopping);
    if (before.status !== stream.status) {
      if (stream.status === "paused") setAnnouncement(t.announce.paused);
      else if (before.status === "paused") setAnnouncement(t.announce.resumed);
      else if (stream.status === "reconnecting") setAnnouncement(t.announce.reconnecting);
    }
  }, [planState, ctx.stopRequested, stream.status, steps, t, f]);

  const canRun = draft && ctx.steps.length > 0 && (service.status === "ready" || service.status === "page");
  const canStop = session.canStop();
  const run = () => {
    if (canRun) session.start();
  };
  const stop = () => {
    session.stop();
  };
  const pauseOrResume = () => {
    if (stream.status === "paused") session.resume();
    else session.pause();
  };
  const newPlan = () => {
    for (const stepId of [...undoToasts.current.keys()]) closeUndoToast(stepId);
    session.reset();
  };

  const help = useShortcuts([
    { key: "r", description: t.shortcuts.start, group: t.shortcuts.run, onTrigger: run, isDisabled: !canRun },
    { key: "s", description: t.shortcuts.stop, group: t.shortcuts.run, onTrigger: stop, isDisabled: !canStop },
    { key: "p", description: t.shortcuts.pauseResume, group: t.shortcuts.run, onTrigger: pauseOrResume, isDisabled: !(stream.status === "paused" || session.canPause()) },
    { key: "?", description: t.shortcuts.help, group: t.shortcuts.general, onTrigger: () => setHelpOpen(true) },
  ]);

  const serviceView =
    service.status === "starting" ? (
      <ProgressBar label={t.service.starting} isIndeterminate />
    ) : service.status === "failed" ? (
      <Callout
        tone="negative"
        role="alert"
        title={t.service.failedTitle}
        action={
          <div className="actions">
            <Button
              variant="primary"
              onPress={() => {
                setAttempt((a) => a + 1);
                setService({ status: "starting" });
              }}
            >
              {t.service.retry}
            </Button>
            <Button
              onPress={() => {
                session.setTransport(pageTransport());
                setService({ status: "page" });
              }}
            >
              {t.service.usePage}
            </Button>
          </div>
        }
      >
        {t.service.errors[service.error]}
      </Callout>
    ) : service.status === "page" ? (
      <Callout tone="info" role="none">
        {t.service.pageNote}
      </Callout>
    ) : null;

  const decisionOpen = stream.status === "waiting" && !ctx.stopRequested && stream.waiting !== null && !stream.waiting.accepts.includes("retry");

  return (
    <PageShell
      header={
        <AppHeader
          title={t.title}
          subtitle={t.subtitle}
          actions={
            <>
              <Button variant="ghost" onPress={() => setHelpOpen(true)} aria-keyshortcuts="?">
                {t.shortcutsButton}{" "}
                <span aria-hidden="true">
                  <Kbd>?</Kbd>
                </span>
              </Button>
              <ThemeSwitch value={themeChoice} onChange={onTheme} />
              <LanguageSwitch languages={LANGS} value={lang} onChange={onLang} />
            </>
          }
        />
      }
    >
      <div className="layout" data-plan-state={planState} data-stream={stream.status}>
        <div className="layout__main">
          <TaskPanel
            x={x}
            seed={ctx.seed}
            autonomy={ctx.autonomy}
            editable={draft}
            onSeed={(seed) => {
              setSeedParam(seed);
              session.plan.send({ type: "REGENERATE", seed });
            }}
            onAutonomy={(autonomy: Autonomy) => session.plan.send({ type: "SET_AUTONOMY", autonomy })}
          />
          {draft ? (
            <PlanPanel
              x={x}
              steps={ctx.steps}
              autonomy={ctx.autonomy}
              service={serviceView}
              canRun={canRun}
              onRun={run}
              onRestore={() => session.plan.send({ type: "RESTORE" })}
              onRemove={(id) => session.plan.send({ type: "REMOVE_STEP", id })}
              onAskFirst={(id, askFirst) => session.plan.send({ type: "SET_ASK_FIRST", id, askFirst })}
              onReorder={(ids) => {
                // One REORDER per item out of place: the machine's own event.
                for (let to = 0; to < ids.length; to += 1) {
                  const current = session.plan.getSnapshot().context.steps.map((s) => s.id);
                  const from = current.indexOf(ids[to] ?? "");
                  if (from >= 0 && from !== to) session.plan.send({ type: "REORDER", from, to });
                }
              }}
            />
          ) : (
            <RunPanel
              x={x}
              steps={steps}
              autonomy={ctx.autonomy}
              session={stream}
              stopRequested={ctx.stopRequested}
              ended={ended}
              canStop={canStop}
              onStop={stop}
              onPause={() => session.pause()}
              onResume={() => session.resume()}
              onRetryStream={() => session.retry()}
              onNewPlan={newPlan}
              onDecide={(stepId, command) => session.decide(stepId, command)}
              onUndo={undo}
              notice={service.status === "page" ? serviceView : null}
            />
          )}
        </div>
        <div className="layout__side">
          {ended && (
            <SummaryPanel
              x={x}
              steps={steps}
              log={ctx.log}
              stopped={planState === "stopped"}
              stoppedAfter={ctx.stoppedAfter}
              startedAt={ctx.startedAt}
              finishedAt={ctx.finishedAt}
              asked={ctx.askedStepIds.length}
              events={stream.lastEventId}
            />
          )}
          <LogPanel x={x} log={ctx.log} steps={steps} />
        </div>
      </div>
      <Decisions x={x} steps={steps} waiting={stream.waiting} open={decisionOpen} onDecide={(stepId, command) => session.decide(stepId, command)} />
      <ShortcutsDialog isOpen={helpOpen} onOpenChange={setHelpOpen} title={t.shortcuts.title} groups={groupShortcuts(help, t.shortcuts.other)} />
      <ToastRegion queue={toasts} />
      <LiveRegion>{announcement}</LiveRegion>
    </PageShell>
  );
}
