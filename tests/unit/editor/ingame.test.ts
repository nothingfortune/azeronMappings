// @vitest-environment happy-dom
/**
 * The in-game half of the mapping is editable beside the boards: a key changed here
 * feeds the same linter the CLI runs, and exports as actions.yaml.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { positionLabel } from "../../../src/lib/layout.js";

function tab(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("header button")].find(
    (button) => button.textContent === name,
  );
  if (!found) throw new Error(`no ${name} tab`);
  return found as HTMLButtonElement;
}

function row(label: string): Element {
  const found = [...document.querySelectorAll(".ingame-row")].find(
    (node) => node.querySelector(".who b")?.textContent === label,
  );
  if (!found) throw new Error(`no row for ${label}`);
  return found;
}

function chip(label: string): HTMLButtonElement {
  const found = row(label).querySelector<HTMLButtonElement>(".key-chip");
  if (!found) throw new Error(`no key chip for ${label}`);
  return found;
}

/** Bind an action as a person does: click its key, then press the new one. */
function press(label: string, code: string): void {
  chip(label).click();
  document.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
}

// Built once and cloned per test; see app.test.ts.
const PAYLOAD = buildPayload();

describe("the in-game bindings editor", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    start(structuredClone(PAYLOAD));
    tab("In-game").click();
  });

  it("shows the boards and the in-game keys together", () => {
    expect(document.querySelectorAll(".hand").length).toBe(2);
    expect(document.querySelectorAll(".ingame-row").length).toBeGreaterThan(20);
  });

  it("shows the key each action is bound to, and where it is sent from", () => {
    // As printed on the key, not the browser's code name for it.
    expect(chip("Consumable 1").textContent).toBe("5");
    // Which position carries it is a layout choice, so the row is checked against the
    // payload rather than against a position name that a revision is free to move.
    const set = (document.querySelectorAll("header select")[1] as HTMLSelectElement).value;
    const expected = PAYLOAD.games
      .flatMap((game) => game.profiles)
      .filter((profile) => profile.data.profile.set === set)
      .flatMap((profile) =>
        Object.entries(profile.data.positions)
          .filter(([, spec]) => spec.tap === "consume_1")
          .map(([position]) => position),
      );
    expect(expected.length).toBeGreaterThan(0);
    const where = row("Consumable 1").querySelector(".who small")?.textContent ?? "";
    for (const position of expected) expect(where).toContain(positionLabel(position));
  });

  it("says which actions do not come from a keypad key at all", () => {
    // The pointer is the unit's own sensor, so it has no key to edit.
    const pointer = row("Pointer up/down");
    expect(pointer.classList.contains("unbound")).toBe(true);
    expect(pointer.querySelector(".key-chip")).toBeNull();
    expect(pointer.textContent).toContain("sensor");
  });

  it("re-runs the checks when an in-game key is changed into a collision", () => {
    press("Consumable 1", "Digit6"); // already Consumable 2
    // Said beside the key the moment it happens, not only in the checks.
    expect(row("Consumable 1").querySelector(".keybind-note")?.textContent).toContain(
      "Consumable 2",
    );

    tab("Edit").click();
    const findings = [...document.querySelectorAll(".finding")].map((n) => n.textContent);
    expect(findings.join(" ")).toContain("key-collision");
  });

  it("keeps the edit when switching modes", () => {
    press("Consumable 1", "KeyV");
    tab("Edit").click();
    tab("In-game").click();
    expect(chip("Consumable 1").textContent).toBe("V");
  });

  it("binds a modifier on its own, the way boost is on Left Shift", () => {
    press("Boost", "ShiftRight");
    expect(chip("Boost").textContent).toBe("Right Shift");
  });

  it("binds a mouse button when one is pressed on the key", () => {
    chip("Lock target").click();
    chip("Lock target").dispatchEvent(new MouseEvent("mousedown", { button: 2, bubbles: true }));
    expect(chip("Lock target").textContent).toBe("Right mouse button");
  });

  it("refuses a key the game cannot be told about, and says so", () => {
    press("Consumable 1", "IntlBackslash");
    expect(chip("Consumable 1").textContent).toBe("5");
    expect(row("Consumable 1").querySelector(".keybind-note.bad")?.textContent).toContain(
      "cannot be bound",
    );
  });

  it("can be cancelled without changing anything", () => {
    chip("Consumable 1").click();
    expect(chip("Consumable 1").textContent).toBe("Press a key…");
    [...row("Consumable 1").querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Cancel")
      ?.click();
    expect(chip("Consumable 1").textContent).toBe("5");
  });
});
