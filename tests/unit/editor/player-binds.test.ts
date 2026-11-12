// @vitest-environment happy-dom
/**
 * Keyboard-and-mouse and controller bindings on the In-game tab: captured by pressing,
 * saved with the actions, and never part of what the units are sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { showWiring } from "../../helpers/editor.js";

const PAYLOAD = buildPayload();
const SERVED = window as unknown as { AZERON_SERVED?: boolean };
const OK = {
  ok: true,
  saved: true,
  path: "p",
  check: { game: null, built: [], findings: [], buildErrors: [] },
};

let calls: { path: string; body: unknown }[] = [];

function open(): void {
  SERVED.AZERON_SERVED = true;
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: { body?: string }) => {
      calls.push({ path, body: init?.body === undefined ? null : JSON.parse(init.body) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(OK) });
    }),
  );
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(PAYLOAD));
  [...document.querySelectorAll<HTMLButtonElement>("header .tabs button")]
    .find((button) => button.textContent === "In-game")
    ?.click();
}

/** An action of the test data, by its id: the first one the list shows. */
function firstAction(): string {
  const chip = document.querySelector<HTMLElement>("[data-kbm]");
  const id = chip?.getAttribute("data-kbm");
  if (!id) throw new Error("no keyboard field");
  return id;
}

const press = (code: string, type: "keydown" | "keyup"): void => {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
};

beforeEach(open);

afterEach(() => {
  SERVED.AZERON_SERVED = false;
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "getGamepads");
});

describe("a keyboard-and-mouse binding", () => {
  it("is captured with its modifiers by pressing it, and saved with the actions", async () => {
    const id = firstAction();
    document.querySelector<HTMLButtonElement>(`[data-kbm="${id}"]`)?.click();
    press("ControlLeft", "keydown");
    press("KeyR", "keydown");
    press("KeyR", "keyup");
    press("ControlLeft", "keyup");
    expect(document.querySelector(`[data-kbm="${id}"]`)?.textContent).toMatch(/Ctrl.*R/);
    [...document.querySelectorAll<HTMLButtonElement>("header button")]
      .find((button) => button.textContent === "Save")
      ?.click();
    await vi.waitFor(() => {
      expect(calls.some((call) => call.path === "/api/actions")).toBe(true);
    });
    const body = calls.find((call) => call.path === "/api/actions")?.body as {
      changes: Record<string, Record<string, unknown>>;
    };
    expect(body.changes[id]).toEqual({ kbm: "ControlLeft+KeyR" });
  });

  it("stops listening when the tab changes, so the next key lands nowhere", () => {
    const id = firstAction();
    document.querySelector<HTMLButtonElement>(`[data-kbm="${id}"]`)?.click();
    [...document.querySelectorAll<HTMLButtonElement>("header .tabs button")]
      .find((button) => button.textContent === "Edit")
      ?.click();
    press("KeyQ", "keydown");
    [...document.querySelectorAll<HTMLButtonElement>("header .tabs button")]
      .find((button) => button.textContent === "In-game")
      ?.click();
    expect(document.querySelector(`[data-kbm="${id}"]`)?.textContent).toBe("—");
  });

  it("gives way to a game-key capture started after it: the next key goes there", () => {
    const id = firstAction();
    document.querySelector<HTMLButtonElement>(`[data-kbm="${id}"]`)?.click();
    showWiring();
    const row = document.querySelector(`[data-kbm="${id}"]`)?.closest(".ingame-row");
    row?.querySelector<HTMLButtonElement>(".key-chip")?.click();
    press("KeyQ", "keydown");
    expect(document.querySelector(`[data-kbm="${id}"]`)?.textContent).toBe("—");
  });

  it("does not bring back an action deleted while its binding was being captured", () => {
    const payload = structuredClone(PAYLOAD);
    const game = payload.games[0];
    if (game) game.actions.actions = { ...game.actions.actions, wave: { label: "Wave" } };
    document.body.innerHTML = '<div id="app"></div>';
    start(payload);
    [...document.querySelectorAll<HTMLButtonElement>("header .tabs button")]
      .find((button) => button.textContent === "In-game")
      ?.click();
    document.querySelector<HTMLButtonElement>('[data-kbm="wave"]')?.click();
    document
      .querySelector('[data-kbm="wave"]')
      ?.closest(".ingame-row")
      ?.querySelector<HTMLButtonElement>(".delete-action")
      ?.click();
    press("KeyQ", "keydown");
    expect(document.querySelector('[data-kbm="wave"]')).toBeNull();
  });

  it("forgets a modifier let go of while the window was not looking", () => {
    const id = firstAction();
    document.querySelector<HTMLButtonElement>(`[data-kbm="${id}"]`)?.click();
    press("ControlLeft", "keydown");
    window.dispatchEvent(new Event("blur"));
    press("KeyR", "keydown");
    expect(document.querySelector(`[data-kbm="${id}"]`)?.textContent).toBe("R");
  });

  it("is a modifier on its own when it is let go with nothing after it", () => {
    const id = firstAction();
    document.querySelector<HTMLButtonElement>(`[data-kbm="${id}"]`)?.click();
    press("ShiftLeft", "keydown");
    press("ShiftLeft", "keyup");
    expect(document.querySelector(`[data-kbm="${id}"]`)?.textContent).toMatch(/Shift/);
  });

  it("is a mouse button clicked on the field while it listens", () => {
    const id = firstAction();
    const chip = (): HTMLElement | null => document.querySelector(`[data-kbm="${id}"]`);
    chip()?.click();
    chip()?.dispatchEvent(new MouseEvent("mousedown", { button: 2, bubbles: true }));
    expect(chip()?.textContent).toBe("Right click");
  });
});

