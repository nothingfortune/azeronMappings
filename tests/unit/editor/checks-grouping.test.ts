// @vitest-environment happy-dom
/**
 * The Checks panel says one thing once. A rule broken on each direction of one stick is one
 * entry that opens to the rest, not four paragraphs that differ in a word; the counts on
 * the header and the Checks tab count entries the same way.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { showDockTab } from "../../helpers/editor.js";

const PAYLOAD = buildPayload();

function mountWithSilentStick(): void {
  const payload = structuredClone(PAYLOAD);
  const game = payload.games[0];
  if (game === undefined) throw new Error("no game");
  // Every action the first stick names loses its key: one rule, four directions, one place.
  const stick = game.profiles[0]?.data.positions.stick;
  for (const value of Object.values(stick?.directions ?? {})) {
    if (typeof value !== "string") continue;
    const action = game.actions.actions?.[value];
    if (action !== undefined) action.key = null;
  }
  document.body.innerHTML = '<div id="app"></div>';
  start(payload);
  showDockTab("checks");
}

describe("findings of one rule on one control", () => {
  beforeEach(() => {
    mountWithSilentStick();
  });

  it("are one entry with the rest folded under it", () => {
    // The same actions are on the right unit's d-pad too: other controls, other entries.
    const entries = [...document.querySelectorAll(".checks > .finding")].filter(
      (entry) =>
        entry.querySelector(".rule")?.textContent.includes("action-sends-nothing") === true &&
        entry.querySelector("b")?.textContent === "Left Stick",
    );
    expect(entries).toHaveLength(1);
    const more = entries[0]?.querySelector(".finding-more");
    expect(more?.querySelector("summary")?.textContent).toMatch(/^3 more like this on /);
    expect(more?.querySelectorAll(".finding")).toHaveLength(3);
  });

  it("are counted once on the Checks tab", () => {
    const tab = [...document.querySelectorAll("button")].find((button) =>
      button.textContent.startsWith("Checks ("),
    );
    const count = Number(/\((\d+)\)/.exec(tab?.textContent ?? "")?.[1]);
    const entries = document.querySelectorAll(".checks > .finding, .checks > details.finding");
    expect(count).toBe(entries.length);
  });
});
