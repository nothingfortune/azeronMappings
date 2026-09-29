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

  it("renders a key for every position on the device", () => {
    const firstHand = document.querySelector(".hand");
    expect(firstHand?.querySelectorAll(".key").length).toBe(31);
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
