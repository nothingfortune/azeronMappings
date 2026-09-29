// @vitest-environment happy-dom
/**
 * The in-game half of the mapping is editable beside the boards: a key changed here
 * feeds the same linter the CLI runs, and exports as actions.yaml.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";

function tab(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("header button")].find(
    (button) => button.textContent === name,
  );
  if (!found) throw new Error(`no ${name} tab`);
  return found as HTMLButtonElement;
}

function keyInput(label: string): HTMLInputElement {
  const row = [...document.querySelectorAll(".ingame-row")].find(
    (node) => node.querySelector(".who b")?.textContent === label,
  );
  if (!row) throw new Error(`no row for ${label}`);
  const input = row.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error(`no key field for ${label}`);
  return input;
}

describe("the in-game bindings editor", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    start(buildPayload());
    tab("In-game").click();
  });

  it("shows the boards and the in-game keys together", () => {
    expect(document.querySelectorAll(".hand").length).toBe(2);
    expect(document.querySelectorAll(".ingame-row").length).toBeGreaterThan(20);
  });

  it("shows the key each action is bound to, and where it is sent from", () => {
    expect(keyInput("Consumable 1").value).toBe("Digit5");
    const row = keyInput("Consumable 1").closest(".ingame-row");
    expect(row?.querySelector(".who small")?.textContent).toContain("pinky_1");
  });

  it("says which actions do not come from a keypad key at all", () => {
    // Pitch and yaw are the unit's own mouse sensor, so they have no key to edit.
    const row = [...document.querySelectorAll(".ingame-row")].find(
      (node) => node.querySelector(".who b")?.textContent === "Pitch",
    );
    expect(row?.classList.contains("unbound")).toBe(true);
    expect(row?.querySelector("input")).toBeNull();
    expect(row?.textContent).toContain("sensor");
  });

  it("re-runs the checks when an in-game key is changed into a collision", () => {
    const input = keyInput("Consumable 1");
    input.value = "Digit6"; // already Consumable 2
    input.dispatchEvent(new Event("change"));

    tab("Edit").click();
    const findings = [...document.querySelectorAll(".finding")].map((n) => n.textContent);
    expect(findings.join(" ")).toContain("key-collision");
  });

  it("keeps the edit when switching modes", () => {
    const input = keyInput("Consumable 1");
    input.value = "KeyZ";
    input.dispatchEvent(new Event("change"));
    tab("Edit").click();
    tab("In-game").click();
    expect(keyInput("Consumable 1").value).toBe("KeyZ");
  });
});
