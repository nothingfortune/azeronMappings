import { defineConfig } from "@playwright/test";

// Overridable so two checkouts -- two worktrees, say -- can run the suite at once.
const PORT = Number(process.env.E2E_PORT ?? "4179");

/**
 * End-to-end against the real thing: the editor as `azeron serve` actually serves it,
 * driven the way it is used. Not part of `npm run check` -- it needs a build, a server
 * and a browser, and the unit suite already covers the rendering.
 */
export default defineConfig({
  testDir: "tests/e2e",
  // A save writes into the repo, so the specs must not race each other over the files.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: "retain-on-failure",
  },
  webServer: {
    // The built CLI, so the spec exercises what ships rather than a dev shim.
    command: `node build/index.js serve --port ${String(PORT)}`,
    url: `http://127.0.0.1:${String(PORT)}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
