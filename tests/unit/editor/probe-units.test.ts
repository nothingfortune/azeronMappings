/**
 * The press test written straight onto a unit, against the fake unit, which refuses what
 * the real ones refused: deleting the slot it runs, adding a slot out of turn.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import {
  holdsProbe,
  PROBE_SLOT_NAMES,
  probeSlot,
  putProbes,
  removeProbes,
  runProbe,
  slotsShort,
} from "../../../src/editor/probe-units.js";
import type { ProbeProfiles, ProbeUnit } from "../../../src/editor/probe-units.js";
import { buildProbeProfile, buildStickCalibrationProfile } from "../../../src/lib/probe.js";
import { UnitSession } from "../../../src/lib/unitsession.js";
import type { ExportDocument, ExportProfile } from "../../../src/types/azeron.js";
import { FakeUnit } from "../../helpers/fakeunit.js";

const UNKNOWN_PINS = [0, 28, 29];

function template(side: "left" | "right"): ExportDocument {
  return JSON.parse(
    readFileSync(repoPath(`templates/everspace2-akimbo-${side}.json`), "utf8"),
  ) as ExportDocument;
}

function only(doc: ExportDocument): ExportProfile {
  const profile = doc.profiles[0];
  if (!profile) throw new Error("no profile");
  return profile;
}

function probes(side: "left" | "right" = "left"): ProbeProfiles {
  const base = template(side);
  return {
    pins: only(buildProbeProfile(base, { id: "a", name: "p", unknownPins: UNKNOWN_PINS }).doc),
    zero: only(buildStickCalibrationProfile(base, { id: "b", name: "z" }).doc),
    unknownPins: UNKNOWN_PINS,
  };
}

/** A unit with its own layouts on it, running the second. */
async function open(
  names: string[] = ["Basic", "Everspace"],
  options: ConstructorParameters<typeof FakeUnit>[0] = {},
): Promise<{ fake: FakeUnit; unit: ProbeUnit }> {
  const fake = new FakeUnit({ activeSlot: 1, ...options });
  for (const name of names) fake.seed(name, only(template("left")).inputs);
  const session = new UnitSession(fake);
  const identity = await session.identify();
  const slots = await session.readAll();
  return { fake, unit: { session, identity, slots } };
}

describe("putting the press test on a unit", () => {
  it("writes both passes into free slots, reads them back, and runs the one asked for", async () => {
    const { unit } = await open();
    const report = await putProbes(unit, probes(), "pins");
    expect(report.problems).toEqual([]);
    expect(probeSlot(unit, "pins")).toBe(2);
    expect(probeSlot(unit, "zero")).toBe(3);
    expect(report.running).toBe(2);
    expect(await unit.session.runningSlot()).toBe(2);
    // The unit's own layouts are where they were.
    expect(unit.slots.map((slot) => slot.name)).toEqual([
      "Basic",
      "Everspace",
      PROBE_SLOT_NAMES.pins,
      PROBE_SLOT_NAMES.zero,
    ]);
  });

  it("writes over a probe already there rather than adding another", async () => {
    const { unit } = await open();
    await putProbes(unit, probes(), "pins");
    await putProbes(unit, probes(), "zero");
    expect(unit.slots).toHaveLength(4);
    expect(await unit.session.runningSlot()).toBe(probeSlot(unit, "zero"));
  });

  it("puts the right unit's probe on the right unit's export, stick block and all", async () => {
    const { unit } = await open();
    const report = await putProbes(unit, probes("right"), "zero");
    expect(report.problems).toEqual([]);
  });

  it("switches between the passes as the page does", async () => {
    const { unit } = await open();
    await putProbes(unit, probes(), "pins");
    expect(await runProbe(unit, "zero")).toBe(probeSlot(unit, "zero"));
    expect(await runProbe(unit, "pins")).toBe(probeSlot(unit, "pins"));
  });

  it("refuses a unit with no room, before writing anything", async () => {
    const { fake, unit } = await open(["A", "B", "C", "D", "E"]);
    expect(slotsShort(unit)).toBe(1);
    fake.received.length = 0;
    await expect(putProbes(unit, probes(), "pins")).rejects.toThrow(/delete one/);
    expect(fake.received).toEqual([]);
    expect(fake.slots.size).toBe(5);
  });
});

describe("taking the press test off", () => {
  it("switches away from a probe it runs, then deletes both", async () => {
    const { fake, unit } = await open();
    await putProbes(unit, probes(), "pins");
    const report = await removeProbes(unit);
    expect(report).toEqual({ removed: [2, 3], switchedTo: 0 });
    expect(holdsProbe(unit)).toBe(false);
    expect([...fake.slots.values()].map((slot) => slot.name)).toEqual(["Basic", "Everspace"]);
  });

  it("leaves the unit on the slot it runs when that is not a probe", async () => {
    const { fake, unit } = await open();
    await putProbes(unit, probes(), "pins");
    fake.pressProfileButton(1);
    expect(await removeProbes(unit)).toEqual({ removed: [2, 3], switchedTo: null });
    expect(await unit.session.runningSlot()).toBe(1);
  });

  it("does nothing to a unit with no probe on it", async () => {
    const { fake, unit } = await open();
    fake.received.length = 0;
    expect(await removeProbes(unit)).toEqual({ removed: [], switchedTo: null });
    expect(fake.received).toEqual([]);
  });

  it("refuses to leave a unit with no slot at all", async () => {
    const { unit } = await open([PROBE_SLOT_NAMES.pins, PROBE_SLOT_NAMES.zero], { activeSlot: 0 });
    await expect(removeProbes(unit)).rejects.toThrow(/nothing to keep/);
  });
});
