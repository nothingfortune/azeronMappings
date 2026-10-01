// @vitest-environment happy-dom
/**
 * Editor behaviour, exercised against a real payload: rendering both units, assigning an
 * action to a selected key, and surfacing linter findings.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { LIVE_SET } from "../../helpers/fixtures.js";

// Built once: it re-reads every device, genre, game and template, about 150 ms a time,
// and was rebuilt before every test. A clone costs a few milliseconds and keeps each test
// from seeing another's edits.
const PAYLOAD = buildPayload();

function mount(): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(PAYLOAD));
}

describe("the editor", () => {
  beforeEach(() => {
    mount();
  });

  it("draws both units of an akimbo set side by side", () => {
    const setSelect = document.querySelectorAll("header select")[1] as HTMLSelectElement;
    setSelect.value = LIVE_SET;
    setSelect.dispatchEvent(new Event("change"));

    const hands = document.querySelectorAll(".hand");
    expect(hands.length).toBe(2);
    const titles = [...hands].map((hand) => hand.querySelector(".title span")?.textContent ?? "");
    expect(titles.some((title) => title.includes("Left unit"))).toBe(true);
    expect(titles.some((title) => title.includes("Right unit"))).toBe(true);
  });

  it("renders every position on the device", () => {
    // 29 key cards; the stick and its click are the dial and its hub, not cards.
    const firstHand = document.querySelector(".hand");
    expect(firstHand?.querySelectorAll(".key").length).toBe(29);
    expect(firstHand?.querySelectorAll(".stick-dial").length).toBe(1);
    expect(firstHand?.querySelectorAll(".stick-dial .hub").length).toBe(1);
  });

  it("keeps the d-pad and the thumbstick visibly apart", () => {
    const groups = [...document.querySelectorAll(".hand .thumb-group .head")].map(
      (node) => node.textContent,
    );
    expect(groups.some((label) => label.startsWith("thumbstick"))).toBe(true);
    expect(groups).toContain("d-pad");
    // The stick's mode stays visible; a gamepad-mode stick is a lint error.
    expect(groups.some((label) => label.includes("keyboard"))).toBe(true);
    expect(document.querySelectorAll(".hand .dpad .key").length).toBeGreaterThanOrEqual(5);
  });

  it("assigns an action to the selected key", () => {
    const keys = [...document.querySelectorAll<HTMLButtonElement>(".key")];
    const target = keys.find((key) => key.dataset.position === "middle_1");
    expect(target).toBeDefined();
    target?.click();

    // Whatever the palette offers first -- the test is about assigning, not the vocabulary.
    const entry = document.querySelector<HTMLButtonElement>(".action");
    const label = entry?.querySelector("b")?.textContent ?? "";
    expect(label).not.toBe("");
    entry?.click();

    const updated = [...document.querySelectorAll<HTMLButtonElement>(".key")].find(
      (key) => key.dataset.position === "middle_1",
    );
    expect(updated?.querySelector(".name")?.textContent).toBe(label);
  });

  it("reports the linter's findings, not its own opinion", () => {
    const checks = document.querySelectorAll(".finding");
    expect(checks.length).toBeGreaterThan(0);
  });
});

describe("the editor's modes", () => {
  beforeEach(() => {
    mount();
  });

  function tab(name: string): HTMLButtonElement {
    const found = [...document.querySelectorAll("header button")].find(
      (button) => button.textContent === name,
    );
    if (!found) throw new Error(`no ${name} tab`);
    return found as HTMLButtonElement;
  }

  it("offers edit, in-game, press test and setup from one page, and no sheet", () => {
    const names = [...document.querySelectorAll("header .tabs button")].map((b) => b.textContent);
    expect(names).toEqual(["Edit", "In-game", "Press test", "Setup"]);
  });

  it("shows the press test without leaving the page", () => {
    tab("Press test").click();
    expect(document.querySelector(".prompt")).not.toBeNull();
    expect(document.querySelectorAll(".hand").length).toBeGreaterThan(0);
  });

  it("returns to the layout editor afterwards", () => {
    tab("Press test").click();
    tab("Edit").click();
    expect(document.querySelector(".prompt")).toBeNull();
    expect(document.querySelectorAll(".key").length).toBeGreaterThan(0);
  });
});

describe("key cards", () => {
  beforeEach(() => {
    mount();
    // Pinned to the golden profile: it must rebuild its template byte for byte, so its
    // bindings cannot drift, and these assertions stay about the rendering.
    show("single-v5");
  });

  function show(set: string): void {
    const sets = document.querySelectorAll("header select")[1] as HTMLSelectElement;
    sets.value = set;
    sets.dispatchEvent(new Event("change"));
  }

  function card(position: string): HTMLElement {
    const found = document.querySelector<HTMLElement>(`.key[data-position="${position}"]`);
    if (!found) throw new Error(`no card for ${position}`);
    return found;
  }

  it("puts the position and the action on separate lines", () => {
    // They were inline spans, which ran together as "pinky_1Consumable 1tap: Consumable 1".
    const key = card("pinky_1");
    // Named as a person would, not by the id the file uses.
    expect(key.querySelector(".pos")?.textContent).toBe("Pinky 1");
    expect(key.querySelector(".name")?.textContent).toBe("Consume 1");
    // Each run of text is its own leaf element, so none of them concatenate.
    expect(key.children.length).toBeGreaterThanOrEqual(2);
    expect([...key.children].every((child) => child.children.length === 0)).toBe(true);
    // The label here abbreviates the action, so the action is spelled out under it.
    expect([...key.querySelectorAll(".sub")].map((node) => node.textContent)).toEqual([
      "Consumable 1",
    ]);
  });

  it("marks an unbound position as empty and gives it no label", () => {
    // The golden profile binds everything, so the empty state comes from the live pair.
    show(LIVE_SET);
    const key = card("pinky_5");
    expect(key.classList.contains("empty")).toBe(true);
    expect(key.querySelector(".name")).toBeNull();
  });

  it("draws the stick as a compass, each direction in the cell it points to", () => {
    const dial = document.querySelector(".stick-dial");
    expect(dial).not.toBeNull();
    for (const direction of ["up", "right", "down", "left"]) {
      const cell = dial?.querySelector(`.dir.${direction}`);
      expect(cell, direction).not.toBeNull();
      expect(cell?.querySelector(".glyph")?.textContent).toBeTruthy();
    }
    expect(dial?.querySelector(".up .name")?.textContent).toBe("Thrust forward");
    expect(dial?.querySelector(".left .name")?.textContent).toBe("Strafe left");
    // The hub is the stick pressed in, so it shows that key's binding.
    expect(dial?.querySelector(".hub .name")?.textContent).toBe("Inertia Dampeners");
  });

  it("selects the stick when a direction cell is clicked", () => {
    const cell = document.querySelector<HTMLButtonElement>(".stick-dial .dir.right");
    cell?.click();
    expect(document.querySelector(".stick-dial.selected")).not.toBeNull();
  });

  it("gives the board the full width, with the panels docked under it", () => {
    // With a rail either side the pair was scaled to under half size, and its key text
    // came out at about five pixels.
    show(LIVE_SET);
    const workspace = document.querySelector(".workspace");
    expect(workspace?.firstElementChild?.className).toBe("stage-wrap");
    const dock = workspace?.querySelector(".dock");
    expect(dock?.querySelector(".action-list")).not.toBeNull();
    expect(dock?.querySelector(".checks")).not.toBeNull();
    expect([...(dock?.querySelectorAll("h2") ?? [])].map((h) => h.textContent)).toContain("Key");
  });

  it("keeps both units on one row rather than wrapping one under the other", () => {
    show(LIVE_SET);
    const stage = document.querySelector<HTMLElement>(".stage");
    expect(stage?.parentElement?.className).toBe("stage-wrap");
    expect(stage?.querySelectorAll(".hand").length).toBe(2);
  });
});

describe("data sources", () => {
  beforeEach(() => {
    mount();
  });

  it("lists every game in the payload, not just the first", () => {
    const select = document.querySelector<HTMLSelectElement>("header select");
    expect(select?.options.length).toBeGreaterThanOrEqual(1);
    expect([...(select?.options ?? [])].map((o) => o.textContent)).toContain("Everspace 2");
  });

  it("lists each set in the selected game", () => {
    const sets = document.querySelectorAll("header select")[1] as HTMLSelectElement;
    const names = [...sets.options].map((option) => option.value);
    expect(names).toContain(LIVE_SET);
    expect(names).toContain("single-v5");
  });

  it("offers a way to open a different payload", () => {
    const button = [...document.querySelectorAll("header button")].find(
      (node) => node.textContent === "Open a data file…",
    );
    expect(button).toBeDefined();
    expect(document.querySelector('header input[type="file"]')).not.toBeNull();
  });

  it("switching set redraws the pair from the same payload", () => {
    const sets = document.querySelectorAll("header select")[1] as HTMLSelectElement;
    sets.value = "single-v5";
    sets.dispatchEvent(new Event("change"));
    expect(document.querySelectorAll(".hand").length).toBe(1);

    sets.value = LIVE_SET;
    sets.dispatchEvent(new Event("change"));
    expect(document.querySelectorAll(".hand").length).toBe(2);
  });
});

describe("the setup tab", () => {
  beforeEach(() => {
    mount();
    const tab = [...document.querySelectorAll("header button")].find(
      (node) => node.textContent === "Setup",
    );
    (tab as HTMLButtonElement).click();
  });

  it("explains what still needs a server, but keeps what does not", () => {
    // Detection is the browser talking to USB, so it works either way.
    const panel = document.querySelector(".panel");
    expect(panel?.textContent).toContain("azeron serve");
    expect(panel?.querySelector(".panel.inset h2")?.textContent).toBe("Units connected");
    const labels = [...(panel?.querySelectorAll("button") ?? [])].map((n) => n.textContent);
    expect(labels).toEqual(["Detect units"]);
  });

  it("offers the operations once a server is behind it", () => {
    (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = true;
    try {
      mount();
      const tab = [...document.querySelectorAll("header button")].find(
        (node) => node.textContent === "Setup",
      );
      (tab as HTMLButtonElement).click();
      const labels = [...document.querySelectorAll(".panel button")].map((n) => n.textContent);
      expect(labels).toContain("Rebuild every import file");
      expect(labels).toContain("Read the game's bindings");
      expect(document.querySelector("header .pill.mode")?.textContent).toBe("saves to repo");
    } finally {
      (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = false;
    }
  });

  it("asks for a layout name and a hand in words, not a set name and a device id", () => {
    (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = true;
    try {
      mount();
      [...document.querySelectorAll<HTMLButtonElement>("header button")]
        .find((node) => node.textContent === "Setup")
        ?.click();
      const labels = [...document.querySelectorAll(".panel .field label")].map(
        (n) => n.textContent,
      );
      expect(labels).toContain("Name for this layout");
      expect(labels).toContain("Exported from");
      const hands = [...document.querySelectorAll(".panel select option")].map(
        (o) => o.textContent,
      );
      expect(hands).toEqual(expect.arrayContaining(["Left unit", "Right unit"]));
      expect(document.querySelector<HTMLInputElement>('.panel input[type="text"]')?.value).toBe("");
    } finally {
      (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = false;
    }
  });

  it("offers to add a game that is not there, in words, with the genres that exist", () => {
    (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = true;
    try {
      mount();
      [...document.querySelectorAll<HTMLButtonElement>("header button")]
        .find((node) => node.textContent === "Setup")
        ?.click();
      const form = document.querySelector(".new-game");
      expect(form?.querySelector("h3")?.textContent).toBe("Add a new game");
      const labels = [...(form?.querySelectorAll("label") ?? [])].map((n) => n.textContent);
      expect(labels).toEqual([
        "Name of the game",
        "Kind of game",
        "Exported from",
        "Name for the first layout",
      ]);
      const genres = [...(form?.querySelectorAll('[data-new-game="genre"] option') ?? [])].map(
        (o) => o.textContent,
      );
      expect(genres).toEqual(PAYLOAD.genres.map((genre) => genre.name));

      // The layout section says which game it adds to, rather than leaving it to the selector.
      const headings = [...document.querySelectorAll(".panel h3")].map((n) => n.textContent);
      expect(headings).toContain(`Add a layout to ${PAYLOAD.games[0]?.name ?? ""}`);

      // Asking before anything is chosen says what is missing, and creates nothing.
      const create = [...(form?.querySelectorAll("button") ?? [])].find(
        (node) => node.textContent === "Create game",
      );
      create?.click();
      expect(document.querySelector(".repo-note")?.textContent).toBe("Give the game a name first.");
    } finally {
      (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = false;
    }
  });

  it("says which mode the page is in", () => {
    expect(document.querySelector("header .pill.mode")?.textContent).toBe("downloads only");
  });
});

describe("stick modes in the editor", () => {
  beforeEach(() => {
    mount();
    const sets = document.querySelectorAll("header select")[1] as HTMLSelectElement;
    sets.value = LIVE_SET;
    sets.dispatchEvent(new Event("change"));
  });

  function modeButton(label: string): HTMLButtonElement {
    const found = [...document.querySelectorAll<HTMLButtonElement>(".mode-row")].find((node) =>
      node.querySelector("b")?.textContent.startsWith(label),
    );
    if (!found) throw new Error(`no ${label} button`);
    return found;
  }

  it("offers a mode per preset", () => {
    expect(document.querySelectorAll(".mode-row").length).toBeGreaterThanOrEqual(3);
    expect(modeButton("Mode 1")).toBeDefined();
  });

  it("sets both sticks from one click", () => {
    modeButton("Mode 2").click();
    const dials = [...document.querySelectorAll(".stick-dial")];
    expect(dials.length).toBe(2);
    // Mode 2: left stick climbs, right stick thrusts.
    expect(dials[0]?.querySelector(".up .name")?.textContent).toBe("Hover up");
    expect(dials[1]?.querySelector(".up .name")?.textContent).toBe("Thrust forward");
  });

  it("shows which mode a pair is already in", () => {
    modeButton("Mode 3").click();
    expect(modeButton("Mode 3").classList.contains("active")).toBe(true);
    expect(modeButton("Mode 3").textContent).toContain("in use");
  });

  it("says the change still has to be saved", () => {
    modeButton("Mode 1").click();
    expect(document.querySelector(".save-note")?.textContent).toContain("Save changes");
  });
});

describe("assigning an action", () => {
  beforeEach(() => {
    mount();
    const sets = document.querySelectorAll("header select")[1] as HTMLSelectElement;
    sets.value = "single-v5";
    sets.dispatchEvent(new Event("change"));
  });

  function card(position: string): HTMLButtonElement {
    const found = document.querySelector<HTMLButtonElement>(`.key[data-position="${position}"]`);
    if (!found) throw new Error(`no card for ${position}`);
    return found;
  }

  function palette(label: string): HTMLButtonElement {
    const found = [...document.querySelectorAll<HTMLButtonElement>(".action")].find((button) =>
      button.querySelector("b")?.textContent.includes(label),
    );
    if (!found) throw new Error(`no palette entry for ${label}`);
    return found;
  }

  it("renames the key it rebinds, rather than leaving the old action's name on it", () => {
    // pinky_1 reads "Consume 1" and sends consume_1. Rebinding it must not still say that:
    // the label is what the board shows and what is compiled onto the unit.
    expect(card("pinky_1").querySelector(".name")?.textContent).toBe("Consume 1");
    card("pinky_1").click();
    palette("Consumable 3").click();
    expect(card("pinky_1").querySelector(".name")?.textContent).toBe("Consumable 3");
  });

  it("leaves the label alone when the long press changes, because the label is the tap's", () => {
    const before = card("pinky_1").querySelector(".name")?.textContent;
    card("pinky_1").click();
    const long = [...document.querySelectorAll<HTMLElement>(".field")].find(
      (field) => field.querySelector("label")?.textContent === "Long press",
    );
    long?.querySelector<HTMLButtonElement>(".slot-pick")?.click();
    palette("Consumable 3").click();
    expect(card("pinky_1").querySelector(".name")?.textContent).toBe(before);
  });

  it("re-arms the tap when a different key is selected", () => {
    // Nothing used to reset the armed slot, so a long press armed on one key stayed armed
    // on the next.
    card("pinky_1").click();
    const long = [...document.querySelectorAll<HTMLElement>(".field")].find(
      (field) => field.querySelector("label")?.textContent === "Long press",
    );
    long?.querySelector<HTMLButtonElement>(".slot-pick")?.click();
    // Clicking redraws the panel, so the armed slot is looked up again.
    expect(document.querySelector(".field.slot[data-active] label")?.textContent).toBe(
      "Long press",
    );
    // And the action list says where a click will land.
    expect(document.querySelector(".palette-target")?.textContent).toContain("long press");

    card("pinky_2").click();
    palette("Consumable 3").click();
    // It landed on the tap, which is what the card shows.
    expect(card("pinky_2").querySelector(".name")?.textContent).toBe("Consumable 3");
  });

  it("says why the palette cannot act when a stick is selected", () => {
    document.querySelector<HTMLButtonElement>(".stick-dial .dir.up")?.click();
    const list = document.querySelector(".action-list");
    expect(list?.classList.contains("inert")).toBe(true);
    expect(document.querySelector(".palette-note")?.textContent).toContain("direction on the dial");
  });
});

describe("the in-game tab", () => {
  it("renders the checks it promises", () => {
    mount();
    const tab = [...document.querySelectorAll("header button")].find(
      (node) => node.textContent === "In-game",
    );
    (tab as HTMLButtonElement).click();
    // The panel says a collision shows up here before it costs a fight.
    expect(document.querySelector(".dock.ingame .checks")).not.toBeNull();
  });
});

describe("unsaved edits", () => {
  function served(reply: (path: string, body: unknown) => unknown) {
    (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = true;
    const calls: { path: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string, init: { body: string }) => {
        const body: unknown = JSON.parse(init.body);
        calls.push({ path, body });
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve(reply(path, body)),
        });
      }),
    );
    return calls;
  }

  afterEach(() => {
    (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = false;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function header(label: string | RegExp): HTMLButtonElement {
    const found = [...document.querySelectorAll<HTMLButtonElement>("header button")].find(
      (button) =>
        typeof label === "string" ? button.textContent === label : label.test(button.textContent),
    );
    if (!found) throw new Error(`no header button ${String(label)}`);
    return found;
  }

  function edit(position: string, unit: 0 | 1 = 0): void {
    const hand = document.querySelectorAll(".hand")[unit];
    const card = [...(hand?.querySelectorAll<HTMLButtonElement>(".key") ?? [])].find(
      (key) => key.dataset.position === position,
    );
    card?.click();
    document.querySelector<HTMLButtonElement>(".action")?.click();
  }

  it("does not call a page dirty for having drawn it", () => {
    // A working copy is made on first read, and drawing reads -- so "has a working copy"
    // made every page dirty, and every Reset and reload asked about edits nobody made.
    mount();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    header("Undo all unsaved edits").click();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks before Reset throws an edit away", () => {
    mount();
    edit("pinky_1");
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    header("Undo all unsaved edits").click();
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("says the file was saved before anything else, and where the file to import is", async () => {
    const PATH = "games/SpaceSims/everspace/profiles/example-left.yaml";
    served(() => ({
      ok: true,
      saved: true,
      path: PATH,
      check: {
        game: "everspace",
        built: [
          {
            output: "dist/x/example_left.json",
            importPath: "C:\\\\repo\\\\dist\\\\x\\\\example_left.json",
            changed: true,
          },
        ],
        findings: [
          {
            level: "warning",
            rule: "duplicate-output-key",
            profile: "p",
            key: "KeyR",
            message: "m",
          },
        ],
        buildErrors: [],
      },
    }));
    mount();
    edit("pinky_1");
    header("Save changes").click();
    await vi.waitFor(() => {
      expect(document.querySelector(".save-report")).not.toBeNull();
    });
    const report = document.querySelector(".save-report");
    expect(report?.firstElementChild?.textContent).toMatch(/^Saved /);
    expect(report?.querySelector(".import-path code")?.textContent).toBe(
      "C:\\\\repo\\\\dist\\\\x\\\\example_left.json",
    );
    // Findings as rows, not one joined line.
    expect(report?.querySelectorAll(".finding.warning")).toHaveLength(1);
  });

  it("saves every unit that changed in one go, and only those", async () => {
    // A pair had a Save and a Download per unit, four buttons, with Download drawn as the
    // main one. One Save covers the pair.
    const calls = served((path) => ({
      ok: true,
      saved: true,
      path,
      check: { game: null, built: [], findings: [], buildErrors: [] },
    }));
    mount();
    expect(header("Saved").hasAttribute("disabled")).toBe(true);

    edit("pinky_1", 0);
    header("Save changes").click();
    await vi.waitFor(() => {
      expect(document.querySelector(".save-report")).not.toBeNull();
    });
    expect(calls.map((call) => call.path)).toEqual(["/api/save"]);
    // Saved is the baseline now, so there is nothing left to save.
    expect(header("Saved").hasAttribute("disabled")).toBe(true);

    // Pinky 1 already holds what edit() assigns, so a different key changes the left.
    edit("pinky_2", 0);
    edit("pinky_1", 1);
    header("Save changes").click();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(3);
    });
  });

  it("sends only the in-game keys that changed, never the whole file", async () => {
    const calls = served(() => ({
      ok: true,
      saved: true,
      path: "p",
      check: { game: null, built: [], findings: [], buildErrors: [] },
    }));
    mount();
    header("In-game").click();
    const row = [...document.querySelectorAll(".ingame-row")].find(
      (node) => node.querySelector(".who b")?.textContent === "Headlight",
    );
    const chip = row?.querySelector<HTMLButtonElement>(".key-chip");
    if (!chip) throw new Error("no key chip for Headlight");
    chip.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyL", bubbles: true }));
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Save only")
      ?.click();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.path).toBe("/api/actions");
    expect(calls[0]?.body).toEqual({ game: "everspace", changes: { headlight: { key: "KeyL" } } });
  });

  it("saves a key and tells the game in one step, after asking that the game is closed", async () => {
    // It took two tabs: save here, then Repo, then write the game's bindings.
    const calls = served((path) =>
      path === "/api/ingame/apply"
        ? {
            ok: true,
            result: { changes: [{ display: "Headlight", from: "B", to: "L" }], backup: null },
          }
        : {
            ok: true,
            saved: true,
            path: "p",
            check: { game: null, built: [], findings: [], buildErrors: [] },
          },
    );
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    mount();
    header("In-game").click();
    const row = [...document.querySelectorAll(".ingame-row")].find(
      (node) => node.querySelector(".who b")?.textContent === "Headlight",
    );
    row?.querySelector<HTMLButtonElement>(".key-chip")?.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyL", bubbles: true }));
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Save and update the game")
      ?.click();
    await vi.waitFor(() => {
      expect(calls.map((call) => call.path)).toEqual(["/api/actions", "/api/ingame/apply"]);
    });
    expect(confirm).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(document.querySelector(".save-report")?.textContent).toContain("Updated the game");
    });
  });

  it("does nothing to the game when the user says it is still running", () => {
    const calls = served(() => ({ ok: true }));
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    mount();
    header("In-game").click();
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Save and update the game")
      ?.click();
    expect(calls).toEqual([]);
  });
});

describe("the inspector in plain words", () => {
  beforeEach(() => {
    mount();
    const sets = document.querySelectorAll("header select")[1] as HTMLSelectElement;
    sets.value = "single-v5";
    sets.dispatchEvent(new Event("change"));
  });

  function select(position: string): void {
    document.querySelector<HTMLButtonElement>(`.key[data-position="${position}"]`)?.click();
  }

  const labels = (): string[] =>
    [...document.querySelectorAll(".panel .field label")].map((node) => node.textContent);

  it("names the slots and timings the way the Azeron app does, not by their field names", () => {
    select("pinky_1");
    expect(labels()).toEqual(
      expect.arrayContaining(["Tap", "Long press", "Double tap", "Long-press wait (ms)"]),
    );
    expect(labels().join(" ")).not.toMatch(/feature_delay|isHold|^long$/);
  });

  it("can turn a repeat on, and only then asks how often", () => {
    select("pinky_1");
    expect(labels()).not.toContain("Every (ms)");
    const repeat = [...document.querySelectorAll<HTMLElement>(".field")].find(
      (field) => field.querySelector("label")?.textContent === "Repeat the tap while held",
    );
    const box = repeat?.querySelector<HTMLInputElement>("input");
    if (!box) throw new Error("no repeat checkbox");
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    expect(labels()).toContain("Every (ms)");
  });

  it("can put a stick back into keyboard mode, which the linter requires", () => {
    document.querySelector<HTMLButtonElement>(".stick-dial .dir.up")?.click();
    const mode = [...document.querySelectorAll<HTMLElement>(".field")]
      .find((field) => field.querySelector("label")?.textContent === "Stick sends")
      ?.querySelector("select");
    expect(mode?.value).toBe("keyboard");
  });

  it("says why there are no stick modes for a single unit instead of hiding the panel", () => {
    const panels = [...document.querySelectorAll(".panel")].map((panel) => panel.textContent);
    expect(panels.some((text) => text.includes("needs a left and a right unit"))).toBe(true);
  });
});

describe("unit settings", () => {
  beforeEach(() => {
    mount();
  });

  it("lets the sensor be chosen per unit, and warns when both would aim", () => {
    const boxes = [...document.querySelectorAll<HTMLElement>(".unit-settings .field")]
      .filter((field) => field.querySelector("label")?.textContent.endsWith("sensor aims"))
      .map((field) => field.querySelector<HTMLInputElement>("input"));
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      if (box && !box.checked) {
        box.checked = true;
        box.dispatchEvent(new Event("change"));
      }
    }
    expect(document.querySelector(".unit-settings .finding.warning")?.textContent).toContain(
      "Both sensors are on",
    );
  });
});

describe("the header", () => {
  it("labels the two selectors", () => {
    mount();
    const names = [...document.querySelectorAll("header .picker span")].map((n) => n.textContent);
    expect(names).toEqual(["Game", "Layout (both hands)"]);
  });
});

describe("printing the layout", () => {
  it("prints the board itself, from the menu, with no iframe anywhere", () => {
    mount();
    const print = vi.fn();
    window.print = print;
    expect(document.querySelector("iframe")).toBeNull();
    const item = [...document.querySelectorAll<HTMLButtonElement>(".menu-item")].find(
      (button) => button.textContent === "Print layout",
    );
    expect(item).toBeDefined();
    item?.click();
    expect(print).toHaveBeenCalledOnce();
    expect(document.querySelector(".print-title")?.textContent).toContain("Everspace");
  });

  it("goes back to the board first when printed from another tab", () => {
    mount();
    window.print = vi.fn();
    [...document.querySelectorAll<HTMLButtonElement>("header .tabs button")]
      .find((button) => button.textContent === "Setup")
      ?.click();
    [...document.querySelectorAll<HTMLButtonElement>(".menu-item")]
      .find((button) => button.textContent === "Print layout")
      ?.click();
    expect(document.querySelectorAll(".hand").length).toBe(2);
  });
});

describe("the press test tab", () => {
  it("keeps its place when something else on the page redraws", () => {
    // It was started afresh on every render, so a selector, a toggle or the tab
    // itself put it back at the first position -- and threw away a stick-zero pass.
    localStorage.clear();
    mount();
    const tab = (name: string): HTMLButtonElement => {
      const found = [...document.querySelectorAll<HTMLButtonElement>("header button")].find(
        (button) => button.textContent === name,
      );
      if (!found) throw new Error(`no ${name}`);
      return found;
    };
    tab("Press test").click();
    const prompt = (): string => document.querySelector(".prompt b")?.textContent ?? "";
    const first = prompt();
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Skip")
      ?.click();
    const second = prompt();
    expect(second).not.toBe(first);

    // Anything that redraws the page will do; the layout selector is one.
    const sets = document.querySelectorAll("header select")[1] as HTMLSelectElement;
    sets.dispatchEvent(new Event("change"));
    expect(prompt()).toBe(second);
  });
});

describe("the checks, from anywhere", () => {
  it("shows the verdict in the header, and changes it as soon as an edit does", () => {
    // The Checks panel sat below the fold, so the feedback an edit is for was out of sight.
    mount();
    const chip = (): string => document.querySelector("header .pill.lint")?.textContent ?? "";
    expect(chip()).toBe("✓ Clean");

    // Rebinding the only Consumable 4 leaves a required action unbound.
    document.querySelector<HTMLButtonElement>('.hand .key[data-position="pinky_2"]')?.click();
    const fire = [...document.querySelectorAll<HTMLButtonElement>(".action")].find((button) =>
      button.querySelector("b")?.textContent.startsWith("Fire primary"),
    );
    fire?.click();
    expect(chip()).toMatch(/^\d+ to look at$/);
  });

  it("folds the stick modes away, still saying which one is in use", () => {
    mount();
    const sets = document.querySelectorAll("header select")[1] as HTMLSelectElement;
    sets.value = LIVE_SET;
    sets.dispatchEvent(new Event("change"));
    const panel = document.querySelector<HTMLDetailsElement>("details.panel.fold");
    expect(panel?.hasAttribute("open")).toBe(false);
    expect(panel?.querySelector("summary")?.textContent).toContain("Mode 2");
  });
});

describe("putting an action on a key", () => {
  beforeEach(() => {
    mount();
  });

  it("says what to do before a key is picked, and what a click will do after", () => {
    expect(document.querySelector(".palette-note")?.textContent).toContain("Pick a key");
    expect(document.querySelector(".action-list")?.classList.contains("inert")).toBe(true);
    document.querySelector<HTMLButtonElement>('.hand .key[data-position="pinky_1"]')?.click();
    expect(document.querySelector(".palette-target")?.textContent).toBe("Put on Left Pinky 1:");
  });

  it("filters the list as you type, and keeps the filter across a redraw", () => {
    const filter = document.querySelector<HTMLInputElement>(".panel .filter");
    if (!filter) throw new Error("no filter box");
    filter.value = "consum";
    filter.dispatchEvent(new Event("input"));
    const shown = (): string[] =>
      [...document.querySelectorAll<HTMLElement>(".action")]
        .filter((button) => !button.hidden)
        .map((button) => button.querySelector("b")?.textContent ?? "");
    expect(shown().length).toBeGreaterThan(0);
    expect(shown().every((label) => label.toLowerCase().includes("consum"))).toBe(true);

    document.querySelector<HTMLButtonElement>('.hand .key[data-position="pinky_1"]')?.click();
    expect(shown().every((label) => label.toLowerCase().includes("consum"))).toBe(true);
  });

  it("clears a slot with its own button", () => {
    document.querySelector<HTMLButtonElement>('.hand .key[data-position="pinky_1"]')?.click();
    const tap = [...document.querySelectorAll<HTMLElement>(".field.slot")].find(
      (field) => field.querySelector("label")?.textContent === "Tap",
    );
    tap?.querySelector<HTMLButtonElement>('button[title="Clear"]')?.click();
    const card = document.querySelector('.hand .key[data-position="pinky_1"]');
    expect(card?.classList.contains("empty")).toBe(true);
  });
});
