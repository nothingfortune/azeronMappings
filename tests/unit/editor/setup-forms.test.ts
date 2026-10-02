/**
 * The Setup tab's two forms that reach outside the page: adding a layout from the Azeron
 * app's exports, and updating the game's own keys.
 *
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { LIVE_SET } from "../../helpers/fixtures.js";

const PAYLOAD = buildPayload();
const SERVED = window as unknown as { AZERON_SERVED?: boolean };
const UPDATE = "Update the game's keys…";

interface Call {
  path: string;
  body: Record<string, unknown> | null;
}

/** A server that answers each POST with `reply`, and `/api/payload` with `payload`. */
function served(reply: (call: Call) => unknown, payload: unknown = PAYLOAD): Call[] {
  SERVED.AZERON_SERVED = true;
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: { body?: string }) => {
      if (path === "/api/payload") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });
      }
      const call: Call = {
        path,
        body: init?.body === undefined ? null : (JSON.parse(init.body) as Record<string, unknown>),
      };
      calls.push(call);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reply(call)) });
    }),
  );
  return calls;
}

function mount(): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(PAYLOAD));
  tab("Setup");
}

function tab(name: string): void {
  const found = [...document.querySelectorAll<HTMLButtonElement>("header .tabs button")].find(
    (button) => button.textContent === name,
  );
  if (!found) throw new Error(`no tab ${name}`);
  found.click();
}

/** A button on the tab itself, not in the header. */
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === label && node.closest("header") === null,
  );
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

const note = (): string => document.querySelector(".repo-note")?.textContent ?? "";

afterEach(() => {
  SERVED.AZERON_SERVED = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("updating the game's keys from the Setup tab", () => {
  it("has the one name the menu and a save use for it", () => {
    served(() => ({ ok: true }));
    mount();
    expect(button(UPDATE)).toBeDefined();
    const labels = [...document.querySelectorAll("button")].map((node) => node.textContent);
    expect(labels.join("|")).not.toMatch(/Write the game's bindings/);
    expect(labels.filter((label) => label === UPDATE).length).toBe(2);
  });

  it("asks whether the game is closed, and does nothing when it is not", () => {
    const calls = served(() => ({ ok: true }));
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    mount();
    button(UPDATE).click();
    expect(calls).toEqual([]);
  });

  it("says what changed, the pedals' rows included", async () => {
    const calls = served(() => ({
      ok: true,
      result: {
        changes: [{ display: "Pitch up", from: "None", to: "Up" }],
        backup: "Input.ini.bak",
        pedals: {
          set: LIVE_SET,
          changes: [
            { display: "Yaw axis", field: "Key1", from: "Axis1", to: "Axis2" },
            { display: "Thrust axis", field: "bInvert", from: "True", to: "False" },
          ],
          waiting: [],
        },
      },
    }));
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    mount();
    button(UPDATE).click();
    await vi.waitFor(() => {
      expect(note()).toContain("Updated the game");
    });
    expect(calls.map((call) => call.path)).toEqual(["/api/ingame/apply"]);
    expect(note()).toContain("Pitch up None → Up");
    expect(note()).toContain("Yaw axis (pedal) Axis1 → Axis2");
    expect(note()).toContain("Thrust axis (bInvert) True → False");
    expect(note()).toContain("Input.ini.bak");
  });
});

describe("adding a layout from the Azeron app's exports", () => {
  const EXPORT = { version: "2.0.2", profiles: [{ name: "from the app" }] };

  function nameField(): HTMLInputElement {
    const field = document.querySelector<HTMLInputElement>('[data-add-layout="name"]');
    if (!field) throw new Error("no name field");
    return field;
  }

  function type(text: string): void {
    const field = nameField();
    field.value = text;
    field.dispatchEvent(new Event("input"));
  }

  /** Choose a file for one unit, as its button's file dialog would. */
  async function choose(device: string, fileName: string): Promise<void> {
    const zone = document.querySelector(`[data-add-layout="${device}"]`);
    const input = zone?.parentElement?.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error(`no file input for ${device}`);
    const file = new File([JSON.stringify(EXPORT)], fileName, { type: "application/json" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => {
      expect(document.querySelector(`[data-add-layout="${device}"]`)?.textContent).toBe(fileName);
    });
  }

  it("offers one export per unit and a button, and does nothing until the button is pressed", async () => {
    const calls = served(() => ({ ok: true }));
    mount();
    expect(document.querySelectorAll(".unit-export").length).toBe(2);
    type("pair-test");
    await choose("cyborg2-left", "left.json");
    // Choosing a file used to import on the spot, name or no name.
    expect(calls).toEqual([]);
    // The redraw that showing the file caused has not lost the name.
    expect(nameField().value).toBe("pair-test");
    expect(note()).toContain("left.json chosen for the left unit");
  });

  it("says what is missing instead of doing nothing", async () => {
    const calls = served(() => ({ ok: true }));
    mount();
    button("Add layout").click();
    expect(note()).toBe("Give the layout a name first.");
    type("pair-test");
    button("Add layout").click();
    expect(note()).toBe("Choose the export for at least one unit first.");
    type("../escape");
    await choose("cyborg2-left", "left.json");
    button("Add layout").click();
    expect(note()).toContain("cannot be a layout name");
    expect(calls).toEqual([]);
  });

  it("imports each unit's export under the one name, then opens the layout on the board", async () => {
    // What the server would hand back once the layout exists: the live pair under its name.
    const after = structuredClone(PAYLOAD);
    for (const game of after.games) {
      for (const profile of game.profiles) {
        if (profile.data.profile.set === LIVE_SET) profile.data.profile.set = "pair-test";
      }
    }
    const calls = served(
      (call) => ({
        ok: true,
        profilePath: `profiles/pair-test-${String(call.body?.device)}.yaml`,
        templatePath: "templates/x.json",
        positions: 25,
      }),
      after,
    );
    mount();
    type("pair-test");
    await choose("cyborg2-left", "left.json");
    await choose("cyborg2-right", "right.json");
    button("Add layout").click();

    await vi.waitFor(() => {
      expect(document.querySelector(".save-note")?.textContent).toContain("Added pair-test");
    });
    expect(calls.map((call) => [call.path, call.body?.device, call.body?.set])).toEqual([
      ["/api/import", "cyborg2-left", "pair-test"],
      ["/api/import", "cyborg2-right", "pair-test"],
    ]);
    // On the Edit tab, with the new layout selected and both hands drawn.
    expect(document.querySelectorAll(".hand").length).toBe(2);
    const layout = document.querySelectorAll<HTMLSelectElement>("header select")[1];
    expect(layout?.selectedOptions[0]?.textContent).toBe("pair-test");
  });

  it("stops at a refusal and says which unit's file was already written", async () => {
    let seen = 0;
    served(() => {
      seen += 1;
      return seen === 1
        ? { ok: true, profilePath: "profiles/pair-test-left.yaml" }
        : { ok: false, error: "that export has no stick" };
    });
    mount();
    type("pair-test");
    await choose("cyborg2-left", "left.json");
    await choose("cyborg2-right", "right.json");
    button("Add layout").click();
    await vi.waitFor(() => {
      expect(note()).toContain("not added: that export has no stick");
    });
    expect(note()).toContain("profiles/pair-test-left.yaml was written");
  });
});
