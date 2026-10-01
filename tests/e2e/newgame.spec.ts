/**
 * A game added from the page, and what its owner can do next without a text editor:
 * name the actions, tag their roles, read the checks, and be told what is not connected.
 *
 * Everything this writes -- the game's folder, its compiled files, the export kept as its
 * template -- is removed again, whether the specs pass or not.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const NAME = "E2E Seed Game";
const SLUG = "e2eSeedGame";
const FOLDER = `games/FPS/${SLUG}`;
const DIST = `dist/FPS/${SLUG}`;
const TEMPLATE = `templates/${SLUG}-v1-left.json`;
const EXPORT = "templates/everspace2-v5.json";
const SHOTS = process.env.NEWGAME_SHOTS ?? "";

function cleanup(): void {
  rmSync(FOLDER, { recursive: true, force: true });
  rmSync(DIST, { recursive: true, force: true });
  rmSync(TEMPLATE, { force: true });
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS === "") return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function tab(page: Page, name: "Edit" | "In-game" | "Setup"): Promise<void> {
  await page.locator("header .tabs").getByRole("button", { name, exact: true }).click();
}

/** Make the game through the Setup tab, as a person would, and land on it. */
async function createThroughThePage(page: Page): Promise<void> {
  await page.goto("/");
  await tab(page, "Setup");
  const form = page.locator(".new-game");
  await form.locator('[data-new-game="name"]').fill(NAME);
  await form.locator('[data-new-game="genre"]').selectOption("FPS");
  await form.locator('[data-new-game="layout"]').fill("v1");
  await form.locator('input[type="file"]').setInputFiles(EXPORT);
  await expect(page.locator(".new-game-file")).toContainText("everspace2-v5.json");
  await shot(page, "01-setup-add-game");
  await form.getByRole("button", { name: "Create game" }).click();
  // The page moves to the new game, on its Edit tab, when it has been made.
  await expect(page.locator("header select").first().locator("option:checked")).toHaveText(NAME, {
    timeout: 120_000,
  });
}

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

test.beforeAll(cleanup);
test.afterAll(cleanup);

