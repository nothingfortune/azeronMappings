// @vitest-environment happy-dom
/**
 * Clicking a key that has nothing on it asks what goes there: the game's actions, the
 * needed ones first, or any key of the keyboard sent exactly as it is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { closePicker } from "../../../src/editor/picker.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";

const PAYLOAD = buildPayload();

const key = (position: string): HTMLElement | null =>
  document
    .querySelectorAll(".hand")[0]
    ?.querySelector<HTMLElement>(`.key[data-position="${position}"]`) ?? null;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(PAYLOAD));
});

afterEach(() => {
  closePicker();
  vi.unstubAllGlobals();
});

describe("what goes on a key", () => {
  it("is asked the moment an empty key is clicked", () => {
    expect(key("pinky_5")?.textContent).not.toContain("Pinky 5Escape");
    key("pinky_5")?.click();
    expect(document.querySelector(".picker-dialog")?.textContent).toContain("Left Pinky 5");
    expect(document.querySelectorAll(".picker-item").length).toBeGreaterThan(10);
  });

  it("puts the action picked on the key", () => {
    key("pinky_5")?.click();
    const item = [...document.querySelectorAll<HTMLButtonElement>(".picker-item")].find(
      (node) => node.querySelector("b")?.textContent === "Headlight",
    );
    if (!item) throw new Error("no Headlight to pick");
    item.click();
    expect(document.querySelector(".picker-dialog")).toBeNull();
    expect(key("pinky_5")?.textContent).toContain("Headlight");
  });

  it("finds an action by name", () => {
    key("pinky_5")?.click();
    const search = document.querySelector<HTMLInputElement>(".picker-search");
    if (!search) throw new Error("no search box");
    search.value = "headl";
    search.dispatchEvent(new Event("input"));
    const shown = [...document.querySelectorAll<HTMLElement>(".picker-item")].filter(
      (node) => !node.hidden,
    );
    expect(shown.map((node) => node.querySelector("b")?.textContent)).toEqual(["Headlight"]);
  });

  it("sends a keyboard key no action has, as a new action named after the key", () => {
    key("pinky_5")?.click();
    document.querySelector<HTMLButtonElement>('[data-picker-tab="Keyboard key"]')?.click();
    document.querySelector<HTMLButtonElement>('.picker-dialog [data-choose="F12"]')?.click();
    expect(document.querySelector(".picker-dialog")).toBeNull();
    expect(key("pinky_5")?.textContent).toContain("F12");
  });

  it("uses the action already on a keyboard key, rather than sending it twice", () => {
    // The arrow up key is Everspace's Pitch up.
    key("pinky_5")?.click();
    document.querySelector<HTMLButtonElement>('[data-picker-tab="Keyboard key"]')?.click();
    document.querySelector<HTMLButtonElement>('.picker-dialog [data-choose="ArrowUp"]')?.click();
    expect(key("pinky_5")?.textContent).toContain("Pitch up");
  });

  it("is offered for a key in use from the Key panel", () => {
    key("pinky_1")?.click();
    expect(document.querySelector(".picker-dialog")).toBeNull();
    document.querySelector<HTMLButtonElement>("[data-choose-action]")?.click();
    expect(document.querySelector(".picker-dialog")).not.toBeNull();
  });

  it("closes on Escape wherever focus is, putting nothing on the key", () => {
    key("pinky_5")?.click();
    // Pressed on the page behind, as when focus never reached the chooser.
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".picker-dialog")).toBeNull();
  });

  it("takes focus into the chooser, the search box first", () => {
    key("pinky_5")?.click();
    expect(document.activeElement?.classList.contains("picker-search")).toBe(true);
  });
});
