/**
 * Pedals as part of a layout.
 *
 * Three pieces of data meet here, kept apart on purpose:
 *
 * - `devices/<pedals>.yaml` says what the hardware is: its axes, whether each springs back
 *   to centre or rests at an end, and -- once captured -- the name a game gives each.
 * - a game's `sets.yaml` says what a layout's pedals do: which game axis each pedal axis
 *   drives, and the invert and dead zone that go with it.
 * - `genres/<Genre>/stick-modes.yaml` says which axes pedals carry, so the sticks do not.
 *
 * A game axis is named in the genre's vocabulary (`yaw`), and reaches the game's row
 * (`Yaw`) through the action vocabulary: the `ingame` row of the action at the axis's `up`
 * end. One table says what the game calls a thing, and the pedals do not grow a second.
 *
 * Node-free, because the editor imports it. Reading files is `io.ts`'s job.
 */

import { parse } from "yaml";

import type {
  NameStatus,
  PedalAssignment,
  PedalAxisData,
  PedalName,
  PedalsDeviceData,
  PedalRest,
  SetLayout,
  SetPedals,
  SetsData,
} from "../types/pedals.js";
import type { ActionSpec } from "../types/profile.js";
import type { IniFile, PedalPlan, PedalRowBinding } from "./ingame.js";
import { joystickAxisBindings, joystickDeviceOf, JOYSTICK_GROUP } from "./ingame.js";
import type { StickModeSet } from "./stickmodes.js";
import { isPlainObject } from "./yaml.js";

export class PedalsError extends Error {}

const REST: readonly PedalRest[] = ["centre", "end"];
export const NAME_STATUSES: readonly NameStatus[] = [
  "confirmed",
  "inferred",
  "unconfirmed",
  "bound",
  "candidate",
];
const NUMBER_FIELDS = ["dead_zone", "scale", "sensitivity", "exponent"] as const;
const ASSIGNMENT_FIELDS = new Set([
  "drives",
  "invert",
  "dead_zone",
  "scale",
  "sensitivity",
  "exponent",
  "shared",
  "note",
]);

function fail(path: string, where: string, problem: string): never {
  throw new PedalsError(`${path}: ${where}: ${problem}`);
}

