import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against a running local stack (docs/12, docs/16).
 * Base URL is env-driven so CI / Compose host ports can differ.
 */
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL?.trim() ||
  process.env.E2E_BASE_URL?.trim() ||
  "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  /* Do not start the app — smoke expects web + API already up. */
});
