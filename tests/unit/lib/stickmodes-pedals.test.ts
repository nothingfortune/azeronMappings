/**
 * Pedals as a modifier on the stick mode: the axes the pedals carry do not need a stick,
 * so the with-pedals variant hands the freed slot to roll. Without pedals every mode must
 * behave exactly as it did before pedals existed.
 */

import { describe, expect, it } from "vitest";

import {
  applyMode,
  axesOnSticks,
  detectMode,
  detectStickModes,
  directionsFor,
  pedalAxes,
  validateStickModes,
} from "../../../src/lib/stickmodes.js";
import type { StickModeSet } from "../../../src/lib/stickmodes.js";
import { loadInherited } from "../../../src/lib/yaml-io.js";

const set = loadInherited("genres/SpaceSims/stick-modes.yaml") as unknown as StickModeSet;
const mode = (id: string) => {
  const found = set.modes[id];
  if (!found) throw new Error(`${id} missing`);
  return found;
};

/** What every mode did before pedals existed, written out so a change here is deliberate. */
const BEFORE_PEDALS = {
  mode1: {
    left: { up: "throttle_up", down: "throttle_down", right: "yaw_right", left: "yaw_left" },
    right: { up: "hover_up", down: "hover_down", right: "strafe_right", left: "strafe_left" },
  },
  mode2: {
    left: { up: "hover_up", down: "hover_down", right: "yaw_right", left: "yaw_left" },
    right: { up: "throttle_up", down: "throttle_down", right: "strafe_right", left: "strafe_left" },
  },
  mode3: {
    left: { up: "throttle_up", down: "throttle_down", right: "strafe_right", left: "strafe_left" },
    right: { up: "hover_up", down: "hover_down", right: "yaw_right", left: "yaw_left" },
  },
  mode2_roll: {
    left: { up: "hover_up", down: "hover_down", right: "roll_right", left: "roll_left" },
    right: { up: "throttle_up", down: "throttle_down", right: "strafe_right", left: "strafe_left" },
  },
  twin_stick: {
    left: { up: "throttle_up", down: "throttle_down", right: "strafe_right", left: "strafe_left" },
    right: { up: "pitch_up", down: "pitch_down", right: "yaw_right", left: "yaw_left" },
  },
} as const;

describe("the pedal data", () => {
  it("says yaw is what the pedals carry", () => {
    expect(pedalAxes(set)).toEqual(["yaw"]);
  });

  it("is valid: nothing a pedal carries is left on a stick, nothing else is touched", () => {
    expect(validateStickModes(set)).toEqual([]);
  });

  it("gives every mode that sends yaw a with-pedals variant", () => {
    for (const [id, m] of Object.entries(set.modes)) {
      const sendsYaw = [
        m.left.vertical,
        m.left.horizontal,
        m.right.vertical,
        m.right.horizontal,
      ].includes("yaw");
      expect(m.with_pedals !== undefined, id).toBe(sendsYaw);
    }
  });
});

describe("without pedals, every mode behaves as it always did", () => {
  for (const [id, expected] of Object.entries(BEFORE_PEDALS)) {
    it(id, () => {
      expect(directionsFor(set, mode(id), "left")).toEqual(expected.left);
      expect(directionsFor(set, mode(id), "right")).toEqual(expected.right);
      expect(directionsFor(set, mode(id), "left", false)).toEqual(expected.left);
    });
  }

  it("applies and detects the same as before", () => {
    for (const id of Object.keys(BEFORE_PEDALS)) {
      const left = applyMode(undefined, set, mode(id), "left");
      const right = applyMode(undefined, set, mode(id), "right");
      const found = detectMode(set, left, right);
      expect(found).not.toBeNull();
      // The first mode with those directions: mode2_roll is its own, and not mode2's.
      expect(directionsFor(set, mode(found ?? ""), "left")).toEqual(
        directionsFor(set, mode(id), "left"),
      );
    }
  });
});

describe("with pedals, the freed slot goes to roll", () => {
  it("Mode 2: roll on the left stick's horizontal, where yaw was", () => {
    expect(directionsFor(set, mode("mode2"), "left", true)).toEqual({
      up: "hover_up",
      down: "hover_down",
      right: "roll_right",
      left: "roll_left",
    });
    expect(directionsFor(set, mode("mode2"), "right", true)).toEqual(BEFORE_PEDALS.mode2.right);
  });

  it("Mode 1 frees the left stick's horizontal, Mode 3 the right's, twin-stick the right's", () => {
    expect(directionsFor(set, mode("mode1"), "left", true).right).toBe("roll_right");
    expect(directionsFor(set, mode("mode1"), "right", true)).toEqual(BEFORE_PEDALS.mode1.right);
    expect(directionsFor(set, mode("mode3"), "right", true).right).toBe("roll_right");
    expect(directionsFor(set, mode("mode3"), "left", true)).toEqual(BEFORE_PEDALS.mode3.left);
    expect(directionsFor(set, mode("twin_stick"), "right", true)).toEqual({
      up: "pitch_up",
      down: "pitch_down",
      right: "roll_right",
      left: "roll_left",
    });
  });

  it("leaves a mode with no yaw alone", () => {
    expect(directionsFor(set, mode("mode2_roll"), "left", true)).toEqual(
      BEFORE_PEDALS.mode2_roll.left,
    );
  });

  it("sends no axis the pedals carry, in any mode", () => {
    for (const id of Object.keys(set.modes)) {
      const left = applyMode(undefined, set, mode(id), "left", true);
      const right = applyMode(undefined, set, mode(id), "right", true);
      const on = axesOnSticks(set, [left, right]);
      for (const axis of pedalAxes(set)) expect(on.has(axis), `${id} ${axis}`).toBe(false);
    }
  });

  it("changes only the directions on the stick", () => {
    const before = { mode: "keyboard", raw: { types: ["4", "0", "0"] }, label: "Stick" };
    const after = applyMode(before, set, mode("mode2"), "left", true);
    expect(after.mode).toBe("keyboard");
    expect(after.raw).toEqual({ types: ["4", "0", "0"] });
    expect(after.label).toBe("Stick");
  });
});

