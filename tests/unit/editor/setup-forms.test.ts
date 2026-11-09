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

describe("starting a new game", () => {
  const form = (): HTMLElement => {
    const found = document.querySelector<HTMLElement>(".new-game");
    if (!found) throw new Error("no new-game form");
    return found;
  };
  function fill(name: string): void {
    const field = form().querySelector<HTMLInputElement>('[data-new-game="name"]');
    if (!field) throw new Error("no name field");
    field.value = name;
    field.dispatchEvent(new Event("input"));
  }
  const create = (): void => {
    const found = [...form().querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent === "Create game",
    );
    if (!found) throw new Error("no Create game");
    found.click();
  };

  it("needs no export: it sends the units ticked, both by default", async () => {
    const calls = served(() => ({ ok: true, slug: "everspace", name: "Deep Rock", leftOff: [] }));
    mount();
    expect(form().querySelectorAll("[data-new-game-unit]")).toHaveLength(2);
    fill("Deep Rock");
    create();
    await vi.waitFor(() => {
      expect(calls.some((call) => call.path === "/api/game")).toBe(true);
    });
    const body = calls.find((call) => call.path === "/api/game")?.body ?? {};
    expect(body.devices).toEqual(["cyborg2-left", "cyborg2-right"]);
    expect(body).not.toHaveProperty("exported");
    // Made, the page reloads its data and opens the game on the Edit tab.
    await vi.waitFor(() => {
      expect(document.querySelector(".workspace.board")).not.toBeNull();
    });
  });

  it("sends only the units left ticked, and says so when none is", () => {
    const calls = served(() => ({ ok: true }));
    mount();
    for (const tick of form().querySelectorAll<HTMLInputElement>("[data-new-game-unit]")) {
      tick.checked = false;
      tick.dispatchEvent(new Event("change"));
    }
    fill("Deep Rock");
    create();
    expect(note()).toContain("Choose at least one unit");
    expect(calls.some((call) => call.path === "/api/game")).toBe(false);
  });

  it("keeps the Azeron app export as an option, folded away", () => {
    served(() => ({ ok: true }));
    mount();
    const details = form().querySelector("details.new-game-export");
    expect(details?.querySelector("summary")?.textContent).toContain("Azeron app export");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(form().querySelector(".new-game-file")?.textContent).toContain(
      "the game starts from its genre",
    );
  });
});

describe("adding a layout with no export", () => {
  /** The live pair, renamed: what the server hands back once the new layout exists. */
  function afterAdding(name: string): typeof PAYLOAD {
    const after = structuredClone(PAYLOAD);
    for (const game of after.games) {
      for (const profile of game.profiles) {
        if (profile.data.profile.set === LIVE_SET) profile.data.profile.set = name;
      }
    }
    return after;
  }
  function type(text: string): void {
    const field = document.querySelector<HTMLInputElement>('[data-add-layout="name"]');
    if (!field) throw new Error("no name field");
    field.value = text;
    field.dispatchEvent(new Event("input"));
  }

  it("copies the open layout by default, and opens the copy", async () => {
    const calls = served(
      () => ({ ok: true, set: "next", profiles: [], pedals: true }),
      afterAdding("next"),
    );
    mount();
    const from = document.querySelector<HTMLSelectElement>('[data-add-layout="from"]');
    expect(from?.value).toBe(LIVE_SET);
    // A copy has the units its layout has: no unit boxes to tick.
    expect(document.querySelector("[data-add-layout-unit]")).toBeNull();
    type("next");
    button("Add layout").click();
    await vi.waitFor(() => {
      expect(document.querySelector(".save-note")?.textContent).toContain(
        `Added next as a copy of ${LIVE_SET}, pedals included`,
      );
    });
    expect(calls.map((call) => [call.path, call.body])).toEqual([
      ["/api/layout", { game: PAYLOAD.games[0]?.slug, set: "next", devices: [], copyOf: LIVE_SET }],
    ]);
  });

  it("starts an empty one for the units ticked", async () => {
    const calls = served(
      () => ({ ok: true, set: "blank", profiles: [], pedals: false }),
      afterAdding("blank"),
    );
    mount();
    const from = document.querySelector<HTMLSelectElement>('[data-add-layout="from"]');
    if (!from) throw new Error("no start-from select");
    from.value = "";
    from.dispatchEvent(new Event("change"));
    const ticks = document.querySelectorAll<HTMLInputElement>("[data-add-layout-unit]");
    expect(ticks).toHaveLength(2);
    const right = ticks[1];
    if (!right) throw new Error("no right unit box");
    right.checked = false;
    right.dispatchEvent(new Event("change"));
    type("blank");
    button("Add layout").click();
    await vi.waitFor(() => {
      expect(document.querySelector(".save-note")?.textContent).toContain("Added blank, empty");
    });
    expect(calls[0]?.body).toEqual({
      game: PAYLOAD.games[0]?.slug,
      set: "blank",
      devices: ["cyborg2-left"],
    });
  });

  it("keeps the exports as an option, folded away", () => {
    served(() => ({ ok: true }));
    mount();
    const details = document.querySelector("details.add-layout-export");
    expect(details?.querySelector("summary")?.textContent).toContain("Azeron app exports");
    expect(details?.hasAttribute("open")).toBe(false);
  });
});
