/**
 * Starting a game from an export. The vocabulary is seeded from the keys the export
 * sends, because an export says which keys are pressed but not what they do in game.
 */

import { describe, expect, it } from "vitest";

import { loadDevice, loadTemplate } from "../../../src/lib/io.js";
import {
  actionIdForKey,
  gameConfig,
  seedActions,
  unnamedPositions,
} from "../../../src/lib/scaffold.js";
import { decompile } from "../../../src/lib/decompile.js";
import { ActionSet } from "../../../src/lib/model-core.js";

const template = () => loadTemplate("templates/everspace2-v5.json");

describe("actionIdForKey", () => {
  it("turns a key name into a readable id", () => {
    expect(actionIdForKey("KeyF")).toBe("key_f");
    expect(actionIdForKey("Digit5")).toBe("digit_5");
    expect(actionIdForKey("ArrowLeft")).toBe("arrow_left");
    expect(actionIdForKey("ShiftLeft")).toBe("shift_left");
  });
});

describe("seedActions", () => {
  it("creates one action per distinct key the export sends", () => {
    const actions = seedActions(template());
    expect(actions.key_f?.key).toBe("KeyF");
    expect(actions.digit_5?.key).toBe("Digit5");
    // Stick directions count: the v5 stick sends W A S D.
    expect(actions.key_w?.key).toBe("KeyW");
  });

  it("marks every seeded action as needing a real name", () => {
    for (const spec of Object.values(seedActions(template()))) {
      expect(spec.label).toContain("(unnamed)");
      expect(spec.note).toContain("Rename");
    }
  });

  it("names nothing it cannot read off the export", () => {
    const actions = seedActions(template());
    // Mouse buttons are not keyboard keys, so no action is invented for them.
    expect(Object.values(actions).some((spec) => spec.mouse)).toBe(false);
  });

  it("lets the whole export decompile to named actions", () => {
    const exported = template();
    const device = loadDevice("cyborg2-left");
    const actions = new ActionSet({ actions: seedActions(exported) });
    const profile = decompile(exported, device, { actions });
    // Only the mouse button and the two unexplained pins stay raw.
    expect(unnamedPositions(profile, device.data)).toEqual(["index_2", "index_3", "stick_press"]);
  });
});

describe("gameConfig", () => {
  it("records an external export location only when one is given", () => {
    const base = { name: "X", slug: "x", genre: "FPS", template: "t.json" };
    expect(gameConfig(base).export_to).toBeUndefined();
    expect(gameConfig({ ...base, exportTo: "/games/x" }).export_to).toBe("/games/x");
  });

  it("starts a new game with the stick rule on", () => {
    expect(gameConfig({ name: "X", slug: "x", genre: "FPS", template: "t" }).lint).toEqual({
      require_keyboard_stick: true,
    });
  });
});
