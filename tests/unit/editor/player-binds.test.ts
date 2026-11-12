// @vitest-environment happy-dom
/**
 * Keyboard-and-mouse and controller bindings on the In-game tab: captured by pressing,
 * saved with the actions, and never part of what the units are sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";

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
