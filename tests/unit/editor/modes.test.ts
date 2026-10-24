/**
 * A layout for one mode of play shows that mode's actions, and the ones live in every
 * mode, and gives an action a key that is free among the actions live with it.
 *
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import type { EditorPayload } from "../../../src/types/editor.js";
import { LIVE_SET } from "../../helpers/fixtures.js";

/** The live layout, made to play one mode, with three actions put in modes. */
function withModes(): EditorPayload {
  const payload = buildPayload();
  const game = payload.games.find((entry) => entry.slug === "everspace");
  if (!game) throw new Error("no game");
  game.sets.sets[LIVE_SET] = { ...game.sets.sets[LIVE_SET], modes: ["ship", "ui"] };
  const actions = game.actions.actions ?? {};
  const put = (id: string, mode: string): void => {
    const spec = actions[id];
    if (!spec) throw new Error(id);
    spec.mode = mode;
  };
  put("headlight", "foot");
  put("toggle_hud", "ui");
  put("free_look", "ship");
  return payload;
}

function mount(payload: EditorPayload): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(payload);
  const select = document.querySelectorAll<HTMLSelectElement>("header select")[1];
  if (select && select.value !== LIVE_SET) {
    select.value = LIVE_SET;
    select.dispatchEvent(new Event("change"));
  }
}

const listed = (): string[] =>
  [...document.querySelectorAll(".action b")].map((node) => node.textContent);

describe("a layout that plays one mode", () => {
  it("lists that mode's actions, the ones for every mode, and none of another mode's", () => {
    mount(withModes());
    expect(listed()).toContain("Free look (toggle)");
    expect(listed()).toContain("Toggle HUD");
    expect(listed()).not.toContain("Headlight");
    // An action with no mode is live in every layout.
    expect(listed()).toContain("Boost");
  });

  it("lists every action when the layout says nothing about modes", () => {
    mount(buildPayload());
    expect(listed()).toContain("Headlight");
  });
});
