import { defineConfig, devices } from "@playwright/test";

// The tests run against the production build, served by `vite preview`:
// the Service Worker is the built one, at the path a deployment serves it
// from. The build runs first every time, so no test sees a stale bundle.
// ARIADNE_E2E=1 lets a test change the served worker's revision with a
// cookie in its own browser context (see vite-sw.ts), to update it.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:4177", viewport: { width: 1440, height: 900 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "pnpm exec vite build && pnpm exec vite preview --port 4177 --strictPort",
    url: "http://localhost:4177",
    reuseExistingServer: false,
    env: { ARIADNE_E2E: "1" },
    timeout: 120_000,
  },
});
