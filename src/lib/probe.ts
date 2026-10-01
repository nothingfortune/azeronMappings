/**
 * Press-test support: a profile binding every pin to a distinct key, and the device map
 * derived from pressing them.
 *
 * The Azeron software is built for a left-handed unit; a mirrored unit does not
 * necessarily report the same pins. The map is established by observation rather than
 * inferred from the left-handed layout.
 */

import type { ExportDocument, StickDirection, StickSector } from "../types/azeron.js";
import {
  isRebindableRecord,
  SECTOR_DEGREES,
  STICK_DIRECTIONS,
  STICK_SECTORS,
  TYPE_KEYBOARD,
  TYPE_STICK_KEYBOARD,
  activeAnalogKeys,
} from "../types/azeron.js";
import type { DeviceData, DevicePosition } from "../types/profile.js";
import { blankRecord } from "./binding.js";
import * as keys from "./keys.js";

/**
 * Distinguishable probe keys. Letters and digits are ordered first as the encodings
 * verified to be emitted by a Cyborg II; the F13+ tail is allocated last, so an
 * unsupported encoding falls on unidentified pins.
 */
export const PROBE_KEYS: readonly string[] = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `Key${letter}`),
  ...Array.from({ length: 10 }, (_unused, index) => `Digit${String(index)}`),
  ...Array.from({ length: 12 }, (_unused, index) => `F${String(index + 13)}`),
];

export interface ProbeAssignment {
  key: string;
  pin: number;
  inputId: number;
  kind: "button" | "stick";
  direction?: StickDirection;
  /** Set on a calibration profile, where all eight sectors are bound. */
  sector?: StickSector;
}

export interface ProbeProfile {
  doc: ExportDocument;
  assignments: ProbeAssignment[];
}

export class ProbeError extends Error {}

/**
 * Build a profile where every pin sends its own key.
 *
 * Unknown pins go last in the key pool so the least reliable probe keys land on the
 * records that are already a mystery.
 */
export function buildProbeProfile(
  template: ExportDocument,
  options: { id: string; name: string; unknownPins?: readonly number[] },
): ProbeProfile {
  const doc = structuredClone(template);
  const target = doc.profiles[0];
  if (!target) throw new ProbeError("template has no profile");
  doc.profiles = [target];
  target.id = options.id;
  target.name = options.name;

  const unknown = new Set(options.unknownPins ?? []);
  const records = target.inputs.filter(
    (record) => record.pinOne !== 255 && isRebindableRecord(record),
  );
  const ordered = [
    ...records.filter((record) => !unknown.has(record.pinOne)),
    ...records.filter((record) => unknown.has(record.pinOne)),
  ];

  const assignments: ProbeAssignment[] = [];
  let next = 0;
  /**
   * Stick directions are stored as numeric keycodes, so they require a probe key with a
   * known keycode. Keys without one are skipped for stick allocation.
   */
  const takeKey = (needsAnalog = false): string => {
    while (next < PROBE_KEYS.length) {
      const key = PROBE_KEYS[next];
      next += 1;
      if (key === undefined) break;
      if (needsAnalog && keys.nameToAnalog(key) === null) continue;
      return key;
    }
    throw new ProbeError(
      "ran out of distinguishable probe keys; probe in two passes or extend PROBE_KEYS",
    );
  };

  for (const record of ordered) {
    // Decide before clearing: `types` is what the app itself wrote, and the pin-0 record
    // also carries a second pin without being a stick.
    const isStick =
      record.types[0] === TYPE_STICK_KEYBOARD ||
      (record.pinTwo !== 255 && record.pinTwo !== record.pinOne);
    blankRecord(record);
    if (isStick) {
      record.types[0] = TYPE_STICK_KEYBOARD;
      const settings = record.analogSettings;
      const live = settings ? activeAnalogKeys(settings) : undefined;
      for (const direction of STICK_DIRECTIONS) {
        const key = takeKey(true);
        const code = keys.nameToAnalog(key);
        if (code === null) throw new ProbeError(`no analog keycode for probe key ${key}`);
        if (live) live[direction][0] = code;
        assignments.push({ key, pin: record.pinOne, inputId: record.id, kind: "stick", direction });
      }
      record.label = `PROBE stick ${String(record.pinOne)}`;
      continue;
    }
    const key = takeKey();
    record.types[0] = TYPE_KEYBOARD;
    record.keyValues[0] = keys.nameToKey(key);
    record.label = `PROBE ${String(record.pinOne)}`;
    assignments.push({ key, pin: record.pinOne, inputId: record.id, kind: "button" });
  }

  return { doc, assignments };
}

