/** Translation between a YAML slot spec and the export's (type, key, meta) triple. */

import type { InputRecord } from "../types/azeron.js";
import {
  DEFAULT_DOUBLE_DELAY,
  DEFAULT_FEATURE_DELAY,
  HOLD_FIELDS,
  SLOTS,
  SLOT_FIELDS,
  TURBO_FIELDS,
  TURBO_INTERVAL_FIELDS,
  TYPE_KEYBOARD,
  TYPE_MOUSE,
  TYPE_NONE,
  TYPE_WHEEL,
  TYPE_XBOX_BUTTON,
  TYPE_XBOX_TRIGGER,
} from "../types/azeron.js";
import type {
  ActionSpec,
  DirectionSpec,
  KeySlotSpec,
  RawSlotSpec,
  SlotSpec,
} from "../types/profile.js";
import * as keys from "./keys.js";

export type Triple = readonly [type: string, key: string, meta: string];

export const EMPTY: Triple = [TYPE_NONE, keys.NONE_TOKEN, keys.NONE_TOKEN];

function isRaw(spec: object): spec is RawSlotSpec {
  return "type_raw" in spec || "key_raw" in spec || "meta_raw" in spec;
}

export class BindingError extends Error {}

/**
 * An Xbox button to the value the unit stores for it: XInput's own button bits, as the app's
 * table names them (read from its interface code; A, the triggers and Guide were seen in a
 * capture, 2026-11-13). `View` is XInput's BACK and `Menu` its START.
 */
export const XBOX_BUTTON_BITS: Readonly<Record<string, number>> = {
  DpadUp: 0x0001,
  DpadDown: 0x0002,
  DpadLeft: 0x0004,
  DpadRight: 0x0008,
  Menu: 0x0010,
  View: 0x0020,
  LS: 0x0040,
  RS: 0x0080,
  LB: 0x0100,
  RB: 0x0200,
  Guide: 0x0400,
  A: 0x1000,
  B: 0x2000,
  X: 0x4000,
  Y: 0x8000,
};

/** The triggers, as the export names them. */
export const XBOX_TRIGGERS: Readonly<Record<string, string>> = { LT: "T1", RT: "T2" };

/** Every control a key can send as an Xbox button or trigger. */
export const XBOX_SLOT_CONTROLS: readonly string[] = [
  ...Object.keys(XBOX_BUTTON_BITS),
  ...Object.keys(XBOX_TRIGGERS),
];

/**
 * Scroll from a key. The export holds a direction per axis (`x` 1 right, -1 left; `y` 1 up,
 * -1 down) and an interval per axis that the app works out from a speed of 0 to 100:
 * `(100 - speed) * 1.5`, so 100 is the fastest and an axis left still reads 150. Up and
 * right were captured (speed 33 up stored 100.5); the signs for down and left are the app's
 * own code.
 */
export const WHEEL_DIRECTIONS: Readonly<Record<string, readonly [x: number, y: number]>> = {
  up: [0, 1],
  down: [0, -1],
  left: [-1, 0],
  right: [1, 0],
};
export const WHEEL_SPEED_MAX = 100;
export const DEFAULT_WHEEL_SPEED = 50;
const WHEEL_SLOWEST = 150;

export function wheelInterval(speed: number): number {
  return ((WHEEL_SPEED_MAX - speed) * WHEEL_SLOWEST) / WHEEL_SPEED_MAX;
}

export function wheelSpeed(interval: number): number {
  return Math.round(WHEEL_SPEED_MAX - (interval * WHEEL_SPEED_MAX) / WHEEL_SLOWEST);
}

export interface WheelFields {
  x: number;
  y: number;
  interval: number;
  yInterval: number;
}

/** A scroll binding to the four fields the export keeps it in. */
export function wheelFields(direction: string, speed = DEFAULT_WHEEL_SPEED): WheelFields {
  const signs = WHEEL_DIRECTIONS[direction];
  if (signs === undefined) {
    throw new BindingError(`'${direction}' is not a scroll direction (up, down, left, right)`);
  }
  if (!Number.isInteger(speed) || speed < 1 || speed > WHEEL_SPEED_MAX) {
    throw new BindingError(`scroll speed ${String(speed)} is not a whole number from 1 to 100`);
  }
  const [x, y] = signs;
  return {
    x,
    y,
    interval: x === 0 ? WHEEL_SLOWEST : wheelInterval(speed),
    yInterval: y === 0 ? WHEEL_SLOWEST : wheelInterval(speed),
  };
}

