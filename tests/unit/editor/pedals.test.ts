// @vitest-environment happy-dom
/**
 * Pedals in the editor: drawn with the keypads, edited like them, saved with them, and
 * read by the stick-mode panel and the checks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { LIVE_SET } from "../../helpers/fixtures.js";

const PAYLOAD = buildPayload();
const SERVED = window as unknown as { AZERON_SERVED?: boolean };

function mount(set = LIVE_SET): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(PAYLOAD));
  const select = document.querySelectorAll<HTMLSelectElement>("header select")[1];
  if (select && select.value !== set) {
    select.value = set;
    select.dispatchEvent(new Event("change"));
  }
}

function axis(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`.pedal-axis[data-axis="${id}"]`);
  if (!found) throw new Error(`no pedal axis ${id}`);
  return found;
}

function choose(id: string, drives: string): void {
  const select = axis(id).querySelector("select");
  if (!select) throw new Error("no select");
  select.value = drives;
  select.dispatchEvent(new Event("change"));
}

/** The header's one Save, whichever state it is in -- not the Edit tab, which is also primary. */
function saveButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("header button")].find(
    (node) => node.textContent === "Save" || node.textContent === "Saved",
  );
}

const reading = (): string => document.querySelector("[data-reading]")?.textContent ?? "";

function stickDirections(unit: 0 | 1): string[] {
  return [
    ...(document.querySelectorAll(".hand")[unit]?.querySelectorAll(".stick-dial .dir .name") ?? []),
  ]
    .map((node) => node.textContent)
    .filter((text) => text !== "");
}

describe("the pedals panel", () => {
  beforeEach(() => {
    mount();
  });

  it("draws the three pedal axes of the live layout in plain words", () => {
    const labels = [...document.querySelectorAll(".pedal-axis .pedal-line b")].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(["Rudder", "Left toe", "Right toe"]);
    expect(axis("rudder").querySelector("select")?.value).toBe("yaw");
    expect(axis("left_toe").querySelector("select")?.value).toBe("");
    // The options are the genre's axes, in words, plus nothing.
    const options = [...axis("rudder").querySelectorAll("option")].map((node) => node.textContent);
    expect(options).toEqual([
      "Nothing",
      "Thrust",
      "Hover",
      "Strafe",
      "Turn (yaw)",
      "Pitch",
      "Roll",
    ]);
  });

  it("says how far each game name is trusted, and never calls any of it verified", () => {
    expect(axis("rudder").querySelector(".chip")?.textContent).toBe("Inferred, not flown");
    expect(axis("left_toe").querySelector(".chip")?.textContent).toBe("Axis not established");
    expect(document.querySelector(".pedals")?.textContent ?? "").not.toMatch(/verified/i);
  });

  it("keeps drives and invert in front and the tuning behind a Details button", () => {
    expect(axis("rudder").querySelector('input[data-field="invert"]')).not.toBeNull();
    expect(axis("rudder").querySelector('input[data-field="dead_zone"]')).toBeNull();
    axis("rudder").querySelector<HTMLButtonElement>(".tune-toggle")?.click();
    for (const field of ["dead_zone", "scale", "sensitivity", "exponent", "shared"]) {
      expect(axis("rudder").querySelector(`input[data-field="${field}"]`)).not.toBeNull();
    }
    // An axis that drives nothing has no invert and no tuning to offer.
    expect(axis("left_toe").querySelector('input[data-field="invert"]')).toBeNull();
  });

  it("is not dirty until something changes, and clean again when it changes back", () => {
    const save = saveButton;
    SERVED.AZERON_SERVED = true;
    try {
      mount();
      expect(save()?.textContent).toBe("Saved");
      choose("rudder", "roll");
      expect(save()?.textContent).toBe("Save");
      expect(save()?.title).toContain("Pedals");
      choose("rudder", "yaw");
      expect(save()?.textContent).toBe("Saved");
    } finally {
      SERVED.AZERON_SERVED = false;
    }
  });

  it("offers to add pedals to a layout that has none, with the rudder on yaw", () => {
    mount("single-v5");
    expect(document.querySelector(".pedal-axis")).toBeNull();
    document.querySelector<HTMLButtonElement>(".add-pedals")?.click();
    expect(axis("rudder").querySelector("select")?.value).toBe("yaw");
    // The toes are never assigned for the owner.
    expect(axis("left_toe").querySelector("select")?.value).toBe("");
    expect(axis("right_toe").querySelector("select")?.value).toBe("");
  });

  it("removes the pedals from a layout", () => {
    document.querySelector<HTMLButtonElement>(".remove-pedals")?.click();
    expect(document.querySelector(".pedal-axis")).toBeNull();
    expect(document.querySelector(".add-pedals")).not.toBeNull();
  });

  it("writes invert and tuning into the layout's pedals", () => {
    const invert = axis("rudder").querySelector<HTMLInputElement>('input[data-field="invert"]');
    if (!invert) throw new Error("no invert");
    invert.checked = true;
    invert.dispatchEvent(new Event("change"));
    axis("rudder").querySelector<HTMLButtonElement>(".tune-toggle")?.click();
    const dead = axis("rudder").querySelector<HTMLInputElement>('input[data-field="dead_zone"]');
    if (!dead) throw new Error("no dead zone");
    dead.value = "0.05";
    dead.dispatchEvent(new Event("change"));
    expect(
      axis("rudder").querySelector<HTMLInputElement>('input[data-field="invert"]')?.checked,
    ).toBe(true);
    expect(
      axis("rudder").querySelector<HTMLInputElement>('input[data-field="dead_zone"]')?.value,
    ).toBe("0.05");
    expect(axis("rudder").querySelector(".tune-toggle")?.textContent).toContain("1 tuned");
  });
});

