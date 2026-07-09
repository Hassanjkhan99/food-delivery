import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E for the four role UIs (customer / restaurant / rider / admin).
 *
 * Servers are NOT started by Playwright here — the CI job (and local runner)
 * boots embedded Postgres, seeds, and runs `pnpm dev` before invoking this.
 * Set `E2E_WEB_START=1` to have Playwright spin the web+api dev servers itself
 * (handy locally when a DB is already up). See README.md.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? "http://localhost:3000";
const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000/graphql";
const startServers = process.env.E2E_WEB_START === "1";

export default defineConfig({
  testDir: "./tests",
  // Smoke suite: keep it fast and deterministic. One retry to absorb the
  // occasional cold-start / SSE flake without masking real regressions.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // The seeded world & dev-OTP live behind the API; expose it to specs.
    extraHTTPHeaders: {},
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Verifies 3D theme effects degrade gracefully when motion is reduced.
      // Set on contextOptions (stable across Playwright versions).
      name: "reduced-motion",
      use: {
        ...devices["Desktop Chrome"],
        contextOptions: { reducedMotion: "reduce" },
      },
      testMatch: /theme\.spec\.ts/,
    },
  ],

  webServer: startServers
    ? {
        command: "pnpm --dir .. dev",
        url: WEB_URL,
        reuseExistingServer: true,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      }
    : undefined,

  metadata: { apiUrl: API_URL },
});
