// @vitest-environment happy-dom
/**
 * A layout with one unit offers to add the other, in place of telling the owner to write
 * a profile file by hand.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";

const PAYLOAD = buildPayload();
const SERVED = window as unknown as { AZERON_SERVED?: boolean };

/** The test data has one game; a second, its copy, is enough to switch to. */
const TWO_GAMES = ((): typeof PAYLOAD => {
  const payload = structuredClone(PAYLOAD);
  const first = payload.games[0];
  if (first) {
    // Without single-v5, so a layout name carried over from the first game names nothing.
    const copy = { ...structuredClone(first), slug: "other", name: "Other game" };
    copy.profiles = copy.profiles.filter((profile) => profile.data.profile.set !== "single-v5");
    payload.games.push(copy);
  }
  return payload;
})();

function openSingle(payload = PAYLOAD): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(payload));
  const sets = document.querySelectorAll<HTMLSelectElement>("header select")[1];
  if (!sets) throw new Error("no layout picker");
  sets.value = "single-v5";
  sets.dispatchEvent(new Event("change"));
}

const addButton = (): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>(".missing-unit button")].find(
    (button) => button.textContent === "Add the right unit",
  );

afterEach(() => {
  SERVED.AZERON_SERVED = false;
  vi.unstubAllGlobals();
});

describe("a layout with one unit", () => {
  it("offers to add the other unit, with no file to write", () => {
    SERVED.AZERON_SERVED = true;
    openSingle();
    expect(addButton()).toBeDefined();
    expect(document.body.textContent).not.toContain("unit: right");
  });

  it("asks the server for the unit, and opens the layout again with it", async () => {
    SERVED.AZERON_SERVED = true;
    const calls: { path: string; body: unknown }[] = [];
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
          json: () => Promise.resolve({ ok: true, set: "single-v5" }),
        });
      }),
    );
    openSingle();
    addButton()?.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Added the right unit");
    });
    expect(calls.find((call) => call.path === "/api/layout/unit")?.body).toEqual({
      game: "everspace",
      set: "single-v5",
      device: "cyborg2-right",
    });
  });

  it("keeps another game chosen while the unit was being added on its own layout", async () => {
    SERVED.AZERON_SERVED = true;
    let answer: (value: unknown) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) => {
        if (path === "/api/payload") {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(TWO_GAMES) });
        }
        return new Promise((resolve) => {
          answer = resolve;
        });
      }),
    );
    openSingle(TWO_GAMES);
    addButton()?.click();
    // Another game, chosen before the server answers.
    const games = document.querySelectorAll<HTMLSelectElement>("header select")[0];
    if (!games) throw new Error("no game picker");
    const other = [...games.options].find((option) => option.value !== games.value);
    if (!other) throw new Error("no other game in the picker");
    games.value = other.value;
    games.dispatchEvent(new Event("change"));
    answer({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Added the right unit");
    });
    const picker = document.querySelectorAll<HTMLSelectElement>("header select")[0];
    expect(picker?.value).toBe(other.value);
    // On a layout the game has, so the board is drawn.
    const layout = document.querySelectorAll<HTMLSelectElement>("header select")[1];
    expect(layout?.value).toBe("akimbo-v10");
    expect(document.querySelectorAll(".hand").length).toBeGreaterThan(0);
  });

  it("says how, where the page cannot save", () => {
    SERVED.AZERON_SERVED = false;
    openSingle();
    expect(addButton()).toBeUndefined();
    expect(document.querySelector(".missing-unit")?.textContent).toContain("npm start");
  });
});
