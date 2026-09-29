// @vitest-environment happy-dom
/**
 * Editor behaviour, exercised against a real payload: rendering both units, assigning an
 * action to a selected key, and surfacing linter findings.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";

function mount(): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(buildPayload());
}

describe("the editor", () => {
  beforeEach(() => {
    mount();
  });

  it("draws both units of an akimbo set side by side", () => {
    const setSelect = document.querySelectorAll("header select")[1] as HTMLSelectElement;
    setSelect.value = "akimbo-v6";
    setSelect.dispatchEvent(new Event("change"));

    const hands = document.querySelectorAll(".hand");
    expect(hands.length).toBe(2);
    const titles = [...hands].map((hand) => hand.querySelector(".title span")?.textContent ?? "");
    expect(titles.some((title) => title.includes("left hand"))).toBe(true);
    expect(titles.some((title) => title.includes("right hand"))).toBe(true);
  });

  it("renders every position on the device", () => {
    // 30 key cards plus the stick, which is drawn as a compass rather than a card.
    const firstHand = document.querySelector(".hand");
    expect(firstHand?.querySelectorAll(".key").length).toBe(30);
    expect(firstHand?.querySelectorAll(".stick-dial").length).toBe(1);
  });

  it("assigns an action to the selected key", () => {
    const keys = [...document.querySelectorAll<HTMLButtonElement>(".key")];
    const target = keys.find((key) => key.querySelector(".pos")?.textContent === "middle_1");
    expect(target).toBeDefined();
    target?.click();

    const palette = [...document.querySelectorAll<HTMLButtonElement>(".action")];
    const primary = palette.find((button) => button.textContent.includes("Primary 3"));
    expect(primary).toBeDefined();
    primary?.click();

    const updated = [...document.querySelectorAll<HTMLButtonElement>(".key")].find(
      (key) => key.querySelector(".pos")?.textContent === "middle_1",
    );
    expect(updated?.textContent).toContain("Primary 3");
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

  it("offers edit, press test and sheet from one page", () => {
    for (const name of ["Edit", "Press test", "Sheet"]) expect(tab(name)).toBeDefined();
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

  it("renders the sheet for the whole set", () => {
    tab("Sheet").click();
    const frame = document.querySelector("iframe.sheet-frame");
    expect(frame?.getAttribute("srcdoc") ?? "").toContain("In-game bindings to set");
  });
});

describe("key cards", () => {
  beforeEach(() => {
    mount();
  });

  function card(position: string): HTMLElement {
    const found = [...document.querySelectorAll<HTMLElement>(".key")].find(
      (key) => key.querySelector(".pos")?.textContent === position,
    );
    if (!found) throw new Error(`no card for ${position}`);
    return found;
  }

  it("puts the position and the action on separate lines", () => {
    // They were inline spans, which ran together as "pinky_1Consumable 1tap: Consumable 1".
    const key = card("pinky_1");
    expect(key.querySelector(".pos")?.textContent).toBe("pinky_1");
    expect(key.querySelector(".name")?.textContent).toBe("Consumable 1");
    expect(key.querySelectorAll(".sub").length).toBe(0);
  });

  it("marks an unbound position as empty and gives it no label", () => {
    const key = card("pinky_side");
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
    expect(dial?.querySelector(".up .name")?.textContent).toBe("Throttle up");
    expect(dial?.querySelector(".left .name")?.textContent).toBe("Strafe left");
    expect(dial?.querySelector(".hub .name")?.textContent).toBe("keyboard");
  });

  it("selects the stick when a direction cell is clicked", () => {
    const cell = document.querySelector<HTMLButtonElement>(".stick-dial .dir.right");
    cell?.click();
    expect(document.querySelector(".stick-dial.selected")).not.toBeNull();
  });

  it("can hide the side rails so the pair gets the full width", () => {
    const toggle = [...document.querySelectorAll("header button")].find(
      (button) => button.textContent === "Wide",
    );
    expect(toggle).toBeDefined();
    (toggle as HTMLButtonElement).click();
    expect(document.querySelector(".workspace")?.classList.contains("wide")).toBe(true);
    expect(document.querySelector(".action-list")).toBeNull();
    expect(document.querySelectorAll(".hand").length).toBe(2);
  });

  it("keeps both units on one row rather than wrapping one under the other", () => {
    const stage = document.querySelector<HTMLElement>(".stage");
    expect(stage?.parentElement?.className).toBe("stage-wrap");
    expect(stage?.querySelectorAll(".hand").length).toBe(2);
  });
});
