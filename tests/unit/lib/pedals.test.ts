/**
 * Pedals as data: the device, the layout's assignments, the plan that comes out of them,
 * and capturing the names the game gives them. The rule that runs through all of it is
 * that a game's name for a pedal is read from a real file or reasoned from evidence and
 * marked so -- never invented -- and that how far a name is trusted travels with it.
 */

import { readFileSync } from "node:fs";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import { applyPedalRows, parseInput } from "../../../src/lib/ingame.js";
import { loadPedalsDevice } from "../../../src/lib/io.js";
import { Game } from "../../../src/lib/model.js";
import {
  capturePedals,
  gameRowFor,
  ingamePlan,
  parsePedalsDevice,
  parseSets,
  PedalsError,
  planAxes,
  recordCandidateNames,
  recordPedalNames,
} from "../../../src/lib/pedals.js";
import type { PlannedAxis } from "../../../src/lib/pedals.js";
import type { SetPedals } from "../../../src/types/pedals.js";
import {
  AXIS0,
  AXIS1,
  AXIS2,
  bindJoystick,
  LEFT_TOE,
  RIGHT_TOE,
  RUDDER,
  withFlightStick,
  withMisboundYaw,
  withRudderBound,
} from "../../helpers/pedals.js";

const game = new Game("games/SpaceSims/everspace");
const modes = game.stickModes;
if (!modes) throw new Error("everspace's genre has no stick modes");
const loaded = loadPedalsDevice("logitech-pro-flight-pedals");
if (!loaded) throw new Error("the pedals device file is missing");
const LIVE_TEXT = loaded.text;
const LIVE = loaded.data;