/** The four scroll fields back to a binding, or null when they are not one direction. */
export function describeWheel(fields: Partial<WheelFields>): KeySlotSpec | null {
  const x = fields.x ?? 0;
  const y = fields.y ?? 0;
  const direction = Object.entries(WHEEL_DIRECTIONS).find(([, [dx, dy]]) => dx === x && dy === y);
  if (direction === undefined) return null;
  const interval = (x === 0 ? fields.yInterval : fields.interval) ?? WHEEL_SLOWEST;
  const other = (x === 0 ? fields.interval : fields.yInterval) ?? WHEEL_SLOWEST;
  if (other !== WHEEL_SLOWEST) return null;
  const speed = wheelSpeed(interval);
  if (speed < 1 || wheelInterval(speed) !== interval) return null;
  return speed === DEFAULT_WHEEL_SPEED ? { wheel: direction[0] } : { wheel: direction[0], speed };
}

/** Whether a slot binding is one the unit sends as itself rather than a key: Xbox or scroll. */
export function isDeviceBinding(spec: object): boolean {
  const binding = spec as KeySlotSpec;
  return (
    (binding.xbox !== null && binding.xbox !== undefined) ||
    (binding.wheel !== null && binding.wheel !== undefined)
  );
}

/** A slot spec (action id, inline binding, or null) to its export triple. */
export function resolveSlot(
  spec: SlotSpec | undefined,
  actions: Record<string, ActionSpec> | null,
): Triple {
  if (spec === null || spec === undefined) return EMPTY;

  let resolved: RawSlotSpec | KeySlotSpec | ActionSpec;
  if (typeof spec === "string") {
    if (!actions) throw new BindingError(`slot references action '${spec}' with no action set`);
    const action = actions[spec];
    if (!action) throw new BindingError(`unknown action '${spec}'`);
    resolved = action;
  } else {
    resolved = spec;
  }

  if (isRaw(resolved)) {
    return [
      resolved.type_raw ?? TYPE_KEYBOARD,
      resolved.key_raw ?? keys.NONE_TOKEN,
      resolved.meta_raw ?? keys.NONE_TOKEN,
    ];
  }

  const binding = resolved;
  // Only a binding written on the key itself sends an Xbox control or scrolls. An action's
  // `xbox:` is the genre's suggestion of a pad control, which the compiler never reads.
  const inline: KeySlotSpec | null = typeof spec === "string" ? null : binding;
  if (typeof inline?.xbox === "string") {
    const bit = XBOX_BUTTON_BITS[inline.xbox];
    if (bit !== undefined) return [TYPE_XBOX_BUTTON, String(bit), keys.NONE_TOKEN];
    const trigger = XBOX_TRIGGERS[inline.xbox];
    if (trigger !== undefined) return [TYPE_XBOX_TRIGGER, trigger, keys.NONE_TOKEN];
    throw new BindingError(
      `'${inline.xbox}' is not an Xbox button or trigger a key can send ` +
        `(${XBOX_SLOT_CONTROLS.join(", ")})`,
    );
  }
  if (typeof inline?.wheel === "string") {
    wheelFields(inline.wheel, inline.speed);
    return [TYPE_WHEEL, keys.NONE_TOKEN, keys.NONE_TOKEN];
  }
  if (binding.mouse !== null && binding.mouse !== undefined) {
    const code = keys.nameToMouse(binding.mouse);
    if (code === null) {
      throw new BindingError(
        `unknown mouse button '${binding.mouse}' -- only verified codes may be emitted; ` +
          "capture a real export and add it to keys.MOUSE_BUTTONS",
      );
    }
    return [TYPE_MOUSE, code, keys.NONE_TOKEN];
  }

  const key = binding.key ?? null;
  const meta = binding.meta ?? null;
  // An action with no key at all (an analog axis on the mouse sensor) binds nothing.
  if (key === null && meta === null) return EMPTY;
  return [TYPE_KEYBOARD, keys.nameToKey(key), keys.nameToMeta(meta)];
}

export interface DescribedSlot {
  spec: RawSlotSpec | KeySlotSpec | null;
  exact: boolean;
}

/**
 * Export triple to a YAML-friendly mapping, or null when the slot is empty.
 *
 * `exact` is false when the tokens could not be expressed canonically and had to stay raw.
 */