export interface ProbeResult {
  /** position name -> the pin that actually fired. */
  pins: Record<string, number>;
  /** Physical push -> reported sector, from the calibration pass. */
  sectors?: Partial<Record<StickSector, StickSector>>;
  /**
   * Physical stick direction -> the direction field in the export that it drives. An
   * identity map means the unit matches the software's left-handed assumption.
   */
  stick: Partial<Record<StickDirection, StickDirection>>;
}

/** Rebuild a device map from what the press test observed. */
export function deviceFromProbe(assumed: DeviceData, result: ProbeResult): DeviceData {
  // Every position comes through. One that was pressed takes the pin that fired; one that
  // was skipped, or never reached, keeps the pin the map already had. Dropping the unseen
  // ones turned a five-key capture into a five-key device -- and every profile that used
  // any other position stopped compiling. A stick is measured by deflection, not by a
  // press, so it is never in the pin sweep either.
  const positions: Record<string, DevicePosition> = {};
  let unseen = 0;
  for (const [name, position] of Object.entries(assumed.positions)) {
    const pin = result.pins[name];
    if (pin !== undefined) {
      positions[name] = { ...position, pin };
      continue;
    }
    positions[name] = { ...position };
    if (position.kind !== "stick") unseen += 1;
  }

  const seen = new Set(Object.values(result.pins));
  const stillUnknown = (assumed.unknown_pins ?? []).filter((pin) => !seen.has(pin));

  const identity = STICK_DIRECTIONS.every(
    (direction) => (result.stick[direction] ?? direction) === direction,
  );

  // Verified means every position was pressed. A partial capture does not earn it, and
  // does not take it away from a map that already had it.
  const next: DeviceData = {
    ...assumed,
    positions,
    unknown_pins: stillUnknown,
    verified: unseen === 0 || assumed.verified === true,
  };
  if (!identity) next.stick_directions = { ...result.stick };

  if (result.sectors && Object.keys(result.sectors).length > 0) {
    const zero = stickZeroFrom(result.sectors);
    if (zero.zeroPush) next.stick_zero = zero.zeroPush;
    // One correction, not two. The direction sweep and the zero pass measure the same
    // rotation; writing both applies it twice, which `stick-double-correction` rejects --
    // so the probe produced maps its own linter would not accept. The sweep is exact for a
    // quarter turn and remaps at compile time, so it wins when it found anything.
    if (zero.offsetDegrees !== 0 && identity) next.stick_angle = zero.offsetDegrees;
  }
  return next;
}

/** What the press test disagreed with, in words. */
export function probeDiff(assumed: DeviceData, result: ProbeResult): string[] {
  const notes: string[] = [];
  for (const [name, position] of Object.entries(assumed.positions)) {
    const pin = result.pins[name];
    if (pin === undefined) {
      notes.push(`${name}: never fired (expected pin ${String(position.pin)})`);
    } else if (pin !== position.pin) {
      notes.push(`${name}: pin ${String(pin)}, not ${String(position.pin)}`);
    }
  }
  for (const direction of STICK_DIRECTIONS) {
    const actual = result.stick[direction];
    if (actual && actual !== direction) {
      notes.push(`stick ${direction} drives the '${actual}' field in the export`);
    }
  }
  return notes;
}

/**
 * The eight physical deflections the calibration requests, clockwise from "away".
 *
 * Described relative to the unit's physical orientation, not to the directions the
 * firmware reports; the mapping between the two is what is being measured.
 */
export const PHYSICAL_PUSHES: readonly { id: StickSector; prompt: string }[] = [
  { id: "up", prompt: "hold the stick straight AWAY from you" },
  { id: "up_right", prompt: "hold it away and to the RIGHT (diagonal)" },
  { id: "right", prompt: "hold it straight RIGHT" },
  { id: "down_right", prompt: "hold it toward you and to the RIGHT (diagonal)" },
  { id: "down", prompt: "hold it straight TOWARD you" },
  { id: "down_left", prompt: "hold it toward you and to the LEFT (diagonal)" },
  { id: "left", prompt: "hold it straight LEFT" },
  { id: "up_left", prompt: "hold it away and to the LEFT (diagonal)" },
];

