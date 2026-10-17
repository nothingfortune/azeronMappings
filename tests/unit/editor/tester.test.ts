// @vitest-environment happy-dom
/**
 * The live key tester and the Edit dock's tabs: press something on a unit and its control
 * lights up; the checks and the sticks and pedals each have a tab of their own.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { start } from "../../../src/editor/app.js";
import { expectedPresses } from "../../../src/lib/checkunit.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { Game } from "../../../src/lib/model.js";
import { showDockTab } from "../../helpers/editor.js";
import { LIVE_SET, live } from "../../helpers/fixtures.js";

const PAYLOAD = buildPayload();
const game = new Game("games/SpaceSims/everspace");

function mount(): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(PAYLOAD));
  const select = document.querySelectorAll<HTMLSelectElement>("header select")[1];
  if (select && select.value !== LIVE_SET) {
    select.value = LIVE_SET;
    select.dispatchEvent(new Event("change"));
  }
}

const header = (label: RegExp): HTMLButtonElement => {
  const found = [...document.querySelectorAll<HTMLButtonElement>("header button")].find((button) =>
    label.test(button.textContent),
  );
  if (!found) throw new Error(`no header button ${String(label)}`);
  return found;
};
const strip = (): string => document.querySelector(".tester-bar")?.textContent ?? "";
const key = (code: string, type: "keydown" | "keyup"): void => {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
};

/** A control of the left unit that sends a plain key, from the layout itself. */
function plainKey(): { position: string; code: string } {
  const profile = game.loadedProfiles().find((entry) => entry.path === live("left"));
  if (!profile) throw new Error("no live left profile");
  const press = expectedPresses(profile.data, profile.device, game.actions).find(
    (entry) =>
      entry.direction === undefined &&
      entry.sends.kind === "key" &&
      entry.sends.modifiers.length === 0 &&
      !/Shift|Control|Alt|Meta/.test(entry.sends.code),
  );
  if (press?.sends.kind !== "key") throw new Error("no plain key on the left unit");
  return { position: press.position, code: press.sends.code };
}

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // Nothing kept.
  }
  mount();
});

describe("the live key tester", () => {
  it("lights the control a key comes from while it is held, and says what it is", () => {
    const { position, code } = plainKey();
    header(/^Test keys$/).click();
    expect(strip()).toContain("Key tester");
    key(code, "keydown");
    const lit = document
      .querySelectorAll(".hand")[0]
      ?.querySelector(`.key[data-position="${position}"]`);
    expect(lit?.classList.contains("live-hit")).toBe(true);
    expect(strip()).toContain("← left");
    key(code, "keyup");
    const after = document
      .querySelectorAll(".hand")[0]
      ?.querySelector(`.key[data-position="${position}"]`);
    expect(after?.classList.contains("live-hit")).toBe(false);
  });

  it("says when no control of the layout sends what arrived", () => {
    header(/^Test keys$/).click();
    key("F24", "keydown");
    expect(strip()).toContain("no control of this layout sends it");
  });

  it("keeps the page's own keys from acting while it runs, and stops", () => {
    header(/^Test keys$/).click();
    const event = new KeyboardEvent("keydown", {
      code: "KeyZ",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    header(/^Testing keys$/).click();
    expect(document.querySelector(".tester-bar")).toBeNull();
  });
});

describe("the Edit dock's tabs", () => {
  it("shows the checks or the sticks and pedals, one at a time, and says how many checks", () => {
    const tabs = [...document.querySelectorAll(".dock-tab")].map((tab) => tab.textContent);
    expect(tabs[0]).toMatch(/^Checks( \(\d+\)| ✓)$/);
    expect(tabs[1]).toBe("Sticks & pedals");
    expect(document.querySelector(".dock .checks")).not.toBeNull();
    expect(document.querySelector(".dock .pedals")).toBeNull();
    showDockTab("pedals");
    expect(document.querySelector(".dock .checks")).toBeNull();
    expect(document.querySelector(".dock .pedals")).not.toBeNull();
  });

  it("remembers the tab across a reload", () => {
    showDockTab("pedals");
    mount();
    expect(document.querySelector(".dock-tab.active")?.textContent).toBe("Sticks & pedals");
  });
});

describe("the key tester's own keys", () => {
  it("stops from the keyboard: Enter on its Stop button is the page's", () => {
    header(/^Test keys$/).click();
    const stop = [...document.querySelectorAll<HTMLButtonElement>(".tester-bar button")].find(
      (button) => button.textContent === "Stop",
    );
    if (!stop) throw new Error("no Stop");
    const enter = new KeyboardEvent("keydown", { code: "Enter", bubbles: true, cancelable: true });
    stop.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
  });

  it("forgets a modifier held when the window lost sight of its release", () => {
    const { code } = plainKey();
    header(/^Test keys$/).click();
    key("ShiftLeft", "keydown");
    window.dispatchEvent(new Event("blur"));
    key(code, "keydown");
    expect(document.querySelector(".tester-recent li")?.textContent ?? "").not.toMatch(/Shift/);
  });
});
