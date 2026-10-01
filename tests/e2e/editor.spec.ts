/**
 * The editor, driven as a user drives it.
 *
 * These cover the seams the unit tests cannot: that the page the CLI serves actually
 * boots, that a save reaches the repo and comes back with the linter's verdict, and that
 * the round trip leaves the file as it was.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { LIVE_SET, live } from "../helpers/fixtures.js";

const PROFILE = live("left");
const DIST = "dist/SpaceSims/everspace";

/**
 * Every file a save can rewrite. The save rebuilds dist/ from the edited profile, so
 * restoring the profile alone left the compiled JSON describing an edit that was undone
 * -- a stale import that the dist gate would then fail on, or that could be committed.
 */
function snapshot(): Map<string, string> {
  const files = new Map<string, string>([[PROFILE, readFileSync(PROFILE, "utf8")]]);
  for (const name of readdirSync(DIST)) {
    if (name.endsWith(".json")) files.set(join(DIST, name), readFileSync(join(DIST, name), "utf8"));
  }
  return files;
}

function restore(files: Map<string, string>): void {
  for (const [path, text] of files) writeFileSync(path, text, "utf8");
}

test.describe("the served editor", () => {
  test("boots with both units drawn and the linter clean", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".hand")).toHaveCount(2);
    await expect(page.locator("header .pill")).toHaveText("saves to repo");
    await expect(page.locator(".finding").first()).toContainText("Clean");
  });

  test("moves between its tabs without losing the pair", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "In-game", exact: true }).click();
    await expect(page.locator(".ingame-row").first()).toBeVisible();
    await expect(page.locator(".hand")).toHaveCount(2);

    await page.getByRole("button", { name: "Sheet", exact: true }).click();
    const sheet = page.frameLocator("iframe.sheet-frame");
    await expect(sheet.locator("h1")).toBeVisible();

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.locator(".hand")).toHaveCount(2);
  });

  test("edits a key and saves it back into the repo", async ({ page }) => {
    // Read and restore the exact files the edit lands in, not siblings.
    const saved = snapshot();
    const before = saved.get(PROFILE) ?? "";
    const header = before.slice(0, before.indexOf("\nprofile:") + 1);
    expect(header.startsWith("#")).toBe(true);
    try {
      await page.goto("/");

      // Pick a key, give it a label, and save that unit.
      // pinky_1 exists on both units, so the click has to name a hand.
      const leftHand = page.locator(".hand").first();
      await leftHand
        .locator(".key", { has: page.locator(".pos", { hasText: /^pinky_1$/ }) })
        .click();
      const label = page.locator(".panel", { hasText: "Key" }).locator('input[type="text"]');
      await label.fill("Edited end to end");
      await label.blur();

      await page.getByRole("button", { name: /^Save left$/ }).click();

      // The verdict comes back from the server, not from the page guessing -- and it says
      // the file was saved before it says anything else.
      const report = page.locator(".save-report");
      await expect(report).toContainText("Lint clean.", { timeout: 15_000 });
      await expect(report.locator("> div").first()).toHaveText(/^Saved /);
      const after = readFileSync(PROFILE, "utf8");
      expect(after).toContain("Edited end to end");
      // The header says why the profile is the way it is; a save must not eat it.
      expect(after.startsWith(header)).toBe(true);
    } finally {
      restore(saved);
    }
  });

  test("applies a stick mode to both sticks at once", async ({ page }) => {
    await page.goto("/");
    await page.locator("header select").nth(1).selectOption(LIVE_SET);

    // By its exact label: "Mode 2, roll for yaw" also contains "Mode 2".
    await page
      .locator(".mode-row")
      .filter({ has: page.locator("b", { hasText: /^Mode 2 \(RC default\)/ }) })
      .click();

    const dials = page.locator(".stick-dial");
    await expect(dials.nth(0).locator(".up .name")).toHaveText("Hover up");
    await expect(dials.nth(0).locator(".right .name")).toHaveText("Yaw right");
    await expect(dials.nth(1).locator(".up .name")).toHaveText("Thrust forward");
    await expect(page.locator(".save-note")).toContainText("Save each unit");
  });

  test("draws the press test's columns side by side", async ({ page }) => {
    // The board's own .hand-body rule once reached the press test and stacked every
    // column into one. A unit test cannot see that; a browser laying the page out can.
    await page.goto("/");
    await page.getByRole("button", { name: "Press test", exact: true }).click();
    const columns = page.locator(".hand").first().locator(".hand-body > *");
    const first = await columns.nth(0).boundingBox();
    const second = await columns.nth(1).boundingBox();
    expect(first && second && second.x > first.x + first.width / 2).toBe(true);
  });

  test("draws the board's keys big enough to read", async ({ page }) => {
    // At a common laptop width the pair was drawn at under half size, key text at about
    // five pixels. Measured, not assumed: the drawn size of a key's name.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const name = page.locator(".hand .key .name").first();
    const height = await name.evaluate((node) => node.getBoundingClientRect().height);
    expect(height).toBeGreaterThan(9);
  });

  test("offers detection, and says what it cannot know", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Repo", exact: true }).click();

    const units = page.locator(".panel.inset", { hasText: "Units connected" });
    await expect(units).toBeVisible();
    await expect(units).toContainText("Not checked yet");
    await expect(units.getByRole("button", { name: "Detect units" })).toBeVisible();
  });

  test("builds from the Repo tab", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Repo", exact: true }).click();

    await page.getByRole("button", { name: "Build profiles" }).click();
    await expect(page.locator(".repo-note")).toContainText("profile(s) changed", {
      timeout: 20_000,
    });
  });
});
