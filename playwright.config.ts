import { defineConfig } from "@playwright/test";

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
    baseURL: "http://127.0.0.1:4179",
    trace: "retain-on-failure",
  },
  webServer: {
    // The built CLI, so the spec exercises what ships rather than a dev shim.
    command: "node build/index.js serve --port 4179",
    url: "http://127.0.0.1:4179",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
