/**
 * Edits that save themselves, the way back from one (Undo), and what a save that happens
 * on its own leaves in the header for the owner to do.
 *
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { LIVE_SET } from "../../helpers/fixtures.js";

const PAYLOAD = buildPayload();
const PAGE = window as unknown as { AZERON_SERVED?: boolean; AZERON_AUTOSAVE?: boolean };

interface Call {
  path: string;
  body: Record<string, unknown>;
}

const OK = {
  ok: true,
  saved: true,
  path: "p",
  check: { game: null, built: [], findings: [], buildErrors: [] },
};

function served(reply: (call: Call) => { status?: number; body: unknown } = () => ({ body: OK })) {
  PAGE.AZERON_SERVED = true;
  PAGE.AZERON_AUTOSAVE = true;
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init: { body: string }) => {
      const call = { path, body: JSON.parse(init.body) as Record<string, unknown> };
      calls.push(call);
      const answer = reply(call);
      return Promise.resolve({
        status: answer.status ?? 200,
        json: () => Promise.resolve(answer.body),
      });
    }),
  );
  return calls;
}

function mount(): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(PAYLOAD));
  const select = document.querySelectorAll<HTMLSelectElement>("header select")[1];
  if (select && select.value !== LIVE_SET) {
    select.value = LIVE_SET;
    select.dispatchEvent(new Event("change"));
  }
}

/** The first empty key on the left unit, wherever the layout has one. */
function emptyKey(): string {
  const found = document.querySelectorAll(".hand")[0]?.querySelector<HTMLElement>(".key.empty");
  const position = found?.getAttribute("data-position");
  if (!position) throw new Error("the left unit has no empty key");
  return position;
}

function key(position: string): HTMLElement {
  const found = document
    .querySelectorAll(".hand")[0]
    ?.querySelector<HTMLElement>(`.key[data-position="${position}"]`);
  if (!found) throw new Error(`no key ${position}`);
  return found;
}

/** An action that already has a key of its own, so placing it changes the keypad only. */
function action(label = "Headlight"): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>(".action")].find(
    (node) => node.querySelector("b")?.textContent === label,
  );
  if (!found) throw new Error(`no action ${label}`);
  return found;
}

function place(position: string, label?: string): void {
  action(label).dispatchEvent(new Event("dragstart", { bubbles: true }));
  key(position).dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
}

const header = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>("header button")].find(
    (node) => node.textContent === text,
  );
const undoButton = (): HTMLButtonElement => {
  const found = document.querySelector<HTMLButtonElement>("[data-undo]");
  if (!found) throw new Error("no undo button");
  return found;
};
const menuItem = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>(".menu-item")].find(
    (node) => node.textContent === label,
  );

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  PAGE.AZERON_SERVED = false;
  PAGE.AZERON_AUTOSAVE = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("an edit on the served page", () => {
  it("is saved by the page shortly after it is made, with no report put on screen", async () => {
    const calls = served();
    mount();
    place(emptyKey());
    expect(calls).toEqual([]);
    expect(header("Save")).toBeDefined();

    await vi.advanceTimersByTimeAsync(799);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map((call) => call.path)).toEqual(["/api/save"]);
    expect(String(calls[0]?.body.path)).toMatch(/profiles\/.*left.*\.yaml$/);
    expect(header("Saved")).toBeDefined();
    expect(document.querySelector(".save-report")).toBeNull();
    expect(document.querySelector(".save-note")).toBeNull();
  });

  it("waits for a pause, so a run of edits is one save", async () => {
    const calls = served();
    mount();
    const first = emptyKey();
    place(first);
    await vi.advanceTimersByTimeAsync(500);
    place(first, "Toggle HUD");
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(calls.length).toBe(1);
  });

  it("leaves the files to import in the header, to be opened and ticked off", async () => {
    served(() => ({
      body: {
        ...OK,
        check: {
          ...OK.check,
          built: [{ output: "left.json", importPath: "C:\\dist\\left.json", changed: true }],
        },
      },
    }));
    mount();
    place(emptyKey());
    await vi.advanceTimersByTimeAsync(800);

    const todo = document.querySelector<HTMLButtonElement>('[data-todo="import"]');
    expect(todo?.textContent).toBe("Re-import 1");
    todo?.click();
    expect(document.querySelector(".save-report.imports")?.textContent).toContain(
      "C:\\dist\\left.json",
    );
    header("I have imported them");
    [...document.querySelectorAll<HTMLButtonElement>(".save-report button")]
      .find((node) => node.textContent === "I have imported them")
      ?.click();
    expect(document.querySelector('[data-todo="import"]')).toBeNull();
  });

  it("leaves the game to be told in the header when the wiring changed", async () => {
    served();
    mount();
    // Free look has no key until it is put on a control.
    place(emptyKey(), "Free look (toggle)");
    await vi.advanceTimersByTimeAsync(800);
    expect(document.querySelector('[data-todo="game"]')?.textContent).toBe(
      "Update the game's keys…",
    );
  });

  it("does not send the same refused edits again and again", async () => {
    const calls = served(() => ({
      status: 400,
      body: { ok: false, error: "no room on the disk" },
    }));
    mount();
    const position = emptyKey();
    place(position);
    await vi.advanceTimersByTimeAsync(800);
    expect(calls.length).toBe(1);
    expect(document.querySelector(".save-note")?.textContent).toContain("not saved");
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls.length).toBe(1);
    // Another edit is another state, and worth another try.
    place(position, "Toggle HUD");
    await vi.advanceTimersByTimeAsync(800);
    expect(calls.length).toBe(2);
  });

  it("waits for Save when autosave is turned off from the menu, and stays off", async () => {
    const calls = served();
    mount();
    menuItem("Turn autosave off")?.click();
    expect(window.localStorage.getItem("azeron-autosave")).toBe("off");
    place(emptyKey());
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toEqual([]);
    expect(header("Save")).toBeDefined();
    mount();
    expect(menuItem("Turn autosave on")).toBeDefined();
  });

  it("is not saved on its own by a page the server did not say may", async () => {
    const calls = served();
    PAGE.AZERON_AUTOSAVE = false;
    mount();
    expect(menuItem("Turn autosave off")).toBeUndefined();
    place(emptyKey());
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toEqual([]);
  });
});

