/**
 * The wiring in the editor: an action gets a key the moment it is first put on a control,
 * and the keys stay out of sight while the editor can write them into the game itself.
 *
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import type { EditorPayload } from "../../../src/types/editor.js";
import { LIVE_SET } from "../../helpers/fixtures.js";
import { showWiring } from "../../helpers/editor.js";

const PAYLOAD = buildPayload();
const SERVED = window as unknown as { AZERON_SERVED?: boolean };
const FREE_LOOK = "Free look (toggle)";

interface Call {
  path: string;
  body: { changes?: Record<string, Record<string, unknown>> };
}

function served(): Call[] {
  SERVED.AZERON_SERVED = true;
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init: { body: string }) => {
      calls.push({ path, body: JSON.parse(init.body) as Call["body"] });
      return Promise.resolve({
        status: 200,
        json: () =>
          Promise.resolve({
            ok: true,
            saved: true,
            path: "p",
            check: { game: null, built: [], findings: [], buildErrors: [] },
          }),
      });
    }),
  );
  return calls;
}

function mount(payload: EditorPayload = PAYLOAD): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(payload));
  const select = document.querySelectorAll<HTMLSelectElement>("header select")[1];
  if (select && select.value !== LIVE_SET) {
    select.value = LIVE_SET;
    select.dispatchEvent(new Event("change"));
  }
}

/** The first game with no file of its own for the editor to write keys into. */
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
  if (!found) throw new Error(`no tab ${name}`);
  found.click();
}

function key(unit: 0 | 1, position: string): HTMLElement {
  const found = document
    .querySelectorAll(".hand")
    [unit]?.querySelector<HTMLElement>(`.key[data-position="${position}"]`);
  if (!found) throw new Error(`no key ${position}`);
  return found;
}

function action(label: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>(".action")].find(
    (node) => node.querySelector("b")?.textContent === label,
  );
  if (!found) throw new Error(`no action ${label}`);
  return found;
}

function drop(source: Element, target: () => Element): void {
  source.dispatchEvent(new Event("dragstart", { bubbles: true }));
  target().dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
}

function row(label: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>(".ingame-row")].find(
    (node) => node.querySelector(".who b, .who button, .who .name")?.textContent === label,
  );
  if (!found) throw new Error(`no row ${label}`);
  return found;
}

const rules = (): (string | null)[] =>
  [...document.querySelectorAll(".checks .rule")].map((node) => node.textContent);
const saveButton = (): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>("header button")].find(
    (node) => node.textContent === "Save" || node.textContent === "Saved",
  );

afterEach(() => {
  SERVED.AZERON_SERVED = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("putting an action that has no key on a control", () => {
  it("gives it one, so the control sends something and the checks stay clean", () => {
    served();
    mount();
    drop(action(FREE_LOOK), () => key(0, "pinky_5"));
    expect(key(0, "pinky_5").querySelector(".name")?.textContent).toBe(FREE_LOOK);
    expect(rules()).not.toContain("action-sends-nothing");
    expect(rules()).not.toContain("key-collision");
    // Two things changed: the key on the unit, and the wiring behind it.
    expect(saveButton()?.title).toBe("Unsaved: Left unit, Wiring");
  });

  it("saves the key it picked with the layout, and nothing else of the vocabulary", async () => {
    const calls = served();
    mount();
    drop(action(FREE_LOOK), () => key(0, "pinky_5"));
    saveButton()?.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".save-report")).not.toBeNull();
    });
    const wiring = calls.find((call) => call.path === "/api/actions");
    expect(wiring?.body.changes).toEqual({ free_look: { key: "Insert" } });
    // The game has not been told yet, and the report offers to tell it.
    expect(document.querySelector(".game-step button")?.textContent).toBe(
      "Update the game's keys…",
    );
  });

  it("does the same for a stick direction", () => {
    served();
    mount();
    const up = (): Element => {
      const cell = document.querySelectorAll(".hand")[0]?.querySelector(".stick-dial .dir.up");
      if (!cell) throw new Error("no stick");
      return cell;
    };
    drop(action(FREE_LOOK), up);
    expect(up().querySelector(".name")?.textContent).toBe(FREE_LOOK);
    expect(saveButton()?.title).toBe("Unsaved: Left unit, Wiring");
  });

  it("leaves an action that already has a key on that key", () => {
    served();
    mount();
    drop(action("Headlight"), () => key(0, "pinky_5"));
    expect(saveButton()?.title).toBe("Unsaved: Left unit");
  });
});

describe("the keys on the In-game tab", () => {
  it("are out of sight while the editor can write them into the game, and one click away", () => {
    served();
    mount();
    tab("In-game");
    expect(document.querySelector(".ingame-row")).not.toBeNull();
    expect(document.querySelector(".key-chip")).toBeNull();
    expect(document.querySelector(".wiring-note")?.textContent).toContain(
      "The editor picks the key",
    );
    showWiring();
    expect(document.querySelectorAll(".key-chip").length).toBeGreaterThan(10);
    expect(document.querySelector('[data-wiring="toggle"]')?.textContent).toBe("Hide the wiring");
  });

  it("show the key an action was given, once asked for", () => {
    served();
    mount();
    drop(action(FREE_LOOK), () => key(0, "pinky_5"));
    tab("In-game");
    showWiring();
    expect(row(FREE_LOOK).querySelector(".key-chip")?.textContent).toBe("Insert");
  });

  it("are shown from the start for a game the editor cannot write to: they are set by hand", () => {
    served();
    mount(unconnected());
    tab("In-game");
    expect(document.querySelectorAll(".key-chip").length).toBeGreaterThan(10);
    expect(document.querySelector(".wiring-note")?.textContent).toContain(
      "Set these same keys in the game's own controls screen",
    );
  });
});
