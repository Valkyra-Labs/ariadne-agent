// Query parameters of the run stream that this application adds to the
// engine's own (speed, drop, undoWindow): `scale` multiplies every delay
// between events, for the end-to-end tests and the measurements (0 sends a
// segment at once). The Service Worker and the in-page transport read it
// the same way.

/** The time scale a stream query asks for, or null for the engine's. */
export function timeScaleOf(params: URLSearchParams): number | null {
  const raw = params.get("scale");
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 10 ? value : null;
}

/** The parameters of the page's own URL that are passed on to the stream. */
export const STREAM_PARAMS = ["speed", "drop", "undoWindow", "scale"] as const;

export function streamParamsFrom(search: string): URLSearchParams {
  const page = new URLSearchParams(search);
  const out = new URLSearchParams();
  for (const name of STREAM_PARAMS) {
    const value = page.get(name);
    if (value !== null && value !== "") out.set(name, value);
  }
  return out;
}

/** The scenario number in the page's URL (`?seed=`), if it is a whole
 * number from 1 to 9999. */
export function seedFrom(search: string): number | null {
  const value = Number(new URLSearchParams(search).get("seed"));
  return Number.isInteger(value) && value >= 1 && value <= 9999 ? value : null;
}
