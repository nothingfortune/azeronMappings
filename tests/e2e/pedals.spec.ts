/**
 * The layout's pedals in the served editor: drawn on the Edit tab inside the window at every
 * size the page is used at, edited, saved with the one Save, and read by the stick modes and
 * the checks.
 */

import "../helpers/e2e-data.js";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { GAME } from "../helpers/fixtures.js";

const SETS = `${GAME}/sets.yaml`;
const DIST = "dist/SpaceSims/everspace";

/** Every file a save can rewrite: sets.yaml, and the compiled files the save rebuilds. */
function snapshot(): Map<string, string> {
  const files = new Map<string, string>([[SETS, readFileSync(SETS, "utf8")]]);
  for (const name of readdirSync(DIST)) {
    if (name.endsWith(".json")) files.set(join(DIST, name), readFileSync(join(DIST, name), "utf8"));
  }
  return files;
}

function restore(files: Map<string, string>): void {
  for (const [path, text] of files) writeFileSync(path, text, "utf8");
}

const pedalAxis = (page: Page, id: string) => page.locator(`.pedal-axis[data-axis="${id}"]`);

const WINDOWS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1080, height: 1920 },
  { width: 1200, height: 1920 },
] as const;

for (const { width, height } of WINDOWS) {
  test.describe(`the pedals at ${String(width)}x${String(height)}`, () => {
    test.use({ viewport: { width, height } });

    test("are drawn on the Edit tab, whole, inside the window", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator(".pedal-axis")).toHaveCount(3);
      const box = await page.locator(".panel.pedals").boundingBox();
      expect(box).not.toBeNull();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      // Nothing on the page is wider than the window with them there.
      const wide = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(wide).toBeLessThanOrEqual(width);
      // Every cell is whole: its own contents do not spill out of it.
      const spilled = await page
        .locator(".pedal-axis")
        .evaluateAll(
          (cells) => cells.filter((cell) => cell.scrollWidth > cell.clientWidth + 1).length,
        );
      expect(spilled).toBe(0);
    });
  });
}

test.describe("the pedals at 1920x1080", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test("keep the Edit tab on one screen, and open and close their Details", async ({ page }) => {
    await page.goto("/");
    const height = (): Promise<number> =>
      page.evaluate(() => document.documentElement.scrollHeight);
    expect(await height()).toBeLessThanOrEqual(1080);
    await pedalAxis(page, "rudder").locator(".tune-toggle").click();
    await expect(pedalAxis(page, "rudder").locator('input[data-field="dead_zone"]')).toBeVisible();
    // The tuning is for occasional use and may take space while it is open, but the page
    // must not need a scroll bar for the common case, which is it being shut.
    await pedalAxis(page, "rudder").locator(".tune-toggle").click();
    expect(await height()).toBeLessThanOrEqual(1080);
  });
});

test.describe("the pedals in the editor", () => {
  test("read as the live layout's: rudder on yaw, right toe on thrust, names marked", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(pedalAxis(page, "rudder").locator("select")).toHaveValue("yaw");
    await expect(pedalAxis(page, "left_toe").locator("select")).toHaveValue("");
    await expect(pedalAxis(page, "right_toe").locator("select")).toHaveValue("thrust");
    await expect(pedalAxis(page, "rudder").locator(".chip")).toHaveText("Inferred, not flown");
    await expect(pedalAxis(page, "right_toe").locator(".chip")).toHaveText("Inferred, not flown");
    await expect(page.locator("[data-reading]")).toHaveText("Mode 2 (RC default), with pedals");
  });

  test("saves with the one Save, keeps the file's comments, and says what the game gets", async ({
    page,
  }) => {
    const saved = snapshot();
    const before = saved.get(SETS) ?? "";
    try {
      await page.goto("/");
      // A toe is offered directions, and the pedal rules run on the unsaved edit, in the
      // same Checks panel as every other: both toes on hover down is one row twice over.
      await pedalAxis(page, "left_toe").locator("select").selectOption({ label: "Hover down" });
      await pedalAxis(page, "right_toe").locator("select").selectOption({ label: "Hover down" });
      await expect(
        page.locator(".checks .rule", { hasText: "pedal-axis-assigned-twice" }),
      ).toBeVisible();
      // Hover up on the other toe is its own row. Calibrated to rest at zero, neither
      // raises anything.
      await pedalAxis(page, "right_toe").locator("select").selectOption({ label: "Hover up" });
      await expect(page.locator(".checks .rule", { hasText: "pedal" })).toHaveCount(0);

      // There is no pedals-only button: the one Save names what it would write.
      const save = page.locator("header button.dirty");
      await expect(save).toHaveAttribute("title", "Unsaved: Pedals");
      await save.click();

      const report = page.locator(".save-report");
      await expect(report).toContainText("Saved games/SpaceSims/everspace/sets.yaml.", {
        timeout: 20_000,
      });
      await expect(report).toContainText("Pedals in akimbo-v10");
      await expect(report).toContainText("the game's Yaw row");
      await expect(report).toContainText("inferred, not flown");
      // What the game is given for the toe, and no finding against it from the server.
      await expect(report).toContainText("the game's MoveUp row, back half");
      await expect(report).not.toContainText("pedal-rest-on-centred");
      await expect(page.locator("header button.dirty")).toHaveCount(0);

      const after = readFileSync(SETS, "utf8");
      expect(after).toContain("left_toe: {drives: vertical, end: down}");
      expect(after).toContain("right_toe: {drives: vertical, end: up}");
      expect(after).toContain("rudder: {drives: yaw}");
      const comments = (text: string): string[] =>
        text.split("\n").filter((line) => line.trim().startsWith("#"));
      expect(comments(after)).toEqual(comments(before));
    } finally {
      restore(saved);
    }
  });

  test("applies a with-pedals mode and says the reading changed when the yaw goes", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator("details.panel.fold > summary").click();
    await expect(page.locator(".mode-pedals")).toContainText("with-pedals variant");
    await pedalAxis(page, "rudder").locator("select").selectOption("");
    await expect(page.locator("[data-reading]")).toHaveText("Mode 2, roll for yaw");
    await expect(page.locator(".pedals-note")).toContainText("Nothing on the sticks was changed");
    await expect(page.locator("header button.dirty")).toHaveAttribute("title", "Unsaved: Pedals");
  });

  test("apply a mode as written, with yaw on the stick, once the pedals do not carry yaw", async ({
    page,
  }) => {
    await page.goto("/");
    await pedalAxis(page, "rudder").locator("select").selectOption("");
    await page.locator("details.panel.fold > summary").click();
    await page
      .locator(".mode-row")
      .filter({ has: page.locator("b", { hasText: /^Mode 2 \(RC default\)/ }) })
      .click();
    await expect(page.locator(".stick-dial").nth(0).locator(".right .name")).toHaveText(
      "Yaw right",
    );
    await expect(page.locator("[data-reading]")).toHaveText("Mode 2 (RC default)");
  });

  test("offers to add pedals to a layout that has none", async ({ page }) => {
    await page.goto("/");
    await page.locator("header select").nth(1).selectOption("single-v5");
    await expect(page.locator(".pedal-axis")).toHaveCount(0);
    await page.getByRole("button", { name: "Add pedals" }).click();
    await expect(pedalAxis(page, "rudder").locator("select")).toHaveValue("yaw");
  });
});
