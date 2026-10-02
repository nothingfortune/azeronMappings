/**
 * The Joystick half of the game's binding file. It has the keyboard half's guarantees:
 * only the rows it owns are rewritten, every other line is carried through byte for byte
 * (the flight stick's buttons above all), the line ending survives, generating twice is
 * generating once, and a pedal whose game name nobody has captured writes nothing.
 */

import { describe, expect, it } from "vitest";

import {
  applyPedalRows,
  IngameError,
  isJoystickKey,
  joystickAxisRows,
  joystickDeviceOf,
  parseInput,
} from "../../../src/lib/ingame.js";
import type { PedalPlan, PedalRowBinding } from "../../../src/lib/ingame.js";
import {
  BASE,
  LEFT_TOE,
  RIGHT_TOE,
  RUDDER,
  STICK_BUTTON,
  bindJoystick,
  joystickRow,
  withFlightStick,
} from "../../helpers/pedals.js";

const OWNED = new Set(["MoveForward", "MoveRight", "MoveUp", "Pitch", "Yaw", "Roll"]);

function plan(
  bindings: readonly Partial<PedalRowBinding>[],
  known: readonly string[] = [],
): PedalPlan {
  return {
    bindings: bindings.map((binding) => ({
      pedalAxis: "rudder",
      label: "Rudder",
      row: "Yaw",
      name: null,
      ...binding,
    })),
    ownedRows: OWNED,
    knownNames: new Set(known),
  };
}

const RUDDER_ON_YAW: Partial<PedalRowBinding> = { pedalAxis: "rudder", row: "Yaw", name: RUDDER };
const TOE_ON_THRUST: Partial<PedalRowBinding> = {
  pedalAxis: "right_toe",
  label: "Right toe brake",
  row: "MoveForward",
  name: RIGHT_TOE,
};

const apply = (text: string, p: PedalPlan, strict = false) =>
  applyPedalRows(parseInput(text), p, { strict });

