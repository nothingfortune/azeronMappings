/**
 * The editor, driven as a user drives it.
 *
 * These cover the seams the unit tests cannot: that the page the CLI serves actually
 * boots, that a save reaches the repo and comes back with the linter's verdict, and that
 * the round trip leaves the file as it was.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const PROFILE = "games/SpaceSims/everspace/profiles/akimbo-v9-left.yaml";

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
    // Read and restore the exact file the edit lands in, not a sibling.
    const before = readFileSync(PROFILE, "utf8");
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

      // The verdict comes back from the server, not from the page guessing.
      await expect(page.locator(".save-note")).toContainText("lint clean", { timeout: 15_000 });
      const after = readFileSync(PROFILE, "utf8");
      expect(after).toContain("Edited end to end");
      // The header says why the profile is the way it is; a save must not eat it.
      expect(after.startsWith("# Everspace 2 -- akimbo v9")).toBe(true);
    } finally {
      writeFileSync(PROFILE, before, "utf8");
    }
  });

  test("applies a stick mode to both sticks at once", async ({ page }) => {
    await page.goto("/");
    await page.locator("header select").nth(1).selectOption("akimbo-v9");

    await page.locator(".mode-row", { hasText: "Mode 2" }).click();

    const dials = page.locator(".stick-dial");
    await expect(dials.nth(0).locator(".up .name")).toHaveText("Hover up");
    await expect(dials.nth(1).locator(".up .name")).toHaveText("Throttle up");
    await expect(page.locator(".save-note")).toContainText("Save each unit");
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