describe("detecting Mode 2 from Mode 2 with pedals", () => {
  const left = (withPedals: boolean) =>
    applyMode(undefined, set, mode("mode2"), "left", withPedals);
  const right = (withPedals: boolean) =>
    applyMode(undefined, set, mode("mode2"), "right", withPedals);

  it("tells them apart when it is told whether the layout has pedals", () => {
    expect(detectMode(set, left(false), right(false), false)).toBe("mode2");
    expect(detectMode(set, left(true), right(true), true)).toBe("mode2");
    // The same sticks read in the other world are not Mode 2: with pedals the left stick
    // has no yaw, and without them it should.
    expect(detectMode(set, left(true), right(true), false)).not.toBe("mode2");
    expect(detectMode(set, left(false), right(false), true)).toBeNull();
  });

  it("lists every reading of the sticks, plain and with pedals", () => {
    expect(detectStickModes(set, left(false), right(false))).toEqual([
      { mode: "mode2", pedals: false },
    ]);
    // Mode 2 with pedals is also, on the sticks alone, Mode 2 roll for yaw.
    expect(detectStickModes(set, left(true), right(true))).toEqual([
      { mode: "mode2", pedals: true },
      { mode: "mode2_roll", pedals: false },
    ]);
  });

  it("without the flag, detectMode is the answer it always gave", () => {
    for (const id of Object.keys(BEFORE_PEDALS)) {
      const l = applyMode(undefined, set, mode(id), "left");
      const r = applyMode(undefined, set, mode(id), "right");
      expect(detectMode(set, l, r), id).toBe(id);
    }
    expect(detectMode(set, { directions: { up: "interact" } }, undefined)).toBeNull();
  });

  it("applyMode, directionsFor and detectMode agree in both worlds", () => {
    for (const withPedals of [false, true]) {
      for (const id of Object.keys(set.modes)) {
        const l = applyMode(undefined, set, mode(id), "left", withPedals);
        const r = applyMode(undefined, set, mode(id), "right", withPedals);
        const found = detectMode(set, l, r, withPedals);
        const winner = mode(found ?? "");
        expect(
          directionsFor(set, winner, "left", withPedals),
          `${id} ${String(withPedals)}`,
        ).toEqual(l.directions);
        expect(directionsFor(set, winner, "right", withPedals)).toEqual(r.directions);
      }
    }
  });
});

describe("validateStickModes", () => {
  const clone = (): StickModeSet => JSON.parse(JSON.stringify(set)) as StickModeSet;

  it("catches a with-pedals slot that still sends what the pedals carry", () => {
    const broken = clone();
    const m = broken.modes.mode2;
    if (!m?.with_pedals) throw new Error("fixture");
    m.with_pedals = { left: { horizontal: "yaw" } };
    expect(validateStickModes(broken).join("\n")).toMatch(/mode2.*still sends 'yaw'/);
  });

  it("catches a slot replaced that the pedals do not take", () => {
    const broken = clone();
    const m = broken.modes.mode2;
    if (!m) throw new Error("fixture");
    m.with_pedals = { left: { horizontal: "roll", vertical: "pitch" } };
    expect(validateStickModes(broken).join("\n")).toMatch(/replaces left vertical.*not an axis/);
  });

  it("catches a mode that sends yaw and offers no variant", () => {
    const broken = clone();
    const m = broken.modes.mode1;
    if (!m) throw new Error("fixture");
    delete m.with_pedals;
    expect(validateStickModes(broken).join("\n")).toMatch(/mode1 sends 'yaw'.*no with_pedals/);
  });

  it("catches an axis on two sticks", () => {
    const broken = clone();
    const m = broken.modes.mode2;
    if (!m) throw new Error("fixture");
    m.with_pedals = { left: { horizontal: "thrust" } };
    expect(validateStickModes(broken).join("\n")).toMatch(/'thrust' is on both/);
  });

  it("catches pedals that take an axis nobody defined", () => {
    const broken = clone();
    broken.pedals = { takes: ["warp"] };
    expect(validateStickModes(broken).join("\n")).toMatch(/pedals.takes names 'warp'/);
  });
});