/** Validate a parsed `devices/<pedals>.yaml`. Anything malformed is refused, not repaired. */
export function parsePedalsDevice(raw: unknown, path: string): PedalsDeviceData {
  if (!isPlainObject(raw)) fail(path, "file", "expected a mapping");
  if (raw.kind !== "pedals") fail(path, "kind", "expected 'pedals'");
  if (typeof raw.device !== "string" || raw.device === "") fail(path, "device", "needs a name");
  const axesRaw = raw.axes;
  if (!isPlainObject(axesRaw) || Object.keys(axesRaw).length === 0) {
    fail(path, "axes", "needs at least one axis");
  }

  const inputs: Record<string, string[]> = {};
  if (raw.inputs !== undefined && raw.inputs !== null) {
    if (!isPlainObject(raw.inputs)) fail(path, "inputs", "expected a mapping");
    for (const [game, list] of Object.entries(raw.inputs)) {
      if (!Array.isArray(list) || !list.every((n) => typeof n === "string" && validGameName(n))) {
        fail(path, `inputs.${game}`, "expected a list of input names");
      }
      inputs[game] = list as string[];
    }
  }

  const axes: Record<string, PedalAxisData> = {};
  const seenNames = new Map<string, string>();
  for (const [id, value] of Object.entries(axesRaw)) {
    if (!isPlainObject(value)) fail(path, `axes.${id}`, "expected a mapping");
    const rest = value.rest;
    if (typeof rest !== "string" || !REST.includes(rest as PedalRest)) {
      fail(path, `axes.${id}.rest`, `expected one of ${REST.join(", ")}`);
    }
    const axis: PedalAxisData = { rest: rest as PedalRest };
    if (value.label !== undefined) {
      if (typeof value.label !== "string") fail(path, `axes.${id}.label`, "expected text");
      axis.label = value.label;
    }
    if (value.rest_end !== undefined) {
      if (value.rest_end !== "min" && value.rest_end !== "max") {
        fail(path, `axes.${id}.rest_end`, "expected min or max");
      }
      axis.rest_end = value.rest_end;
    }
    const given = value.names;
    if (given !== undefined && given !== null) {
      if (!isPlainObject(given)) fail(path, `axes.${id}.names`, "expected a mapping");
      const names: Record<string, PedalName> = {};
      for (const [game, entry] of Object.entries(given)) {
        const where = `axes.${id}.names.${game}`;
        if (!isPlainObject(entry)) fail(path, where, "expected {name, status}");
        if (typeof entry.name !== "string" || !validGameName(entry.name)) {
          fail(path, `${where}.name`, "expected a name the game uses, as text");
        }
        if (
          typeof entry.status !== "string" ||
          !NAME_STATUSES.includes(entry.status as NameStatus)
        ) {
          fail(path, `${where}.status`, `expected one of ${NAME_STATUSES.join(", ")}`);
        }
        const known = inputs[game];
        if (known !== undefined && !known.includes(entry.name)) {
          fail(path, `${where}.name`, `'${entry.name}' is not one of the inputs ${game} registers`);
        }
        const other = seenNames.get(`${game}\0${entry.name}`);
        if (other !== undefined) {
          fail(path, `${where}.name`, `'${entry.name}' is also the name of ${other}`);
        }
        seenNames.set(`${game}\0${entry.name}`, id);
        const out: PedalName = { name: entry.name, status: entry.status as NameStatus };
        if (entry.note !== undefined) {
          if (typeof entry.note !== "string") fail(path, `${where}.note`, "expected text");
          out.note = entry.note;
        }
        names[game] = out;
      }
      axis.names = names;
    }
    axes[id] = axis;
  }
  const device: PedalsDeviceData = { device: raw.device, kind: "pedals", axes };
  if (Object.keys(inputs).length > 0) device.inputs = inputs;
  if (typeof raw.name === "string") device.name = raw.name;
  if (typeof raw.reports_as === "string") device.reports_as = raw.reports_as;
  if (isPlainObject(raw.usb)) {
    const { vendor_id: vendor, product_id: product } = raw.usb;
    if (typeof vendor !== "string" || typeof product !== "string") {
      fail(path, "usb", "needs vendor_id and product_id as text");
    }
    device.usb = { vendor_id: vendor, product_id: product };
  }
  return device;
}

/** A name that can be written into a row of the game's file without breaking the row. */
export function validGameName(name: string): boolean {
  return name.trim() !== "" && name === name.trim() && !/[,()=\r\n"]/.test(name);
}

function parseAssignment(raw: unknown, path: string, where: string): PedalAssignment {
  if (!isPlainObject(raw)) fail(path, where, "expected a mapping");
  for (const key of Object.keys(raw)) {
    if (!ASSIGNMENT_FIELDS.has(key)) fail(path, `${where}.${key}`, "unknown field");
  }
  if (typeof raw.drives !== "string" || raw.drives === "")
    fail(path, `${where}.drives`, "needs a game axis");
  const out: PedalAssignment = { drives: raw.drives };
  for (const field of ["invert", "shared"] as const) {
    const value = raw[field];
    if (value === undefined) continue;
    if (typeof value !== "boolean") fail(path, `${where}.${field}`, "expected true or false");
    out[field] = value;
  }
  for (const field of NUMBER_FIELDS) {
    const value = raw[field];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail(path, `${where}.${field}`, "expected a number");
    }
    out[field] = value;
  }
  if (raw.note !== undefined) {
    if (typeof raw.note !== "string") fail(path, `${where}.note`, "expected text");
    out.note = raw.note;
  }
  return out;
}

