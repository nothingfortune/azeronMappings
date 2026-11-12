// @vitest-environment happy-dom
/**
 * A game started from an export has no settings file of the game's own connected, so its
 * keys cannot be written into the game. The page says what is missing and what to do
 * instead, rather than a button that fails with the name of a config key.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseGame } from "../../helpers/editor.js";

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
    expect(text).toContain("is not told its keys automatically");
    expect([...(note?.querySelectorAll("li") ?? [])]).toHaveLength(3);
    // In the owner's terms, not the file's.
    expect(text).not.toContain("ingame_config");
    expect(text).not.toContain("game.yaml");
    expect(text).toContain("controls screen");
    expect(text).not.toContain("developer work");
    // And it does not promise what it cannot do.
    expect(document.querySelector(".panel .note")?.textContent).not.toContain("offers to update");
  });

  it("has no Read or Write button on the Setup tab, and says why in their place", () => {
    tab("Setup");
    expect(buttons()).not.toContain("Update the game's keys…");
    expect(buttons()).not.toContain("Compare with the game's keys");
    expect(document.querySelector(".game-file")?.textContent).toContain(
      "not told its keys automatically",
    );
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
    start(payload);
    chooseGame(payload.games[index]?.slug ?? "");
    tab("In-game");
    expect(document.querySelector(".game-file")).toBeNull();
    tab("Setup");
    expect(buttons()).toContain("Update the game's keys…");
    expect(buttons()).toContain("Compare with the game's keys");
    expect(document.querySelector(".game-file")).toBeNull();
  });
});

describe("a game whose settings file is not on this computer", () => {
  let calls: { path: string; body: unknown }[] = [];
  const open = (found: boolean | undefined): void => {
    calls = served();
    document.body.innerHTML = '<div id="app"></div>';
    const payload = structuredClone(PAYLOAD);
    const game = payload.games.find((entry) => entry.slug === "everspace");
    if (!game?.ingameFile) throw new Error("no everspace file");
    if (found === undefined) delete game.ingameFile.found;
    else game.ingameFile.found = found;
    start(payload);
    chooseGame(game.slug);
    tab("Setup");
  };
  const note = (): string => document.querySelector(".game-file-missing")?.textContent ?? "";

  it("asks where the file is, with no file to edit, and still offers Compare", () => {
    // The fixture's game.yaml names a file no computer has, which is exactly this case.
    expect(PAYLOAD.games.find((game) => game.slug === "everspace")?.ingameFile?.found).toBe(false);
    open(false);
    expect(note()).toContain("was not found on this computer");
    expect(note()).not.toContain("local.yaml");
    expect(document.querySelector('[data-game-file="path"]')).not.toBeNull();
    expect(buttons()).toContain("Compare with the game's keys");
  });

  it("sends the location pasted in, for this game", async () => {
    open(false);
    const path = document.querySelector<HTMLInputElement>('[data-game-file="path"]');
    if (!path) throw new Error("no location box");
    path.value = String.raw`"D:\Games\Everspace 2\Input.ini"`;
    document.querySelector<HTMLButtonElement>('[data-game-file="use"]')?.click();
    await vi.waitFor(() => {
      expect(calls.some((call) => call.path === "/api/local/game-file")).toBe(true);
    });
    expect(calls.find((call) => call.path === "/api/local/game-file")?.body).toEqual({
      game: "everspace",
      path: String.raw`"D:\Games\Everspace 2\Input.ini"`,
    });
  });

  it("says nothing once the file is found", () => {
    open(true);
    expect(document.querySelector(".game-file-missing")).toBeNull();
  });
});

describe("a game whose file is Elite's bindings", () => {
  it("is connected without categories: Elite's file is owned control by control", () => {
    served();
    document.body.innerHTML = '<div id="app"></div>';
    const payload = structuredClone(PAYLOAD);
    const game = payload.games.find((entry) => entry.slug === "everspace");
    if (!game) throw new Error("no everspace");
    game.ingameFile = { configured: true, ownedCategories: 0, format: "elite-binds" };
    start(payload);
    chooseGame(game.slug);
    tab("In-game");
    expect(document.querySelector(".game-file")).toBeNull();
    tab("Setup");
    expect(buttons()).toContain("Update the game's keys…");
  });

  it("is what the payload says for a game that names the format, and an ini otherwise", () => {
    expect(PAYLOAD.games.find((game) => game.slug === "everspace")?.ingameFile?.format).toBe(
      "unreal-ini",
    );
  });
});