describe("applyPedalRows", () => {
  const before = withFlightStick();

  it("writes the pedal into the Joystick axis row it drives, and into no other line", () => {
    const { text, changes } = apply(before, plan([RUDDER_ON_YAW, TOE_ON_THRUST]));
    const was = before.split("\r\n");
    const now = text.split("\r\n");
    expect(now.length).toBe(was.length);
    const differing = now.flatMap((line, index) => (line === was[index] ? [] : [index]));
    expect(differing.sort()).toEqual(
      [joystickRow(before, "Yaw", true), joystickRow(before, "MoveForward", true)].sort(),
    );
    const rows = joystickAxisRows(parseInput(text));
    expect(rows.get("Yaw")?.key).toBe(RUDDER);
    expect(rows.get("MoveForward")?.key).toBe(RIGHT_TOE);
    expect(changes.map((change) => `${change.row}.${change.field}`).sort()).toEqual([
      "MoveForward.Key1",
      "Yaw.Key1",
    ]);
  });

  it("leaves the flight stick's button bindings exactly as they were", () => {
    const { text } = apply(before, plan([RUDDER_ON_YAW]));
    const index = joystickRow(before, "Boost", false);
    expect(text.split("\r\n")[index]).toBe(before.split("\r\n")[index]);
    expect(text).toContain(STICK_BUTTON);
  });

  it("changes no field of the row but the one it was told about", () => {
    const { text } = apply(before, plan([RUDDER_ON_YAW]));
    const index = joystickRow(before, "Yaw", true);
    const was = before.split("\r\n")[index] ?? "";
    const now = text.split("\r\n")[index] ?? "";
    expect(now).toBe(was.replace("Key1=None", `Key1=${RUDDER}`));
  });

  it("keeps the file's line ending, whichever it is", () => {
    const crlf = apply(before, plan([RUDDER_ON_YAW])).text;
    expect(crlf.includes("\r\n")).toBe(true);
    expect(crlf.replace(/\r\n/g, "").includes("\n")).toBe(false);

    const lf = before.replace(/\r\n/g, "\n");
    const out = apply(lf, plan([RUDDER_ON_YAW])).text;
    expect(out.includes("\r")).toBe(false);
    expect(out).toBe(crlf.replace(/\r\n/g, "\n"));
  });

  it("is a fixed point: generating from its own output changes nothing", () => {
    const wanted = plan([RUDDER_ON_YAW, { ...TOE_ON_THRUST, invert: true, deadZone: 0.25 }]);
    const once = apply(before, wanted);
    expect(once.changes.length).toBeGreaterThan(0);
    const twice = apply(once.text, wanted);
    expect(twice.changes).toEqual([]);
    expect(twice.text).toBe(once.text);
  });

  it("writes invert and dead zone where the layout says, on that row only", () => {
    const { text, changes } = apply(
      before,
      plan([{ ...TOE_ON_THRUST, invert: true, deadZone: 0.25 }]),
    );
    const row = parseInput(text).entries.find(
      (entry) => entry.group === "Joystick" && entry.isAxis && entry.action === "MoveForward",
    );
    expect(row?.raw).toContain("bInvert=True");
    expect(row?.raw).toContain("DeadZone=0.250000");
    expect(changes.map((change) => change.field).sort()).toEqual(["DeadZone", "Key1", "bInvert"]);
  });

  it("leaves invert and dead zone as the game has them when the layout is silent", () => {
    const lever = bindJoystick(before, "MoveForward", true, "None");
    const flipped = lever.replace(
      /(Action=MoveForward[^\r\n]*bIsAxis=True[^\r\n]*?)bInvert=False([^\r\n]*GroupName="Joystick")/,
      "$1bInvert=True$2",
    );
    expect(flipped).not.toBe(lever);
    const { text } = apply(flipped, plan([TOE_ON_THRUST]));
    const row = parseInput(text).entries.find(
      (entry) => entry.group === "Joystick" && entry.isAxis && entry.action === "MoveForward",
    );
    expect(row?.raw).toContain("bInvert=True");
  });

  describe("a pedal with no captured game name", () => {
    it("writes nothing, and says which axis is waiting", () => {
      const { text, changes, waiting } = apply(
        before,
        plan([{ ...RUDDER_ON_YAW, name: null }, TOE_ON_THRUST]),
      );
      expect(waiting.map((entry) => entry.pedalAxis)).toEqual(["rudder"]);
      expect(waiting[0]?.row).toBe("Yaw");
      expect(changes.map((change) => change.row)).toEqual(["MoveForward"]);
      expect(joystickAxisRows(parseInput(text)).get("Yaw")?.key).toBe("None");
    });

    it("leaves the file untouched when every axis is waiting", () => {
      const waiting = plan([
        { ...RUDDER_ON_YAW, name: null },
        { ...TOE_ON_THRUST, name: null, invert: true },
      ]);
      const result = apply(before, waiting);
      expect(result.text).toBe(before);
      expect(result.changes).toEqual([]);
      expect(result.waiting.length).toBe(2);
    });

    it("refuses when asked to require them, naming the axis", () => {
      expect(() => apply(before, plan([{ ...RUDDER_ON_YAW, name: null }]), true)).toThrow(
        /rudder.*not been captured.*'Yaw'/s,
      );
    });
  });

  describe("refuses, naming the axis", () => {
    it("a row the game does not have", () => {
      const lines = before.split("\r\n");
      const gone = lines.filter((_, index) => index !== joystickRow(before, "Yaw", true));
      expect(() => apply(gone.join("\r\n"), plan([RUDDER_ON_YAW]))).toThrow(
        /rudder: the game has no Joystick row 'Yaw'/,
      );
    });

    it("a slot that already holds something that is not a pedal", () => {
      const taken = bindJoystick(before, "Yaw", true, "JS-1_T16000M_Twist");
      expect(() => apply(taken, plan([RUDDER_ON_YAW]))).toThrow(
        /rudder: Key1 of 'Yaw' is bound to JS-1_T16000M_Twist/,
      );
    });

    it("a name that would break the row", () => {
      expect(() => apply(before, plan([{ ...RUDDER_ON_YAW, name: "JS-2_a,b" }]))).toThrow(
        /rudder: 'JS-2_a,b' cannot be written/,
      );
    });

    it("two axes with one game name", () => {
      expect(() =>
        apply(before, plan([RUDDER_ON_YAW, { ...TOE_ON_THRUST, name: RUDDER }])),
      ).toThrow(IngameError);
    });
  });

  it("writes a name whatever its status, and says which status it was using", () => {
    const { text, changes } = apply(
      before,
      plan([
        { ...TOE_ON_THRUST, status: "unconfirmed" },
        { ...RUDDER_ON_YAW, status: "inferred" },
      ]),
    );
    expect(joystickAxisRows(parseInput(text)).get("MoveForward")?.key).toBe(RIGHT_TOE);
    expect(changes.find((change) => change.row === "MoveForward")?.status).toBe("unconfirmed");
    expect(changes.find((change) => change.row === "Yaw")?.status).toBe("inferred");
  });

  it("moves a name the device is known by off a row it was mis-bound to", () => {
    // The owner's file has Yaw on a toe brake. The layout drives Yaw from the rudder, and
    // the toe's name is one the device is known by, so it is replaced rather than refused.
    const wrong = bindJoystick(before, "Yaw", true, RIGHT_TOE);
    const { text, changes } = apply(wrong, plan([RUDDER_ON_YAW], [RIGHT_TOE, RUDDER]));
    expect(joystickAxisRows(parseInput(text)).get("Yaw")?.key).toBe(RUDDER);
    expect(changes).toEqual([
      expect.objectContaining({ row: "Yaw", field: "Key1", from: RIGHT_TOE, to: RUDDER }),
    ]);
  });

  it("works while a device is only partly named: the named axes are written, the rest wait", () => {
    const { text, waiting, changes } = apply(
      before,
      plan([RUDDER_ON_YAW, { ...TOE_ON_THRUST, name: null }]),
    );
    expect(waiting.map((entry) => entry.pedalAxis)).toEqual(["right_toe"]);
    expect(changes.map((change) => change.row)).toEqual(["Yaw"]);
    expect(joystickAxisRows(parseInput(text)).get("Yaw")?.key).toBe(RUDDER);
  });

  it("puts two pedals that share a row on its two slots", () => {
    const shared = plan([
      { pedalAxis: "right_toe", row: "MoveForward", name: RIGHT_TOE },
      { pedalAxis: "left_toe", row: "MoveForward", name: LEFT_TOE },
    ]);
    const row = joystickAxisRows(parseInput(apply(before, shared).text)).get("MoveForward");
    expect(row?.key).toBe(RIGHT_TOE);
    expect(row?.key2).toBe(LEFT_TOE);
  });

  it("clears a known pedal name from an owned row the layout no longer uses, and only that", () => {
    const bound = bindJoystick(before, "Roll", true, LEFT_TOE);
    const stranger = bindJoystick(bound, "Pitch", true, "JS-1_T16000M_YAxis");
    const { text, changes } = apply(stranger, plan([RUDDER_ON_YAW], [RUDDER, LEFT_TOE]));
    const rows = joystickAxisRows(parseInput(text));
    expect(rows.get("Roll")?.key).toBe("None");
    expect(rows.get("Pitch")?.key).toBe("JS-1_T16000M_YAxis");
    expect(changes.some((change) => change.row === "Roll" && change.pedalAxis === null)).toBe(true);
  });

  it("owns no row outside the flight axes", () => {
    const camera = bindJoystick(before, "CameraYaw", true, LEFT_TOE);
    const { text } = apply(camera, plan([RUDDER_ON_YAW], [LEFT_TOE]));
    expect(joystickAxisRows(parseInput(text)).get("CameraYaw")?.key).toBe(LEFT_TOE);
  });
});