/** Validate a parsed `sets.yaml`. A missing file is no sets, not an error. */
export function parseSets(raw: unknown, path: string): SetsData {
  if (raw === undefined || raw === null) return { sets: {} };
  if (!isPlainObject(raw)) fail(path, "file", "expected a mapping");
  const setsRaw = raw.sets ?? {};
  if (!isPlainObject(setsRaw)) fail(path, "sets", "expected a mapping");
  const sets: Record<string, SetLayout> = {};
  for (const [name, value] of Object.entries(setsRaw)) {
    if (value === null) {
      sets[name] = {};
      continue;
    }
    if (!isPlainObject(value)) fail(path, `sets.${name}`, "expected a mapping");
    for (const key of Object.keys(value)) {
      if (key !== "pedals") fail(path, `sets.${name}.${key}`, "unknown field");
    }
    const layout: SetLayout = {};
    if (value.pedals !== undefined && value.pedals !== null) {
      const pedals = value.pedals;
      if (!isPlainObject(pedals)) fail(path, `sets.${name}.pedals`, "expected a mapping");
      if (typeof pedals.device !== "string" || pedals.device === "") {
        fail(path, `sets.${name}.pedals.device`, "needs a device name");
      }
      if (!isPlainObject(pedals.assign))
        fail(path, `sets.${name}.pedals.assign`, "expected a mapping");
      const assign: Record<string, PedalAssignment> = {};
      for (const [axis, entry] of Object.entries(pedals.assign)) {
        assign[axis] = parseAssignment(entry, path, `sets.${name}.pedals.assign.${axis}`);
      }
      layout.pedals = { device: pedals.device, assign };
    }
    sets[name] = layout;
  }
  return { sets };
}

/**
 * The game's row for a game axis, or null when the vocabulary does not reach the game.
 * An action's `ingame` is its row's `Action=`; the axis is the action at its `up` end.
 */
export function gameRowFor(
  axis: string,
  modes: StickModeSet,
  actions: Readonly<Record<string, ActionSpec>>,
): string | null {
  const ends = modes.axes[axis];
  if (!ends) return null;
  return actions[ends.up]?.ingame ?? null;
}

/** One pedal axis of a layout, resolved against everything it depends on. */
export interface PlannedAxis {
  pedalAxis: string;
  label: string;
  rest: PedalRest | null;
  assignment: PedalAssignment;
  /** The game row it lands on, or null when `drives` does not name one. */
  row: string | null;
  /** What the game calls this axis, or null while nothing is recorded. */
  name: string | null;
  /** How far `name` is trusted. */
  status: NameStatus | null;
}

/** Resolve a layout's pedals into rows and names. Problems are for lint, not thrown. */
export function planAxes(
  pedals: SetPedals,
  device: PedalsDeviceData | undefined,
  modes: StickModeSet | undefined,
  actions: Readonly<Record<string, ActionSpec>>,
  game: string,
): PlannedAxis[] {
  return Object.entries(pedals.assign).map(([pedalAxis, assignment]) => {
    const spec = device?.axes[pedalAxis];
    const entry = spec?.names?.[game];
    return {
      pedalAxis,
      label: spec?.label ?? pedalAxis,
      rest: spec?.rest ?? null,
      assignment,
      row: modes === undefined ? null : gameRowFor(assignment.drives, modes, actions),
      name: entry?.name ?? null,
      status: entry?.status ?? null,
    };
  });
}

/**
 * The plan the binding-file generator takes, from a layout's resolved axes. Throws when
 * the layout cannot be written at all (an axis with no game row); lint reports the same
 * things earlier and more kindly, but generating must not depend on lint having run.
 */
