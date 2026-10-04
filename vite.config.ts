import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { serviceWorker } from "./vite-sw.ts";

// Served from GitHub Pages under /ariadne-agent/. ARIADNE_BENCH=1 also
// builds the throughput bench page (bench.html), which the app itself
// never ships.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/ariadne-agent/" : "/",
  plugins: [react(), serviceWorker()],
  // Stoa and the engine are linked from sibling repositories during
  // development and have their own node_modules: without dedupe the app
  // would run two copies of React (and of XState, which the engine's
  // machines are built with) and fail with "Invalid hook call".
  resolve: { dedupe: ["react", "react-dom", "react-aria-components", "xstate"] },
  build: process.env.ARIADNE_BENCH
    ? { outDir: "dist-bench", rolldownOptions: { input: { index: "index.html", bench: "bench.html" } } }
    : {},
  server: { port: 5177, strictPort: true, fs: { allow: [".."] } },
  preview: { port: 4177, strictPort: true },
});