export function describeSlot(typeCode: string, keyToken: string, metaToken: string): DescribedSlot {
  const emptyKey = keyToken === keys.NONE_TOKEN;
  const emptyMeta = metaToken === keys.NONE_TOKEN;

  if (typeCode === TYPE_NONE && emptyKey && emptyMeta) return { spec: null, exact: true };

  if (typeCode === TYPE_XBOX_BUTTON) {
    const name = Object.entries(XBOX_BUTTON_BITS).find(([, bit]) => String(bit) === keyToken);
    if (name === undefined || !emptyMeta) {
      return { spec: { type_raw: typeCode, key_raw: keyToken, meta_raw: metaToken }, exact: false };
    }
    return { spec: { xbox: name[0] }, exact: true };
  }
  if (typeCode === TYPE_XBOX_TRIGGER) {
    const name = Object.entries(XBOX_TRIGGERS).find(([, token]) => token === keyToken);
    if (name === undefined || !emptyMeta) {
      return { spec: { type_raw: typeCode, key_raw: keyToken, meta_raw: metaToken }, exact: false };
    }
    return { spec: { xbox: name[0] }, exact: true };
  }

  if (typeCode === TYPE_MOUSE) {
    const name = keys.mouseToName(keyToken);
    if (name === null) {
      return { spec: { type_raw: typeCode, key_raw: keyToken }, exact: false };
    }
    return { spec: { mouse: name }, exact: true };
  }

  // The slot sends nothing but carries an unexplained type code (the "6" and "0" codes
  // in v5). Report it as empty; the code itself is preserved by raw.types.
  if (emptyKey && emptyMeta) return { spec: null, exact: true };

  if (typeCode === TYPE_KEYBOARD) {
    if (!keys.keyRoundTrips(keyToken) || !keys.metaRoundTrips(metaToken)) {
      return {
        spec: { type_raw: typeCode, key_raw: keyToken, meta_raw: metaToken },
        exact: false,
      };
    }
    const spec: KeySlotSpec = {};
    const name = keys.keyToName(keyToken);
    if (name !== null) spec.key = name;
    const metaName = keys.metaToName(metaToken);
    if (metaName !== null) spec.meta = metaName;
    return { spec, exact: true };
  }

  return {
    spec: { type_raw: typeCode, key_raw: keyToken, meta_raw: metaToken },
    exact: false,
  };
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Find the action whose signature matches a decompiled slot.
 *
 * Several actions may legitimately send the same key (Interact and Cruise are both F in
 * Everspace 2), so ties are broken with the free-text label on the physical key.
 */
export function matchAction(
  spec: RawSlotSpec | KeySlotSpec | null,
  actions: Record<string, ActionSpec> | null,
  hintLabel?: string,
): string | null {
  if (!spec || !actions) return null;
  if (isRaw(spec)) return null;
  // No action names an Xbox button or scroll, and one with no key would otherwise match.
  if (isDeviceBinding(spec)) return null;

  const want = spec;
  const candidates = Object.entries(actions)
    .filter(([, action]) => !action.provided_by)
    .filter(
      ([, action]) =>
        (action.key ?? null) === (want.key ?? null) &&
        (action.meta ?? null) === (want.meta ?? null) &&
        (action.mouse ?? null) === (want.mouse ?? null),
    )
    .map(([id]) => id);

  if (candidates.length === 0) return null;
  const first = candidates[0];
  if (first === undefined) return null;
  if (candidates.length === 1 || !hintLabel) return first;

  const hint = new Set(words(hintLabel));
  const scored = [...candidates].sort((a, b) => {
    const score = (id: string): number => {
      const label = actions[id]?.label ?? id;
      const tokens = new Set([...words(label), ...words(id)]);
      return [...hint].filter((word) => tokens.has(word)).length;
    };
    const diff = score(b) - score(a);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
  return scored[0] ?? first;
}

/**
 * How a stick direction reads on a diagram.
 *
 * A direction is an action id, an inline key, or a token decompiling could not name. Every
 * surface that draws a stick needs the same answer, so it is decided once here.
 */
export function describeDirection(
  label: (id: string) => string,
  value: string | DirectionSpec | undefined,
): string | null {
  if (value === undefined) return null;
  if (typeof value === "string") return label(value);
  if (typeof value.key === "string") return value.key;
  if (typeof value.mouse === "string") return `mouse ${value.mouse}`;
  if (typeof value.key_raw === "string") return `raw ${value.key_raw}`;
  return null;
}

/**
 * Clear every slot of an input record: no key, no modifier, no latch, no repeat, default
 * waits. `label` is left in place -- deleting and re-adding it would move it to the end of
 * the record and churn the JSON.
 *
 * The compiler and the probe each had their own copy of this, and they had already
 * drifted: the probe's did not clear a repeat, so a probe built from a template with one
 * sent a stream of keys for every press.
 */
export function blankRecord(record: InputRecord): void {
  record.types = [TYPE_NONE, TYPE_NONE, TYPE_NONE];
  for (const slot of SLOTS) {
    const [keyField, metaField] = SLOT_FIELDS[slot];
    (record[keyField] as string[])[0] = keys.NONE_TOKEN;
    (record[metaField] as string[])[0] = keys.NONE_TOKEN;
    record[HOLD_FIELDS[slot]] = false;
    record[TURBO_FIELDS[slot]] = false;
    record[TURBO_INTERVAL_FIELDS[slot]] = 0;
  }
  record.featureDelay = DEFAULT_FEATURE_DELAY;
  record.doubleDelay = DEFAULT_DOUBLE_DELAY;
  // `x`, `y` and the intervals are left: they only mean anything on a scroll slot, which
  // writes all four, and a scroll this repo cannot name (two axes at once) keeps them.
}