describe("the sticks and the pedals", () => {
  beforeEach(() => {
    mount();
  });

  it("reads the live layout as Mode 2 with pedals, not roll for yaw", () => {
    expect(reading()).toBe("Mode 2 (RC default), with pedals");
  });

  it("says the reading changed when the yaw assignment goes, and leaves the sticks alone", () => {
    const before = stickDirections(0);
    choose("rudder", "");
    expect(reading()).toBe("Mode 2, roll for yaw");
    expect(document.querySelector(".pedals-note")?.textContent).toContain(
      "Mode 2 (RC default), with pedals",
    );
    expect(document.querySelector(".pedals-note")?.textContent).toContain(
      "Nothing on the sticks was changed",
    );
    expect(stickDirections(0)).toEqual(before);
    // And back: the reading follows the assignment, both ways.
    choose("rudder", "yaw");
    expect(reading()).toBe("Mode 2 (RC default), with pedals");
  });

  it("applies the with-pedals variant of a mode when the pedals carry yaw, and says so", () => {
    expect(document.querySelector(".mode-pedals")?.textContent).toContain("with-pedals variant");
    const mode1 = [...document.querySelectorAll<HTMLButtonElement>(".mode-row")].find((row) =>
      row.textContent.startsWith("Mode 1"),
    );
    mode1?.click();
    // Mode 1 plain has yaw on the left stick's horizontal; with pedals it has roll.
    expect(stickDirections(0).join(" ")).toContain("Roll left");
    expect(stickDirections(0).join(" ")).not.toContain("Yaw");
    expect(reading()).toBe("Mode 1, with pedals");
    expect(document.querySelector(".save-note")?.textContent).toContain("with pedals");
  });

  it("applies the plain mode when the layout's pedals do not carry yaw", () => {
    choose("rudder", "");
    expect(document.querySelector(".mode-pedals")?.textContent).toContain("applied as written");
    const mode1 = [...document.querySelectorAll<HTMLButtonElement>(".mode-row")].find((row) =>
      row.textContent.startsWith("Mode 1"),
    );
    mode1?.click();
    expect(stickDirections(0).join(" ")).toContain("Yaw left");
    expect(reading()).toBe("Mode 1");
  });

  it("applies a mode as written to a layout with no pedals", () => {
    document.querySelector<HTMLButtonElement>(".remove-pedals")?.click();
    expect(document.querySelector(".mode-pedals")?.textContent).toContain("no pedals");
    expect(document.querySelector(".mode-pedals")?.getAttribute("data-with-pedals")).toBe("false");
    // The sticks were not touched by taking the pedals away; only how they read changed.
    expect(reading()).toBe("Mode 2, roll for yaw");
  });
});

describe("the checks", () => {
  beforeEach(() => {
    mount();
  });

  it("run the pedal rules on the pedals as edited, before anything is saved", () => {
    expect(document.querySelector(".pedal-warn")).toBeNull();
    choose("left_toe", "thrust");
    const rules = [...document.querySelectorAll(".checks .rule")].map((node) => node.textContent);
    expect(rules).toContain("pedal-rest-on-centred");
    const finding = [...document.querySelectorAll(".checks .finding")].find((node) =>
      node.textContent.includes("pedal-rest-on-centred"),
    );
    expect(finding?.querySelector("b")?.textContent).toBe("Pedals: Left toe");
    expect(axis("left_toe").querySelector(".pedal-warn")?.textContent).toContain("full deflection");
    expect(document.querySelector("header .pill.lint")?.textContent).toContain("to look at");
  });

  it("flag a stick that still sends what a pedal carries", () => {
    const rules = [...document.querySelectorAll(".checks .rule")].map((node) => node.textContent);
    expect(rules).not.toContain("pedal-duplicates-stick");
    // Plain Mode 2 puts yaw on the left stick; the rudder is then put back on yaw.
    choose("rudder", "");
    [...document.querySelectorAll<HTMLButtonElement>(".mode-row")]
      .find((row) => row.textContent.startsWith("Mode 2 (RC default)"))
      ?.click();
    expect(reading()).toBe("Mode 2 (RC default)");
    choose("rudder", "yaw");
    const after = [...document.querySelectorAll(".checks .rule")].map((node) => node.textContent);
    expect(after).toContain("pedal-duplicates-stick");
  });
});

