import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig } from "@playwright/test";

// Overridable so two checkouts -- two worktrees, say -- can run the suite at once.
const PORT = Number(process.env.E2E_PORT ?? "4179");

/**
 * End-to-end against the real thing: the editor as `azeron serve` actually serves it,
 * driven the way it is used. Not part of `npm run check` -- it needs a build, a server
 * and a browser, and the unit suite already covers the rendering.
 */
/**
 * The specs save, import and create games for real. They do it in a throwaway copy of the
 * frozen data (tests/fixtures/repo), so nothing they do -- or leave behind when a run is
 * killed -- reaches the owner's layouts, which may be open in the editor at the time.
 *
 * This file is loaded again in every worker; the copy is made once, by the first to load it,
 * and handed on in the environment.
 */
if (process.env.AZERON_E2E_DATA === undefined) {
  const scratch = mkdtempSync(join(tmpdir(), "azeron-e2e-"));
  for (const dir of ["devices", "genres", "games", "templates", "dist"]) {
    cpSync(resolve("tests/fixtures/repo", dir), join(scratch, dir), { recursive: true });
  }
  process.env.AZERON_E2E_DATA = scratch;
}
const DATA = process.env.AZERON_E2E_DATA;

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
    // The served page saves edits on its own. The specs that press Save are about what
    // Save does, so they start with that turned off, as the owner can from the menu; the
    // autosave spec turns it back on.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://127.0.0.1:${String(PORT)}`,
          localStorage: [{ name: "azeron-autosave", value: "off" }],
        },
      ],
    },
  },
  webServer: {
    // The built CLI, so the spec exercises what ships rather than a dev shim.
    command: `node build/index.js serve --port ${String(PORT)}`,
    env: { AZERON_DATA: DATA },
    url: `http://127.0.0.1:${String(PORT)}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