/** The live device with no names recorded: every axis waiting, as before anything was known. */
const FRESH_TEXT = LIVE_TEXT.split("\n")
  .filter((line) => !/^ {6}everspace: \{name:/.test(line))
  .map((line) => (/^ {4}names:\s*$/.test(line) ? "    names: {}" : line))
  .join("\n");
const FRESH = parsePedalsDevice(parse(FRESH_TEXT), "fresh pedals file");

const liveLayout = game.sets.sets["akimbo-v10"]?.pedals;
if (!liveLayout) throw new Error("akimbo-v10 has no pedals in sets.yaml");
const LIVE_AXES = planAxes(liveLayout, LIVE, modes, game.actions.actions, game.slug);

/**
 * A layout for testing the mechanisms, which the live one deliberately is not: the rudder
 * on yaw and the right toe on thrust. The toe is the very thing the live layout keeps off.
 */
const layout: SetPedals = {
  device: "logitech-pro-flight-pedals",
  assign: { rudder: { drives: "yaw" }, right_toe: { drives: "thrust" } },
};
const AXES = planAxes(layout, FRESH, modes, game.actions.actions, game.slug);
const NAMED = planAxes(layout, LIVE, modes, game.actions.actions, game.slug);

function axisOf(id: string): PlannedAxis {
  const found = AXES.find((axis) => axis.pedalAxis === id);
  if (!found) throw new Error(`the layout has no ${id}`);
  return found;
}

describe("the pedals device", () => {
  it("describes three axes, the rudder centred and the toe brakes at an end", () => {
    expect(Object.keys(LIVE.axes)).toEqual(["rudder", "left_toe", "right_toe"]);
    expect(LIVE.axes.rudder?.rest).toBe("centre");
    expect(LIVE.axes.left_toe?.rest).toBe("end");
    expect(LIVE.axes.right_toe?.rest).toBe("end");
  });

  it("records where a toe rests, as measured: -1.0, the minimum", () => {
    expect(LIVE.axes.left_toe?.rest_end).toBe("min");
    expect(LIVE.axes.right_toe?.rest_end).toBe("min");
  });

  it("has no pins, and is not read as a keypad", () => {
    expect(LIVE.kind).toBe("pedals");
    expect("positions" in LIVE).toBe(false);
  });

  it("knows what the hardware reports itself as", () => {
    expect(LIVE.reports_as).toBe("Saitek Pro Flight Rudder Pedals");
    expect(LIVE.usb).toEqual({ vendor_id: "0x06a3", product_id: "0x0763" });
  });

  it("lists the three inputs the game registers for it, which its own log confirms", () => {
    expect(LIVE.inputs?.everspace).toEqual([AXIS0, AXIS1, AXIS2]);
  });

  it("marks nothing confirmed that nobody has flown", () => {
    const status = Object.fromEntries(
      Object.entries(LIVE.axes).map(([id, axis]) => [id, axis.names?.everspace?.status]),
    );
    expect(status).toEqual({
      rudder: "inferred",
      left_toe: "inferred",
      right_toe: "inferred",
    });
    expect(LIVE.axes.rudder?.names?.everspace?.name).toBe(AXIS2);
    // Axis1 is a toe: the earlier belief that it was the rudder was a mis-capture.
    expect(LIVE.axes.rudder?.names?.everspace?.name).not.toBe(AXIS1);
  });

  it("records a calibration only for an axis that rests at an end", () => {
    // The owner's toes, as calibrated and recorded.
    expect(LIVE.axes.left_toe?.calibrated_rest).toBe("centre");
    expect(LIVE.axes.right_toe?.calibrated_rest).toBe("centre");
    expect(LIVE.axes.rudder?.calibrated_rest).toBeUndefined();
    const file = (axis: Record<string, unknown>) => ({
      device: "p",
      kind: "pedals",
      axes: { a: axis },
    });
    const toe = parsePedalsDevice(file({ rest: "end", calibrated_rest: "centre" }), "p.yaml");
    expect(toe.axes.a?.calibrated_rest).toBe("centre");
    expect(() =>
      parsePedalsDevice(file({ rest: "end", calibrated_rest: "max" }), "p.yaml"),
    ).toThrow(/calibrated_rest/);
    expect(() =>
      parsePedalsDevice(file({ rest: "centre", calibrated_rest: "centre" }), "p.yaml"),
    ).toThrow(/rests at an end/);
  });

  it("refuses a malformed file rather than repairing it", () => {
    const entry = { name: "JS0_P_Axis0", status: "inferred" };
    const base = { device: "p", kind: "pedals", axes: { a: { rest: "centre" } } };
    expect(parsePedalsDevice(base, "p.yaml").axes.a?.rest).toBe("centre");
    expect(() => parsePedalsDevice({ ...base, kind: "keypad" }, "p.yaml")).toThrow(PedalsError);
    expect(() => parsePedalsDevice({ ...base, axes: {} }, "p.yaml")).toThrow(/at least one axis/);
    expect(() => parsePedalsDevice({ ...base, axes: { a: { rest: "left" } } }, "p.yaml")).toThrow(
      /axes.a.rest/,
    );
    const named = (value: unknown) => ({
      ...base,
      axes: { a: { rest: "end", names: { g: value } } },
    });
    expect(parsePedalsDevice(named(entry), "p.yaml").axes.a?.names?.g?.status).toBe("inferred");
    expect(() => parsePedalsDevice(named({ ...entry, name: "a,b" }), "p.yaml")).toThrow(
      /names.g.name/,
    );
    expect(() => parsePedalsDevice(named({ ...entry, status: "certain" }), "p.yaml")).toThrow(
      /names.g.status/,
    );
    expect(() => parsePedalsDevice(named("JS0_P_Axis0"), "p.yaml")).toThrow(/expected \{name/);
    expect(() =>
      parsePedalsDevice(
        {
          ...base,
          axes: {
            a: { rest: "end", names: { g: entry } },
            b: { rest: "end", names: { g: entry } },
          },
        },
        "p.yaml",
      ),
    ).toThrow(/also the name of a/);
  });

  it("refuses a name the game does not register for the device", () => {
    const base = {
      device: "p",
      kind: "pedals",
      inputs: { g: ["JS0_P_Axis0"] },
      axes: { a: { rest: "end", names: { g: { name: "JS0_P_Axis9", status: "candidate" } } } },
    };
    expect(() => parsePedalsDevice(base, "p.yaml")).toThrow(/not one of the inputs g registers/);
  });
});

describe("a layout's pedals", () => {
  it("live in the game's sets.yaml, under the set name the profiles carry", () => {
    const sets = new Set(game.loadedProfiles().map((profile) => profile.set));
    for (const name of Object.keys(game.sets.sets)) expect(sets.has(name), name).toBe(true);
  });

  it("resolve to the game's own rows through the action vocabulary", () => {
    expect(gameRowFor("yaw", modes, game.actions.actions)).toBe("Yaw");
    expect(gameRowFor("thrust", modes, game.actions.actions)).toBe("MoveForward");
    expect(gameRowFor("vertical", modes, game.actions.actions)).toBe("MoveUp");
    expect(gameRowFor("strafe", modes, game.actions.actions)).toBe("MoveRight");
    expect(gameRowFor("nonsense", modes, game.actions.actions)).toBeNull();
  });

  it("put the rudder on yaw and the right toe on thrust, and leave the left toe alone", () => {
    expect(Object.keys(liveLayout.assign)).toEqual(["rudder", "right_toe"]);
    expect(liveLayout.assign.rudder?.drives).toBe("yaw");
    // The throttle: the game's thrust row is inverted as it ships, so this is said outright.
    expect(liveLayout.assign.right_toe).toEqual({ drives: "thrust", invert: false });
  });

  it("carry each name with the status that says it is inferred, not flown", () => {
    expect(LIVE_AXES.map((axis) => [axis.pedalAxis, axis.name, axis.status])).toEqual([
      ["rudder", AXIS2, "inferred"],
      ["right_toe", AXIS1, "inferred"],
    ]);
  });

  it("refuse a malformed sets file", () => {
    expect(parseSets(undefined, "s.yaml")).toEqual({ sets: {} });
    expect(() => parseSets({ sets: { a: { pedals: { device: "d" } } } }, "s.yaml")).toThrow(
      /assign/,
    );
    const assign = (entry: unknown) => ({
      sets: { a: { pedals: { device: "d", assign: { r: entry } } } },
    });
    expect(() => parseSets(assign({ drives: "yaw", spin: 1 }), "s.yaml")).toThrow(/unknown field/);
    expect(() => parseSets(assign({ drives: "yaw", invert: "yes" }), "s.yaml")).toThrow(
      /true or false/,
    );
  });
});

describe("ingamePlan", () => {
  it("refuses one game axis driven by two pedal axes unless the data says so", () => {
    const twice: PlannedAxis[] = [
      ...AXES,
      { ...axisOf("right_toe"), pedalAxis: "left_toe", assignment: { drives: "thrust" } },
    ];
    expect(() => ingamePlan(twice, FRESH, modes, game.actions.actions, game.slug)).toThrow(
      /right_toe and left_toe both drive 'MoveForward'.*shared: true/s,
    );
    const agreed = twice.map((axis) =>
      axis.row === "MoveForward"
        ? { ...axis, assignment: { ...axis.assignment, shared: true } }
        : axis,
    );
    const plan = ingamePlan(agreed, FRESH, modes, game.actions.actions, game.slug);
    expect(plan.bindings.filter((binding) => binding.row === "MoveForward").length).toBe(2);
  });

  it("refuses a game axis the game has no row for", () => {
    const bad: PlannedAxis[] = [{ ...axisOf("rudder"), assignment: { drives: "warp" }, row: null }];
    expect(() => ingamePlan(bad, FRESH, modes, game.actions.actions, game.slug)).toThrow(
      /rudder: 'warp' is not a game axis/,
    );
  });

  it("owns every flight axis row, and knows the device by every input the game registers", () => {
    const plan = ingamePlan(AXES, FRESH, modes, game.actions.actions, game.slug);
    expect([...plan.ownedRows].sort()).toEqual(
      ["MoveForward", "MoveRight", "MoveUp", "Pitch", "Roll", "Yaw"].sort(),
    );
    expect([...plan.knownNames].sort()).toEqual([AXIS0, AXIS1, AXIS2].sort());
    expect(plan.bindings.every((binding) => binding.name === null)).toBe(true);
  });

  it("carries each name's status into the binding", () => {
    const plan = ingamePlan(NAMED, LIVE, modes, game.actions.actions, game.slug);
    expect(plan.bindings.map((b) => [b.pedalAxis, b.name, b.status])).toEqual([
      ["rudder", AXIS2, "inferred"],
      ["right_toe", AXIS1, "inferred"],
    ]);
  });
});

describe("capturePedals", () => {
  const capture = (
    text: string,
    options: Parameters<typeof capturePedals>[5] = {},
    axes: readonly PlannedAxis[] = AXES,
    device = FRESH,
    deviceText = FRESH_TEXT,
  ) => capturePedals(parseInput(text), deviceText, device, axes, game.slug, options);

  it("finds the names the game wrote and says which game axis each was on", () => {
    const bound = bindJoystick(withRudderBound(), "MoveForward", true, RIGHT_TOE);
    const result = capture(bound);
    const found = result.recorded.map((entry) => [entry.pedalAxis, entry.name, entry.row]);
    expect(found).toContainEqual(["rudder", RUDDER, "Yaw"]);
    expect(found).toContainEqual(["right_toe", RIGHT_TOE, "MoveForward"]);
    expect(found.length).toBe(2);
    expect(result.unresolved).toEqual([]);
  });

  it("records them as bound -- what the game wrote, not proof the right pedal moved", () => {
    const text = capture(withRudderBound()).text ?? "";
    const parsed = parsePedalsDevice(parse(text), "x");
    expect(parsed.axes.rudder?.names?.everspace?.name).toBe(RUDDER);
    expect(parsed.axes.rudder?.names?.everspace?.status).toBe("bound");
    expect(parsed.axes.right_toe?.names).toEqual({});
  });

  it("changes nothing else in the device file, comments included", () => {
    const text = capture(withRudderBound()).text ?? "";
    expect(text).toContain("THE TOE-BRAKE PROBLEM");
    const was = FRESH_TEXT.split("\n");
    const now = text.split("\n");
    // `names: {}` became a block with one line under it.
    expect(now.length).toBe(was.length + 1);
    expect(now.filter((line) => !was.includes(line)).length).toBe(2);
  });

  it("skips the flight stick, which already has buttons in the file", () => {
    const stickAxis = bindJoystick(withFlightStick(), "Pitch", true, "JS-1_T16000M_YAxis");
    const result = capture(stickAxis);
    expect(result.recorded).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.otherDevices).toEqual(["T16000M"]);
    expect(result.text).toBeNull();
  });

  it("reports a name on a row no pedal drives, and does not guess", () => {
    const stray = bindJoystick(withFlightStick(), "Roll", true, LEFT_TOE);
    const result = capture(stray);
    expect(result.recorded).toEqual([]);
    expect(result.unresolved.map((found) => found.row)).toEqual(["Roll"]);
    expect(result.unresolved[0]?.reason).toMatch(/no pedal in the layout drives 'Roll'/);
    expect(result.text).toBeNull();
  });

  it("reports names it cannot tell apart when two pedals share a row", () => {
    const shared = AXES.map((axis) =>
      axis.pedalAxis === "rudder"
        ? { ...axis, row: "MoveForward", assignment: { drives: "thrust", shared: true } }
        : { ...axis, assignment: { ...axis.assignment, shared: true } },
    );
    const twoOnThrust = bindJoystick(withFlightStick(), "MoveForward", true, RIGHT_TOE);
    // Key2 holds the second name; set it by hand, the helper only sets Key1.
    const withKey2 = twoOnThrust.replace(
      /(Action=MoveForward[^\r\n]*bIsAxis=True[^\r\n]*?)Key2=None([^\r\n]*GroupName="Joystick")/,
      `$1Key2=${LEFT_TOE}$2`,
    );
    const result = capture(withKey2, {}, shared);
    expect(result.recorded).toEqual([]);
    expect(result.unresolved.length).toBeGreaterThan(0);
    expect(result.unresolved[0]?.reason).toMatch(/both drive 'MoveForward'/);
    expect(result.text).toBeNull();
  });

  it("takes an explicit --assign where the layout cannot say", () => {
    const stray = bindJoystick(withFlightStick(), "Roll", true, LEFT_TOE);
    const result = capture(stray, { assign: { [LEFT_TOE]: "left_toe" } });
    expect(result.recorded.map((found) => [found.pedalAxis, found.name])).toEqual([
      ["left_toe", LEFT_TOE],
    ]);
    expect(() => capture(stray, { assign: { [LEFT_TOE]: "nope" } })).toThrow(/no axis 'nope'/);
  });

  it("records the resolved names and reports the rest, in one run", () => {
    const mixed = bindJoystick(withRudderBound(), "Roll", true, LEFT_TOE);
    const result = capture(mixed);
    expect(result.recorded.map((found) => found.pedalAxis)).toEqual(["rudder"]);
    expect(result.unresolved.map((found) => found.name)).toEqual([LEFT_TOE]);
  });

  it("reports the axes still without a name when a device is only partly captured", () => {
    const result = capture(withRudderBound());
    expect(result.missing.map((entry) => [entry.pedalAxis, entry.row])).toEqual([
      ["right_toe", "MoveForward"],
    ]);
  });

  it("says so when nothing is bound yet", () => {
    const result = capture(withFlightStick());
    expect(result.recorded).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.known).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.missing.length).toBe(2);
  });

  describe("against names already recorded", () => {
    it("does not rewrite one that is found where the layout expects it", () => {
      const result = capture(withRudderBound(), {}, LIVE_AXES, LIVE, LIVE_TEXT);
      expect(result.known.map((entry) => [entry.pedalAxis, entry.status])).toEqual([
        ["rudder", "inferred"],
      ]);
      expect(result.recorded).toEqual([]);
      expect(result.conflicts).toEqual([]);
      // The toe the layout puts on thrust is not bound in this file, so nothing vouches for it.
      expect(result.unproven.map((entry) => entry.pedalAxis)).toEqual(["right_toe"]);
      expect(result.text).toBeNull();
    });

    it("reports the owner's file as it is, with Yaw on a toe, as a conflict and changes nothing", () => {
      const result = capture(withMisboundYaw(), {}, LIVE_AXES, LIVE, LIVE_TEXT);
      expect(result.conflicts.map((entry) => [entry.pedalAxis, entry.name, entry.row])).toEqual([
        ["right_toe", AXIS1, "Yaw"],
      ]);
      expect(result.conflicts[0]?.reason).toMatch(/drives on 'MoveForward'.*has it on 'Yaw'/);
      expect(result.known).toEqual([]);
      expect(result.recorded).toEqual([]);
      expect(result.text).toBeNull();
      // The rudder, which the layout drives on Yaw, was not seen anywhere, and the toe was
      // not seen on the thrust row the layout puts it on.
      expect(result.unproven.map((entry) => [entry.pedalAxis, entry.status])).toEqual([
        ["rudder", "inferred"],
        ["right_toe", "inferred"],
      ]);
    });

    it("moves a name to another axis only when told to, and frees the one it left", () => {
      const result = capture(
        withMisboundYaw(),
        { assign: { [AXIS1]: "rudder" } },
        LIVE_AXES,
        LIVE,
        LIVE_TEXT,
      );
      expect(result.recorded.map((entry) => [entry.pedalAxis, entry.name])).toEqual([
        ["rudder", AXIS1],
      ]);
      const after = parsePedalsDevice(parse(result.text ?? ""), "after");
      expect(after.axes.rudder?.names?.everspace?.name).toBe(AXIS1);
      expect(after.axes.rudder?.names?.everspace?.status).toBe("bound");
      expect(after.axes.right_toe?.names).toEqual({});
    });

    it("does not replace a different name silently", () => {
      // The rudder is recorded as Axis0 here; the game has Yaw on Axis2, which nobody owns.
      const text = recordPedalNames(FRESH_TEXT, "everspace", {
        rudder: { name: AXIS0, status: "inferred" },
      });
      const device = parsePedalsDevice(parse(text), "x");
      const axes = planAxes(layout, device, modes, game.actions.actions, game.slug);
      const result = capture(withRudderBound(), {}, axes, device, text);
      expect(result.recorded).toEqual([]);
      expect(result.unresolved[0]?.reason).toMatch(/already recorded as/);
      const replaced = capture(
        withRudderBound(),
        { assign: { [AXIS2]: "rudder" } },
        axes,
        device,
        text,
      );
      expect(replaced.recorded.map((found) => found.pedalAxis)).toEqual(["rudder"]);
    });

    it("leaves a name from another device alone, as not one the game registers for the pedals", () => {
      const other = bindJoystick(withFlightStick(), "Yaw", true, "JS1_SomeOtherPedals_Axis0");
      const result = capture(other, {}, LIVE_AXES, LIVE, LIVE_TEXT);
      expect(result.recorded).toEqual([]);
      expect(result.unresolved[0]?.reason).toMatch(/not one of the inputs everspace registers/);
    });
  });

  it("makes a layout generate: what was recorded is what the generator then writes", () => {
    const text = capture(withRudderBound()).text ?? "";
    const device = parsePedalsDevice(parse(text), "x");
    const axes = planAxes(layout, device, modes, game.actions.actions, game.slug);
    expect(axes.map((axis) => [axis.name, axis.status])).toEqual([
      [RUDDER, "bound"],
      [null, null],
    ]);
    const plan = ingamePlan(axes, device, modes, game.actions.actions, game.slug);
    // The file the game wrote already agrees with what is recorded, and nothing is waiting
    // for the other toe but the toe.
    const again = applyPedalRows(parseInput(withRudderBound()), plan);
    expect(again.changes).toEqual([]);
    expect(again.waiting.map((entry) => entry.pedalAxis)).toEqual(["right_toe"]);
    // The same layout, applied to a file where only the flight stick is bound, writes it.
    const fresh = applyPedalRows(parseInput(withFlightStick()), plan);
    expect(fresh.text).toBe(withRudderBound());
  });
});