describe("taking a change back", () => {
  it("has nothing to undo until something changes", () => {
    mount();
    expect(undoButton().disabled).toBe(true);
  });

  it("restores the layout as it was before the last change, one change at a time", () => {
    mount();
    const position = emptyKey();
    place(position);
    place(position, "Toggle HUD");
    expect(key(position).querySelector(".name")?.textContent).toBe("Toggle HUD");

    undoButton().click();
    expect(key(position).querySelector(".name")?.textContent).toBe("Headlight");
    undoButton().click();
    expect(key(position).classList.contains("empty")).toBe(true);
    expect(undoButton().disabled).toBe(true);
  });

  it("answers Ctrl+Z, except in a text box, where it belongs to the text", () => {
    mount();
    const position = emptyKey();
    place(position);
    const filter = document.querySelector<HTMLInputElement>(".panel .filter");
    filter?.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(key(position).classList.contains("empty")).toBe(false);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
    );
    expect(key(position).classList.contains("empty")).toBe(true);
  });

  it("brings back a board that was cleared", () => {
    mount();
    const filled = (): number => document.querySelectorAll(".hand .key:not(.empty)").length;
    const before = filled();
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    document.querySelector<HTMLButtonElement>("[data-clear-all]")?.click();
    expect(filled()).toBe(0);
    undoButton().click();
    expect(filled()).toBe(before);
  });

  it("saves what it restored, like any other change", async () => {
    const calls = served();
    mount();
    const position = emptyKey();
    place(position);
    await vi.advanceTimersByTimeAsync(800);
    expect(calls.length).toBe(1);
    undoButton().click();
    await vi.advanceTimersByTimeAsync(800);
    expect(calls.length).toBe(2);
    expect(String(calls[1]?.body.content)).not.toContain("tap: headlight");
  });

  it("starts again for another layout", () => {
    mount();
    place(emptyKey());
    expect(undoButton().disabled).toBe(false);
    const layout = document.querySelectorAll<HTMLSelectElement>("header select")[1];
    const other = [...(layout?.options ?? [])].find((option) => option.value !== LIVE_SET);
    if (!layout || !other) throw new Error("no second layout");
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    layout.value = other.value;
    layout.dispatchEvent(new Event("change"));
    expect(undoButton().disabled).toBe(true);
  });
});

describe("an action dragged onto a pedal", () => {
  function pedal(axis: string): HTMLElement {
    const found = document.querySelector<HTMLElement>(`.pedal-axis[data-axis="${axis}"]`);
    if (!found) throw new Error(`no pedal ${axis}`);
    return found;
  }

  function dropOnPedal(label: string, axis: string): Event {
    action(label).dispatchEvent(new Event("dragstart", { bubbles: true }));
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    pedal(axis).dispatchEvent(over);
    pedal(axis).dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    return over;
  }

  it("puts a toe on the direction that action is: hover down on one, hover up on the other", () => {
    mount();
    dropOnPedal("Hover down", "left_toe");
    expect(pedal("left_toe").querySelector("select")?.value).toBe("vertical:down");
    dropOnPedal("Hover up", "left_toe");
    expect(pedal("left_toe").querySelector("select")?.value).toBe("vertical:up");
    expect(pedal("left_toe").querySelector('input[data-field="invert"]')).toBeNull();
  });

  it("puts the rudder on the whole axis that action is an end of, the way round it says", () => {
    mount();
    dropOnPedal("Roll left", "rudder");
    expect(pedal("rudder").querySelector("select")?.value).toBe("roll");
    expect(
      pedal("rudder").querySelector<HTMLInputElement>('input[data-field="invert"]')?.checked,
    ).toBe(true);
  });

  it("is not taken when the action is not one end of an axis", () => {
    mount();
    const before = pedal("left_toe").querySelector("select")?.value;
    expect(dropOnPedal("Headlight", "left_toe").defaultPrevented).toBe(false);
    expect(pedal("left_toe").querySelector("select")?.value).toBe(before);
  });
});
