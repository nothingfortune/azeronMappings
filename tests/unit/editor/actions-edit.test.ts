// @vitest-environment happy-dom
/**
 * Naming an action and tagging its role from the In-game tab. A new game's actions are all
 * called after their keys, and the only way to name one used to be a text editor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { showWiring } from "../../helpers/editor.js";
import { LIVE_SET } from "../../helpers/fixtures.js";

const PAYLOAD = buildPayload();

const OK = {
  ok: true,
  saved: true,
  path: "p",
  check: { game: null, built: [], findings: [], buildErrors: [] },
};

function served() {
  (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = true;
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init: { body: string }) => {
      calls.push({ path, body: JSON.parse(init.body) as unknown });
      return Promise.resolve({ status: 200, json: () => Promise.resolve(OK) });
    }),
  );
  return calls;
}

function header(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("header button")].find(
    (button) => button.textContent === label,
  );
  if (!found) throw new Error(`no header button ${label}`);
  return found;
}

function row(label: string): Element {
  const found = [...document.querySelectorAll(".ingame-row")].find(
    (node) => node.querySelector(".who b")?.textContent === label,
  );
  if (!found) throw new Error(`no row for ${label}`);
  return found;
}

function rename(label: string, to: string): void {
  row(label).querySelector<HTMLElement>(".who b")?.click();
  const input = document.querySelector<HTMLInputElement>(".rename-input");
  if (!input) throw new Error("no name box opened");
  input.focus();
  input.value = to;
  input.blur();
}

function toggle(label: string, tag: string): void {
  const button = [...row(label).querySelectorAll<HTMLButtonElement>(".tag-chip")].find(
    (chip) => chip.textContent === tag,
  );
  if (!button) throw new Error(`no ${tag} chip on ${label}`);
  button.click();
}

const on = (label: string): string[] =>
  [...row(label).querySelectorAll(".tag-chip.on")].map((chip) => chip.textContent);

let calls: { path: string; body: unknown }[] = [];

describe("naming and tagging actions", () => {
  beforeEach(() => {
    calls = served();
    document.body.innerHTML = '<div id="app"></div>';
    start(structuredClone(PAYLOAD));
    header("In-game").click();
    showWiring();
  });

  afterEach(() => {
    (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = false;
    vi.unstubAllGlobals();
  });

  it("shows each action's roles as switches, on for the ones it has", () => {
    // The vocabulary says the headlight is a utility.
    expect(on("Headlight")).toEqual(["utility"]);
    expect(row("Headlight").querySelectorAll(".tag-chip")).toHaveLength(6);
    const pressed = [...row("Headlight").querySelectorAll(".tag-chip")].map((chip) =>
      chip.getAttribute("aria-pressed"),
    );
    expect(pressed.filter((value) => value === "true")).toHaveLength(1);
  });

  it("opens a name for typing when it is clicked, and keeps what was typed", () => {
    rename("Headlight", "Helmet lamp");
    expect(document.querySelector(".rename-input")).toBeNull();
    expect(row("Helmet lamp")).toBeDefined();
  });

  it("keeps the old name when the box is emptied", () => {
    rename("Headlight", "   ");
    expect(row("Headlight")).toBeDefined();
    expect(header("Saved").hasAttribute("disabled")).toBe(true);
  });

  it("counts a rename as unsaved and names it for what it is", () => {
    expect(header("Saved").hasAttribute("disabled")).toBe(true);
    rename("Headlight", "Helmet lamp");
    expect(header("Save").title).toBe("Unsaved: Action names");
  });

  it("sends only the label and tags that changed, and the server's reply clears the mark", async () => {
    rename("Headlight", "Helmet lamp, front");
    toggle("Helmet lamp, front", "combat");
    expect(on("Helmet lamp, front")).toEqual(["combat", "utility"]);
    header("Save").click();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.path).toBe("/api/actions");
    expect(calls[0]?.body).toEqual({
      game: "everspace",
      changes: { headlight: { label: "Helmet lamp, front", tags: ["utility", "combat"] } },
    });
    await vi.waitFor(() => {
      expect(header("Saved").hasAttribute("disabled")).toBe(true);
    });
    // A rename is not a key: the game has nothing to be told.
    expect(document.querySelector(".game-step")).toBeNull();
  });

  it("sends an empty list when the last role is switched off", async () => {
    toggle("Headlight", "utility");
    expect(on("Headlight")).toEqual([]);
    header("Save").click();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.body).toEqual({ game: "everspace", changes: { headlight: { tags: [] } } });
  });

  it("is not unsaved when a role is switched on and off again", () => {
    toggle("Headlight", "combat");
    toggle("Headlight", "combat");
    expect(header("Saved").hasAttribute("disabled")).toBe(true);
  });

  it("names both when keys and names are unsaved together", () => {
    rename("Headlight", "Helmet lamp");
    row("Helmet lamp").querySelector<HTMLButtonElement>(".key-chip")?.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyL", bubbles: true }));
    expect(header("Save").title).toBe("Unsaved: Wiring and action names");
  });

  it("feeds the checks: a role changed here changes the findings", () => {
    // `required` is what the missing-required rule reads, so ticking it on an action
    // nobody binds raises the finding.
    const before = document.querySelector(".checks")?.textContent ?? "";
    toggle("Headlight", "required");
    const after = document.querySelector(".checks")?.textContent ?? "";
    expect(after).not.toBe(before);
  });
});

describe("renaming an action that is on keys", () => {
  beforeEach(() => {
    calls = served();
    document.body.innerHTML = '<div id="app"></div>';
    start(structuredClone(PAYLOAD));
    const select = document.querySelectorAll<HTMLSelectElement>("header select")[0];
    if (select && select.value !== LIVE_SET) {
      select.value = LIVE_SET;
      select.dispatchEvent(new Event("change"));
    }
  });

  afterEach(() => {
    (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = false;
    vi.unstubAllGlobals();
  });

  const rightKey = (position: string): string | undefined =>
    document.querySelectorAll(".hand")[1]?.querySelector(`.key[data-position="${position}"] .name`)
      ?.textContent ?? undefined;

  it("renames the keys named after it, which is the name the unit shows", () => {
    expect(rightKey("index_2")).toBe("Thrust forward");
    header("In-game").click();
    showWiring();
    rename("Thrust forward", "Forward");
    header("Edit").click();
    expect(rightKey("index_2")).toBe("Forward");
    // A key given its own name keeps it: that name was chosen, not inherited.
    expect(rightKey("middle_4")).toBe("Thrust fwd (pulse 100)");
    expect(header("Save").title).toContain("Right unit");
  });
});

describe("adding and deleting actions", () => {
  /** The payload with one action of the game's own that no key uses. */
  const withWave = (): typeof PAYLOAD => {
    const payload = structuredClone(PAYLOAD);
    const game = payload.games[0];
    if (game) {
      game.actions.actions = {
        ...game.actions.actions,
        wave: { label: "Wave", mode: "ship" },
        hail: { label: "Hail", ingame: "Hail" },
      };
    }
    return payload;
  };

  beforeEach(() => {
    calls = served();
    document.body.innerHTML = '<div id="app"></div>';
  });

  afterEach(() => {
    (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = false;
    vi.unstubAllGlobals();
  });

  it("adds one by typing its name in the action list, and saves it as a new line", async () => {
    start(structuredClone(PAYLOAD));
    const input = document.querySelector<HTMLInputElement>(".palette input.new-action");
    if (!input) throw new Error("no New action box");
    input.value = "Emote: wave";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const names = [...document.querySelectorAll(".palette .action b")].map((b) => b.textContent);
    expect(names).toContain("Emote: wave");
    header("Save").click();
    await vi.waitFor(() => {
      expect(calls.some((call) => call.path === "/api/actions")).toBe(true);
    });
    const body = calls.find((call) => call.path === "/api/actions")?.body as {
      changes: Record<string, unknown>;
      add?: Record<string, unknown>;
    };
    expect(body.add?.emote_wave).toEqual({ label: "Emote: wave" });
    expect(body.changes).not.toHaveProperty("emote_wave");
  });

  it("offers Delete only for the game's own action that no key sends, and saves the removal", async () => {
    start(withWave());
    header("In-game").click();
    const button = (label: string): HTMLButtonElement | null =>
      row(label).querySelector<HTMLButtonElement>(".delete-action");
    // The genre's actions cannot be deleted: they would come back from the genre.
    expect(button("Headlight")).toBeNull();
    button("Wave")?.click();
    expect(() => row("Wave")).toThrow();
    header("Save").click();
    await vi.waitFor(() => {
      expect(calls.some((call) => call.path === "/api/actions")).toBe(true);
    });
    const body = calls.find((call) => call.path === "/api/actions")?.body as { remove?: string[] };
    expect(body.remove).toEqual(["wave"]);
  });

  it("does not offer Delete for an action that names a row in the game's own file", () => {
    start(withWave());
    header("In-game").click();
    expect(row("Hail").querySelector(".delete-action")).toBeNull();
  });

  it("brings a deleted action back whole when the delete is undone after saving", async () => {
    start(withWave());
    header("In-game").click();
    row("Wave").querySelector<HTMLButtonElement>(".delete-action")?.click();
    header("Save").click();
    await vi.waitFor(() => {
      expect(calls.filter((call) => call.path === "/api/actions")).toHaveLength(1);
      expect(header("Saved")).toBeDefined();
    });
    const undo = [...document.querySelectorAll<HTMLButtonElement>("header button")].find((button) =>
      button.title.startsWith("Take back the last change"),
    );
    undo?.click();
    expect(row("Wave")).toBeDefined();
    // Saved by hand, or by autosave once it is on.
    [...document.querySelectorAll<HTMLButtonElement>("header button")]
      .find((button) => button.textContent === "Save")
      ?.click();
    await vi.waitFor(
      () => {
        expect(calls.filter((call) => call.path === "/api/actions")).toHaveLength(2);
      },
      { timeout: 4000 },
    );
    const body = calls.filter((call) => call.path === "/api/actions")[1]?.body as {
      add?: Record<string, unknown>;
    };
    expect(body.add?.wave).toEqual({ label: "Wave", mode: "ship" });
  });
});
