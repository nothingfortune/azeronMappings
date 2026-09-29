/**
 * Compile a profile into Azeron import JSON.
 *
 * The template export supplies every field the YAML does not speak about, so unknown and
 * unverified fields (macro blocks, turbo settings, subType, analog tuning, the records
 * for unidentified pins) survive untouched.
 */

import type {
  AnalogDirections,
  ExportDocument,
  ExportProfile,
  InputRecord,
  Slot,
} from "../types/azeron.js";
import {
  DEFAULT_DOUBLE_DELAY,
  DEFAULT_FEATURE_DELAY,
  HOLD_FIELDS,
  SLOTS,
  SLOT_FIELDS,
  STICK_DIRECTIONS,
  STICK_MODE_CODES,
  TYPE_NONE,
} from "../types/azeron.js";
import type { ActionSpec, PositionSpec } from "../types/profile.js";
import { resolveSlot } from "./binding.js";
import * as keys from "./keys.js";
import type { Device, Profile } from "./model-core.js";

export class CompileError extends Error {}

function tokens(record: InputRecord, field: keyof InputRecord): string[] {
  return record[field] as string[];
}

function neutralize(record: InputRecord, isStick: boolean): void {
  record.types = [TYPE_NONE, TYPE_NONE, TYPE_NONE];
  for (const slot of SLOTS) {
    const [keyField, metaField] = SLOT_FIELDS[slot];
    tokens(record, keyField)[0] = keys.NONE_TOKEN;
    tokens(record, metaField)[0] = keys.NONE_TOKEN;
    record[HOLD_FIELDS[slot]] = false;
  }
  record.featureDelay = DEFAULT_FEATURE_DELAY;
  record.doubleDelay = DEFAULT_DOUBLE_DELAY;
  // `label` is deliberately left alone here. Deleting and re-adding it would move the
  // key to the end of the record and churn the JSON for no reason; the caller clears it
  // for positions the profile does not mention, and applyPosition overwrites it in place.
  if (isStick && record.analogSettings) {
    const left = record.analogSettings.analogKeys.left;
    for (const direction of STICK_DIRECTIONS) left[direction][0] = 0;
  }
}

function applyStick(
  record: InputRecord,
  spec: PositionSpec,
  actions: Record<string, ActionSpec> | null,
  position: string,
  device: Device,
): void {
  const mode = spec.mode ?? "keyboard";
  let code = STICK_MODE_CODES[mode];
  if (code === undefined) {
    const raw = spec.raw?.types?.[0];
    if (raw === undefined) {
      throw new CompileError(
        `${position}: stick mode '${mode}' has no known type code. Only 'keyboard' is ` +
          "verified; capture a real export and add the code to STICK_MODES.",
      );
    }
    code = raw;
  }
  record.types[0] = code;

  const analogSettings = record.analogSettings;
  // Only written when the unit has actually been measured; the field's units are
  // unverified, so an unmeasured device leaves whatever the template had.
  if (analogSettings && device.stickAngle !== undefined) analogSettings.angle = device.stickAngle;
  if (!analogSettings) throw new CompileError(`${position}: template record has no analogSettings`);
  const left: AnalogDirections = analogSettings.analogKeys.left;

  for (const direction of STICK_DIRECTIONS) {
    // A mirrored unit may not drive the same field the left-handed software expects,
    // so the device map can redirect a physical direction onto another export field.
    const field = device.stickDirections[direction] ?? direction;
    const ref = spec.directions?.[direction];
    if (ref === undefined) {
      left[field][0] = 0;
      continue;
    }
    let name: string | null;
    if (typeof ref === "string") {
      const action = actions?.[ref];
      if (!action) throw new CompileError(`${position}: unknown action '${ref}'`);
      name = action.key ?? null;
      if (name === null) {
        throw new CompileError(`${position}: stick ${direction} -> action '${ref}' sends no key`);
      }
    } else {
      name = ref.key ?? null;
    }
    const analog = keys.nameToAnalog(name);
    if (analog === null) {
      throw new CompileError(
        `${position}: stick ${direction} -> no analog keycode for '${String(name)}'`,
      );
    }
    left[field][0] = analog;
  }
}

function applyPosition(
  record: InputRecord,
  spec: PositionSpec,
  actions: Record<string, ActionSpec> | null,
  position: string,
  isStick: boolean,
  device: Device,
): void {
  if (spec.label !== undefined) record.label = spec.label;
  else delete record.label;

  if (isStick) {
    applyStick(record, spec, actions, position, device);
  } else {
    SLOTS.forEach((slot: Slot, index: number) => {
      let triple;
      try {
        triple = resolveSlot(spec[slot], actions);
      } catch (error) {
        throw new CompileError(`${position}.${slot}: ${(error as Error).message}`);
      }
      record.types[index] = triple[0];
      const [keyField, metaField] = SLOT_FIELDS[slot];
      tokens(record, keyField)[0] = triple[1];
      tokens(record, metaField)[0] = triple[2];
    });
  }

  const rawTypes = spec.raw?.types;
  if (rawTypes) {
    if (rawTypes.length !== 3) throw new CompileError(`${position}: raw.types must have 3 entries`);
    record.types = rawTypes.map(String);
  }

  if (spec.feature_delay !== undefined) record.featureDelay = spec.feature_delay;
  if (spec.double_delay !== undefined) record.doubleDelay = spec.double_delay;
  for (const slot of SLOTS) {
    const field = slot === "tap" ? "hold" : (`hold_${slot}` as const);
    if (spec[field]) record[HOLD_FIELDS[slot]] = true;
  }
}

export interface CompileOptions {
  device?: Device;
  actions?: Record<string, ActionSpec> | null;
  template?: ExportDocument;
}

/** Build the import-ready document for a profile. */
export function compileProfile(profile: Profile, options: CompileOptions = {}): ExportDocument {
  const actions = options.actions ?? profile.game?.actions.actions ?? null;
  const device = options.device ?? profile.device;

  const source = options.template;
  if (!source) {
    throw new CompileError(
      `${profile.path}: no template given. The caller loads it -- see loadTemplate in io.ts.`,
    );
  }
  const doc = structuredClone(source);

  const index = profile.meta.template_profile ?? 0;
  const target: ExportProfile | undefined = doc.profiles[index];
  if (!target) {
    throw new CompileError(
      `${profile.template ?? "template"}: no profile at index ${String(index)}`,
    );
  }
  doc.profiles = [target];

  if (profile.id) target.id = profile.id;
  if (profile.name) target.name = profile.name;

  const byPin = new Map<number, InputRecord>();
  for (const record of target.inputs) {
    if (!byPin.has(record.pinOne)) byPin.set(record.pinOne, record);
  }

  // Only pins this device names are ever rewritten. Unidentified pins and unused
  // `pinOne: 255` slots pass through from the template exactly as they came.
  for (const [name, position] of Object.entries(device.positions)) {
    if (device.unknownPins.has(position.pin)) continue;
    const record = byPin.get(position.pin);
    if (!record) continue;
    neutralize(record, device.isStick(name));
    if (!(name in profile.positions)) delete record.label;
  }

  for (const [name, spec] of Object.entries(profile.positions)) {
    const position = device.positions[name];
    if (!position) {
      throw new CompileError(`${profile.path}: position '${name}' is not on device ${device.name}`);
    }
    const record = byPin.get(position.pin);
    if (!record) {
      throw new CompileError(
        `${profile.template ?? "template"}: no input for pin ${String(position.pin)} (${name})`,
      );
    }
    applyPosition(record, spec, actions, name, device.isStick(name), device);
  }

  return doc;
}

export function dumps(doc: ExportDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
