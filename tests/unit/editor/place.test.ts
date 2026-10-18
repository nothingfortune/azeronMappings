// @vitest-environment happy-dom
/**
 * A reload opens where the page was: the game, the layout and the tab. It used to open on
 * the first game every time.
 */
import { describe, expect, it } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import type { EditorPayload } from "../../../src/types/editor.js";

const PAYLOAD = buildPayload();

/** The fixture has one game; a second, so there is a game to come back to that is not the first. */
function twoGames(): EditorPayload {
  const payload = structuredClone(PAYLOAD);
  const first = payload.games[0];
  if (!first) throw new Error("no game in the fixture");
  payload.games.push({ ...structuredClone(first), slug: "second", name: "Second game" });
  return payload;
}

function mount(payload: EditorPayload = PAYLOAD): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(payload));
}

const selects = (): HTMLSelectElement[] => [
  ...document.querySelectorAll<HTMLSelectElement>("header select"),
];
const choose = (index: number, value: string): void => {
  const select = selects()[index];
  if (!select) throw new Error(`no header select ${String(index)}`);
  select.value = value;
  select.dispatchEvent(new Event("change"));
};
const tab = (name: string): void => {
  const button = [...document.querySelectorAll<HTMLButtonElement>("header .tabs button")].find(
    (entry) => entry.textContent === name,
  );
  if (!button) throw new Error(`no tab ${name}`);
  button.click();
};
const openTab = (): string =>
  document.querySelector("header .tabs button.primary")?.textContent ?? "";
const layouts = (): string[] => [...(selects()[1]?.options ?? [])].map((option) => option.value);

describe("where the page was, across a reload", () => {
  it("opens on the game, the layout and the tab it was on", () => {
    mount(twoGames());
    choose(0, "1");
    const layout = layouts().at(-1) ?? "";
    expect(layouts().length).toBeGreaterThan(1);
    choose(1, layout);
    tab("In-game");
    mount(twoGames());
    expect(selects()[0]?.value).toBe("1");
    expect(selects()[1]?.value).toBe(layout);
    expect(openTab()).toBe("In-game");
  });

  it("opens on the first game and its first layout when the one kept has gone", () => {
    mount(twoGames());
    choose(0, "1");
    mount();
    expect(selects()[0]?.value).toBe("0");
    expect(selects()[1]?.value).toBe(layouts()[0]);
  });

  it("opens on the game's first layout when the layout kept has gone", () => {
    window.localStorage.setItem(
      "azeron-editor-place",
      JSON.stringify({ game: PAYLOAD.games[0]?.slug, set: "gone", mode: "edit" }),
    );
    mount();
    expect(selects()[1]?.value).toBe(layouts()[0]);
  });

  it("opens on Edit after a reload on the press test, which is a run, not a place", () => {
    mount();
    tab("Press test");
    mount();
    expect(openTab()).toBe("Edit");
  });

  it("takes what it cannot read for nothing kept", () => {
    window.localStorage.setItem("azeron-editor-place", "{not json");
    mount();
    expect(selects()[0]?.value).toBe("0");
    expect(openTab()).toBe("Edit");
  });
});
