/**
 * The wiring through the real server: an action with no key is put on a control, the
 * editor picks the key, and one Save writes it into the game's actions.yaml.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { GAME, live } from "../helpers/fixtures.js";

const ACTIONS = `${GAME}/actions.yaml`;
const DIST = "dist/SpaceSims/everspace";

function snapshot(): Map<string, string> {
  const files = new Map<string, string>();
  for (const path of [ACTIONS, live("left")]) files.set(path, readFileSync(path, "utf8"));
  for (const name of readdirSync(DIST)) {
    const path = join(DIST, name);
    if (/\.(json|ini|md|csv)$/.test(name)) files.set(path, readFileSync(path, "utf8"));
  }
  return files;
}

function restore(files: Map<string, string>): void {
  for (const [path, text] of files) writeFileSync(path, text, "utf8");
}

test.use({ viewport: { width: 1920, height: 1080 } });

test("an action with no key is given one when it is put on a control, and Save writes it", async ({
  page,
}) => {
  const saved = snapshot();
  try {
    // Free look has a row in the game and nothing to be sent on.
    expect(saved.get(ACTIONS)).toMatch(/free_look:\s+\{ingame: FreeLook\}/);

    await page.goto("/");
    const key = page.locator(".hand").nth(0).locator('.key[data-position="pinky_5"]');
    await page
      .locator(".action", { has: page.locator("b", { hasText: /^Free look \(toggle\)$/ }) })
      .dragTo(key);
    await expect(key.locator(".name")).toHaveText("Free look (toggle)");
    await expect(page.locator(".checks .rule", { hasText: "action-sends-nothing" })).toHaveCount(0);

    const save = page.locator("header button.dirty");
    await expect(save).toHaveAttribute("title", "Unsaved: Left unit, Wiring");
    await save.click();
    const report = page.locator(".save-report");
    await expect(report).toContainText("actions.yaml", { timeout: 20_000 });
    await expect(report.getByRole("button", { name: "Update the game's keys…" })).toBeVisible();

    // The key is in the file, on the action's own line, and the rest of the line is kept.
    expect(readFileSync(ACTIONS, "utf8")).toMatch(/free_look:\s+\{key: Insert, ingame: FreeLook\}/);
    expect(readFileSync(live("left"), "utf8")).toContain("tap: free_look");

    // The keys themselves are not on show: the editor writes them into the game.
    await page.getByRole("button", { name: "In-game", exact: true }).click();
    await expect(page.locator(".key-chip")).toHaveCount(0);
    await page.getByRole("button", { name: "Show the wiring" }).click();
    await expect(
      page.locator(".ingame-row", { hasText: "Free look (toggle)" }).locator(".key-chip"),
    ).toHaveText("Insert");
  } finally {
    restore(saved);
  }
});