describe("recordCandidateNames", () => {
  const withCandidate = recordCandidateNames(FRESH_TEXT, "everspace", { right_toe: AXIS1 });
  const device = parsePedalsDevice(parse(withCandidate), "candidate");

  it("writes the name by hand as a candidate, and nowhere else in the file", () => {
    expect(device.axes.right_toe?.names?.everspace?.name).toBe(AXIS1);
    expect(device.axes.right_toe?.names?.everspace?.status).toBe("candidate");
    expect(device.axes.rudder?.names).toEqual({});
  });

  it("is used for generation, and the status says it is a candidate", () => {
    const axes = planAxes(layout, device, modes, game.actions.actions, game.slug);
    const plan = ingamePlan(axes, device, modes, game.actions.actions, game.slug);
    expect(plan.bindings.find((binding) => binding.pedalAxis === "right_toe")?.status).toBe(
      "candidate",
    );
    const written = applyPedalRows(parseInput(withRudderBound()), plan);
    expect(written.changes.find((change) => change.row === "MoveForward")?.status).toBe(
      "candidate",
    );
  });

  it("cannot be the name another axis already has", () => {
    expect(() => recordCandidateNames(LIVE_TEXT, "everspace", { left_toe: AXIS2 })).toThrow(
      /also the name of rudder/,
    );
  });

  it("refuses an axis the device does not have, a name that would break the row, and one the game does not register", () => {
    expect(() => recordCandidateNames(FRESH_TEXT, "everspace", { brake: AXIS1 })).toThrow(
      /no axis 'brake'/,
    );
    expect(() => recordCandidateNames(FRESH_TEXT, "everspace", { left_toe: "a,b" })).toThrow(
      /cannot be written/,
    );
    expect(() =>
      recordCandidateNames(FRESH_TEXT, "everspace", {
        left_toe: "JS0_SaitekProFlightRudderPedals_Axis9",
      }),
    ).toThrow(/not one of the inputs everspace registers/);
  });
});

