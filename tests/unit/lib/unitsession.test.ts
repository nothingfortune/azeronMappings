/**
 * A session against a fake unit: who it is, writing a compiled layout into a slot, reading
 * it back, and saying so when the slot does not hold what was written.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import {
  Command,
  ProtocolError,
  encodeInputRecord,
  isWritableInput,
} from "../../../src/lib/unitproto.js";
import { UnitSession } from "../../../src/lib/unitsession.js";
import type { ExportDocument, ExportProfile } from "../../../src/types/azeron.js";
import { FakeUnit } from "../../helpers/fakeunit.js";

const compiled = (unit: "left" | "right"): ExportProfile => {
  const document = JSON.parse(
    readFileSync(repoPath(`dist/SpaceSims/everspace/everspace_akimbo_v10_${unit}.json`), "utf8"),
  ) as ExportDocument;
  const profile = document.profiles[0];
  if (!profile) throw new Error("no profile");
  return profile;
};
const UNKNOWN_PINS = [0, 28, 29];

describe("identifying a unit", () => {
  it("reads its id, hand, slot count and active slot", async () => {
    const identity = await new UnitSession(new FakeUnit()).identify();
    expect(identity).toMatchObject({
      firmware: 111,
      deviceId: 49229,
      isRightStick: false,
      profileLimit: 6,
      activeSlot: 2,
    });
    const right = await new UnitSession(
      new FakeUnit({ deviceId: 29993, isRightStick: true }),
    ).identify();
    expect(right).toMatchObject({ deviceId: 29993, isRightStick: true });
  });

  it("refuses firmware the protocol was not read from", async () => {
    await expect(new UnitSession(new FakeUnit({ firmware: 110 })).identify()).rejects.toThrow(
      /firmware 110/,
    );
  });

  it("says so when the unit stops answering", async () => {
    await expect(new UnitSession(new FakeUnit({ goSilentAfter: 1 })).identify()).rejects.toThrow(
      ProtocolError,
    );
  });
});

describe("writing a layout into a slot", () => {
  for (const unit of ["left", "right"] as const) {
    it(`writes the compiled akimbo ${unit} and reads back exactly that`, async () => {
      const fake = new FakeUnit();
      const profile = compiled(unit);
      const report = await new UnitSession(fake).writeProfile({
        slot: 3,
        name: "ES2 akimbo",
        profile,
        unknownPins: UNKNOWN_PINS,
      });
      expect(report.problems).toEqual([]);
      expect(report.stored.name).toBe("ES2 akimbo");
      const writable = profile.inputs.filter((input) => isWritableInput(input, UNKNOWN_PINS));
      expect(report.written).toBe(writable.length);
      expect(fake.slots.get(3)?.records.size).toBe(writable.length);
    });
  }

  it("sends each record exactly as encoded, in the app's order: check, name, records", async () => {
    const fake = new FakeUnit();
    const profile = compiled("left");
    await new UnitSession(fake).writeProfile({
      slot: 3,
      name: "ES2 akimbo",
      profile,
      unknownPins: UNKNOWN_PINS,
    });
    const commands = fake.received.map((report) => report[2]);
    expect(commands.slice(0, 2)).toEqual([Command.CHECK_PROFILE, Command.PROFILE_NAME]);
    const copies = fake.received.filter((report) => report[2] === Command.OBM_COPY);
    const first = profile.inputs.find((input) => isWritableInput(input, UNKNOWN_PINS));
    if (!first) throw new Error("nothing writable");
    const record = encodeInputRecord(3, first);
    expect(Array.from(copies[0]?.slice(7, 7 + 57) ?? [])).toEqual(Array.from(record.slice(0, 57)));
  });

  it("never sends pin 0, the unknown pins, or an unbound slot", async () => {
    const fake = new FakeUnit();
    await new UnitSession(fake).writeProfile({
      slot: 3,
      name: "ES2 akimbo",
      profile: compiled("left"),
      unknownPins: UNKNOWN_PINS,
    });
    const pins = fake.received
      .filter((report) => report[2] === Command.OBM_COPY && report[5] === 1)
      .map((report) => report[9]);
    for (const pin of [0, 28, 29, 255]) expect(pins).not.toContain(pin);
  });

  it("reports a slot that holds something other than what was written", async () => {
    // Input 7's tap key comes back as something else.
    const fake = new FakeUnit({
      corrupt: (id, stored) => {
        if (id === 7) stored[8] = 0x05;
      },
    });
    const report = await new UnitSession(fake).writeProfile({
      slot: 3,
      name: "ES2 akimbo",
      profile: compiled("left"),
      unknownPins: UNKNOWN_PINS,
    });
    expect(report.problems.some((problem) => problem.startsWith("input 7 "))).toBe(true);
  });

  it("refuses before sending anything when the profile cannot be written", async () => {
    const fake = new FakeUnit();
    const session = new UnitSession(fake);
    const profile = compiled("left");
    await expect(
      session.writeProfile({
        slot: 3,
        name: "a name far too long for the unit",
        profile,
        unknownPins: UNKNOWN_PINS,
      }),
    ).rejects.toThrow(/1 to 19/);
    const broken = {
      ...profile,
      inputs: profile.inputs.map((input) =>
        input.id === 1
          ? { ...input, types: ["1", "11", "11"], keyValues: ["IntlBackslash", "0", "0", "0"] }
          : input,
      ),
    };
    await expect(
      session.writeProfile({
        slot: 3,
        name: "ES2 akimbo",
        profile: broken,
        unknownPins: UNKNOWN_PINS,
      }),
    ).rejects.toThrow(/IntlBackslash/);
    expect(fake.received).toEqual([]);
  });
});

describe("reading the slots", () => {
  it("lists every slot by name", async () => {
    const fake = new FakeUnit();
    const session = new UnitSession(fake);
    await session.writeProfile({
      slot: 0,
      name: "first",
      profile: compiled("left"),
      unknownPins: UNKNOWN_PINS,
    });
    await session.writeProfile({
      slot: 1,
      name: "second",
      profile: compiled("right"),
      unknownPins: UNKNOWN_PINS,
    });
    const all = await session.readAll();
    expect(all.map((profile) => [profile.slot, profile.name])).toEqual([
      [0, "first"],
      [1, "second"],
    ]);
  });
});