export function ingamePlan(
  axes: readonly PlannedAxis[],
  device: PedalsDeviceData,
  modes: StickModeSet,
  actions: Readonly<Record<string, ActionSpec>>,
  game: string,
): PedalPlan {
  const bindings: PedalRowBinding[] = [];
  const problems: string[] = [];
  const driven = new Map<string, { axis: string; shared: boolean }[]>();
  for (const planned of axes) {
    if (planned.row === null) {
      problems.push(
        `${planned.pedalAxis}: '${planned.assignment.drives}' is not a game axis this game reaches`,
      );
      continue;
    }
    const list = driven.get(planned.row) ?? [];
    list.push({ axis: planned.pedalAxis, shared: planned.assignment.shared === true });
    driven.set(planned.row, list);
    const a = planned.assignment;
    bindings.push({
      pedalAxis: planned.pedalAxis,
      label: planned.label,
      row: planned.row,
      name: planned.name,
      ...(planned.status === null ? {} : { status: planned.status }),
      ...(a.invert === undefined ? {} : { invert: a.invert }),
      ...(a.dead_zone === undefined ? {} : { deadZone: a.dead_zone }),
      ...(a.scale === undefined ? {} : { scale: a.scale }),
      ...(a.sensitivity === undefined ? {} : { sensitivity: a.sensitivity }),
      ...(a.exponent === undefined ? {} : { exponent: a.exponent }),
    });
  }
  for (const [row, list] of driven) {
    if (list.length > 1 && !list.every((entry) => entry.shared)) {
      problems.push(
        `${list.map((entry) => entry.axis).join(" and ")} both drive '${row}' -- say ` +
          "`shared: true` on each if that is meant",
      );
    }
    if (list.length > 2)
      problems.push(`'${row}' has room for two axes, not ${String(list.length)}`);
  }
  if (problems.length > 0) throw new PedalsError(problems.join("\n"));

  // Every flight axis the vocabulary names is a row this generator owns: a pedal name found
  // on one the layout no longer assigns is cleared, so changing a layout is one edit.
  const ownedRows = new Set<string>();
  for (const axis of Object.keys(modes.axes)) {
    const row = gameRowFor(axis, modes, actions);
    if (row !== null) ownedRows.add(row);
  }
  // Everything the device is known by in this game: a name on an owned row that is any of
  // them is ours to move, whichever axis it was recorded for.
  const knownNames = new Set<string>(device.inputs?.[game] ?? []);
  for (const spec of Object.values(device.axes)) {
    const entry = spec.names?.[game];
    if (entry !== undefined) knownNames.add(entry.name);
  }
  return { bindings, ownedRows, knownNames };
}

// ---------------------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------------------

export interface FoundName {
  name: string;
  /** The device part of the name, `SaitekProFlightRudderPedals` in `JS0_..._Axis1`. */
  device: string | null;
  row: string;
  display: string;
  slot: "Key1" | "Key2";
}

export interface CaptureResult {
  /** New names recorded, as `bound`, each with the pedal axis the layout says it is. */
  recorded: (FoundName & { pedalAxis: string })[];
  /** Found, and not placed: what was seen, and why it could not be placed. */
  unresolved: (FoundName & { reason: string })[];
  /** Names already recorded, found where the layout expects that pedal axis. */
  known: (FoundName & { pedalAxis: string; status: NameStatus })[];
  /**
   * Names already recorded for one pedal axis, found on a row the layout drives from
   * another (or from none). The file and the device data disagree about what the name is;
   * which is right is not something to decide here, so nothing is changed.
   */
  conflicts: (FoundName & { pedalAxis: string; status: NameStatus; reason: string })[];
  /** Joystick devices left out because they were already in the file's button rows. */
  otherDevices: string[];
  /** Axes of the layout with no name at all after this run -- partly named is normal. */
  missing: { pedalAxis: string; label: string; row: string | null }[];
  /** Axes of the layout whose name was not seen in the file, with how far it is trusted. */
  unproven: {
    pedalAxis: string;
    label: string;
    row: string | null;
    name: string;
    status: NameStatus;
  }[];
  /** The device file's new text; null when nothing is to be written. */
  text: string | null;
}