/**
 * A stick-only profile with all eight sectors bound to their own key.
 *
 * Everything else is silenced so a stray finger cannot be mistaken for a stick push, and
 * the stick is switched to eight-directional so the diagonals report separately -- that
 * is what gives 45-degree resolution instead of 90.
 */
export function buildStickCalibrationProfile(
  template: ExportDocument,
  options: { id: string; name: string },
): ProbeProfile {
  const doc = structuredClone(template);
  const target = doc.profiles[0];
  if (!target) throw new ProbeError("template has no profile");
  doc.profiles = [target];
  target.id = options.id;
  target.name = options.name;

  const assignments: ProbeAssignment[] = [];
  let next = 0;
  const takeAnalogKey = (): string => {
    while (next < PROBE_KEYS.length) {
      const key = PROBE_KEYS[next];
      next += 1;
      if (key !== undefined && keys.nameToAnalog(key) !== null) return key;
    }
    throw new ProbeError("ran out of probe keys with an analog keycode");
  };

  let found = false;
  for (const record of target.inputs) {
    const isStick =
      record.types[0] === TYPE_STICK_KEYBOARD ||
      (record.pinOne !== 255 && record.pinTwo !== 255 && record.pinTwo !== record.pinOne);
    if (!isRebindableRecord(record)) continue;
    blankRecord(record);
    if (!isStick) continue;
    found = true;

    record.types[0] = TYPE_STICK_KEYBOARD;
    record.label = `CALIBRATE stick ${String(record.pinOne)}`;
    const analog = record.analogSettings;
    if (!analog) throw new ProbeError("stick record has no analogSettings");
    analog.isEightDirectionalTrigger = true;

    for (const sector of STICK_SECTORS) {
      const key = takeAnalogKey();
      const code = keys.nameToAnalog(key);
      if (code === null) throw new ProbeError(`no analog keycode for ${key}`);
      if (isCardinal(sector)) {
        activeAnalogKeys(analog)[sector][0] = code;
      } else if (analog.diagonalKeys) {
        const diagonals =
          analog.isRightAnalog === true ? analog.diagonalKeys.right : analog.diagonalKeys.left;
        diagonals[sector][0] = code;
      } else {
        throw new ProbeError("stick record has no diagonalKeys to bind");
      }
      assignments.push({
        key,
        pin: record.pinOne,
        inputId: record.id,
        kind: "stick",
        sector,
      });
    }
  }

  if (!found) throw new ProbeError("template has no stick record to calibrate");
  return { doc, assignments };
}

function isCardinal(sector: StickSector): sector is StickDirection {
  return (STICK_DIRECTIONS as readonly string[]).includes(sector);
}

export interface StickZero {
  /** How far the firmware's idea of the sectors is rotated from the physical unit. */
  offsetDegrees: number;
  /** The physical push that the firmware reports as "up". */
  zeroPush: StickSector | null;
  /** How many of the eight pushes agree with that rotation. */
  agreement: number;
  samples: number;
}

/**
 * Work out where the stick's zero sits from what each physical push reported.
 *
 * Each push contributes one vote for a rotation. The most-voted rotation is returned, so
 * a single mis-aimed push does not determine the result.
 */
export function stickZeroFrom(observed: Partial<Record<StickSector, StickSector>>): StickZero {
  const votes = new Map<number, number>();
  let samples = 0;

  for (const [pushed, reported] of Object.entries(observed) as [StickSector, StickSector][]) {
    const from = STICK_SECTORS.indexOf(pushed);
    const to = STICK_SECTORS.indexOf(reported);
    if (from === -1 || to === -1) continue;
    samples += 1;
    const steps = (to - from + STICK_SECTORS.length) % STICK_SECTORS.length;
    votes.set(steps, (votes.get(steps) ?? 0) + 1);
  }

  let best = 0;
  let agreement = 0;
  for (const [steps, count] of votes) {
    if (count > agreement) {
      best = steps;
      agreement = count;
    }
  }

  // Normalised to the shortest rotation: an anticlockwise step reports -45, not 315.
  const half = STICK_SECTORS.length / 2;
  const signed = best > half ? best - STICK_SECTORS.length : best;
  const zeroIndex = (STICK_SECTORS.length - best) % STICK_SECTORS.length;
  return {
    offsetDegrees: signed * SECTOR_DEGREES,
    zeroPush: samples === 0 ? null : (STICK_SECTORS[zeroIndex] ?? null),
    agreement,
    samples,
  };
}
