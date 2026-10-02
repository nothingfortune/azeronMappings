/**
 * The Edit tab in a real browser: dragging an action or a key, every key one size, and a
 * layout added from the Azeron app's two exports.
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { GAME } from "../helpers/fixtures.js";

const key = (page: Page, unit: number, position: string) =>
  page.locator(".hand").nth(unit).locator(`.key[data-position="${position}"]`);
const action = (page: Page, label: string) =>
  page.locator(".action", { has: page.locator("b", { hasText: new RegExp(`^${label}$`) }) });

test.describe("drag and drop on the Edit tab", () => {
  // The board and the action list on one screen, as they are on the owner's monitor: a drag
  // that has to scroll between picking up and putting down is another matter.
  test.use({ viewport: { width: 1920, height: 1080 } });

  test("an action dragged from the list lands on the key it is dropped on", async ({ page }) => {
    await page.goto("/");
    await expect(key(page, 0, "pinky_5")).toHaveClass(/empty/);
    await action(page, "Headlight").dragTo(key(page, 0, "pinky_5"));
    await expect(key(page, 0, "pinky_5").locator(".name")).toHaveText("Headlight");
    await expect(key(page, 0, "pinky_5")).toHaveClass(/selected/);
    await expect(page.locator("header button.dirty")).toHaveAttribute("title", /Left unit/);
  });

  test("a key dragged onto another swaps with it, and dragged onto the list is cleared", async ({
    page,
  }) => {
    await page.goto("/");
    const first = await key(page, 0, "pinky_1").locator(".name").innerText();
    const second = await key(page, 0, "pinky_2").locator(".name").innerText();
    await key(page, 0, "pinky_1").dragTo(key(page, 0, "pinky_2"));
    await expect(key(page, 0, "pinky_2").locator(".name")).toHaveText(first);
    await expect(key(page, 0, "pinky_1").locator(".name")).toHaveText(second);

    await key(page, 0, "pinky_2").dragTo(page.locator(".palette .palette-bar"));
    await expect(key(page, 0, "pinky_2")).toHaveClass(/empty/);
  });

  test("an action dragged onto a stick direction is what that direction sends", async ({
    page,
  }) => {
    await page.goto("/");
    const up = page.locator(".hand").nth(0).locator(".stick-dial .dir.up");
    await action(page, "Headlight").dragTo(up);
    await expect(up.locator(".name")).toHaveText("Headlight");
  });
});

test.describe("the board's keys", () => {
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1080, 1920],
  ] as const) {
    test(`are all one size at ${String(width)}x${String(height)}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const sizes = await page.locator(".hand .key, .hand .stick-dial .dir").evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return `${String(Math.round(box.width))}x${String(Math.round(box.height))}`;
        }),
      );
      expect(sizes.length).toBeGreaterThan(50);
      expect([...new Set(sizes)]).toHaveLength(1);
    });
  }
});

test.describe("adding a layout from the app's exports", () => {
  const NAME = "zz-e2e-pair";

  function remove(): void {
    for (const unit of ["left", "right"]) {
      rmSync(`${GAME}/profiles/${NAME}-${unit}.yaml`, { force: true });
    }
    for (const dir of ["templates", "dist/SpaceSims/everspace"]) {
      for (const file of readdirSync(dir)) {
        if (file.includes(NAME)) rmSync(`${dir}/${file}`, { force: true });
      }
    }
  }

  test("takes an export for each unit under one name and opens the pair on the board", async ({
    page,
  }) => {
    try {
      await page.goto("/");
      await page.getByRole("button", { name: "Setup", exact: true }).click();

      // Pressing the button with nothing filled in says so, in view, and writes nothing.
      await page.getByRole("button", { name: "Add layout", exact: true }).click();
      await expect(page.locator(".repo-note")).toHaveText("Give the layout a name first.");
      await expect(page.locator(".repo-note")).toBeInViewport();

      await page.locator('[data-add-layout="name"]').fill(NAME);
      const exports = page.locator(".unit-export");
      await exports
        .nth(0)
        .locator('input[type="file"]')
        .setInputFiles("templates/everspace2-akimbo-left.json");
      await exports
        .nth(1)
        .locator('input[type="file"]')
        .setInputFiles("templates/everspace2-akimbo-right.json");
      await expect(page.locator('[data-add-layout="cyborg2-right"]')).toHaveText(
        "everspace2-akimbo-right.json",
      );
      // The name survived the two redraws.
      await expect(page.locator('[data-add-layout="name"]')).toHaveValue(NAME);
      await page.getByRole("button", { name: "Add layout", exact: true }).click();

      await expect(page.locator(".save-note")).toContainText(`Added ${NAME}`, { timeout: 20_000 });
      await expect(page.locator(".hand")).toHaveCount(2);
      await expect(page.locator("header select").nth(1).locator("option:checked")).toHaveText(NAME);
      expect(existsSync(`${GAME}/profiles/${NAME}-left.yaml`)).toBe(true);
      expect(existsSync(`${GAME}/profiles/${NAME}-right.yaml`)).toBe(true);
    } finally {
      remove();
    }
  });
});