export interface CaptureOptions {
  /** name -> pedal axis, to settle what the layout alone cannot, or to move a name. */
  assign?: Readonly<Record<string, string>>;
  /** Device names that are not the pedals, beyond those the file's button rows show. */
  ignoreDevices?: readonly string[];
}

/**
 * Read the pedals' game names out of a file the user has bound them in.
 *
 * Bind each pedal once, on the row the layout says it drives (rudder on Yaw, say), and
 * the game writes a `JS<index>_<Device>_Axis<n>` name into that Joystick axis row. That
 * row plus the layout is the only way to tell a name's pedal axis, and it is used only
 * when it is unambiguous: one pedal axis drives that row. A name the layout cannot place
 * -- on a row no pedal drives, or on a row two pedals share -- is reported and left out.
 *
 * What a capture proves is what the GAME wrote, not which pedal was moved: a toe brake rests
 * at the end of its travel, so touching it wins a capture meant for the rudder. New names
 * are therefore recorded as `bound`, never `confirmed`, and a name already recorded is
 * checked against where the file has it: found on a row the layout drives from a different
 * pedal, it is a conflict, reported and left as it was.
 *
 * Partly named is an ordinary state: the axes still without a name are reported, not
 * treated as a failure. A device the file already had buttons for (the flight stick) is
 * not a pedal, and is skipped.
 */
