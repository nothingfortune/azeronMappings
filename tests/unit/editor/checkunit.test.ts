// @vitest-environment happy-dom
/**
 * Checking a unit from the Edit board: it asks for each control, reads what the unit sends,
 * marks the key, and says at the end whether the unit is running the layout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { expectedPresses } from "../../../src/lib/checkunit.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { Game } from "../../../src/lib/model.js";
import { LIVE_SET } from "../../helpers/fixtures.js";

const PAYLOAD = buildPayload();
const game = new Game("games/SpaceSims/everspace");
const BUTTONS: Record<string, number> = { left: 0, middle: 1, right: 2 };

let clock = 1_000_000;

function mount(): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(PAYLOAD));
  const select = document.querySelectorAll<HTMLSelectElement>("header select")[0];
  if (select && select.value !== LIVE_SET) {
    select.value = LIVE_SET;
    select.dispatchEvent(new Event("change"));
  }
}

const hand = (unit: 0 | 1): Element => {
  const found = document.querySelectorAll(".hand")[unit];
  if (!found) throw new Error("no hand");
  return found;
};

const key = (unit: 0 | 1, position: string): HTMLElement => {
  const found = hand(unit).querySelector<HTMLElement>(`.key[data-position="${position}"]`);
  if (!found) throw new Error(`no key ${position}`);
  return found;
};

const bar = (): string => document.querySelector(".check-bar")?.textContent ?? "";

function barButton(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>(".check-bar button")].find(
    (button) => button.textContent === label,
  );
  if (!found) throw new Error(`no ${label} button`);
  return found;
}

/** One press on the unit, some time after the last, the way a hand presses. */
function press(code: string): void {
  clock += 1_000;
  window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }));
  window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true, cancelable: true }));
}

function click(button: number, target: Element = document.body): void {
  clock += 1_000;
  target.dispatchEvent(new MouseEvent("mousedown", { button, bubbles: true, cancelable: true }));
}

/** Start the key test, then its step-by-step check of one unit. */
function testKeys(): void {
  [...document.querySelectorAll<HTMLButtonElement>("header button")]
    .find((button) => button.textContent === "Test keys")
    ?.click();
}