describe("a controller binding", () => {
  it("is picked from the pad's controls", () => {
    const id = firstAction();
    const select = document.querySelector<HTMLSelectElement>(`[data-pad="${id}"]`);
    if (!select) throw new Error("no controller field");
    select.value = "RT";
    select.dispatchEvent(new Event("change"));
    expect(document.querySelector<HTMLSelectElement>(`[data-pad="${id}"]`)?.value).toBe("RT");
  });

  it("is read from a connected pad when asked to listen", async () => {
    const buttons = Array.from({ length: 16 }, (_, index) => ({ pressed: index === 3 }));
    // happy-dom has no Gamepad API: give it one pad holding Y.
    Object.defineProperty(navigator, "getGamepads", {
      value: () => [{ buttons, axes: [0, 0, 0, 0] }],
      configurable: true,
    });
    const id = firstAction();
    document.querySelector<HTMLButtonElement>(`[data-pad-press="${id}"]`)?.click();
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLSelectElement>(`[data-pad="${id}"]`)?.value).toBe("Y");
    });
  });
});

describe("the drawings in a game with modes of play", () => {
  it("show only the actions the open layout plays", () => {
    const payload = structuredClone(PAYLOAD);
    const game = payload.games[0];
    if (!game) throw new Error("no game");
    game.actions.actions = {
      ...game.actions.actions,
      fire_guns: { label: "Fire guns", mode: "ship", kbm: "KeyH" },
      buggy_horn: { label: "Buggy horn", mode: "srv", kbm: "KeyH" },
    };
    const set = Object.keys(game.sets.sets)[0];
    if (set === undefined) throw new Error("no set");
    game.sets.sets[set] = { ...game.sets.sets[set], modes: ["ship"] };
    document.body.innerHTML = '<div id="app"></div>';
    start(payload);
    const sets = document.querySelectorAll<HTMLSelectElement>("header select")[1];
    if (sets) {
      sets.value = set;
      sets.dispatchEvent(new Event("change"));
    }
    [...document.querySelectorAll<HTMLButtonElement>("header .tabs button")]
      .find((button) => button.textContent === "In-game")
      ?.click();
    const h = [...document.querySelectorAll<HTMLElement>(".keyboard-board .device-key")].find(
      (node) => node.querySelector(".device-key-name")?.textContent === "H",
    );
    expect(h?.title).toBe("Fire guns");
    expect(h?.classList.contains("shared")).toBe(false);
  });
});