export function capturePedals(
  file: IniFile,
  deviceText: string,
  device: PedalsDeviceData,
  axes: readonly PlannedAxis[],
  game: string,
  options: CaptureOptions = {},
): CaptureResult {
  const assign = options.assign ?? {};
  for (const [name, axis] of Object.entries(assign)) {
    if (!(axis in device.axes)) {
      throw new PedalsError(`--assign ${name}=${axis}: ${device.device} has no axis '${axis}'`);
    }
  }

  const buttonDevices = new Set<string>(options.ignoreDevices ?? []);
  for (const entry of file.entries) {
    if (entry.group !== JOYSTICK_GROUP || entry.isAxis) continue;
    for (const key of [entry.key, entry.key2]) {
      const owner = joystickDeviceOf(key);
      if (owner !== null) buttonDevices.add(owner);
    }
  }

  const recordedBefore = new Map<string, { axis: string; status: NameStatus }>();
  for (const [id, spec] of Object.entries(device.axes)) {
    const entry = spec.names?.[game];
    if (entry !== undefined) recordedBefore.set(entry.name, { axis: id, status: entry.status });
  }
  const rowOf = (axis: string): string | null =>
    axes.find((planned) => planned.pedalAxis === axis)?.row ?? null;

  const result: CaptureResult = {
    recorded: [],
    unresolved: [],
    known: [],
    conflicts: [],
    otherDevices: [],
    missing: [],
    unproven: [],
    text: null,
  };
  const skipped = new Set<string>();
  const candidates: FoundName[] = [];
  for (const bound of joystickAxisBindings(file)) {
    const owner = joystickDeviceOf(bound.name);
    if (owner !== null && buttonDevices.has(owner)) {
      skipped.add(owner);
      continue;
    }
    candidates.push({ ...bound, device: owner });
  }
  result.otherDevices = [...skipped].sort();

  const seen = new Set<string>();
  const byAxis = new Map<string, (FoundName & { pedalAxis: string })[]>();
  for (const found of candidates) {
    const registered = device.inputs?.[game];
    if (registered !== undefined && !registered.includes(found.name)) {
      result.unresolved.push({
        ...found,
        reason:
          `not one of the inputs ${game} registers for ${device.device} ` +
          `(${registered.join(", ")}) -- another device?`,
      });
      continue;
    }
    const explicit = assign[found.name];
    const before = recordedBefore.get(found.name);
    if (before !== undefined && (explicit === undefined || explicit === before.axis)) {
      const expected = rowOf(before.axis);
      if (expected === found.row) {
        seen.add(before.axis);
        result.known.push({ ...found, pedalAxis: before.axis, status: before.status });
      } else {
        result.conflicts.push({
          ...found,
          pedalAxis: before.axis,
          status: before.status,
          reason:
            `recorded as ${before.axis} (${before.status}), ` +
            (expected === null
              ? "which this layout does not drive"
              : `which this layout drives on '${expected}'`) +
            `, but the game has it on '${found.row}'. Either the file is wrong (applying moves ` +
            `it) or the recorded name is; --assign ${found.name}=<axis> re-records it`,
        });
      }
      continue;
    }
    const onRow = axes.filter((planned) => planned.row === found.row);
    let pedalAxis: string | null = null;
    let reason = "";
    if (explicit !== undefined) {
      pedalAxis = explicit;
    } else if (onRow.length === 1 && onRow[0] !== undefined) {
      pedalAxis = onRow[0].pedalAxis;
    } else if (onRow.length === 0) {
      reason = `no pedal in the layout drives '${found.row}'`;
    } else {
      reason = `${onRow.map((p) => p.pedalAxis).join(" and ")} both drive '${found.row}'`;
    }
    if (pedalAxis === null) {
      result.unresolved.push({ ...found, reason });
      continue;
    }
    const list = byAxis.get(pedalAxis) ?? [];
    list.push({ ...found, pedalAxis });
    byAxis.set(pedalAxis, list);
  }

  const edits: Record<string, PedalName | null> = {};
  for (const [pedalAxis, list] of byAxis) {
    const existing = device.axes[pedalAxis]?.names?.[game];
    const sure = list.length === 1 ? list[0] : undefined;
    if (sure === undefined) {
      for (const found of list) {
        result.unresolved.push({
          ...found,
          reason: `${String(list.length)} names claim ${pedalAxis}; name the right one with --assign`,
        });
      }
    } else if (existing !== undefined && assign[sure.name] === undefined) {
      result.unresolved.push({
        ...sure,
        reason:
          `${pedalAxis} is already recorded as '${existing.name}' (${existing.status}); ` +
          `--assign ${sure.name}=${pedalAxis} replaces it`,
      });
    } else {
      edits[pedalAxis] = {
        name: sure.name,
        status: "bound",
        note: `the game wrote it on the ${sure.row} axis row when it was bound there`,
      };
      // A name that moves leaves the axis it was recorded on.
      const before = recordedBefore.get(sure.name);
      if (before !== undefined && before.axis !== pedalAxis && !(before.axis in edits)) {
        edits[before.axis] = null;
      }
      result.recorded.push(sure);
      seen.add(pedalAxis);
    }
  }

  for (const planned of axes) {
    if (seen.has(planned.pedalAxis)) continue;
    const entry = { pedalAxis: planned.pedalAxis, label: planned.label, row: planned.row };
    if (planned.name === null || planned.status === null) result.missing.push(entry);
    else result.unproven.push({ ...entry, name: planned.name, status: planned.status });
  }

  if (Object.keys(edits).length > 0) {
    result.text = recordPedalNames(deviceText, game, edits);
  }
  return result;
}

const INDENT = (line: string): number => /^ */.exec(line)?.[0].length ?? 0;

function renderName(game: string, entry: PedalName): string {
  const note = entry.note === undefined ? "" : `, note: ${JSON.stringify(entry.note)}`;
  return `      ${game}: {name: ${JSON.stringify(entry.name)}, status: ${entry.status}${note}}`;
}

/**
 * Patch names into a pedals device file, a line at a time.
 *
 * The file is hand-written and explains itself in comments, so it is patched rather than
 * regenerated: an axis's `names:` block gains, replaces or loses the one line for the game,
 * and nothing else moves. A null entry removes the game's name. The result is parsed back
 * and checked, so a patch that meant something else is refused.
 */
