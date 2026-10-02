/**
 * Clearing the board: every key emptied in one go, to lay a layout out again from the list.
 *
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { LIVE_SET } from "../../helpers/fixtures.js";

const PAYLOAD = buildPayload();
const SERVED = window as unknown as { AZERON_SERVED?: boolean };

function mount(): void {
  SERVED.AZERON_SERVED = true;
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(PAYLOAD));
  const select = document.querySelectorAll<HTMLSelectElement>("header select")[1];
  if (select && select.value !== LIVE_SET) {
    select.value = LIVE_SET;
    select.dispatchEvent(new Event("change"));
  }
}

function clearAll(answer: boolean): ReturnType<typeof vi.fn> {
  const confirm = vi.fn(() => answer);
  vi.stubGlobal("confirm", confirm);
  const button = document.querySelector<HTMLButtonElement>("[data-clear-all]");
  if (!button) throw new Error("no clear-all button");
  button.click();
  return confirm;
}

const filled = (): number => document.querySelectorAll(".hand .key:not(.empty)").length;
const directions = (): number =>
  document.querySelectorAll(".hand .stick-dial .dir:not(.hub):not(.empty)").length;
const saveButton = (): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>("header button")].find(
    (node) => node.textContent === "Save" || node.textContent === "Saved",
  );
const menuItem = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>(".menu-item")].find(
    (node) => node.textContent === label,
  );

afterEach(() => {
  SERVED.AZERON_SERVED = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("clearing every key", () => {
  it("asks first, and does nothing when the answer is no", () => {
    mount();
    const before = filled();
    expect(before).toBeGreaterThan(40);
    const confirm = clearAll(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(String(confirm.mock.calls[0]?.[0])).toContain("both units");
    expect(filled()).toBe(before);
    expect(saveButton()?.textContent).toBe("Saved");
  });

  it("empties every key and every stick direction on both units", () => {
    mount();
    expect(directions()).toBe(8);
    clearAll(true);
    expect(filled()).toBe(0);
    expect(directions()).toBe(0);
    // Both hands are still drawn, each with its stick.
    expect(document.querySelectorAll(".hand").length).toBe(2);
    expect(document.querySelectorAll(".hand .stick-dial").length).toBe(2);
  });

  it("sends every action back to the list, nothing greyed, and says what happened", () => {
    mount();
    expect(document.querySelectorAll(".action.bound").length).toBeGreaterThan(40);
    clearAll(true);
    expect(document.querySelectorAll(".action.bound").length).toBe(0);
    expect(document.querySelector(".save-note")?.textContent).toContain("Every key cleared");
    expect(saveButton()?.title).toBe("Unsaved: Left unit, Right unit");
  });

  it("leaves what a unit is: its stick's mode, its sensor, and the layout's pedals", () => {
    mount();
    const sensor = (): boolean | undefined =>
      document.querySelector<HTMLInputElement>('.panel input[type="checkbox"]')?.checked;
    const before = sensor();
    clearAll(true);
    expect(sensor()).toBe(before);
    expect(document.querySelector('.pedal-axis[data-axis="rudder"] select')).not.toBeNull();
    expect(
      document.querySelector<HTMLSelectElement>('.pedal-axis[data-axis="rudder"] select')?.value,
    ).toBe("yaw");
    // A stick with nothing on it is still a keyboard stick, which is all the game allows.
    const rules = [...document.querySelectorAll(".checks .rule")].map((node) => node.textContent);
    expect(rules).not.toContain("stick-not-keyboard");
  });

  it("is undone by the menu's undo, since nothing was saved", () => {
    mount();
    const before = filled();
    clearAll(true);
    expect(filled()).toBe(0);
    menuItem("Undo all unsaved edits")?.click();
    expect(filled()).toBe(before);
  });
});
