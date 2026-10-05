import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyLanguage, applyTheme, readLanguage, readThemeChoice } from "@valkyra-labs/stoa-react";
import "@valkyra-labs/stoa-tokens/tokens.css";
import "./styles.css";
import plexArabic from "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2?url";
import { LANGUAGE_STORE, Root, THEME_STORE } from "./App";
import { LANGS } from "./i18n";

// The theme and the language before the first paint, so a dark page does
// not flash light and an Arabic one does not flash left to right.
applyTheme(readThemeChoice(THEME_STORE));
applyLanguage(readLanguage(LANGS, LANGUAGE_STORE));

// An Arabic page asks for its Arabic face at once, so the text is usually
// drawn in it from the first paint; only then, since an unused preload
// costs the download.
if (document.documentElement.lang === "ar") {
  document.head.append(Object.assign(document.createElement("link"), { rel: "preload", as: "font", type: "font/woff2", href: plexArabic, crossOrigin: "anonymous" }));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
