/**
 * Stick modes, after the convention RC transmitters use: a mode assigns four action
 * pairs to the four axes a pair of units has, and owns nothing else on the position.
 */

import { describe, expect, it } from "vitest";

import {
  applyMode,
  detectMode,
  directionsFor,
  StickModeError,
} from "../../../src/lib/stickmodes.js";
import type { StickModeSet } from "../../../src/lib/stickmodes.js";
import { loadActionSet } from "../../../src/lib/io.js";
import { loadInherited } from "../../../src/lib/yaml-io.js";

const set = loadInherited("genres/SpaceSims/stick-modes.yaml") as unknown as StickModeSet;

describe("the shipped modes", () => {
  it("names an axis that exists for every side of every mode", () => {
    for (const [id, mode] of Object.entries(set.modes)) {
      for (const hand of ["left", "right"] as const) {
        expect(() => directionsFor(set, mode, hand), `${id} ${hand}`).not.toThrow();
      }
    }
  });

  it("gives each stick four directions", () => {
    const mode = set.modes.mode2;
    if (!mode) throw new Error("mode2 missing");
    // Mode 2 is DJI's: the left stick climbs and turns. Earlier versions put roll here and
    // called it a stand-in for yaw; one banks the ship and the other turns its nose.
    expect(directionsFor(set, mode, "left")).toEqual({
      up: "hover_up",
      down: "hover_down",
      right: "yaw_right",
      left: "yaw_left",
    });
    expect(directionsFor(set, mode, "right")).toEqual({
      up: "throttle_up",
      down: "throttle_down",
      right: "strafe_right",
      left: "strafe_left",
    });
  });

  it("keeps roll available, for flying it against yaw on the same stick", () => {
    const variant = set.modes.mode2_roll;
    if (!variant) throw new Error("mode2_roll missing");
    expect(directionsFor(set, variant, "left").right).toBe("roll_right");
    expect(directionsFor(set, variant, "right")).toEqual(
      directionsFor(set, set.modes.mode2 ?? variant, "right"),
    );
  });

  it("names only actions the vocabulary declares", () => {
    // A mode that sends an action nothing binds compiles to a stick that does nothing.
    const declared = new Set(Object.keys(loadActionSet("genres/SpaceSims/actions.yaml").actions));
    for (const [axis, ends] of Object.entries(set.axes)) {
      expect(declared.has(ends.up), `${axis} up: ${ends.up}`).toBe(true);
      expect(declared.has(ends.down), `${axis} down: ${ends.down}`).toBe(true);
    }
  });

  it("puts thrust on a different stick in mode 1 than in mode 2", () => {
    const [one, two] = [set.modes.mode1, set.modes.mode2];
    if (!one || !two) throw new Error("modes missing");
    expect(directionsFor(set, one, "left").up).toBe("throttle_up");
    expect(directionsFor(set, two, "left").up).toBe("hover_up");
  });

  it("refuses an axis it does not know rather than writing nothing", () => {
    const broken: StickModeSet = {
      axes: set.axes,
      modes: {
        x: {
          label: "x",
          left: { vertical: "nope", horizontal: "roll" },
          right: set.modes.mode1?.right ?? { vertical: "roll", horizontal: "roll" },
        },
      },
    };
    const mode = broken.modes.x;
    if (!mode) throw new Error("mode missing");
    expect(() => directionsFor(broken, mode, "left")).toThrow(StickModeError);
  });
});

describe("applyMode", () => {
  it("replaces the directions and keeps everything else on the position", () => {
    const before = { mode: "keyboard", raw: { types: ["4", "0", "0"] }, label: "Stick" };
    const mode = set.modes.mode3;
    if (!mode) throw new Error("mode3 missing");
    const after = applyMode(before, set, mode, "left");
    expect(after.mode).toBe("keyboard");
    expect(after.raw).toEqual({ types: ["4", "0", "0"] });
    expect(after.label).toBe("Stick");
    expect(after.directions?.up).toBe("throttle_up");
  });

  it("works on a stick that had nothing on it", () => {
    const mode = set.modes.mode1;
    if (!mode) throw new Error("mode1 missing");
    expect(applyMode(undefined, set, mode, "right").directions?.up).toBe("hover_up");
  });
});

describe("detectMode", () => {
  it("recognises a pair that is already in a mode", () => {
    const mode = set.modes.mode3;
    if (!mode) throw new Error("mode3 missing");
    const left = applyMode(undefined, set, mode, "left");
    const right = applyMode(undefined, set, mode, "right");
    expect(detectMode(set, left, right)).toBe("mode3");
  });

  it("says nothing rather than guessing when the pair matches none", () => {
    expect(detectMode(set, { directions: { up: "interact" } }, undefined)).toBeNull();
  });
});
