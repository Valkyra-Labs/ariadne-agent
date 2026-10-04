import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSelector } from "@xstate/react";
import type { StepActorRef } from "ariadne-runner";
import type { PlanActor, RunSession, SessionSnapshot } from "../session";

export function useSession(session: RunSession): SessionSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}

export type StepSnapshot = ReturnType<StepActorRef["getSnapshot"]>;
export type StepView = { id: string; snapshot: StepSnapshot };

const EMPTY: StepView[] = [];

/** The snapshots of every step actor of the run, in the run's order. The
 * array is new only when one of them changed. */
export function useRunSteps(plan: PlanActor): StepView[] {
  const order = useSelector(plan, (s) => s.context.order);
  const refs = useSelector(plan, (s) => s.context.stepRefs);
  const cache = useRef<StepView[]>(EMPTY);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscriptions = order.map((id) => refs[id]?.subscribe(onChange));
      return () => {
        for (const subscription of subscriptions) subscription?.unsubscribe();
      };
    },
    [order, refs],
  );
  const read = useCallback(() => {
    const previous = cache.current;
    const next: StepView[] = [];
    let changed = previous.length !== order.length;
    order.forEach((id, index) => {
      const ref = refs[id];
      if (!ref) return;
      const snapshot = ref.getSnapshot();
      const old = previous[index];
      if (!old || old.id !== id || old.snapshot !== snapshot) changed = true;
      next.push(old && old.id === id && old.snapshot === snapshot ? old : { id, snapshot });
    });
    if (changed || next.length !== previous.length) cache.current = next;
    return cache.current;
  }, [order, refs]);
  return useSyncExternalStore(subscribe, read, read);
}

/** The time now, updated every `everyMs` while `active`. */
export function useNow(active: boolean, everyMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
  return now;
}
