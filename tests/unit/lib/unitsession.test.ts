/**
 * A session against a fake unit that behaves as the real ones did on 2026-10-15: it adds a
 * slot only when asked for the next free one, renames only slots it has, and answers
 * REQUEST_PROFILE with the slot it is running whatever it is asked.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import { Command, isWritableInput } from "../../../src/lib/unitproto.js";
import { UnitError, UnitSession } from "../../../src/lib/unitsession.js";
import { hostReports } from "../../../src/lib/unitproto.js";
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

/** A unit as it comes: three slots on it, running the third. */
function unit(
  side: "left" | "right" = "left",
  options: ConstructorParameters<typeof FakeUnit>[0] = {},
): FakeUnit {
  const fake = new FakeUnit({ deviceId: side === "left" ? 49229 : 29993, ...options });
  for (const name of ["Basic", "Joystick", "Everspace 2 akimbo"])
    fake.seed(name, compiled(side).inputs);
  return fake;
}

async function ready(fake: FakeUnit): Promise<UnitSession> {
  const session = new UnitSession(fake);
  await session.identify();
  await session.readAll();
  fake.received.length = 0;
  return session;
}

const commands = (fake: FakeUnit): number[] => fake.received.map((report) => report[2] ?? 0);

describe("identifying a unit", () => {
  it("reads its id, slot count and the slot it is running", async () => {
    const identity = await new UnitSession(unit()).identify();
    expect(identity).toEqual({
      firmware: 111,
      keypadType: 8,
      deviceId: 49229,
      profileLimit: 6,
      activeSlot: 2,
    });
  });

  it("refuses firmware the protocol was not read from", async () => {
    await expect(new UnitSession(unit("left", { firmware: 110 })).identify()).rejects.toThrow(
      /firmware 110/,
    );
  });

  it("says so when the unit stops answering", async () => {
    await expect(new UnitSession(unit("left", { goSilentAfter: 1 })).identify()).rejects.toThrow(
      UnitError,
    );
  });
});

describe("writing a layout into a slot", () => {
  const plan = (slot: number, side: "left" | "right" = "left") => ({
    slot,
    name: "ES2 akimbo",
    profile: compiled(side),
    unknownPins: UNKNOWN_PINS,
  });

  it("will not write before it has read the slots", async () => {
    const fake = unit();
    const session = new UnitSession(fake);
    await session.identify();
    await expect(session.writeProfile(plan(2))).rejects.toThrow(/read the unit's slots/);
  });

  it("writes over a slot that exists without asking to add one", async () => {
    const fake = unit();
    const report = await (await ready(fake)).writeProfile(plan(1));
    expect(report.problems).toEqual([]);
    expect(commands(fake)).not.toContain(Command.CHECK_PROFILE);
    expect(commands(fake)[0]).toBe(Command.PROFILE_NAME);
    expect(fake.slots.get(1)?.name).toBe("ES2 akimbo");
  });

  it("adds a slot after the last, the way the app does", async () => {
    const fake = unit();
    const report = await (await ready(fake)).writeProfile(plan(3));
    expect(report.problems).toEqual([]);
    expect(commands(fake).slice(0, 2)).toEqual([Command.CHECK_PROFILE, Command.PROFILE_NAME]);
    expect(fake.slots.size).toBe(4);
  });

  it("refuses a slot past the end, before sending anything", async () => {
    const fake = unit();
    const session = await ready(fake);
    await expect(session.writeProfile(plan(4))).rejects.toThrow(/past the end/);
    await expect(session.writeProfile(plan(6))).rejects.toThrow(/past the end/);
    expect(fake.received).toEqual([]);
  });

  it("checks the slot it wrote, not the one the unit is running", async () => {
    const fake = unit();
    const report = await (await ready(fake)).writeProfile(plan(0));
    expect(report.stored.slot).toBe(0);
    expect(commands(fake)).not.toContain(Command.REQUEST_PROFILE);
  });

  for (const side of ["left", "right"] as const) {
    it(`writes the compiled akimbo ${side} and reads back exactly that`, async () => {
      const fake = unit(side);
      const report = await (await ready(fake)).writeProfile(plan(2, side));
      expect(report.problems).toEqual([]);
      const writable = compiled(side).inputs.filter((input) =>
        isWritableInput(input, UNKNOWN_PINS),
      );
      expect(report.written).toBe(writable.length);
    });
  }

  it("reports a stick whose inversion came back on the other axis", async () => {
    // The right layout inverts X; a unit holding Y inverted instead is a different stick.
    const fake = unit("right", {
      corrupt: (_id, stored) => {
        if (stored[4] !== 4) return;
        const at = stored.length - 16;
        stored[at] = ((stored[at] ?? 0) & ~0x08) | 0x10;
      },
    });
    const report = await (await ready(fake)).writeProfile(plan(2, "right"));
    expect(report.problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/invertXAxis is false/),
        expect.stringMatching(/invertYAxis is true/),
      ]),
    );
  });

  it("reports a key that came back as something else", async () => {
    const fake = unit("left", {
      corrupt: (id, stored) => {
        if (id === 7) stored[8] = 0x05;
      },
    });
    const report = await (await ready(fake)).writeProfile(plan(2));
    expect(report.problems.some((problem) => problem.startsWith("input 7 "))).toBe(true);
  });

  it("refuses before sending anything when the profile cannot be written", async () => {
    const fake = unit();
    const session = await ready(fake);
    await expect(
      session.writeProfile({ ...plan(2), name: "a name far too long for the unit" }),
    ).rejects.toThrow(/1 to 19/);
    const broken = {
      ...compiled("left"),
      inputs: compiled("left").inputs.map((input) =>
        input.id === 1
          ? { ...input, types: ["1", "11", "11"], keyValues: ["IntlBackslash", "0", "0", "0"] }
          : input,
      ),
    };
    await expect(session.writeProfile({ ...plan(2), profile: broken })).rejects.toThrow(
      /IntlBackslash/,
    );
    expect(fake.received).toEqual([]);
  });
});

