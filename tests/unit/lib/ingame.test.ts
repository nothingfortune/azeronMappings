/**
 * Reading the game's own binding file. The file belongs to the game, so parsing is
 * lossless and only Key1 on a keyboard row is ever rewritten.
 */

import { describe, expect, it } from "vitest";

import {
  compareToGame,
  gameCollisions,
  parseInput,
  setKey,
  ueKeyFor,
} from "../../../src/lib/ingame.js";
import { ActionSet } from "../../../src/lib/model-core.js";

const LINE = (
  action: string,
  key: string,
  group = "Keyboard",
  scale = "1.000000",
  display = "Thing",
) =>
  `KeybindingsConfig=(Action=${action},ActionName="${action}",AxisName="",Category=0,bIsAxis=False,` +
  `Key1=${key},Key1Mod=None,Key2=None,Key2Mod=None,Scale=${scale},DeadZone=0.100000,` +
  `Sensitivity=1.000000,Exponent=1.000000,bInvert=False,` +
  `DisplayName=NSLOCTEXT("KEY_BINDINGS", "K", "${display}"),GroupName="${group}")`;

const FILE = [
  ";METADATA=(Diff=true, UseCommands=true)",
  "[/Script/ES2.CustomPlayerInput]",
  LINE("Boost", "LeftShift", "Keyboard", "1.000000", "Boost [HOLD]"),
  LINE("Boost", "None", "Joystick", "1.000000", "Boost [HOLD]"),
  LINE("Pitch", "Up", "Keyboard", "1.000000", "Pitch up"),
  LINE("MenuSideCompare", "LeftShift", "Keyboard", "1.000000", "Toggle side by side compare"),
].join("\n");

describe("parseInput", () => {
  it("reads one entry per binding row and ignores the rest", () => {
    const file = parseInput(FILE);
    expect(file.entries.length).toBe(4);
    expect(file.lines.length).toBe(6);
    const boost = file.entries[0];
    expect(boost?.action).toBe("Boost");
    expect(boost?.key).toBe("LeftShift");
    expect(boost?.group).toBe("Keyboard");
    expect(boost?.displayName).toBe("Boost [HOLD]");
  });
});

describe("ueKeyFor", () => {
  it("translates our key names into Unreal's", () => {
    expect(ueKeyFor({ key: "KeyF" })).toBe("F");
    expect(ueKeyFor({ key: "Digit5" })).toBe("Five");
    expect(ueKeyFor({ key: "ArrowUp" })).toBe("Up");
    expect(ueKeyFor({ key: "F9" })).toBe("F9");
    expect(ueKeyFor({ meta: "ShiftLeft" })).toBe("LeftShift");
    expect(ueKeyFor({ mouse: "middle" })).toBe("MiddleMouseButton");
  });

  it("returns null rather than guessing at a key it does not know", () => {
    expect(ueKeyFor({ key: "Fn" })).toBeNull();
    expect(ueKeyFor({})).toBeNull();
  });
});

describe("compareToGame", () => {
  const actions = new ActionSet({
    actions: {
      boost: { label: "Boost", meta: "ShiftLeft" },
      cycle_up: { label: "Cycle weapon (up)", key: "ArrowUp" },
      nothing: { label: "Unbound", key: "F3" },
      sensor: { label: "Pitch", provided_by: "sensor" },
    },
  });

  it("matches on the key, which is the only thing the two sides share", () => {
    const rows = compareToGame(actions, parseInput(FILE));
    const boost = rows.find((row) => row.action === "boost");
    expect(boost?.status).toBe("agrees");
    expect(boost?.theirs.map((entry) => entry.display).sort()).toEqual([
      "Boost [HOLD]",
      "Toggle side by side compare",
    ]);
  });

  it("reports what the game actually does with a key, not what we called it", () => {
    const rows = compareToGame(actions, parseInput(FILE));
    const cycle = rows.find((row) => row.action === "cycle_up");
    expect(cycle?.theirs[0]?.display).toBe("Pitch up");
  });

  it("separates keys the game has nothing on from actions no key sends", () => {
    const rows = compareToGame(actions, parseInput(FILE));
    expect(rows.find((row) => row.action === "nothing")?.status).toBe("unmatched");
    expect(rows.find((row) => row.action === "sensor")?.status).toBe("unsendable");
  });
});

describe("gameCollisions", () => {
  it("reports a key the game binds to more than one action", () => {
    expect(gameCollisions(parseInput(FILE))).toEqual([
      { key: "LeftShift", actions: ["Boost [HOLD]", "Toggle side by side compare"] },
    ]);
  });
});

describe("setKey", () => {
  it("rewrites only Key1 and leaves the rest of the line alone", () => {
    const before = LINE("Boost", "LeftShift");
    const after = setKey(before, "RightShift");
    expect(after).toContain("Key1=RightShift,");
    expect(after.replace("Key1=RightShift", "Key1=LeftShift")).toBe(before);
  });
});
