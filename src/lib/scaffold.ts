/**
 * Starting a game from an export.
 *
 * A new game needs a folder, a vocabulary and a profile. The vocabulary is the hard part:
 * an export only says which keys are sent, not what they do in the game, so an action is
 * seeded per distinct key with a name derived from the key and a note marking it
 * unnamed. That produces a game that builds and lints from the first minute, with every
 * action visibly needing a real name rather than silently inventing one.
 */

import { SLOTS, STICK_DIRECTIONS } from "../types/azeron.js";
import type { ExportDocument } from "../types/azeron.js";
import type { ActionSpec, DeviceData, GameConfig, ProfileData } from "../types/profile.js";
import * as keys from "./keys.js";

export class ScaffoldError extends Error {}

/** `KeyF` -> `key_f`, `Digit5` -> `digit_5`, `ShiftLeft` -> `shift_left`. */
export function actionIdForKey(name: string): string {
  return name
    .replace(/([a-z])([A-Z0-9])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();
}

function keyNamesIn(exported: ExportDocument, profileIndex: number): string[] {
  const profile = exported.profiles[profileIndex];
  if (!profile) throw new ScaffoldError(`export has no profile at index ${String(profileIndex)}`);

  const found = new Set<string>();
  const slotFields = [
    ["keyValues", "metaValues"],
    ["keyValuesLong", "metaValuesLong"],
    ["keyValuesDouble", "metaValuesDouble"],
  ] as const;

  for (const record of profile.inputs) {
    slotFields.forEach(([keyField, metaField], index) => {
      if (record.types[index] !== "1") return;
      const key = keys.keyToName(record[keyField][0]);
      const meta = keys.metaToName(record[metaField][0]);
      if (key !== null) found.add(key);
      else if (meta !== null) found.add(meta);
    });
    const left = record.analogSettings?.analogKeys.left;
    if (!left) continue;
    for (const direction of STICK_DIRECTIONS) {
      const name = keys.analogToName(left[direction][0]);
      if (name !== null) found.add(name);
    }
  }
  return [...found].sort();
}

/** An action per distinct key the export sends, each marked as needing a real name. */
export function seedActions(
  exported: ExportDocument,
  profileIndex = 0,
): Record<string, ActionSpec> {
  const actions: Record<string, ActionSpec> = {};
  for (const name of keyNamesIn(exported, profileIndex)) {
    actions[actionIdForKey(name)] = {
      label: `${name} (unnamed)`,
      key: name,
      note: "Seeded by `azeron import`. Rename it and tag it once its in-game job is known.",
    };
  }
  return actions;
}

export interface ScaffoldOptions {
  name: string;
  slug: string;
  genre: string;
  template: string;
  /** Where built profiles are copied in addition to dist/. */
  exportTo?: string | undefined;
}

export function gameConfig(options: ScaffoldOptions): GameConfig & { export_to?: string } {
  const config: GameConfig & { export_to?: string } = {
    name: options.name,
    slug: options.slug,
    genre: options.genre,
    template: options.template,
    lint: { require_keyboard_stick: true },
  };
  if (options.exportTo) config.export_to = options.exportTo;
  return config;
}

/** Positions whose bindings the seeded vocabulary could not name. */
export function unnamedPositions(profile: ProfileData, device: DeviceData): string[] {
  const out: string[] = [];
  for (const [position, spec] of Object.entries(profile.positions)) {
    if (!(position in device.positions)) continue;
    const named = SLOTS.some((slot) => typeof spec[slot] === "string");
    const stick = Object.values(spec.directions ?? {}).some((value) => typeof value === "string");
    if (!named && !stick && Object.keys(spec).length > 0) out.push(position);
  }
  return out;
}
