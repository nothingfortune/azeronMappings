/**
 * The served page saving on its own, in a real browser against the real server, and the
 * page sitting in the middle of a wide window.
 */
import "../helpers/e2e-data.js";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { live } from "../helpers/fixtures.js";

const PROFILE = live("left");
const DIST = "dist/SpaceSims/everspace";

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

test.describe("autosave", () => {
  // As the owner gets the page: nothing stored, so autosave is on.
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1920, height: 1080 } });

  test("an edit is written to the repo without Save being pressed, and Undo writes it back", async ({
    page,
  }) => {
    const saved = snapshot();
    try {
      expect(saved.get(PROFILE)).not.toContain("tap: headlight");
      await page.goto("/");
      const key = page.locator(".hand").nth(0).locator('.key[data-position="pinky_5"]');
      await page
        .locator(".action", { has: page.locator("b", { hasText: /^Headlight$/ }) })
        .dragTo(key);
      await expect(key.locator(".name")).toHaveText("Headlight");

      await expect.poll(() => readFileSync(PROFILE, "utf8")).toContain("tap: headlight");
      await expect(page.locator("header button", { hasText: /^Saved$/ })).toBeVisible();
      // No report is put on screen; what is left to do is in the header.
      await expect(page.locator(".save-report")).toHaveCount(0);
      await expect(page.locator('[data-todo="import"]')).toHaveText(/^Re-import \d+$/);

      await page.locator("[data-undo]").click();
      await expect(key).toHaveClass(/empty/);
      await expect.poll(() => readFileSync(PROFILE, "utf8")).not.toContain("tap: headlight");
    } finally {
      restore(saved);
    }
  });
});

test.describe("on a wide window", () => {
  test.use({ viewport: { width: 2560, height: 1440 } });

  test("the board and the single-column tabs sit in the middle", async ({ page }) => {
    await page.goto("/");
    const gaps = async (inner: string, outer: string): Promise<{ left: number; right: number }> =>
      page.evaluate(
        ([innerSelector, outerSelector]) => {
          const a = document.querySelector(innerSelector ?? "")?.getBoundingClientRect();
          const b = document.querySelector(outerSelector ?? "")?.getBoundingClientRect();
          if (!a || !b) throw new Error("not on the page");
          return { left: a.left - b.left, right: b.right - a.right };
        },
        [inner, outer],
      );
    const board = await gaps(".stage", ".stage-wrap");
    expect(board.left).toBeGreaterThan(20);
    expect(Math.abs(board.left - board.right)).toBeLessThan(3);

    await page.getByRole("button", { name: "Setup", exact: true }).click();
    const setup = await gaps(".workspace.single > .panel", ".workspace.single");
    expect(setup.left).toBeGreaterThan(100);
    expect(Math.abs(setup.left - setup.right)).toBeLessThan(3);
  });
});
