/**
 * What a unit was given directly, by the editor's Write to units.
 *
 * The units report judges a unit by the Azeron app's stored copy of its profile, and a
 * direct write leaves that copy as it was, so after one the report would go on asking for an
 * import the units no longer need. The page therefore records each write that read back
 * clean -- the unit, the slot, and a fingerprint of exactly what went onto the unit -- and
 * the report counts a unit as current when the last such write is the layout as compiled now.
 *
 * The fingerprint is of the bytes the unit holds: every writable input as `OBM_COPY` carries
 * it, the slot byte set to 0, so the same layout in any slot is the same fingerprint, and a
 * label -- which never reaches a unit -- changes nothing. Node-free: the editor computes it
 * after a write, the server when it reports.
 */

import { encodeInputRecord, isWritableInput } from "./unitproto.js";
import type { ExportProfile } from "../types/azeron.js";

/** One direct write that read back as written. */
export interface DirectWrite {
  /** The unit's id, as its device map's `software_device_id` has it. */
  deviceId: string;
  slot: number;
  set: string;
  unit: string;
  /** The name the slot was given on the unit. */
  name: string;
  /** `layoutFingerprint` of the profile written. */
  fingerprint: string;
  /** When, as an ISO date. */
  at: string;
}

/** The record the server keeps: the last write into each slot of each unit. */
export interface DirectWrites {
  writes: DirectWrite[];
}

/** FNV-1a, twice over with different seeds: 64 bits, no crypto, the same in node and a page. */
function fnv(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * A fingerprint of what writing `profile` puts on a unit, or null when it cannot be
 * written as it is (a key the unit has no code for): such a layout was never written.
 */
export function layoutFingerprint(
  profile: ExportProfile,
  unknownPins: readonly number[],
): string | null {
  const parts: string[] = [];
  try {
    for (const input of profile.inputs) {
      if (!isWritableInput(input, unknownPins)) continue;
      parts.push(
        Array.from(encodeInputRecord(0, input), (byte) => byte.toString(16).padStart(2, "0")).join(
          "",
        ),
      );
    }
  } catch {
    return null;
  }
  const text = parts.join("|");
  return `${fnv(text, 0x811c9dc5)}${fnv(text, 0x01234567)}`;
}

/** The last write into each slot: a new one replaces the one it wrote over. */
export function recordWrite(record: DirectWrites, write: DirectWrite): DirectWrites {
  return {
    writes: [
      ...record.writes.filter(
        (entry) => !(entry.deviceId === write.deviceId && entry.slot === write.slot),
      ),
      write,
    ],
  };
}

/**
 * The newest write of this layout's unit that is the layout as `fingerprint` says it is now,
 * or null. Any slot will do: what the unit holds is what it holds, wherever it is.
 */
export function currentWrite(
  record: DirectWrites,
  deviceId: string | undefined,
  fingerprint: string | null,
): DirectWrite | null {
  if (deviceId === undefined || fingerprint === null) return null;
  const matching = record.writes
    .filter((entry) => entry.deviceId === deviceId && entry.fingerprint === fingerprint)
    .sort((a, b) => b.at.localeCompare(a.at));
  return matching[0] ?? null;
}

/** A record read from disk, or a body sent by the page, checked field by field. */
export function parseDirectWrite(value: unknown): DirectWrite {
  if (typeof value !== "object" || value === null) throw new Error("a write record is an object");
  const entry = value as Record<string, unknown>;
  const text = (field: string): string => {
    const found = entry[field];
    if (typeof found !== "string" || found === "") throw new Error(`a write record needs ${field}`);
    return found;
  };
  const slot = entry.slot;
  if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot > 15) {
    throw new Error("a write record needs a slot from 0 to 15");
  }
  const fingerprint = text("fingerprint");
  if (!/^[0-9a-f]{16}$/.test(fingerprint))
    throw new Error("a write record's fingerprint is 16 hex digits");
  return {
    deviceId: text("deviceId"),
    slot,
    set: text("set"),
    unit: text("unit"),
    name: text("name"),
    fingerprint,
    at: text("at"),
  };
}

export function parseDirectWrites(value: unknown): DirectWrites {
  const writes = (value as { writes?: unknown } | null)?.writes;
  if (!Array.isArray(writes)) return { writes: [] };
  const parsed: DirectWrite[] = [];
  for (const entry of writes) {
    try {
      parsed.push(parseDirectWrite(entry));
    } catch {
      // A damaged entry is dropped; the report then falls back to the app's copy for it.
    }
  }
  return { writes: parsed };
}
