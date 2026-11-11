// @vitest-environment happy-dom
/**
 * Renaming and deleting a layout, and deleting a game, from the Setup tab: no file to
 * touch, and a question before anything is deleted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { LIVE_SET } from "../../helpers/fixtures.js";

const PAYLOAD = buildPayload();
const SERVED = window as unknown as { AZERON_SERVED?: boolean };

let calls: { path: string; body: unknown }[] = [];

function serve(): void {
  SERVED.AZERON_SERVED = true;
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: { body?: string }) => {
      if (path === "/api/payload") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(PAYLOAD) });
      }
      calls.push({ path, body: init?.body === undefined ? null : JSON.parse(init.body) });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      });
    }),
  );
}

function openSetup(): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(PAYLOAD));
  const tab = [...document.querySelectorAll<HTMLButtonElement>("header .tabs button")].find(
    (button) => button.textContent === "Setup",
  );
  tab?.click();
}

const control = (name: string): HTMLInputElement => {
  const found = document.querySelector<HTMLInputElement>(`[data-manage="${name}"]`);
  if (!found) throw new Error(`no ${name}`);
  return found;
};

beforeEach(() => {
  serve();
  openSetup();
});

afterEach(() => {
  SERVED.AZERON_SERVED = false;
  vi.unstubAllGlobals();
});

describe("managing the open layout and game", () => {
  it("renames the layout from a name box and a button", async () => {
    const name = control("name");
    name.value = "main";
    name.dispatchEvent(new Event("input"));
    control("rename").click();
    await vi.waitFor(() => {
      expect(calls.some((call) => call.path === "/api/layout/rename")).toBe(true);
    });
    expect(calls.find((call) => call.path === "/api/layout/rename")?.body).toEqual({
      game: "everspace",
      set: LIVE_SET,
      to: "main",
    });
  });

  it("asks before deleting a layout, and sends nothing when told no", async () => {
    const confirm = vi.fn((_message?: string) => false);
    vi.stubGlobal("confirm", confirm);
    control("delete-layout").click();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
    confirm.mockReturnValue(true);
    control("delete-layout").click();
    await vi.waitFor(() => {
      expect(calls.map((call) => call.path)).toContain("/api/layout/delete");
    });
  });

  it("asks before deleting the game", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    control("delete-game").click();
    await vi.waitFor(() => {
      expect(calls.find((call) => call.path === "/api/game/delete")?.body).toEqual({
        game: "everspace",
      });
    });
  });

  it("is not offered where the page cannot save", () => {
    SERVED.AZERON_SERVED = false;
    openSetup();
    expect(document.querySelector('[data-manage="rename"]')).toBeNull();
  });
});
