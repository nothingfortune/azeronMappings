// @vitest-environment happy-dom
/**
 * State the page holds for a while -- a key being captured, the press test, edits that are
 * not saved -- and what has to happen to it when the game, the tab or the data changes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import type { EditorPayload } from "../../../src/types/editor.js";
import { showWiring } from "../../helpers/editor.js";

const PAYLOAD = buildPayload();

const OK = {
  ok: true,
  saved: true,
  path: "p",
  check: { game: null, built: [], findings: [], buildErrors: [] },
};

function served(): void {
  (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ status: 200, json: () => Promise.resolve(OK) })),
  );
}

function mount(payload = structuredClone(PAYLOAD)): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(payload);
}

/** The repo has one game worth the name here, so a second is a copy under another name. */
function withSecondGame(): EditorPayload {
  const payload = structuredClone(PAYLOAD);
  const first = payload.games[0];
  if (!first) throw new Error("no game");
  payload.games.push({ ...structuredClone(first), slug: "second", name: "Second game" });
  return payload;
}

function headerButton(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("header button")].find(
    (button) => button.textContent === label,
  );
  if (!found) throw new Error(`no header button ${label}`);
  return found;
}

const clean = (): boolean => {
  const saved = [...document.querySelectorAll<HTMLButtonElement>("header button")].find(
    (button) => button.textContent === "Saved",
  );
  return saved?.hasAttribute("disabled") === true;
};

function gameSelect(): HTMLSelectElement {
  const found = document.querySelector<HTMLSelectElement>("header select");
  if (!found) throw new Error("no game selector");
  return found;
}

function chooseGame(index: number): void {
  const select = gameSelect();
  select.value = String(index);
  select.dispatchEvent(new Event("change"));
}

function press(code: string): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
}

afterEach(() => {
  (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = false;
  vi.unstubAllGlobals();
});

describe("looking at an empty key", () => {
  beforeEach(() => {
    served();
    mount();
  });

  /** Whether the browser would be asked to confirm leaving the page. */
  function asksBeforeLeaving(): boolean {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it("is not an edit", () => {
    // Drawing the inspector for a position with nothing on it put an empty entry into the
    // working copy. The header is drawn before the inspector, so it said Saved until the
    // next redraw, then Save -- and leaving the page asked whether to discard edits that
    // were never made.
    const empties = document.querySelectorAll<HTMLButtonElement>(".hand .key.empty");
    expect(empties.length).toBeGreaterThan(1);
    expect(clean()).toBe(true);
    empties[0]?.click();
    expect(document.querySelector(".key.selected")).not.toBeNull();
    // A second look is a second redraw, which is where the mark appeared.
    document.querySelectorAll<HTMLButtonElement>(".hand .key.empty")[1]?.click();
    expect(clean()).toBe(true);
    expect(asksBeforeLeaving()).toBe(false);
  });

  it("is still an edit once something is put on it, and saves no empty entries", () => {
    const empty = document.querySelector<HTMLButtonElement>(".hand .key.empty");
    const position = empty?.dataset.position;
    empty?.click();
    document.querySelector<HTMLButtonElement>(".action")?.click();
    expect(clean()).toBe(false);
    expect(headerButton("Save").title).toContain("unit");
    expect(position).toBeDefined();
  });
});

describe("opening a data file", () => {
  beforeEach(() => {
    served();
    mount();
  });

  /** Hand the menu's file picker a payload, as choosing a file would. */
  function choose(payload: unknown): void {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("no file input");
    const file = new File([JSON.stringify(payload)], "editor-data.json", {
      type: "application/json",
    });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));
  }

  function edited(): void {
    const key = document.querySelector<HTMLButtonElement>('.hand .key[data-position="pinky_1"]');
    key?.click();
    const actions = document.querySelectorAll<HTMLButtonElement>(".action");
    [...actions].find((action) => !action.classList.contains("on"))?.click();
    expect(clean()).toBe(false);
  }

  function renamed(): unknown {
    const next = structuredClone(PAYLOAD);
    const game = next.games[0];
    if (game) game.name = "Replacement data";
    return next;
  }

  it("asks first when there are unsaved edits, and keeps them if the answer is no", async () => {
    edited();
    const confirm = vi.fn((_message: string) => false);
    vi.stubGlobal("confirm", confirm);
    choose(renamed());
    await vi.waitFor(() => {
      expect(confirm).toHaveBeenCalled();
    });
    expect(confirm.mock.calls[0]?.[0] ?? "").toContain("discards edits");
    expect(gameSelect().textContent).not.toContain("Replacement data");
    expect(clean()).toBe(false);
  });

  it("takes the file when the answer is yes", async () => {
    edited();
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    choose(renamed());
    await vi.waitFor(() => {
      expect(gameSelect().textContent).toContain("Replacement data");
    });
    expect(clean()).toBe(true);
  });

  it("does not ask when nothing is unsaved", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    choose(renamed());
    await vi.waitFor(() => {
      expect(gameSelect().textContent).toContain("Replacement data");
    });
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("a key being captured, and the press test, across a change of game or tab", () => {
  beforeEach(() => {
    served();
    mount(withSecondGame());
    headerButton("In-game").click();
    showWiring();
  });

  function startCapture(): void {
    document.querySelector<HTMLButtonElement>(".ingame-row .key-chip")?.click();
    expect(document.querySelector(".key-chip.capturing")).not.toBeNull();
  }

  it("stops capturing when the game changes, so the key cannot land on the other game", () => {
    startCapture();
    chooseGame(1);
    expect(document.querySelector(".key-chip.capturing")).toBeNull();
    press("KeyL");
    expect(clean()).toBe(true);
    // And back: the first game was never touched either.
    chooseGame(0);
    expect(clean()).toBe(true);
  });

  it("stops capturing when the tab changes", () => {
    startCapture();
    headerButton("Edit").click();
    press("KeyL");
    expect(clean()).toBe(true);
    headerButton("In-game").click();
    showWiring();
    expect(document.querySelector(".key-chip.capturing")).toBeNull();
    expect(clean()).toBe(true);
  });

  it("still captures a key on the game it was started on", () => {
    startCapture();
    press("KeyL");
    expect(clean()).toBe(false);
  });

  it("starts the press test again for the new game rather than keeping the old one", () => {
    headerButton("Press test").click();
    const host = (): Element | null =>
      document.querySelector(".workspace .panel")?.lastElementChild ?? null;
    const before = host();
    expect(before).not.toBeNull();
    chooseGame(1);
    expect(host()).not.toBe(before);
  });

  it("keeps the press test going when its own tab is clicked again", () => {
    headerButton("Press test").click();
    const host = document.querySelector(".workspace .panel")?.lastElementChild;
    headerButton("Press test").click();
    expect(document.querySelector(".workspace .panel")?.lastElementChild).toBe(host);
  });
});
