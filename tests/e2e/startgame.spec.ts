/**
 * A game started from the page with no export and no Azeron app: name, genre, units, and
 * it opens on the Edit tab with the genre's layout on the left unit, every key sending
 * something, and the right unit empty to lay out.
 *
 * Everything this writes is removed again, whether the spec passes or not.
 */

import "../helpers/e2e-data.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const NAME = "E2E Fresh Sim";
const SLUG = "e2eFreshSim";
const FOLDER = `games/SpaceSims/${SLUG}`;
const DIST = `dist/SpaceSims/${SLUG}`;
const SHOTS = process.env.NEWGAME_SHOTS ?? "";

function cleanup(): void {
  rmSync(FOLDER, { recursive: true, force: true });
  rmSync(DIST, { recursive: true, force: true });
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS === "") return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

test.setTimeout(240_000);
test.beforeAll(cleanup);
test.afterAll(cleanup);

test("a game starts from its genre, with no export", async ({ page }) => {
  await page.goto("/");
  await page.locator("header .tabs").getByRole("button", { name: "Setup", exact: true }).click();
  const form = page.locator(".new-game");
  // The export is folded away: nothing on the way asks for one.
  await expect(form.locator("details.new-game-export")).not.toHaveAttribute("open", /.*/);
  await expect(form.locator("[data-new-game-unit]")).toHaveCount(2);
  await form.locator('[data-new-game="name"]').fill(NAME);
  await form.locator('[data-new-game="genre"]').selectOption("SpaceSims");
  await shot(page, "10-setup-new-game-no-export");
  await form.getByRole("button", { name: "Create game" }).click();

  await expect(page.locator("header select").first().locator("option:checked")).toHaveText(NAME, {
    timeout: 120_000,
  });
  // Both units, named for the game; the left one carries the genre's layout.
  await expect(page.locator(".hand")).toHaveCount(2);
  await expect(page.locator(".hand").first()).toContainText(`${NAME} v1 left`);
  await expect(page.locator(".hand").nth(1)).toContainText(`${NAME} v1 right`);
  // Nothing placed is left sending nothing.
  await expect(page.locator(".checks")).not.toContainText("action-sends-nothing");
  await shot(page, "11-edit-new-game-no-export");
});