describe("joystickDeviceOf", () => {
  it("reads the device out of the game's name for an input", () => {
    expect(joystickDeviceOf("JS0_SaitekProFlightRudderPedals_Axis1")).toBe(
      "SaitekProFlightRudderPedals",
    );
    expect(joystickDeviceOf("JS-1_T16000M_Button0")).toBe("T16000M");
  });

  it("reads the same device whatever its index, the index being negative for a stick that is unplugged", () => {
    for (const index of ["-1", "0", "1", "12"]) {
      expect(joystickDeviceOf(`JS${index}_SaitekProFlightRudderPedals_Axis1`)).toBe(
        "SaitekProFlightRudderPedals",
      );
      expect(isJoystickKey(`JS${index}_T16000M_Button0`)).toBe(true);
    }
  });

  it("says nothing for a key that is not a joystick's", () => {
    expect(joystickDeviceOf("LeftShift")).toBeNull();
    expect(joystickDeviceOf("Gamepad_LeftY")).toBeNull();
    expect(isJoystickKey("JSomething")).toBe(false);
    expect(isJoystickKey("None")).toBe(false);
  });
});

describe("the game's file as it stood before the first generation", () => {
  it("has nothing a pedal could have been wrongly written over", () => {
    // Every owned Joystick axis row is free.
    const rows = joystickAxisRows(parseInput(BASE));
    for (const name of OWNED) expect(rows.get(name)?.key, name).toBe("None");
  });
});
