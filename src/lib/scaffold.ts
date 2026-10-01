/**
 * Starting a game from an export.
 *
 * A new game needs a folder, a vocabulary and a profile. The vocabulary is the hard part:
 * an export only says which keys are sent, not what they do in the game, so an action is
 * seeded per distinct key with a name derived from the key and a note marking it
 * unnamed. That produces a game that builds and lints from the first minute, with every
 * action visibly needing a real name rather than silently inventing one.
 */

import { activeAnalogKeys, SLOTS, STICK_DIRECTIONS } from "../types/azeron.js";
import type { ExportDocument } from "../types/azeron.js";
import type { ActionSpec, DeviceData, GameConfig, ProfileData } from "../types/profile.js";
import { yamlScalar } from "./actionfile.js";
import * as keys from "./keys.js";
import { dumpYaml } from "./yaml.js";

export class ScaffoldError extends Error {}

/**
 * A name that becomes one component of a path: a game's folder, a layout's file name.
 *
 * Letters, digits, dots, dashes and underscores, starting and ending on something that is
 * not a dot. Nothing with a separator can match, so no spelling of `..` or an absolute
 * path gets through -- and the repo lives on Windows, which silently drops a trailing dot
 * and refuses names like `con`.
 */
const FILE_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/;
const RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

export function isFileName(value: string): boolean {
  return FILE_NAME.test(value) && !RESERVED_NAME.test(value);
}

/** Return `value` if it is safe to use in a path, otherwise say what is wrong with it. */
export function checkFileName(kind: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ScaffoldError(`${kind} is required`);
  }
  if (!isFileName(value)) {
    throw new ScaffoldError(
      `'${value}' cannot be a ${kind}: letters, digits, dots, dashes and underscores only, ` +
        "starting with a letter or digit and not ending in a dot",
    );
  }
  return value;
}

/** The name a person types for a game, tidied. Free text, but not a way to break a file. */
export function checkGameName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ScaffoldError("the game needs a name");
  }
  const name = value.trim();
  // eslint-disable-next-line no-control-regex
  if (name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new ScaffoldError("a game name is one line of at most 80 characters");
  }
  return name;
}

/** `Deep Rock Galactic` -> `deepRockGalactic`, the folder-and-file spelling games use. */
export function slugFromName(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter((word) => word !== "");
  const slug = words
    .map((word, index) =>
      index === 0 ? word.toLowerCase() : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join("");
  return slug;
}

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
    const settings = record.analogSettings;
    if (!settings) continue;
    const live = activeAnalogKeys(settings);
    for (const direction of STICK_DIRECTIONS) {
      const name = keys.analogToName(live[direction][0]);
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
      label: `${keys.keyLabel(name)} (unnamed)`,
      key: name,
      note: "Seeded by `azeron import`. Rename it and tag it once its in-game job is known.",
    };
  }
  return actions;
}

/**
 * The text of a new game's actions.yaml: the genre it extends, then one line per action.
 *
 * One line each, in the flow style the hand-written files use, because that is the shape
 * the editor's save can patch in place. Generic YAML output puts every action on four
 * lines, and a save then refused with "spans more than one line" -- a new game could not
 * have a key changed from the page at all. The seeded `note` is left out of the file: it
 * would still say "rename it" after the action had been renamed, and the label already
 * says "(unnamed)" for as long as that is true.
 */
export function actionsYaml(
  game: string,
  extendsPath: string,
  actions: Readonly<Record<string, ActionSpec>>,
  header: string,
): string {
  const ids = Object.keys(actions);
  const width = Math.max(0, ...ids.map((id) => id.length));
  const lines = ids.map((id) => {
    const spec = actions[id] ?? {};
    const fields: string[] = [];
    if (spec.label !== undefined) fields.push(`label: ${yamlScalar(spec.label)}`);
    if (spec.key) fields.push(`key: ${spec.key}`);
    if (spec.meta) fields.push(`meta: ${spec.meta}`);
    if (spec.mouse) fields.push(`mouse: ${spec.mouse}`);
    return `  ${`${id}:`.padEnd(width + 1)} {${fields.join(", ")}}`;
  });
  return `${dumpYaml({ extends: extendsPath, game }, header)}actions:\n${lines.join("\n")}\n`;
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