export function recordPedalNames(
  text: string,
  game: string,
  entries: Readonly<Record<string, PedalName | null>>,
): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const axesAt = lines.findIndex((line) => /^axes:\s*(#.*)?$/.test(line));
  if (axesAt === -1) throw new PedalsError("no top-level `axes:` block to record names in");

  for (const [axis, entry] of Object.entries(entries)) {
    if (entry !== null && !validGameName(entry.name)) {
      throw new PedalsError(`'${entry.name}' cannot be written into the game's file`);
    }
    const start = lines.findIndex(
      (line, index) => index > axesAt && new RegExp(`^  ${axis}:\\s*(#.*)?$`).test(line),
    );
    if (start === -1) throw new PedalsError(`no axis '${axis}' in the pedals file`);
    let end = start + 1;
    while (end < lines.length) {
      const line = lines[end] ?? "";
      if (line.trim() !== "" && !line.trim().startsWith("#") && INDENT(line) <= 2) break;
      end += 1;
    }
    // Trailing blank lines and comments belong to whatever follows.
    while (end > start + 1 && (lines[end - 1] ?? "").trim() === "") end -= 1;

    const namesAt = lines.findIndex(
      (line, index) => index > start && index < end && /^ {4}names:/.test(line),
    );
    if (namesAt === -1) {
      if (entry !== null) lines.splice(end, 0, "    names:", renderName(game, entry));
      continue;
    }
    const header = lines[namesAt] ?? "";
    if (/^ {4}names:\s*\{\s*\}\s*(#.*)?$/.test(header)) {
      if (entry !== null) lines.splice(namesAt, 1, "    names:", renderName(game, entry));
      continue;
    }
    if (!/^ {4}names:\s*(#.*)?$/.test(header)) {
      throw new PedalsError(`${axis}.names is not a block mapping; edit it by hand`);
    }
    let blockEnd = namesAt + 1;
    while (blockEnd < end) {
      const line = lines[blockEnd] ?? "";
      if (line.trim() !== "" && !line.trim().startsWith("#") && INDENT(line) <= 4) break;
      blockEnd += 1;
    }
    const at = lines.findIndex(
      (line, index) =>
        index > namesAt && index < blockEnd && new RegExp(`^ {6}${game}:`).test(line),
    );
    if (at !== -1) {
      if (entry === null) lines.splice(at, 1);
      else lines[at] = renderName(game, entry);
    } else if (entry !== null) {
      lines.splice(blockEnd, 0, renderName(game, entry));
    }
    let after = namesAt + 1;
    while (after < lines.length) {
      const line = lines[after] ?? "";
      if (line.trim() !== "" && !line.trim().startsWith("#") && INDENT(line) <= 4) break;
      after += 1;
    }
    const stillHas = lines.slice(namesAt + 1, after).some((line) => /^ {6}\S/.test(line));
    if (!stillHas) lines[namesAt] = "    names: {}";
  }

  const patched = lines.join(eol);
  const check = parsePedalsDevice(parse(patched) as unknown, "the patched pedals file");
  for (const [axis, entry] of Object.entries(entries)) {
    const now = check.axes[axis]?.names?.[game];
    const ok =
      entry === null ? now === undefined : now?.name === entry.name && now.status === entry.status;
    if (!ok) throw new PedalsError(`changing ${axis}'s name did not take; edit the file by hand`);
  }
  return patched;
}

/**
 * Write names by hand, as `candidate`s, for an axis the game's controls screen would not
 * take. Generation writes them like any other name and says what they are; nothing here
 * chooses a name -- the caller supplies it, and is guessing.
 */
export function recordCandidateNames(
  text: string,
  game: string,
  names: Readonly<Record<string, string>>,
): string {
  return recordPedalNames(
    text,
    game,
    Object.fromEntries(
      Object.entries(names).map(([axis, name]) => [
        axis,
        { name, status: "candidate", note: "written by hand; nothing has shown it is right" },
      ]),
    ),
  );
}
