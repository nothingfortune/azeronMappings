/**
 * The press test establishes a device map by observation. It must bind every pin to a
 * distinct key, and convert the resulting presses back into a device map.
 */

import { describe, expect, it } from "vitest";

import { loadDevice, loadProfile, loadTemplate } from "../../../src/lib/io.js";
import { Game } from "../../../src/lib/model.js";
import type { DeviceData } from "../../../src/types/profile.js";
import {
  buildProbeProfile,
  buildStickCalibrationProfile,
  deviceFromProbe,
  probeDiff,
  PROBE_KEYS,
  stickZeroFrom,
} from "../../../src/lib/probe.js";
import * as keys from "../../../src/lib/keys.js";
import {
  STICK_DIRECTIONS,
  STICK_SECTORS,
  TYPE_NONE,
  TYPE_STICK_KEYBOARD,
} from "../../../src/types/azeron.js";

const TEMPLATE = "templates/everspace2-v5.json";

function probe() {
  const device = loadDevice("cyborg2-left");
  return buildProbeProfile(loadTemplate(TEMPLATE), {
    id: "00000000-0000-4000-8000-000000000000",
    name: "PROBE",
    unknownPins: [...device.unknownPins],
  });
}

describe("buildProbeProfile", () => {
  it("gives every pin its own key", () => {
    const { assignments } = probe();
    const used = assignments.map((entry) => entry.key);
    expect(new Set(used).size).toBe(used.length);
    expect(used.every((key) => PROBE_KEYS.includes(key))).toBe(true);
  });

  it("covers every input that has a real pin", () => {
    const { doc, assignments } = probe();
    const real = doc.profiles[0]?.inputs.filter((record) => record.pinOne !== 255) ?? [];
    expect(new Set(assignments.map((entry) => entry.pin)).size).toBe(real.length);
  });

  it("probes the stick as four directions, not as a button", () => {
    const { assignments } = probe();
    const stick = assignments.filter((entry) => entry.kind === "stick");
    expect(stick.map((entry) => entry.direction).sort()).toEqual([...STICK_DIRECTIONS].sort());
    // Stick directions are numeric keycodes, so each probe key must have one.
    for (const entry of stick) expect(keys.nameToAnalog(entry.key)).not.toBeNull();
  });

  it("leaves the stick in keyboard mode, never gamepad mode", () => {
    const { doc } = probe();
    const stick = doc.profiles[0]?.inputs.find((record) => record.pinTwo === 30);
    expect(stick?.types[0]).toBe(TYPE_STICK_KEYBOARD);
  });

  it("saves the least reliable keys for pins nobody has identified", () => {
    const device = loadDevice("cyborg2-left");
    const { assignments } = probe();
    const tail = assignments.filter((entry) => entry.key.startsWith("F"));
    for (const entry of tail) expect(device.unknownPins.has(entry.pin)).toBe(true);
  });
});

describe("deviceFromProbe", () => {
  /**
   * A synthetic map, not a checked-in device file: these assertions cover the
   * transformation, and the real files change as units are press-tested.
   */
  function assumedMap(): DeviceData {
    return {
      device: "test-unit",
      hand: "right",
      mirrored: true,
      verified: false,
      unknown_pins: [0, 28],
      positions: {
        pinky_1: { pin: 5, col: "pinky", row: 1 },
        pinky_5: { pin: 1, col: "pinky", row: 5 },
        thumb_left: { pin: 35, col: "thumb", row: 2, cluster: "pad" },
        stick: { pin: 31, pin_two: 30, col: "thumb", row: 0, kind: "stick" },
      },
    };
  }

  it("rebuilds the map from what actually fired, and marks it verified", () => {
    const assumed = assumedMap();
    const next = deviceFromProbe(assumed, {
      pins: { pinky_1: 1, pinky_5: 5, thumb_left: 33 },
      stick: { up: "up", right: "left", down: "down", left: "right" },
    });

    expect(next.verified).toBe(true);
    expect(next.positions.pinky_1?.pin).toBe(1);
    expect(next.positions.thumb_left?.pin).toBe(33);
    expect(next.stick_directions).toEqual({ up: "up", right: "left", down: "down", left: "right" });
    // The rest of the position's description survives; only the pin was measured.
    expect(next.positions.pinky_1?.col).toBe("pinky");
  });

  it("keeps the stick, which a pin sweep can never press", () => {
    const next = deviceFromProbe(assumedMap(), { pins: { pinky_1: 1 }, stick: {} });
    expect(next.positions.stick?.pin).toBe(31);
    expect(next.positions.pinky_5).toBeUndefined();
  });

  it("omits a stick remap when the unit matches the left-handed assumption", () => {
    const next = deviceFromProbe(assumedMap(), { pins: { pinky_1: 5 }, stick: {} });
    expect(next.stick_directions).toBeUndefined();
  });

  it("drops unknown pins that the sweep accounted for", () => {
    const next = deviceFromProbe(assumedMap(), { pins: { pinky_1: 28 }, stick: {} });
    expect(next.unknown_pins).toEqual([0]);
  });

  it("reports what disagreed with the assumed map", () => {
    const notes = probeDiff(assumedMap(), {
      pins: { pinky_1: 5, pinky_5: 1, thumb_left: 33 },
      stick: { left: "right" },
    });
    expect(notes.some((note) => note.includes("thumb_left: pin 33, not 35"))).toBe(true);
    expect(notes.some((note) => note.includes("stick left drives the 'right' field"))).toBe(true);
  });
});

