import { describe, expect, it } from "vitest";

import { buildStyle, parseStyles, StyleError } from "../../../src/lib/styles.js";
import type { StickModeSet } from "../../../src/lib/stickmodes.js";
import type { ActionSpec } from "../../../src/types/profile.js";
import { XBOX_CONTROLS, xboxLabel, xboxLayout } from "../../../src/lib/xbox.js";

describe("an Xbox pad laid over a pair of units", () => {
  it("puts the face buttons under the right thumb and the d-pad under the left", () => {
    expect(XBOX_CONTROLS.A).toEqual({ hand: "right", position: "dpad_down" });
    expect(XBOX_CONTROLS.Y).toEqual({ hand: "right", position: "dpad_up" });
    expect(XBOX_CONTROLS.DpadUp).toEqual({ hand: "left", position: "dpad_up" });
    expect(XBOX_CONTROLS.RT).toEqual({ hand: "right", position: "index_3" });
    expect(XBOX_CONTROLS.LeftStickUp).toEqual({
      hand: "left",
      position: "stick",
      direction: "up",
    });
  });

  it("gives no two controls one place", () => {
    const places = Object.values(XBOX_CONTROLS).map(
      (place) => `${place.hand} ${place.position} ${place.direction ?? ""}`,
    );
    expect(new Set(places).size).toBe(places.length);
  });

  it("names each control the way the editor shows it", () => {
    expect(xboxLabel("A")).toBe("A");
    expect(xboxLabel("DpadUp")).toBe("D-pad up");
    expect(xboxLabel("LeftStickUp")).toBe("Left stick up");
  });

  it("places each action where its control sits, sticks by direction", () => {
    const layout = xboxLayout({
      jump: { label: "Jump", xbox: "A" },
      forward: { xbox: "LeftStickUp" },
      back: { xbox: "LeftStickDown" },
      unplaced: { label: "Map" },
    });
    expect(layout.problems).toEqual([]);
    expect(layout.right.dpad_down).toEqual({ label: "Jump", tap: "jump" });
    expect(layout.left.stick).toEqual({
      mode: "keyboard",
      directions: { up: "forward", down: "back" },
    });
    expect(JSON.stringify(layout)).not.toContain("unplaced");
  });

  it("says when two actions want one control, or a control is not on a pad", () => {
    const layout = xboxLayout({ a: { xbox: "A" }, b: { xbox: "A" }, c: { xbox: "Z" } });
    expect(layout.problems).toEqual(["b and a are both on A", "c: 'Z' is not an Xbox control"]);
  });
});

const MODES: StickModeSet = {
  genre: "Test",
  pedals: { takes: ["yaw"] },
  modes: {
    pad: {
      label: "Pad",
      left: { vertical: "thrust", horizontal: "strafe" },
      right: { vertical: "pitch", horizontal: "yaw" },
      with_pedals: { right: { horizontal: "roll" } },
    },
  },
  axes: {
    thrust: { up: "fwd", down: "back", centred: true },
    strafe: { up: "right", down: "left", centred: true },
    pitch: { up: "nose_up", down: "nose_down", centred: true },
    yaw: { up: "yaw_r", down: "yaw_l", centred: true },
    roll: { up: "roll_r", down: "roll_l", centred: true },
  },
} as unknown as StickModeSet;

const ACTIONS: Record<string, ActionSpec> = {
  ...Object.fromEntries(
    [
      "fwd",
      "back",
      "right",
      "left",
      "nose_up",
      "nose_down",
      "yaw_r",
      "yaw_l",
      "roll_r",
      "roll_l",
    ].map((id): [string, ActionSpec] => [id, {}]),
  ),
  fire: { xbox: "RT" },
  map: {},
};

describe("a style", () => {
  it("is read from layouts.yaml, and a style with no label is a mistake there", () => {
    expect(parseStyles({ pad: { label: "Pad" } }, "f")).toEqual({ pad: { label: "Pad" } });
    expect(() => parseStyles({ pad: {} }, "f")).toThrow(StyleError);
  });

  it("starts a controller from the Xbox controls, and flies its sticks in the mode it names", () => {
    const built = buildStyle(
      "controller",
      { label: "Pad", stick_mode: "pad", left: { index_5: { tap: "map" } } },
      { actions: ACTIONS, defaults: {}, modes: MODES },
    );
    expect(built.right.index_3).toMatchObject({ tap: "fire" });
    expect(built.left.index_5).toEqual({ tap: "map" });
    expect(built.right.stick?.directions).toEqual({
      up: "nose_up",
      down: "nose_down",
      right: "yaw_r",
      left: "yaw_l",
    });
  });

  it("gives the yaw to the pedals and rolls instead, with pedals", () => {
    const built = buildStyle(
      "keyboard",
      { label: "Keys", stick_mode: "pad" },
      { actions: ACTIONS, defaults: {}, modes: MODES, withPedals: true },
    );
    expect(built.right.stick?.directions).toMatchObject({ right: "roll_r", left: "roll_l" });
  });

  it("takes the genre's one-unit default for a hand that says default", () => {
    const built = buildStyle(
      "keyboard",
      { label: "Keys", left: "default" },
      { actions: ACTIONS, defaults: { pinky_1: { tap: "map" } } },
    );
    expect(built.left).toEqual({ pinky_1: { tap: "map" } });
  });

  it("refuses a position taken twice, an action that is not one, and a mode that is not there", () => {
    const inputs = { actions: ACTIONS, defaults: {}, modes: MODES };
    expect(() =>
      buildStyle("controller", { label: "P", right: { index_3: { tap: "map" } } }, inputs),
    ).toThrow(/already has its Xbox control/);
    expect(() =>
      buildStyle("keyboard", { label: "K", left: { index_3: { tap: "nope" } } }, inputs),
    ).toThrow(/'nope' is not an action/);
    expect(() => buildStyle("keyboard", { label: "K", stick_mode: "mode9" }, inputs)).toThrow(
      /no stick mode 'mode9'/,
    );
  });
});
