// Numbers, dates and times in the interface's locale, with its digits
// (Arabic-Indic for "ar-u-nu-arab"). The engine sends numbers, ISO dates
// and timestamps; everything a person reads is formatted here.

export type Fmt = {
  locale: string;
  /** An identifier (a request or contract number): no grouping. */
  id(value: number): string;
  /** A count, with the locale's grouping. */
  int(value: number): string;
  /** A share from 0 to 1 as a percentage. */
  percent(value: number): string;
  /** A number with fixed decimals. */
  decimal(value: number, digits: number): string;
  /** An ISO calendar date (2026-09-30), as the calendar date it names. */
  date(iso: string): string;
  /** A timestamp's local time of day, to the second. */
  time(ms: number): string;
  /** A timestamp's local time of day, to the minute. */
  timeShort(ms: number): string;
  /** Remaining time as minutes and seconds, never negative. */
  countdown(ms: number): string;
  /** A list of items joined with the locale's "and". */
  list(items: string[]): string;
};

const cache = new Map<string, Fmt>();

export function makeFmt(locale: string): Fmt {
  const cached = cache.get(locale);
  if (cached) return cached;
  const id = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 0 });
  const int = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const two = new Intl.NumberFormat(locale, { minimumIntegerDigits: 2, useGrouping: false });
  const decimals = new Map<number, Intl.NumberFormat>();
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const timeShort = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  const fmt: Fmt = {
    locale,
    id: (value) => id.format(value),
    int: (value) => int.format(value),
    percent: (value) => percent.format(value),
    decimal: (value, digits) => {
      let format = decimals.get(digits);
      if (!format) {
        format = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
        decimals.set(digits, format);
      }
      return format.format(value);
    },
    date: (iso) => {
      const [y, m, d] = iso.split("-").map(Number);
      return date.format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)));
    },
    time: (ms) => time.format(new Date(ms)),
    timeShort: (ms) => timeShort.format(new Date(ms)),
    countdown: (ms) => {
      const total = Math.max(0, Math.ceil(ms / 1000));
      return `${id.format(Math.floor(total / 60))}:${two.format(total % 60)}`;
    },
    list: (items) => list.format(items),
  };
  cache.set(locale, fmt);
  return fmt;
}