describe("reading the slots", () => {
  it("lists every slot by name", async () => {
    const all = await new UnitSession(unit()).readAll();
    expect(all.map((profile) => [profile.slot, profile.name])).toEqual([
      [0, "Basic"],
      [1, "Joystick"],
      [2, "Everspace 2 akimbo"],
    ]);
  });
});

describe("when things go wrong", () => {
  const plan = (slot: number) => ({
    slot,
    name: "ES2 akimbo",
    profile: compiled("left"),
    unknownPins: UNKNOWN_PINS,
  });

  it("asks again, once, when the answer to a read goes missing", async () => {
    const lines: string[] = [];
    const identity = await new UnitSession(unit("left", { loseOnce: [Command.FIRMWARE_VERSION] }), {
      log: (line) => lines.push(line),
    }).identify();
    expect(identity.deviceId).toBe(49229);
    expect(lines).toContain("no answer to FIRMWARE_VERSION; trying once more");
  });

  it("sends an input record again when its answer goes missing, and the slot still reads back right", async () => {
    const fake = unit("left", { loseOnce: [Command.OBM_COPY] });
    const report = await (await ready(fake)).writeProfile(plan(2));
    expect(report.problems).toEqual([]);
  });

  it("never asks twice to add a slot: a lost answer may mean it was added", async () => {
    const fake = unit("left", { loseOnce: [Command.CHECK_PROFILE] });
    const session = await ready(fake);
    const failure = await session.writeProfile(plan(3)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UnitError);
    expect((failure as UnitError).kind).toBe("no-answer");
    expect((failure as UnitError).message).toMatch(/did not add slot 3; nothing else was sent/);
    expect(fake.received.filter((report) => report[2] === Command.CHECK_PROFILE)).toHaveLength(1);
    expect(fake.received.some((report) => report[2] === Command.PROFILE_NAME)).toBe(false);
  });

  it("says which step it was on and how much went in when the unit goes quiet mid-write", async () => {
    const fake = unit("left");
    const session = await ready(fake);
    // Quiet after the rename and ten reports of records.
    (fake as unknown as { options: { goSilentAfter: number } }).options.goSilentAfter = 12;
    const failure = (await session
      .writeProfile(plan(2))
      .catch((error: unknown) => error)) as UnitError;
    expect(failure).toBeInstanceOf(UnitError);
    expect(failure.kind).toBe("no-answer");
    expect(failure.step).toMatch(/^writing input \d+ \(\d+ of 31\)$/);
    expect(failure.written).toBeGreaterThan(0);
    expect(failure.written).toBeLessThan(31);
  });

  it("says the unit went away when sending fails", async () => {
    const fake = unit("left");
    const session = await ready(fake);
    fake.send = () => Promise.reject(new Error("The device was disconnected."));
    const failure = (await session.readAll().catch((error: unknown) => error)) as UnitError;
    expect(failure.kind).toBe("transport");
    expect(failure.message).toMatch(/disconnected/);
  });

  it("does one thing at a time, even when asked for two at once", async () => {
    const fake = unit("left");
    const session = await ready(fake);
    const [first, second] = await Promise.all([session.readAll(), session.readAll()]);
    expect(first.map((slot) => slot.name)).toEqual(second.map((slot) => slot.name));
  });

  it("keeps a trace of every report, out and in", async () => {
    const trace: string[] = [];
    await new UnitSession(unit(), { trace: (line) => trace.push(line) }).identify();
    expect(trace[0]).toMatch(/^→ FIRMWARE_VERSION 000005/);
    expect(trace.some((line) => line.startsWith("← FIRMWARE_VERSION"))).toBe(true);
  });
});