describe("saving the pedals with everything else", () => {
  function served(reply: (path: string, body: { path?: string; content?: string }) => unknown) {
    SERVED.AZERON_SERVED = true;
    const calls: { path: string; body: { path?: string; content?: string } }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { path?: string; content?: string };
        calls.push({ path, body });
        return Promise.resolve({ status: 200, json: () => Promise.resolve(reply(path, body)) });
      }),
    );
    return calls;
  }

  afterEach(() => {
    SERVED.AZERON_SERVED = false;
    vi.unstubAllGlobals();
  });

  const verdict = {
    ok: true,
    check: {
      game: "everspace",
      built: [],
      findings: [],
      buildErrors: [],
      pedals: {
        set: LIVE_SET,
        axes: [
          {
            pedalAxis: "rudder",
            label: "Rudder",
            drives: "yaw",
            row: "Yaw",
            name: "JS0_SaitekProFlightRudderPedals_Axis2",
            status: "inferred",
          },
        ],
      },
    },
  };

  it("sends sets.yaml through the one Save, comments and all, and reports the verdict", async () => {
    const calls = served(() => verdict);
    mount();
    choose("left_toe", "thrust");
    const save = saveButton();
    expect(save?.title).toBe("Unsaved: Pedals");
    save?.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".save-report")).not.toBeNull();
    });

    const sent = calls.find((call) => call.body.path?.endsWith("sets.yaml"));
    expect(sent?.path).toBe("/api/save");
    expect(sent?.body.path).toBe("games/SpaceSims/everspace/sets.yaml");
    expect(sent?.body.content).toContain("rudder: {drives: yaw}");
    expect(sent?.body.content).toContain("left_toe: {drives: thrust}");
    expect(sent?.body.content).toContain("THE TOES ARE DELIBERATELY NOT ASSIGNED");
    // Pedals only: no keypad or in-game call rode along.
    expect(calls.length).toBe(1);

    const report = document.querySelector(".save-report")?.textContent ?? "";
    expect(report).toContain("Saved games/SpaceSims/everspace/sets.yaml.");
    expect(report).toContain("Rudder drives turn (yaw) (the game's Yaw row)");
    expect(report).toContain("inferred, not flown");
    // It was saved, so the page no longer calls it unsaved, and the game is offered the change.
    expect(saveButton()?.textContent).toBe("Saved");
    expect(report).toContain("The game does not know about the new pedals yet.");
  });

  it("saves a keypad edit and a pedals edit as one scheme", async () => {
    const calls = served(() => verdict);
    mount();
    choose("left_toe", "thrust");
    const inputs = document.querySelectorAll<HTMLInputElement>(".ingame-row input");
    expect(inputs.length).toBe(0);
    document.querySelector<HTMLButtonElement>('.hand .key[data-position="pinky_1"]')?.click();
    const label = [...document.querySelectorAll<HTMLInputElement>('.panel input[type="text"]')][0];
    if (label) {
      label.value = "Both at once";
      label.dispatchEvent(new Event("change"));
    }
    expect(saveButton()?.title).toContain("Pedals");
    saveButton()?.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".save-report")).not.toBeNull();
    });
    const paths = calls.map((call) => call.body.path);
    expect(paths).toContain("games/SpaceSims/everspace/sets.yaml");
    expect(paths.length).toBeGreaterThan(1);
  });

  it("asks before throwing unsaved pedals away", () => {
    served(() => verdict);
    mount();
    choose("rudder", "roll");
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const game = document.querySelectorAll<HTMLSelectElement>("header select")[0];
    if (game) {
      game.value = "0";
      game.dispatchEvent(new Event("change"));
    }
    expect(confirm).toHaveBeenCalled();
    expect(axis("rudder").querySelector("select")?.value).toBe("roll");
  });

  it("downloads sets.yaml with the layout when the page cannot save", () => {
    SERVED.AZERON_SERVED = false;
    mount();
    choose("left_toe", "thrust");
    const names: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:x",
      revokeObjectURL: () => undefined,
    });
    const item = [...document.querySelectorAll<HTMLButtonElement>(".menu-item")].find(
      (node) => node.textContent === "Download the layout as YAML",
    );
    item?.click();
    click.mockRestore();
    expect(names).toContain("sets.yaml");
  });
});