function checkStepByStep(hand: "left" | "right"): void {
  if (document.querySelector(".tester-bar") === null) testKeys();
  [...document.querySelectorAll<HTMLButtonElement>(".tester-bar .check-unit")]
    .find((button) => button.textContent === `Check the ${hand} unit step by step`)
    ?.click();
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  mount();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checking a unit by pressing it", () => {
  it("is offered for each unit from the key test, not on the board", () => {
    expect(document.querySelector(".hand .check-unit")).toBeNull();
    testKeys();
    const offered = [...document.querySelectorAll(".tester-bar .check-unit")].map(
      (node) => node.textContent,
    );
    expect(offered).toEqual([
      "Check the left unit step by step",
      "Check the right unit step by step",
    ]);
  });

  it("asks for each control in turn, and marks what each one sent", () => {
    checkStepByStep("right");
    expect(bar()).toContain("Checking the right unit: press Index side on it");
    expect(bar()).toContain("The layout has Boost (Left Shift) there.");
    expect(key(1, "index_side").classList.contains("check-next")).toBe(true);

    // A modifier pressed on its own is the press.
    press("ShiftLeft");
    expect(key(1, "index_side").classList.contains("check-ok")).toBe(true);
    expect(key(1, "index_2").classList.contains("check-next")).toBe(true);

    // Index 2 should be W; the unit sends I.
    press("KeyI");
    const wrong = key(1, "index_2");
    expect(wrong.classList.contains("check-bad")).toBe(true);
    expect(wrong.title).toContain("Sent Inventory (I); the layout has Thrust forward (W).");

    // Index 3 is the right mouse button.
    click(2);
    expect(key(1, "index_3").classList.contains("check-ok")).toBe(true);
    expect(bar()).toContain("2 as the layout");
    expect(bar()).toContain("1 not");
  });

  it("reads one press once: a key the unit repeats, or two keys in a burst, is one reading", () => {
    checkStepByStep("right");
    press("ShiftLeft");
    clock += 1_000;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyW", repeat: true, bubbles: true }),
    );
    // Within the settling time: not a press of the next control.
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ", bubbles: true }));
    expect(key(1, "index_2").classList.contains("check-ok")).toBe(true);
    expect(key(1, "index_3").classList.contains("check-next")).toBe(true);
  });

  it("reads a turbo key, which sends a stream of presses while held, as one press", () => {
    checkStepByStep("right");
    clock += 1_000;
    for (let pulse = 0; pulse < 20; pulse += 1) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftLeft", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "ShiftLeft", bubbles: true }));
      clock += 100;
    }
    // Two seconds of pulses, one reading; the next control is still waiting.
    expect(key(1, "index_side").classList.contains("check-ok")).toBe(true);
    expect(key(1, "index_2").classList.contains("check-next")).toBe(true);
    press("KeyW");
    expect(key(1, "index_2").classList.contains("check-ok")).toBe(true);
  });

  it("asks to point at the board when the control is a mouse button", () => {
    checkStepByStep("right");
    press("ShiftLeft");
    press("KeyW");
    expect(bar()).toContain("Fire secondary (Right mouse button)");
    expect(bar()).toContain("Point at the board first");
    // A click on the bar is the bar's: the run is still waiting for the button.
    document
      .querySelector(".check-bar")
      ?.dispatchEvent(new MouseEvent("mousedown", { button: 2, bubbles: true }));
    expect(key(1, "index_3").classList.contains("check-next")).toBe(true);
  });

  it("goes back, skips, and stops, from its own buttons, which a click on still reaches", () => {
    checkStepByStep("right");
    press("ShiftLeft");
    barButton("Skip").click();
    expect(key(1, "index_3").classList.contains("check-next")).toBe(true);
    barButton("Back").click();
    expect(key(1, "index_2").classList.contains("check-next")).toBe(true);
    barButton("Stop").click();
    expect(document.querySelector(".check-bar")).toBeNull();
    expect(document.querySelector(".key.check-ok")).toBeNull();
  });

  it("keeps the page out of it: a key from the unit is not Undo, a click is not a selection", () => {
    // Make a change, so Undo has something to take back.
    key(1, "ring_1").click();
    checkStepByStep("right");
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyZ",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(key(1, "index_side").classList.contains("check-bad")).toBe(true);
    clock += 1_000;
    key(1, "pinky_5").dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    key(1, "pinky_5").dispatchEvent(new MouseEvent("click", { button: 0, bubbles: true }));
    expect(key(1, "pinky_5").classList.contains("selected")).toBe(false);
    expect(key(1, "index_2").classList.contains("check-bad")).toBe(true);
  });

  it("says the unit is running the layout when every control sent what it has", () => {
    const right = game.loadedProfiles().find((p) => p.set === LIVE_SET && p.unit === "right");
    if (!right) throw new Error("no right unit");
    const presses = expectedPresses(right.data, right.device, game.actions);
    checkStepByStep("right");
    for (const expected of presses) {
      const sends = expected.sends;
      if (sends.kind === "mouse") click(BUTTONS[sends.button] ?? 0);
      else press(sends.code);
    }
    expect(bar()).toContain(
      `The right unit is running this layout: all ${String(presses.length)} controls sent`,
    );
    expect(document.querySelectorAll(".hand .key.check-ok").length).toBeGreaterThan(20);
    expect(document.querySelector(".hand .key.check-bad")).toBeNull();
  });

  it("says when it is not, which controls, and what to do", () => {
    checkStepByStep("right");
    press("ShiftLeft");
    press("KeyI");
    while (document.querySelector(".check-bar .check-ask") !== null) barButton("Skip").click();
    expect(bar()).toContain("The right unit is not running this layout: 1 of 2 controls sent");
    expect(bar()).toContain("Index 2: sent Inventory (I); the layout has Thrust forward (W)");
    expect(bar()).toContain("Write to units, in the header, puts this layout on it");
    expect(bar()).not.toContain("Azeron app");
    // From the verdict, the other unit is one click away.
    barButton("Check the left unit").click();
    expect(bar()).toContain("Checking the left unit");
  });

  it("ends with a change of tab", () => {
    checkStepByStep("right");
    const tab = (name: string): void => {
      [...document.querySelectorAll<HTMLButtonElement>("header .tabs button")]
        .find((button) => button.textContent === name)
        ?.click();
    };
    tab("In-game");
    tab("Edit");
    expect(document.querySelector(".check-bar")).toBeNull();
  });
});
