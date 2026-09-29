import { defineConfig } from "@playwright/test";

/**
 * Browser end-to-end tests against a RUNNING stack (CI staging compose, or a local one).
 *   ADMIN_URL  admin SPA origin           (default http://127.0.0.1:8080)
 *   API_URL    web app / API origin       (default http://127.0.0.1:3000)
 *   E2E_EMAIL / E2E_PASSWORD  the seeded owner login
 * Locally, set E2E_CHROME=1 to use the installed Chrome instead of downloading a browser.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.ADMIN_URL ?? "http://127.0.0.1:8080",
    screenshot: "on",
    trace: "retain-on-failure",
    ...(process.env.E2E_CHROME ? { channel: "chrome" } : {}),
  },
});
