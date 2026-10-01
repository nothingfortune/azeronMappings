// @vitest-environment happy-dom
/** The light/dark switch: it must switch, whatever the OS says, and be remembered. */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";

const PAYLOAD = buildPayload();

function mount(): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(PAYLOAD));
}

function osPrefers(scheme: "light" | "dark"): void {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes("dark") && scheme === "dark",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
}

function themeItem(): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>(".menu-item")].find((button) =>
    button.textContent.endsWith(" theme"),
  );
  if (!found) throw new Error("no theme item in the menu");
  return found;
}

describe("the theme", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("switches on the first click even when the OS is already dark", () => {
    // With no data-theme the page follows the OS, and the old toggle answered "dark" to a
    // page that was already dark: the first click did nothing.
    osPrefers("dark");
    mount();
    expect(themeItem().textContent).toBe("Use the light theme");
    themeItem().click();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(themeItem().textContent).toBe("Use the dark theme");
    themeItem().click();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("switches both ways on a light OS too", () => {
    osPrefers("light");
    mount();
    themeItem().click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    themeItem().click();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("remembers the choice across a reload", () => {
    osPrefers("dark");
    mount();
    themeItem().click();
    expect(localStorage.getItem("azeron-editor-theme")).toBe("light");

    delete document.documentElement.dataset.theme;
    mount();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("still works when storage throws", () => {
    osPrefers("light");
    mount();
    const stored = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => {
      themeItem().click();
    }).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
    stored.mockRestore();
  });
});
