import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyTheme, readThemeChoice } from "@valkyra-labs/stoa-react";
import "@valkyra-labs/stoa-tokens/tokens.css";
import "./styles.css";
import plexArabic from "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2?url";
import { Root, THEME_STORE } from "./App";

// The theme before React draws, so a dark page is not drawn light. The
// language's lang and dir are set earlier still, by the script in
// index.html, before the first paint.
applyTheme(readThemeChoice(THEME_STORE));

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
