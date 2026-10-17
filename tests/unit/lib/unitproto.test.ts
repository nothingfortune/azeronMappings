/**
 * The unit protocol against what the Azeron app itself put on the wire.
 *
 * The fixtures are frozen captures (tests/fixtures/unit-protocol): the app writing a
 * profile into slot 3 of the left unit, and the app reading profiles back with its own
 * decoding of them beside the bytes. Encoding must reproduce the app's reports byte for
 * byte; decoding must reproduce the app's JSON. A failure means this module disagrees with
 * the app, and the capture is the reference, not the thing to change.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  Command,
  ProfileStream,
  ProtocolError,
  encodeInputRecord,
  hostReports,
  isWritableInput,
  keyCode,
  parseDeviceReport,
  profileNamePayload,
} from "../../../src/lib/unitproto.js";
import type { StoredInput, StoredProfile } from "../../../src/lib/unitproto.js";
import type { InputRecord } from "../../../src/types/azeron.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/fixtures/unit-protocol/${name}`, "utf8"));

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const bytes = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, "hex"));

interface WriteCapture {
  checkProfile: string;
  profileName: string;
  copies: { slot: number; input: InputRecord; frames: string[] }[];
}
interface ReadCapture {
  frames: string[];
  decoded: {
    id: string;
    name: string;
    inputs: Record<string, unknown>[];
    profileSettings: {
      profileSensitivitySettings: { sensitivityValues: number[] };
      ledSettings: { isLedsOn: boolean[]; ledEffect: number; ledBrightness: number };
    };
  }[];
}

const write = fixture("write-slot3.json") as WriteCapture;

function readStream(capture: ReadCapture): StoredProfile[] {
  const stream = new ProfileStream();
  for (const frame of capture.frames) stream.push(parseDeviceReport(bytes(frame)));
  expect(stream.done).toBe(true);
  return stream.result();
}

describe("writing a profile, against the app's own write", () => {
  it("frames every input exactly as the app did", () => {
    for (const copy of write.copies) {
      const first = bytes(copy.frames[0] ?? "");
      const record = encodeInputRecord(copy.slot, copy.input);
      const reports = hostReports(Command.OBM_COPY, first[3] ?? 0, record);
      expect(reports.map(hex), `input ${String(copy.input.id)}`).toEqual(copy.frames);
    }
  });

  it("covers keys, modifiers, mouse buttons, media keys, every trigger and the stick", () => {
    const types = new Set(write.copies.flatMap((copy) => copy.input.types));
    expect([...types].sort()).toEqual(["1", "11", "15", "4"]);
    expect(write.copies).toHaveLength(31);
  });

  it("names the slot and checks it the way the app did", () => {
    const name = bytes(write.profileName);
    expect(
      hex(
        hostReports(
          Command.PROFILE_NAME,
          name[3] ?? 0,
          profileNamePayload(3, "RE all fields"),
        )[0] ?? new Uint8Array(),
      ),
    ).toBe(write.profileName);
    const check = bytes(write.checkProfile);
    expect(
      hex(
        hostReports(Command.CHECK_PROFILE, check[3] ?? 0, Uint8Array.of(3))[0] ?? new Uint8Array(),
      ),
    ).toBe(write.checkProfile);
  });

  it("skips what the app skips: no pin, the profile switch, unknown pins and types", () => {
    const base = write.copies[0]?.input;
    if (!base) throw new Error("no input");
    expect(isWritableInput({ ...base, pinOne: 255 })).toBe(false);
    expect(isWritableInput({ ...base, pinOne: 0, types: ["2", "11", "11"] })).toBe(false);
    expect(isWritableInput({ ...base, pinOne: 28 }, [0, 28, 29])).toBe(false);
    expect(isWritableInput({ ...base, types: ["29", "11", "11"] })).toBe(false);
    expect(isWritableInput(base)).toBe(true);
  });
});

describe("refusals", () => {
  it("will not build a report for reset, DFU, the device id or the details save", () => {
    for (const command of [
      Command.RESET,
      Command.DFU,
      Command.UPDATE_DEVICE_ID,
      Command.KEYPAD_DETAILS_SAVE,
      Command.BUTTON_BIND,
    ]) {
      expect(() => hostReports(command, 0, new Uint8Array())).toThrow(ProtocolError);
    }
  });

  it("refuses a key the unit has no code for, rather than sending something else", () => {
    expect(() => keyCode("IntlBackslash")).toThrow(ProtocolError);
    expect(keyCode("16")).toBe(0xe002);
    expect(keyCode("37")).toBe(0xf050);
    expect(keyCode("0")).toBe(0);
  });

  it("refuses a value that does not fit the byte the unit keeps it in", () => {
    const base = write.copies[0]?.input;
    if (!base) throw new Error("no input");
    expect(() => encodeInputRecord(3, { ...base, isTurbo: true, turboInterval: 300 })).toThrow(
      /one byte/,
    );
  });

  it("refuses a name the unit would cut short", () => {
    expect(() => profileNamePayload(0, "Everspace 2 akimbo v10 (L)")).toThrow(/1 to 19/);
    expect(() => profileNamePayload(0, "")).toThrow(ProtocolError);
  });
});

/** The fields the app's decoding and ours both state, for an input. */
function keyFields(input: StoredInput | Record<string, unknown>): Record<string, unknown> {
  const pick = input as Record<string, unknown>;
  const fields = [
    "id",
    "pinOne",
    "pinTwo",
    "types",
    "keyValues",
    "metaValues",
    "keyValuesLong",
    "metaValuesLong",
    "keyValuesDouble",
    "metaValuesDouble",
    "isHold",
    "isHoldLong",
    "isHoldDouble",
    "holdTime",
    "holdTimeLong",
    "holdTimeDouble",
    "isTurbo",
    "isTurboLong",
    "isTurboDouble",
    "turboInterval",
    "turboIntervalLong",
    "turboIntervalDouble",
  ];
  const out: Record<string, unknown> = {};
  for (const field of fields) out[field] = pick[field];
  if (pick.types && (pick.types as string[])[0] !== "4") {
    out.featureDelay = pick.featureDelay;
    out.doubleDelay = pick.doubleDelay;
  }
  return out;
}