describe("switching the slot the unit runs", () => {
  it("sends SWITCH_PROFILE as the app did, and checks the unit took it", async () => {
    // The app picking slot 3 on 2026-10-14: 00 01 1a 8f 01 01 01 03, zero padded.
    const app = new Uint8Array(64);
    app.set([0x00, 0x01, 0x1a, 0x8f, 0x01, 0x01, 0x01, 0x03]);
    expect(hostReports(Command.SWITCH_PROFILE, 0x8f, Uint8Array.of(3))[0]).toEqual(app);

    const fake = unit();
    const session = await ready(fake);
    expect(await session.switchTo(0)).toBe(0);
    expect((await session.identify()).activeSlot).toBe(0);
  });
});

describe("a unit that is less tidy than the fake usually is", () => {
  const plan = (slot: number, side: "left" | "right" = "left") => ({
    slot,
    name: "ES2 akimbo",
    profile: compiled(side),
    unknownPins: UNKNOWN_PINS,
  });

  it("passes over what the unit says unasked, mixed into every answer", async () => {
    const fake = unit("left", { chatter: true });
    const session = new UnitSession(fake);
    expect((await session.identify()).deviceId).toBe(49229);
    expect(await session.readAll()).toHaveLength(3);
    expect((await session.writeProfile(plan(2))).problems).toEqual([]);
  });

  it("tells a late answer to an earlier part from the answer it is waiting for", async () => {
    const trace: string[] = [];
    const fake = unit("left", { lateFirstRecord: true });
    const session = new UnitSession(fake, { trace: (line) => trace.push(line) });
    await session.identify();
    await session.readAll();
    const report = await session.writeProfile(plan(2));
    expect(report.problems).toEqual([]);
    expect(trace.some((line) => line.includes("a late answer"))).toBe(true);
  });

  it("can still read and write a unit after a new slot was added and the write stopped", async () => {
    const fake = unit();
    const session = await ready(fake);
    // The unit adds slot 3, then the next report never gets there.
    const send = fake.send.bind(fake);
    fake.send = (report: Uint8Array) =>
      report[2] === Command.PROFILE_NAME
        ? Promise.reject(new Error("The device was disconnected."))
        : send(report);
    await expect(session.writeProfile(plan(3))).rejects.toThrow(UnitError);
    fake.send = send;
    const slots = await session.readAll();
    expect(slots.map((slot) => [slot.slot, slot.inputs.length])).toEqual([
      [0, 31],
      [1, 31],
      [2, 31],
      [3, 0],
    ]);
    expect((await session.writeProfile(plan(3))).problems).toEqual([]);
  });

  it("says everything went in when only the reading back failed", async () => {
    const fake = unit();
    const session = await ready(fake);
    const send = fake.send.bind(fake);
    fake.send = (report: Uint8Array) =>
      report[2] === Command.PROFILE_PAYLOAD_V2
        ? Promise.reject(new Error("The device was disconnected."))
        : send(report);
    const failure = (await session
      .writeProfile(plan(2))
      .catch((error: unknown) => error)) as UnitError;
    expect(failure.step).toBe("reading the slot back");
    expect(failure.written).toBe(31);
    expect(failure.message).toMatch(/^all 31 inputs were written/);
  });

  it("sees a stick's hold key that differs from the layout's", async () => {
    // As the app's older write left the real slots: the hold key stored as ShiftLeft's code.
    const fake = unit("left", {
      corrupt: (_id, stored) => {
        if (stored[4] !== 4) return;
        const at = stored.length - 12;
        stored[at] = 0x02;
        stored[at + 1] = 0xe0;
      },
    });
    const report = await (await ready(fake)).writeProfile(plan(2));
    expect(
      report.problems.some((problem) => problem.includes("holdKeyValues[0] is 57346, not 16")),
    ).toBe(true);
  });
});