test.describe("a game started from an export", () => {
  test("has its layout named for the game, and its required actions as one finding", async ({
    page,
  }) => {
    await createThroughThePage(page);
    await tab(page, "Edit");
    // Named for the game, the layout and the unit -- not the export's own "Everspace 2 v5".
    await expect(page.locator(".hand").first()).toContainText(`${NAME} v1 left`);
    await expect(page.locator(".hand").first()).not.toContainText("Everspace 2 v5");

    // The wall of required-action errors is one entry, in the panel and in the chip.
    await expect(page.locator("header .pill.lint")).toHaveText(/^\d+ to look at$/);
    const count = Number((await page.locator("header .pill.lint").textContent())?.split(" ")[0]);
    expect(count).toBeLessThanOrEqual(5);
    const group = page.locator(".checks details.grouped");
    await expect(group).toHaveCount(1);
    await expect(group.locator("summary")).toContainText(
      /\d+ required actions are not on any key yet/,
    );
    await group.locator("summary").click();
    expect(await group.locator("li").count()).toBeGreaterThan(10);
    await shot(page, "02-edit-checks-grouped");

    // And the mouse button the export sends is not a finding any more.
    await expect(page.locator(".checks")).not.toContainText("unbound-key");
  });

  test("lets its actions be named and tagged in the page, and saves them in place", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator("header select").first().selectOption({ label: NAME });
    await tab(page, "In-game");

    // What is missing, and what to do about it, in the owner's words.
    const note = page.locator(".game-file");
    await expect(note).toContainText("not connected");
    await expect(note).toContainText("controls screen");
    await expect(note).not.toContainText("ingame_config");
    await shot(page, "03-ingame-new-game");

    const row = page.locator(".ingame-row", { hasText: "F (unnamed)" }).first();
    await row.locator("b.rename").click();
    const box = page.locator(".rename-input");
    await expect(box).toBeFocused();
    await box.fill("Fire, primary");
    await box.press("Enter");
    const renamed = page.locator(".ingame-row", { hasText: "Fire, primary" });
    await expect(renamed).toHaveCount(1);
    await renamed.locator(".tag-chip", { hasText: /^combat$/ }).click();
    await renamed.locator(".tag-chip", { hasText: /^required$/ }).click();
    await expect(renamed.locator(".tag-chip.on")).toHaveCount(2);
    await expect(page.locator("header button.primary.dirty")).toHaveAttribute(
      "title",
      /Action names/,
    );
    await shot(page, "04-ingame-renamed");

    const before = readFileSync(join(FOLDER, "actions.yaml"), "utf8");
    await page.locator("header button.primary.dirty").click();
    await expect(page.locator(".save-report > div").first()).toHaveText(/^Saved /, {
      timeout: 120_000,
    });
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
    // No offer to rewrite a game file there is none of.
    await expect(page.locator(".game-step")).toHaveCount(0);

    const after = readFileSync(join(FOLDER, "actions.yaml"), "utf8");
    expect(after).toContain('label: "Fire, primary"');
    expect(after).toMatch(/tags: \[combat, required\]/);
    // Only that line moved: the header comment, the extends line and every other action.
    expect(after).toContain("# Seeded by `azeron import`");
    expect(after).toContain("extends: genres/FPS/actions.yaml");
    const changed = after.split("\n").filter((line, index) => line !== before.split("\n")[index]);
    expect(changed).toHaveLength(1);

    // It is on disk, so a fresh page shows it.
    await page.reload();
    await page.locator("header select").first().selectOption({ label: NAME });
    await tab(page, "In-game");
    const again = page.locator(".ingame-row", { hasText: "Fire, primary" });
    await expect(again.locator(".tag-chip.on")).toHaveCount(2);
  });

  test("says on the Setup tab why its own key settings cannot be written", async ({ page }) => {
    await page.goto("/");
    await page.locator("header select").first().selectOption({ label: NAME });
    await tab(page, "Setup");
    await expect(page.locator(".game-file")).toContainText("not connected");
    await expect(page.getByRole("button", { name: "Write the game's bindings" })).toHaveCount(0);
    await shot(page, "05-setup-not-connected");
  });

  test("answers 'saved' when the file was written and only the check failed", async ({
    request,
  }) => {
    // The save wrote the file; the check after it could not run. That is a saved file with
    // a note, not a refusal -- the route used to answer "not saved" about a file it had
    // written.
    const profile = join(FOLDER, "profiles", "v1-left.yaml");
    const original = readFileSync(profile, "utf8");
    try {
      writeFileSync(profile, `${original}positions: [\n`, "utf8");
      const reply = await request.post("/api/actions", {
        data: { game: SLUG, changes: { key_w: { label: "Check cannot run" } } },
      });
      const body = (await reply.json()) as { ok: boolean; saved?: boolean; check?: unknown };
      expect(reply.status()).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.saved).toBe(true);
      expect(body.check).toHaveProperty("error");
      expect(readFileSync(join(FOLDER, "actions.yaml"), "utf8")).toContain("Check cannot run");
    } finally {
      writeFileSync(profile, original, "utf8");
    }
  });

  test("refuses a key that is not a key name, and writes nothing", async ({ request }) => {
    const file = join(FOLDER, "actions.yaml");
    const before = readFileSync(file, "utf8");
    for (const key of [5, true, ["KeyA"], "Key A, label: x"]) {
      const reply = await request.post("/api/actions", {
        data: { game: SLUG, changes: { key_w: { key } } },
      });
      expect(reply.status()).toBe(400);
      expect(readFileSync(file, "utf8")).toBe(before);
    }
  });

  test("leaves nothing behind once the specs are done", () => {
    expect(existsSync(FOLDER)).toBe(true);
    cleanup();
    expect(existsSync(FOLDER)).toBe(false);
    expect(existsSync(DIST)).toBe(false);
    expect(existsSync(TEMPLATE)).toBe(false);
  });
});

const WINDOWS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1080, height: 1920 },
  { width: 1200, height: 1920 },
] as const;

for (const { width, height } of WINDOWS) {
  test.describe(`a new game at ${String(width)}x${String(height)}`, () => {
    test.use({ viewport: { width, height } });

    test.beforeAll(cleanup);
    test.afterAll(cleanup);

    for (const name of ["Edit", "In-game", "Setup"] as const) {
      test(`${name} is no wider than the window, in light and dark`, async ({ page }) => {
        await createThroughThePage(page);
        for (const theme of ["light", "dark"] as const) {
          await page.evaluate((chosen) => {
            document.documentElement.setAttribute("data-theme", chosen);
          }, theme);
          await tab(page, name);
          const wide = await page.evaluate(() => ({
            page: document.documentElement.scrollWidth,
            offenders: [...document.querySelectorAll("body *")]
              .filter((node) => node.getBoundingClientRect().right > window.innerWidth + 1)
              .slice(0, 3)
              .map((node) => node.className || node.tagName),
          }));
          expect(wide.offenders).toEqual([]);
          expect(wide.page).toBeLessThanOrEqual(width);
          if (name === "In-game")
            await shot(page, `06-ingame-${theme}-${String(width)}x${String(height)}`);
        }
        cleanup();
      });
    }
  });
}