describe("reading profiles, against the app's own decoding", () => {
  for (const name of ["read-all.json", "read-slot3.json"]) {
    it(`decodes ${name} to what the app showed`, () => {
      const capture = fixture(name) as ReadCapture;
      const profiles = readStream(capture);
      expect(profiles.map((p) => [String(p.slot), p.name])).toEqual(
        capture.decoded.map((p) => [p.id, p.name]),
      );
      profiles.forEach((profile, index) => {
        const app = capture.decoded[index];
        if (!app) throw new Error("no profile");
        const ours = profile.inputs.filter((input) => input.types[0] !== "4").map(keyFields);
        const theirs = app.inputs
          .filter((input) => (input.types as string[])[0] !== "4")
          .map(keyFields);
        expect(ours).toEqual(theirs);
      });
    });
  }

  for (const name of ["read-all.json", "read-slot3.json"]) {
    it(`decodes each slot's settings in ${name} as the app does, as far as they are known`, () => {
      const capture = fixture(name) as ReadCapture;
      const profiles = readStream(capture);
      expect(profiles).toHaveLength(capture.decoded.length);
      profiles.forEach((profile, index) => {
        const app = capture.decoded[index]?.profileSettings;
        if (!app || !profile.settings) throw new Error(`no settings for ${profile.name}`);
        expect(profile.settings.sensitivityValues).toEqual(
          app.profileSensitivitySettings.sensitivityValues,
        );
        expect(profile.settings.isLedsOn).toEqual(app.ledSettings.isLedsOn);
        expect(profile.settings.ledEffect).toBe(app.ledSettings.ledEffect);
        expect(profile.settings.ledBrightness).toBe(app.ledSettings.ledBrightness);
        expect(profile.settings.raw).toHaveLength(32);
      });
    });
  }

  it("decodes the stick's tuning and keys as the app does", () => {
    const capture = fixture("read-slot3.json") as ReadCapture;
    const stick = readStream(capture)[0]?.inputs.find((input) => input.stick);
    const app = capture.decoded[0]?.inputs.find((input) => (input.types as string[])[0] === "4");
    if (!stick?.stick || !app) throw new Error("no stick");
    const a = app.analogSettings as Record<string, unknown>;
    const s = stick.stick;
    expect([s.upperLimit, s.lowerLimit, s.angle, s.sensitivity]).toEqual([
      a.upperLimit,
      a.lowerLimit,
      a.angle,
      a.sensitivity,
    ]);
    const cones = a.analogCones as { verticalCone: number; horizontalCone: number };
    expect(s.cones).toEqual([cones.verticalCone, cones.horizontalCone]);
    expect([
      s.mouseSensitivity,
      s.analogThrottle,
      s.triggerMagnitude,
      s.combinedAnalogMagnitude,
      s.holdMagnitude,
      String(s.holdType),
    ]).toEqual([
      a.mouseSensitivity,
      a.analogThrottle,
      a.triggerMagnitude,
      a.combinedAnalogMagnitude,
      a.holdMagnitude,
      a.holdType,
    ]);
    expect([s.rotateStickButtonId, s.lockZoneAngle, s.lockZoneSize]).toEqual([
      a.rotateStickButtonId,
      a.lockZoneAngle,
      a.lockZoneSize,
    ]);
    const keys = a.analogKeys as Record<string, Record<string, unknown[]>>;
    expect(s.keys[0]?.[0]).toBe(keys.left?.up?.[0]);
    expect(s.keys[7]?.[0]).toBe(keys.right?.left?.[0]);
    // isCombinedAnalog, isHoldTrigger, isAngleLock and invertXAxis were all set: four bits.
    expect(s.flags.toString(2).replace(/0/g, "")).toHaveLength(4);
  });
});
