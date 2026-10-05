// The inline script in index.html sets lang and dir before the bundle
// arrives. It cannot import the application's lists, so this keeps it in
// step with them: the same languages, the same stored key and link
// parameter, the same direction for each.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { LANGUAGE_STORE } from "./App";
import { LANGS } from "./i18n";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

/** Runs the script with a link query and a stored value; returns lang and dir. */
function firstPaint(search: string, stored: Record<string, string> = {}, storage = true) {
  const root = { lang: "en", dir: "ltr" };
  runInNewContext(script, {
    location: { search },
    URLSearchParams,
    localStorage: storage
      ? { getItem: (key: string) => stored[key] ?? null }
      : {
          getItem: () => {
            throw new Error("storage is blocked");
          },
        },
    document: { documentElement: root },
  });
  return [root.lang, root.dir];
}

describe("the first-paint script", () => {
  it("exists", () => {
    expect(script).toContain("documentElement");
  });

  it("knows every language of the application, each with its direction", () => {
    for (const lang of LANGS) expect(firstPaint(`?lang=${lang}`)).toEqual([lang, lang === "ar" ? "rtl" : "ltr"]);
  });

  it("reads the stored choice under the application's key, after the link", () => {
    const key = LANGUAGE_STORE.storageKey;
    expect(firstPaint("", { [key]: "ar" })).toEqual(["ar", "rtl"]);
    expect(firstPaint("?lang=ru", { [key]: "ar" })).toEqual(["ru", "ltr"]);
    expect(firstPaint("?lang=xx", { [key]: "ar" })).toEqual(["ar", "rtl"]);
  });

  it("leaves the page as it is for an unknown language or blocked storage", () => {
    expect(firstPaint("?lang=xx", { [LANGUAGE_STORE.storageKey]: "de" })).toEqual(["en", "ltr"]);
    expect(firstPaint("", {}, false)).toEqual(["en", "ltr"]);
  });
});
