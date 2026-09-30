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
}
