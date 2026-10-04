import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyLanguage, applyTheme, readLanguage, readThemeChoice } from "@valkyra-labs/stoa-react";
import "@valkyra-labs/stoa-tokens/tokens.css";
import "./styles.css";
import { LANGUAGE_STORE, Root, THEME_STORE } from "./App";
import { LANGS } from "./i18n";

// The theme and the language before the first paint, so a dark page does
// not flash light and an Arabic one does not flash left to right.
applyTheme(readThemeChoice(THEME_STORE));
applyLanguage(readLanguage(LANGS, LANGUAGE_STORE));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
