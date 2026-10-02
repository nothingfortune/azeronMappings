// @vitest-environment happy-dom
/**
 * A game started from an export has no settings file of the game's own connected, so its
 * keys cannot be written into the game. The page says what is missing and what to do
 * instead, rather than a button that fails with the name of a config key.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import type { EditorPayload } from "../../../src/types/editor.js";

const PAYLOAD = buildPayload();

const OK = {
  ok: true,
  saved: true,
  path: "p",
  check: { game: null, built: [], findings: [], buildErrors: [] },
};

function served(): { path: string; body: unknown }[] {
  (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = true;
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: { body?: string }) => {
      calls.push({
        path,
        body: init?.body === undefined ? null : (JSON.parse(init.body) as unknown),
      });
      return Promise.resolve({ status: 200, json: () => Promise.resolve(OK) });
    }),
  );
  return calls;
}

/** The first game as a fresh one: nothing connected, no action naming a row in the game. */
function unconnected(): EditorPayload {
  const payload = structuredClone(PAYLOAD);
  const game = payload.games[0];
  if (!game) throw new Error("no game");
  delete game.ingameFile;
  for (const spec of Object.values(game.actions.actions ?? {})) delete spec.ingame;
  return payload;
}

function tab(name: string): void {
  const found = [...document.querySelectorAll<HTMLButtonElement>("header .tabs button")].find(
    (button) => button.textContent === name,
  );
  if (!found) throw new Error(`no ${name} tab`);
  found.click();
}

/** The buttons on the tab itself. The header's menu offers the update under the same name. */
const buttons = (): string[] =>
  [...document.querySelectorAll("button")]
    .filter((button) => button.closest("header") === null)
    .map((button) => button.textContent);

afterEach(() => {
  (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = false;
  vi.unstubAllGlobals();
});

describe("a game whose own settings file is not connected", () => {
  beforeEach(() => {
    served();
    document.body.innerHTML = '<div id="app"></div>';
    start(unconnected());
  });

  it("says on the In-game tab what is missing and what to do instead", () => {
    tab("In-game");
    const note = document.querySelector(".game-file");
    expect(note).not.toBeNull();
    const text = note?.textContent ?? "";
    expect(text).toContain("key settings are not connected");
    expect([...(note?.querySelectorAll("li") ?? [])]).toHaveLength(3);
    // In the owner's terms, not the file's.
    expect(text).not.toContain("ingame_config");
    expect(text).not.toContain("game.yaml");
    expect(text).toContain("controls screen");
    expect(text).toContain("developer work");
    // And it does not promise what it cannot do.
    expect(document.querySelector(".panel .note")?.textContent).not.toContain("offers to update");
  });

  it("has no Read or Write button on the Setup tab, and says why in their place", () => {
    tab("Setup");
    expect(buttons()).not.toContain("Update the game's keys…");
    expect(buttons()).not.toContain("Compare with the game's keys");
    expect(document.querySelector(".game-file")?.textContent).toContain("not connected");
  });

  it("does not offer to update the game after saving a key, and the menu item says why", async () => {
    const calls = served();
    document.body.innerHTML = '<div id="app"></div>';
    start(unconnected());
    tab("In-game");
    const chip = document.querySelector<HTMLButtonElement>(".ingame-row .key-chip");
    chip?.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyL", bubbles: true }));
    const save = [...document.querySelectorAll<HTMLButtonElement>("header button")].find(
      (button) => button.textContent === "Save",
    );
    save?.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".save-report")).not.toBeNull();
    });
    expect(calls.map((call) => call.path)).toContain("/api/actions");
    expect(document.querySelector(".game-step")).toBeNull();

    const item = [...document.querySelectorAll<HTMLButtonElement>(".menu-item")].find((button) =>
      button.textContent.startsWith("Update the game"),
    );
    item?.click();
    expect(document.querySelector(".save-note")?.textContent).toContain("cannot be written");
  });
});

describe("a game whose own settings file is connected", () => {
  it("shows no such note, and keeps its Read and Write buttons", () => {
    served();
    document.body.innerHTML = '<div id="app"></div>';
    const payload = structuredClone(PAYLOAD);
    const index = payload.games.findIndex((game) => game.slug === "everspace");
    const select = () => document.querySelector<HTMLSelectElement>("header select");
    start(payload);
    const picker = select();
    if (!picker) throw new Error("no game selector");
    picker.value = String(index);
    picker.dispatchEvent(new Event("change"));
    tab("In-game");
    expect(document.querySelector(".game-file")).toBeNull();
    tab("Setup");
    expect(buttons()).toContain("Update the game's keys…");
    expect(buttons()).toContain("Compare with the game's keys");
    expect(document.querySelector(".game-file")).toBeNull();
  });
});
