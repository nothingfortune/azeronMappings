/**
 * Whether the Azeron app holds what a layout says: control by control, what the app's copy
 * of a profile sends against what the compiled file would.
 *
 * A layout is edited in the editor and saved to `dist/`; nothing reaches a unit until the
 * file is imported into the app and written to it. Until then the editor shows one thing
 * and the hand does another -- a key labelled Ultimate that opens the inventory -- and
 * nothing on screen says why. This compares the two.
 *
 * Both records are read the same way (`decompilePosition`, with no vocabulary), so a key
 * the app stores in another spelling -- a keycode for a code string -- is the same key.
 *
 * Node-free; the store is read in `install.ts`.
 */

import { matchAction } from "./binding.js";
import { decompilePosition } from "./decompile.js";
import { bindingLabel, keyToName, metaToName } from "./keys.js";
import { positionLabel } from "./layout.js";
import type { ActionSet, Device } from "./model-core.js";
import { withoutKey } from "./object.js";
import type { ExportProfile, InputRecord } from "../types/azeron.js";
import { SLOTS, STICK_DIRECTIONS, TYPE_KEYBOARD, isRebindableRecord } from "../types/azeron.js";
import type { DirectionSpec, KeySlotSpec, PositionSpec, RawSlotSpec } from "../types/profile.js";

export interface UnitDifference {
  position: string;
  /** The position as a person names it: "Ring 4". */
  where: string;
  /** What the compiled layout sends from it, in words. */
  layout: string;
  /** What the app's copy sends from it. */
  app: string;
  /** The control does the same thing and only its name differs. */
  labelOnly: boolean;
}

/** A spec with its keys in a fixed order, so two that say the same thing print the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, inner]) => `${key}:${canonical(inner)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** One slot or stick direction in words: "Ultimate (G)", or the key when no action sends it. */
function slotText(
  value: string | RawSlotSpec | KeySlotSpec | DirectionSpec | null | undefined,
  actions: ActionSet | null,
  hint: string | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if ("key_raw" in value && typeof value.key_raw === "string") return `raw key ${value.key_raw}`;
  const sent = value as KeySlotSpec;
  const keyText = bindingLabel(sent);
  if (keyText === null) return null;
  const action = matchAction(sent, actions?.actions ?? null, hint);
  return action === null ? keyText : `${actions?.label(action) ?? action} (${keyText})`;
}

/** What a control does, in words, from a spec read without a vocabulary. */
export function describeControl(spec: PositionSpec, actions: ActionSet | null): string {
  const hint = spec.label;
  if (spec.directions !== undefined || spec.mode !== undefined) {
    const directions = STICK_DIRECTIONS.map((direction) => {
      const text = slotText(spec.directions?.[direction], actions, direction);
      return text === null ? null : `${direction} ${text}`;
    }).filter((part): part is string => part !== null);
    const head = `stick in ${spec.mode ?? "no"} mode`;
    return directions.length > 0 ? `${head}: ${directions.join(", ")}` : head;
  }
  const parts: string[] = [];
  const names = { tap: "", long: "long press ", double: "double tap " } as const;
  for (const slot of SLOTS) {
    const text = slotText(spec[slot], actions, hint);
    if (text !== null) parts.push(`${names[slot]}${text}`);
  }
  if (spec.hold === true) parts.push("latches");
  if (spec.turbo === true) {
    parts.push(
      spec.turbo_interval === undefined
        ? "repeats"
        : `repeats every ${String(spec.turbo_interval)} ms`,
    );
  }
  return parts.length > 0 ? parts.join(", ") : "nothing";
}

const named = (spec: PositionSpec, actions: ActionSet | null): string => {
  const does = describeControl(spec, actions);
  return spec.label === undefined ? does : `${does} -- labelled "${spec.label}"`;
};

/**
 * A record read as what it sends. The compiler writes the arrows as legacy keycodes ("38")
 * and the app may hold the code string ("ArrowUp"); decompiling keeps whichever spelling
 * does not round-trip as a raw token, and two spellings of one key are one key here.
 */
function readRecord(record: InputRecord, isStick: boolean): PositionSpec {
  const spec = decompilePosition(record, null, isStick);
  for (const slot of SLOTS) {
    const value = spec[slot];
    if (typeof value !== "object" || value === null || !("type_raw" in value)) continue;
    if (value.type_raw !== TYPE_KEYBOARD || value.key_raw === undefined) continue;
    const key = keyToName(value.key_raw);
    const meta = metaToName(value.meta_raw);
    spec[slot] = { ...(key === null ? {} : { key }), ...(meta === null ? {} : { meta }) };
  }
  return spec;
}

/**
 * Every control of `device` whose record differs between the compiled layout and the app's
 * copy. Pins the device does not name, unidentified pins and records that are not keys (the
 * profile switch) are not compared: the compiler never writes them.
 */
export function compareUnit(
  layout: ExportProfile,
  app: ExportProfile,
  device: Device,
  actions: ActionSet | null,
): UnitDifference[] {
  const byPin = (profile: ExportProfile): Map<number, InputRecord> => {
    const found = new Map<number, InputRecord>();
    for (const record of profile.inputs) {
      if (!found.has(record.pinOne)) found.set(record.pinOne, record);
    }
    return found;
  };
  const ours = byPin(layout);
  const theirs = byPin(app);
  const differences: UnitDifference[] = [];

  for (const [position, { pin }] of Object.entries(device.positions)) {
    if (device.unknownPins.has(pin)) continue;
    const mine = ours.get(pin);
    if (mine === undefined || !isRebindableRecord(mine)) continue;
    const isStick = device.isStick(position);
    const want = readRecord(mine, isStick);
    const other = theirs.get(pin);
    const have = other === undefined ? null : readRecord(other, isStick);
    if (have !== null && canonical(want) === canonical(have)) continue;
    const labelOnly =
      have !== null &&
      canonical(withoutKey(want, "label")) === canonical(withoutKey(have, "label"));
    differences.push({
      position,
      where: positionLabel(position),
      layout: named(want, actions),
      app: have === null ? "no such key" : named(have, actions),
      labelOnly,
    });
  }
  return differences;
}

export interface UnitCheck {
  set: string;
  unit: string;
  /** The profile's name, which is what the app files it under. */
  name: string;
  /** The compiled file, repo-relative. */
  file: string;
  /** The same file as the Azeron app's import dialog would take it. */
  importPath: string;
  /**
   * `matches`: the app's newest copy sends what the file does from every control.
   * `differs`: it does not, and `differences` says where. `missing`: the app has no
   * profile by that name. `unbuilt`: there is no compiled file to compare.
   */
  status: "matches" | "differs" | "missing" | "unbuilt";
  /** The app's copy that was compared, and when the app last wrote it. */
  appFile?: string;
  appModified?: string;
  /** How many profiles the app holds under the name; the newest is compared. */
  copies: number;
  differences: UnitDifference[];
}

export interface UnitsReport {
  /** Where the app's profiles were looked for, or null when the app is not on this machine. */
  store: string | null;
  units: UnitCheck[];
}
