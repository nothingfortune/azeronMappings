/**
 * What a unit can do on its own beyond keys: send Xbox buttons and triggers, scroll, and
 * drive its stick as an Xbox stick or as the mouse pointer. Each is stored on the unit
 * (firmware 112), so it works with nothing running on the PC.
 *
 * `tests/fixtures/unit-protocol/onboard-112.json` holds what the Azeron app 2.0.3 wrote
 * for each, with the export of the profile it wrote: the compiler must produce those
 * export fields and the encoder those bytes. The capture is the reference.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  XBOX_BUTTON_BITS,
  describeWheel,
  resolveSlot,
  wheelFields,
} from "../../../src/lib/binding.js";
import { compileProfile } from "../../../src/lib/compile.js";
import { decompile } from "../../../src/lib/decompile.js";
import { loadProfile, loadTemplate } from "../../../src/lib/io.js";
import { Game } from "../../../src/lib/model.js";
import { Profile } from "../../../src/lib/model-core.js";
import {
  ProtocolError,
  decodeStoredRecord,
  encodeInputRecord,
  isWritableInput,
} from "../../../src/lib/unitproto.js";
import { compareStored } from "../../../src/lib/unitsession.js";
import type { InputRecord } from "../../../src/types/azeron.js";
import { isRebindableRecord } from "../../../src/types/azeron.js";
import type { PositionSpec } from "../../../src/types/profile.js";

interface Captured {
  capture: string;
  slot: number;
  input: InputRecord;
  wire: string;
}

const captured = (
  JSON.parse(readFileSync("tests/fixtures/unit-protocol/onboard-112.json", "utf8")) as {
    records: Captured[];
  }
).records;

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

function one(capture: string, id: number): Captured {
  const found = captured.find((entry) => entry.capture === capture && entry.input.id === id);
  if (found === undefined) throw new Error(`no captured input ${String(id)} in ${capture}`);
  return found;
}

describe("the unit's records for Xbox output, scroll and the stick's modes", () => {
  it("are encoded exactly as the app sent them", () => {
    expect(captured.length).toBeGreaterThanOrEqual(12);
    for (const entry of captured) {
      const where = `${entry.capture} input ${String(entry.input.id)}`;
      expect(isWritableInput(entry.input, [0, 28, 29]), where).toBe(true);
      expect(hex(encodeInputRecord(entry.slot, entry.input)), where).toBe(entry.wire);
    }
  });

  it("covers every kind: button and trigger on each press, scroll, Xbox and mouse sticks", () => {
    const kinds = new Set(captured.flatMap((entry) => entry.input.types));
    for (const type of ["21", "22", "23", "35", "40"]) expect(kinds).toContain(type);
    // An Xbox button on a long and on a double press, not only a tap.
    expect(one("wheel-layer", 18).input.types).toEqual(["6", "22", "6"]);
    expect(one("wheel-layer", 13).input.types).toEqual(["6", "6", "22"]);
  });

  it("refuses scroll down or left until a capture shows how they go", () => {
    const up = structuredClone(one("wheel-layer", 4).input);
    up.y = -1;
    expect(() => encodeInputRecord(4, up)).toThrow(ProtocolError);
  });

  it("refuses an Xbox button that is not one button", () => {
    const button = structuredClone(one("xinput", 15).input);
    button.keyValues = ["4097", "0", "0", "0"];
    expect(() => encodeInputRecord(4, button)).toThrow(/not one button bit/);
  });

  it("are records the compiler may rewrite", () => {
    for (const type of ["21", "22", "23", "35", "40"]) {
      expect(isRebindableRecord({ types: [type, "6", "6"] } as unknown as InputRecord)).toBe(true);
    }
    // What the app runs on the PC still passes through: macro, layer switch, sequence.
    for (const type of ["16", "24", "37"]) {
      expect(isRebindableRecord({ types: [type, "6", "6"] } as unknown as InputRecord)).toBe(false);
    }
  });
});

describe("a key's Xbox and scroll bindings", () => {
  it("names a button by XInput's bit and a trigger as the export does", () => {
    expect(resolveSlot({ xbox: "A" }, null)).toEqual(["22", "4096", "0"]);
    expect(resolveSlot({ xbox: "Guide" }, null)).toEqual(["22", "1024", "0"]);
    expect(resolveSlot({ xbox: "RT" }, null)).toEqual(["23", "T2", "0"]);
    expect(resolveSlot({ xbox: "LT" }, null)).toEqual(["23", "T1", "0"]);
    expect(() => resolveSlot({ xbox: "LeftStickUp" }, null)).toThrow(/not an Xbox button/);
  });

  it("agrees with what the app exported for A and the right trigger", () => {
    expect(one("xinput", 15).input.keyValues[0]).toBe(String(XBOX_BUTTON_BITS.A));
    expect(one("xinput", 10).input.keyValues[0]).toBe("T2");
  });

  it("works out scroll's fields the way the app does", () => {
    // The app exported scroll up at speed 33 and right at 29 like this.
    const up = one("wheel-layer", 4).input;
    expect(wheelFields("up", 33)).toEqual({ x: 0, y: 1, interval: 150, yInterval: 100.5 });
    expect([up.x, up.y, up.interval, up.yInterval]).toEqual([0, 1, 150, 100.5]);
    const right = one("wheel-layer", 12).input;
    expect(wheelFields("right", 29)).toEqual({ x: 1, y: 0, interval: 106.5, yInterval: 150 });
    expect([right.x, right.y, right.interval, right.yInterval]).toEqual([1, 0, 106.5, 150]);
    expect(describeWheel({ x: 0, y: 1, interval: 150, yInterval: 100.5 })).toEqual({
      wheel: "up",
      speed: 33,
    });
    // Neither axis moving is not a direction.
    expect(describeWheel({ x: 0, y: 0, interval: 150, yInterval: 150 })).toBeNull();
    expect(() => wheelFields("up", 0)).toThrow(/1 to 100/);
    expect(() => wheelFields("sideways")).toThrow(/not a scroll direction/);
  });
});

describe("compiling and decompiling them", () => {
  const SINGLE_V5 = "games/SpaceSims/everspace/profiles/single-v5.yaml";

  function build(edit: (positions: Record<string, PositionSpec>) => void) {
    const game = new Game("games/SpaceSims/everspace");
    const profile = loadProfile(SINGLE_V5, game);
    const template = loadTemplate("templates/everspace2-v5.json");
    const data = structuredClone(profile.data);
    edit(data.positions);
    const edited = new Profile(data, profile.device, { path: profile.path, game });
    const built = compileProfile(edited, { template, actions: game.actions.actions });
    const record = (name: string): InputRecord | undefined => {
      const pin = profile.device.positions[name]?.pin;
      return built.profiles[0]?.inputs.find((input) => input.pinOne === pin);
    };
    return { game, profile, template, built, record };
  }

  function onboard(positions: Record<string, PositionSpec>): void {
    positions.pinky_1 = { label: "Jump", tap: { xbox: "A" }, long: { xbox: "Y" } };
    positions.pinky_2 = { label: "Fire", tap: { xbox: "RT" } };
    positions.pinky_3 = { label: "Next", tap: { wheel: "up", speed: 33 } };
    positions.stick = { mode: "mouse", mouse_sensitivity: 2 };
  }

  it("writes the fields the app's own export has", () => {
    const { record } = build(onboard);
    expect(record("pinky_1")?.types).toEqual(["22", "22", "11"]);
    expect(record("pinky_1")?.keyValues[0]).toBe("4096");
    expect(record("pinky_1")?.keyValuesLong[0]).toBe("32768");
    expect(record("pinky_2")?.types[0]).toBe("23");
    expect(record("pinky_2")?.keyValues[0]).toBe("T2");
    const scroll = record("pinky_3");
    expect(scroll?.types[0]).toBe("35");
    expect([scroll?.x, scroll?.y, scroll?.interval, scroll?.yInterval]).toEqual([0, 1, 150, 100.5]);
    const stick = record("stick");
    expect(stick?.types[0]).toBe("40");
    expect(stick?.analogSettings?.mouseSensitivity).toBe(2);
  });

  it("comes back out of the export as the same bindings, and builds the same again", () => {
    const { game, profile, template, built } = build(onboard);
    const data = decompile(built, profile.device, { actions: game.actions });
    expect(data.positions.pinky_1?.tap).toEqual({ xbox: "A" });
    expect(data.positions.pinky_1?.long).toEqual({ xbox: "Y" });
    expect(data.positions.pinky_2?.tap).toEqual({ xbox: "RT" });
    expect(data.positions.pinky_3?.tap).toEqual({ wheel: "up", speed: 33 });
    expect(data.positions.stick?.mode).toBe("mouse");
    expect(data.positions.stick?.mouse_sensitivity).toBe(2);
    const again = compileProfile(new Profile(data, profile.device, { path: profile.path, game }), {
      template,
      actions: game.actions.actions,
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(built));
  });

  it("makes the stick an Xbox stick", () => {
    const { record } = build((positions) => {
      positions.stick = { mode: "xbox" };
    });
    expect(record("stick")?.types[0]).toBe("21");
  });

  it("refuses scroll on a long press, and mouse speed on a stick that is not the mouse", () => {
    expect(() =>
      build((positions) => {
        positions.pinky_3 = { long: { wheel: "down" } };
      }),
    ).toThrow(/tap only/);
    expect(() =>
      build((positions) => {
        positions.stick = { mode: "keyboard", mouse_sensitivity: 2 };
      }),
    ).toThrow(/mouse mode/);
  });

  it("goes to a unit byte for byte as the app sent the same bindings", () => {
    const { record } = build(onboard);
    const button = record("pinky_2");
    if (button === undefined) throw new Error("no record");
    // The app's trigger record and ours differ only in id and pin; the trigger block agrees.
    const ours = hex(encodeInputRecord(4, button)).slice(8, 8 + 14);
    const theirs = one("xinput", 10).wire.slice(8, 8 + 14);
    expect(ours).toBe(theirs);
  });
});

describe("reading a unit's slot that holds what this cannot decode", () => {
  it("keeps going rather than misreading the record or running off its end", () => {
    // A stored scroll record: its id, pins and types, then a layout not captured yet.
    const stored = Uint8Array.from([2, 4, 5, 255, 0x23, 6, 6, 0, 1, 0]);
    const input = decodeStoredRecord(stored);
    expect(input.undecoded).toBe(true);
    expect(input.types).toEqual(["35", "6", "6"]);
    const wanted = structuredClone(one("wheel-layer", 4).input);
    const differences = compareStored([wanted], {
      slot: 5,
      name: "Recon",
      inputs: [input],
      settings: null,
    });
    expect(differences.map((difference) => difference.field)).toContain("record");
  });

  it("reads an Xbox button and trigger back as the values that were written", () => {
    const record = new Uint8Array(68);
    record.set([2, 15, 24, 255, 0x16, 0x06, 0x06]);
    // Stored values are little-endian, unlike what OBM_COPY sends.
    record.set([0x00, 0x10], 7);
    const input = decodeStoredRecord(record);
    expect(input.keyValues[0]).toBe("4096");
    const wanted = structuredClone(one("xinput", 15).input);
    wanted.types = ["22", "6", "6"];
    const differences = compareStored([wanted], {
      slot: 4,
      name: "Recon",
      inputs: [input],
      settings: null,
    });
    expect(differences.filter((difference) => difference.field.startsWith("keyValues["))).toEqual(
      [],
    );
  });
});

describe("Everspace 2's rule that its stick is keyboard only", () => {
  it("still refuses the stick as an Xbox stick or as the mouse, now both are real modes", async () => {
    const { lintGame } = await import("../../../src/lib/lint.js");
    const game = new Game("games/SpaceSims/everspace");
    const profile = loadProfile("games/SpaceSims/everspace/profiles/single-v5.yaml", game);
    for (const mode of ["xbox", "mouse"]) {
      const data = structuredClone(profile.data);
      const stick = data.positions.stick;
      if (stick === undefined) throw new Error("no stick");
      stick.mode = mode;
      delete stick.raw;
      const edited = new Profile(data, profile.device, { path: profile.path, game });
      const { live } = lintGame(game, [edited]);
      expect(
        live.some((finding) => finding.rule === "stick-not-keyboard"),
        mode,
      ).toBe(true);
    }
  });
});
