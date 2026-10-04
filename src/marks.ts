// Performance marks at the points the measurements are taken from
// (scripts/measure.mjs reads them with performance.getEntriesByName). A
// mark is a timestamp in the page's own timeline and costs next to nothing.
//
//   ariadne:sw-register       before the worker is registered
//   ariadne:sw-controlled     the worker controls the page
//   ariadne:run               Run was pressed
//   ariadne:first-event       the first event of the run is in the DOM
//   ariadne:stop              Stop was pressed
//   ariadne:stopped           the stopped run is in the DOM

export type MarkName = "sw-register" | "sw-controlled" | "run" | "first-event" | "stop" | "stopped";

export function mark(name: MarkName): void {
  if (typeof performance !== "undefined" && typeof performance.mark === "function") performance.mark(`ariadne:${name}`);
}
