/**
 * The keyboard-and-mouse and controller bindings: how they are written, read, named and
 * checked, and that the compiled layouts never see them.
 */
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { patchActionBindings } from "../../../src/lib/actionfile.js";
import {
  canonicalKbm,
  isPadControl,
  kbmLabel,
  padControlFrom,
  padLabel,
  parseKbm,
} from "../../../src/lib/controls.js";
import { checkActions } from "../../../src/lib/lint.js";
import { ActionSet } from "../../../src/lib/model-core.js";

describe("a keyboard-and-mouse binding", () => {
  it("is a key, a modifier alone, a mouse token, or modifiers then one of those", () => {
    expect(parseKbm("KeyR")).toEqual({ modifiers: [], input: "KeyR" });
    expect(parseKbm("ShiftLeft")).toEqual({ modifiers: [], input: "ShiftLeft" });
    expect(parseKbm("ControlLeft+KeyR")).toEqual({ modifiers: ["ControlLeft"], input: "KeyR" });
    expect(parseKbm("ShiftLeft+WheelUp")).toEqual({ modifiers: ["ShiftLeft"], input: "WheelUp" });
  });

  it("is refused when a modifier is not one, or repeats, or the token is not a key", () => {
    expect(parseKbm("KeyA+KeyB")).toBeNull();
    expect(parseKbm("ShiftLeft+ShiftLeft")).toBeNull();
    expect(parseKbm("shift+r")).toBeNull();
    expect(parseKbm("")).toBeNull();
  });

  it("reads in words", () => {
    expect(kbmLabel("MouseRight")).toBe("Right click");
    expect(kbmLabel("ShiftLeft+WheelUp")).toMatch(/Shift.*\+ Wheel up/);
  });
});

describe("a controller binding", () => {
  it("is one of the pad's controls", () => {
    expect(isPadControl("A")).toBe(true);
    expect(isPadControl("LeftStickUp")).toBe(true);
    expect(isPadControl("Z")).toBe(false);
    expect(padLabel("DpadUp")).toBe("D-pad up");
  });

  it("is read from the browser's standard pad: a button, or the stick pushed furthest", () => {
    const up = { pressed: false };
    const buttons = Array.from({ length: 16 }, () => up);
    expect(padControlFrom(buttons, [0, 0, 0, 0])).toBeNull();
    const a = buttons.map((entry, index) => (index === 0 ? { pressed: true } : entry));
    expect(padControlFrom(a, [0, 0, 0, 0])).toBe("A");
    const rt = buttons.map((entry, index) => (index === 7 ? { pressed: true } : entry));
    expect(padControlFrom(rt, [0, 0, 0, 0])).toBe("RT");
    // Up is negative on the Gamepad API.
    expect(padControlFrom(buttons, [0, -0.9, 0, 0])).toBe("LeftStickUp");
    expect(padControlFrom(buttons, [0.7, 0, 0, 0.95])).toBe("RightStickDown");
    // Drift is not a push.
    expect(padControlFrom(buttons, [0.3, -0.2, 0.1, 0])).toBeNull();
  });
});

describe("writing them into actions.yaml", () => {
  const FILE = "actions:\n  reload: {key: KeyR, ingame: Reload}\n";

  it("sets and clears each, on the action's own line", () => {
    const out = patchActionBindings(FILE, { reload: { kbm: "ControlLeft+KeyR", pad: "X" } });
    expect((parse(out) as { actions: Record<string, unknown> }).actions.reload).toEqual({
      key: "KeyR",
      ingame: "Reload",
      kbm: "ControlLeft+KeyR",
      pad: "X",
    });
    const cleared = patchActionBindings(out, { reload: { kbm: null, pad: null } });
    expect(cleared).toBe(FILE);
  });

  it("refuses one that is not a binding", () => {
    expect(() => patchActionBindings(FILE, { reload: { kbm: "Ctrl+R" } })).toThrow(/chord/);
    expect(() => patchActionBindings(FILE, { reload: { pad: "Z" } })).toThrow(/controller/);
  });
});

describe("checking them", () => {
  const check = (
    actions: Record<string, Record<string, unknown>>,
    live: (a: string | undefined, b: string | undefined) => boolean = () => true,
  ): string[] => checkActions(new ActionSet({ actions }), live).map((finding) => finding.rule);

  it("says when two actions share a keyboard key or a controller control", () => {
    expect(
      check({
        reload: { kbm: "KeyR", pad: "X" },
        revive: { kbm: "KeyR", pad: "X" },
        jump: { kbm: "Space", pad: "A" },
      }),
    ).toEqual(["kbm-collision", "pad-collision"]);
  });

  it("lets actions of modes never played together share one", () => {
    expect(
      check(
        {
          fly: { kbm: "KeyR", mode: "ship" },
          walk: { kbm: "KeyR", mode: "foot" },
        },
        (a, b) => a === b,
      ),
    ).toEqual([]);
  });

  it("sees the same chord with its modifiers written in another order", () => {
    expect(
      check({
        reload: { kbm: "ControlLeft+ShiftLeft+KeyR" },
        revive: { kbm: "ShiftLeft+ControlLeft+KeyR" },
      }),
    ).toEqual(["kbm-collision"]);
    expect(canonicalKbm("ShiftLeft+ControlLeft+KeyR")).toBe("ControlLeft+ShiftLeft+KeyR");
  });

  it("says when one is not a binding at all", () => {
    expect(check({ reload: { kbm: "Ctrl+R" } })).toEqual(["kbm-unknown"]);
  });

  it("is not a keypad key clash: the Azeron key and the keyboard key are apart", () => {
    expect(check({ reload: { key: "Insert", kbm: "KeyR" }, other: { key: "KeyR" } })).toEqual([]);
  });
});