describe("stick zero calibration", () => {
  function calibration() {
    return buildStickCalibrationProfile(loadTemplate(TEMPLATE), {
      id: "00000000-0000-4000-8000-000000000001",
      name: "PROBE stick",
    });
  }

  it("binds all eight sectors to keys with analog keycodes", () => {
    const { assignments } = calibration();
    expect(assignments.map((entry) => entry.sector).sort()).toEqual([...STICK_SECTORS].sort());
    for (const entry of assignments) expect(keys.nameToAnalog(entry.key)).not.toBeNull();
    expect(new Set(assignments.map((entry) => entry.key)).size).toBe(8);
  });

  it("turns on eight-directional mode so the diagonals report separately", () => {
    const { doc } = calibration();
    const stick = doc.profiles[0]?.inputs.find((record) => record.types[0] === TYPE_STICK_KEYBOARD);
    expect(stick?.analogSettings?.isEightDirectionalTrigger).toBe(true);
  });

  it("silences every other key so a stray finger is not read as a push", () => {
    const { doc } = calibration();
    const live = doc.profiles[0]?.inputs.filter(
      (record) => record.types[0] !== TYPE_NONE && record.types[0] !== TYPE_STICK_KEYBOARD,
    );
    expect(live).toEqual([]);
  });

  it("reads a stick that matches the software as zero rotation", () => {
    const observed = Object.fromEntries(STICK_SECTORS.map((sector) => [sector, sector]));
    const zero = stickZeroFrom(observed);
    expect(zero.offsetDegrees).toBe(0);
    expect(zero.zeroPush).toBe("up");
    expect(zero.agreement).toBe(8);
  });

  it("measures a rotated stick, and reports the short way round", () => {
    // Every push reports one sector clockwise of where it physically went.
    const observed = Object.fromEntries(
      STICK_SECTORS.map((sector, index) => [
        sector,
        STICK_SECTORS[(index + 7) % STICK_SECTORS.length],
      ]),
    );
    const zero = stickZeroFrom(observed);
    expect(zero.offsetDegrees).toBe(-45);
    expect(zero.zeroPush).toBe("up_right");
  });

  it("ignores one sloppy diagonal rather than letting it move the answer", () => {
    const observed: Record<string, string> = Object.fromEntries(
      STICK_SECTORS.map((sector, index) => [
        sector,
        STICK_SECTORS[(index + 2) % STICK_SECTORS.length] ?? sector,
      ]),
    );
    observed.up_right = "down";
    const zero = stickZeroFrom(observed);
    expect(zero.offsetDegrees).toBe(90);
    expect(zero.agreement).toBe(7);
    expect(zero.samples).toBe(8);
  });

  it("carries the measurement into the device map", () => {
    const assumed = loadDevice("cyborg2-right");
    const pins = Object.fromEntries(
      Object.entries(assumed.positions).map(([name, position]) => [name, position.pin]),
    );
    const observed = Object.fromEntries(
      STICK_SECTORS.map((sector, index) => [
        sector,
        STICK_SECTORS[(index + 2) % STICK_SECTORS.length],
      ]),
    );
    const next = deviceFromProbe(assumed.data, { pins, stick: {}, sectors: observed });
    expect(next.stick_angle).toBe(90);
    expect(next.stick_zero).toBe("left");
  });
});

describe("device identity", () => {
  it("records the id the Azeron software files each unit under", () => {
    expect(loadDevice("cyborg2-left").softwareDeviceId).toBe("49229");
    expect(loadDevice("cyborg2-right").softwareDeviceId).toBe("29993");
  });
});

describe("stick key encodings", () => {
  it("reads both the integer keycodes and the code strings the app writes", () => {
    // everspace2-v5 holds 87 for W; a profile edited in 2.0.2 holds "ArrowUp".
    expect(keys.analogToName(87)).toBe("KeyW");
    expect(keys.analogToName("ArrowUp")).toBe("ArrowUp");
    expect(keys.analogToName("not-a-key")).toBeNull();
  });

  it("keeps the stick bindings from an app-edited export", () => {
    // These were silently dropped when only integer keycodes were understood.
    const game = new Game("games/SpaceSims/everspace");
    const profile = loadProfile("games/SpaceSims/everspace/profiles/akimbo-v7-left.yaml", game);
    expect(profile.positions.stick?.directions).toEqual({
      up: "weapon_cycle_up",
      right: "roll_right",
      down: "weapon_cycle_down",
      left: "roll_left",
    });
  });
});
