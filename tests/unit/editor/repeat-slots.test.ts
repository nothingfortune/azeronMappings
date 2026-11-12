// @vitest-environment happy-dom
/**
 * A long press or double tap repeats while held, switched from the Key panel like the tap,
 * instead of in the profile's YAML.
 */
import { describe, expect, it } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";

const PAYLOAD = buildPayload();

function openKey(position: string): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(PAYLOAD));
  const sets = document.querySelectorAll<HTMLSelectElement>("header select")[0];
  if (!sets) throw new Error("no layout picker");
  sets.value = "single-v5";
  sets.dispatchEvent(new Event("change"));
  document.querySelector<HTMLElement>(`.hand .key[data-position="${position}"]`)?.click();
}

describe("repeating a long press or a double tap", () => {
  it("offers a switch for the long press on a key that has one, and none for the double tap", () => {
    openKey("pinky_5");
    expect(document.querySelector('[data-repeat="long"]')).not.toBeNull();
    expect(document.querySelector('[data-repeat="double"]')).toBeNull();
    expect(document.body.textContent).not.toContain("only editable in the YAML");
  });

  it("switches it on and off", () => {
    openKey("pinky_5");
    const box = (): HTMLInputElement | null =>
      document.querySelector<HTMLInputElement>('[data-repeat="long"]');
    const on = box();
    if (!on) throw new Error("no switch");
    on.checked = true;
    on.dispatchEvent(new Event("change"));
    expect(box()?.hasAttribute("checked")).toBe(true);
    const off = box();
    if (!off) throw new Error("no switch");
    off.checked = false;
    off.dispatchEvent(new Event("change"));
    expect(box()?.hasAttribute("checked")).toBe(false);
  });
});