describe("recordPedalNames", () => {
  const entry = { name: AXIS2, status: "bound" as const };

  it("adds one game's name to an axis that already has another game's", () => {
    const text = FRESH_TEXT.replace(
      /( {4}names: )\{\}/,
      '$1\n      othergame: {name: "JS1_Other_Axis0", status: candidate}',
    );
    const out = recordPedalNames(text, "everspace", { rudder: entry });
    const names = parsePedalsDevice(parse(out), "x").axes.rudder?.names;
    expect(Object.keys(names ?? {}).sort()).toEqual(["everspace", "othergame"]);
  });

  it("replaces a game's name rather than adding a second line", () => {
    const once = recordPedalNames(FRESH_TEXT, "everspace", { rudder: entry });
    const twice = recordPedalNames(once, "everspace", {
      rudder: { name: AXIS0, status: "inferred", note: "because" },
    });
    const names = parsePedalsDevice(parse(twice), "x").axes.rudder?.names;
    expect(names).toEqual({ everspace: { name: AXIS0, status: "inferred", note: "because" } });
    expect(twice.match(/everspace: \{name:/g)?.length).toBe(1);
  });

  it("removes a name, leaving an empty mapping behind", () => {
    const once = recordPedalNames(FRESH_TEXT, "everspace", { rudder: entry });
    const gone = recordPedalNames(once, "everspace", { rudder: null });
    expect(parsePedalsDevice(parse(gone), "x").axes.rudder?.names).toEqual({});
    expect(gone).toBe(FRESH_TEXT);
  });

  it("keeps CRLF, and refuses an axis the file does not have", () => {
    const crlf = FRESH_TEXT.replace(/\n/g, "\r\n");
    const out = recordPedalNames(crlf, "everspace", { rudder: entry });
    expect(out.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(() => recordPedalNames(FRESH_TEXT, "everspace", { brake: entry })).toThrow(
      /no axis 'brake'/,
    );
  });

  it("matches what is committed: the file in the repo still parses", () => {
    parsePedalsDevice(
      parse(readFileSync(repoPath("devices/logitech-pro-flight-pedals.yaml"), "utf8")),
      "x",
    );
  });
});
