/**
 * The press test, put straight onto the units: no file to download, nothing to import.
 *
 * Each unit gets two slots, one per pass of the test, written and read back like any
 * layout (`UnitSession.writeProfile`). The pass the page is on decides which of the two
 * the unit runs, so pressing Pins or Stick zero on the page is all the switching there is.
 * Taking the test off deletes both slots again; a probe left on a unit is a trap, because
 * its profile button cycles onto it and every key then sends a probe key.
 */

import { nextFreeSlot } from "../lib/unitsession.js";
import type { UnitIdentity, UnitSession } from "../lib/unitsession.js";
import type { StoredProfile } from "../lib/unitproto.js";
import type { ExportProfile } from "../types/azeron.js";

export type ProbePass = "pins" | "zero";

/** What each pass's slot is called on the unit. Both fit its 19 characters. */
export const PROBE_SLOT_NAMES: Record<ProbePass, string> = {
  pins: "PROBE 1 pins",
  zero: "PROBE 2 stick zero",
};

const PASSES: readonly ProbePass[] = ["pins", "zero"];

/** The part of an open unit the press test uses. */
export interface ProbeUnit {
  session: UnitSession;
  identity: UnitIdentity;
  slots: StoredProfile[];
}

/** One unit's two probe profiles, built on that unit's own export. */
export interface ProbeProfiles {
  pins: ExportProfile;
  zero: ExportProfile;
  /** The device map's `unknown_pins`, which are never written. */
  unknownPins: readonly number[];
}

function isProbeName(name: string): boolean {
  return Object.values(PROBE_SLOT_NAMES).includes(name);
}

/** The slot holding a pass, or null when the unit does not have it. */
export function probeSlot(unit: ProbeUnit, pass: ProbePass): number | null {
  return unit.slots.find((slot) => slot.name === PROBE_SLOT_NAMES[pass])?.slot ?? null;
}

/** Whether any probe is on the unit. */
export function holdsProbe(unit: ProbeUnit): boolean {
  return unit.slots.some((slot) => isProbeName(slot.name));
}

/** Slots a full unit would need freed: how many the press test needs that it has not got. */
export function slotsShort(unit: ProbeUnit): number {
  const missing = PASSES.filter((pass) => probeSlot(unit, pass) === null).length;
  const free = unit.identity.profileLimit - unit.slots.length;
  return Math.max(0, missing - free);
}

export interface PutReport {
  /** Every way a slot read back differs from what was written. Empty is success. */
  problems: string[];
  /** The slot the unit runs afterwards, or null when it was not switched. */
  running: number | null;
}

/**
 * Writes both passes onto the unit -- over a slot that already has a pass's name, or into
 * the next free one -- reads each back, and runs the one for `pass`. Refuses before
 * writing anything when the unit has no room for both.
 */
export async function putProbes(
  unit: ProbeUnit,
  profiles: ProbeProfiles,
  pass: ProbePass,
): Promise<PutReport> {
  const short = slotsShort(unit);
  if (short > 0) {
    throw new Error(
      `the unit's ${String(unit.identity.profileLimit)} slots are all in use: delete ` +
        `${short === 1 ? "one" : String(short)} with Write to units, then try again`,
    );
  }
  const problems: string[] = [];
  for (const each of PASSES) {
    const held = new Set(unit.slots.map((slot) => slot.slot));
    const slot = probeSlot(unit, each) ?? nextFreeSlot(held, unit.identity.profileLimit);
    if (slot === null) throw new Error("the unit has no free slot");
    const report = await unit.session.writeProfile({
      slot,
      name: PROBE_SLOT_NAMES[each],
      profile: each === "pins" ? profiles.pins : profiles.zero,
      unknownPins: profiles.unknownPins,
    });
    unit.slots = [...unit.slots.filter((entry) => entry.slot !== slot), report.stored].sort(
      (a, b) => a.slot - b.slot,
    );
    problems.push(...report.problems.map((problem) => `${PROBE_SLOT_NAMES[each]}: ${problem}`));
  }
  // A probe that did not read back as written is not one to press keys on.
  const running = problems.length === 0 ? await runProbe(unit, pass) : null;
  return { problems, running };
}

/** Makes the unit run a pass's slot. Asks which it runs first: the button may have moved it. */
export async function runProbe(unit: ProbeUnit, pass: ProbePass): Promise<number> {
  const slot = probeSlot(unit, pass);
  if (slot === null) throw new Error(`the unit has no ${PROBE_SLOT_NAMES[pass]} slot`);
  const running = await unit.session.runningSlot();
  return running === slot ? running : unit.session.switchTo(slot);
}

export interface RemoveReport {
  /** The slots deleted. */
  removed: number[];
  /** The slot the unit was switched to first, when it was running a probe. */
  switchedTo: number | null;
}

/**
 * Deletes both probe slots. The unit cannot delete the slot it runs, so when it is on a
 * probe it is first switched to its lowest other slot. A unit holding nothing but probes
 * keeps one, since a unit with no slot at all is not something anyone has seen.
 */
export async function removeProbes(unit: ProbeUnit): Promise<RemoveReport> {
  const probes = unit.slots.filter((slot) => isProbeName(slot.name)).map((slot) => slot.slot);
  if (probes.length === 0) return { removed: [], switchedTo: null };
  const others = unit.slots.filter((slot) => !isProbeName(slot.name)).map((slot) => slot.slot);
  const home = others[0];
  if (home === undefined) {
    throw new Error("the unit holds nothing but the press test, so there is nothing to keep");
  }
  let switchedTo: number | null = null;
  const running = await unit.session.runningSlot();
  if (probes.includes(running)) switchedTo = await unit.session.switchTo(home);
  const removed: number[] = [];
  for (const slot of probes) {
    unit.slots = await unit.session.deleteSlot(slot);
    removed.push(slot);
  }
  return { removed, switchedTo };
}
