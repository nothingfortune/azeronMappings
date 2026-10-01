/**
 * The game's own binding file.
 *
 * Everspace 2 keeps its bindings in `Input.ini` under
 * `[/Script/ES2.CustomPlayerInput]`, one `KeybindingsConfig=(...)` line per action and
 * input group (Keyboard, Gamepad, Joystick). Only `Key1` and `Key2` on Keyboard rows in
 * the categories a game owns are ever rewritten; every other field on every other line is
 * carried through verbatim, because this file belongs to the game and most of it is not
 * understood here.
 *
 * The direction of truth is one way: `actions.yaml` says which key each action is on, and
 * the game is made to agree. That is what lets a layout be changed on the keypads alone --
 * the in-game half is generated, never edited by hand alongside it.
 */

import type { NameStatus } from "../types/pedals.js";
import type { ActionSpec } from "../types/profile.js";
import type { ActionSet } from "./model-core.js";

export const KEYBOARD_GROUP = "Keyboard";

export interface IniEntry {
  /** The whole line, so anything not rewritten survives exactly. */
  raw: string;
  /** Where the line sits in `IniFile.lines`, so a rewrite can put it back. */
  index: number;
  action: string;
  group: string;
  /**
   * The game's own grouping. In Everspace 2: 0 flight, 1 combat and ship functions, 2
   * opening menus, 3 system (saves, photo mode, HUD) -- all live while flying -- and 4 menu
   * navigation, 5 menu actions, 6 photo-mode camera, which are not. A key only collides
   * with another in a category live at the same time.
   */
  category: number;
  key: string;
  key2: string;
  scale: number;
  isAxis: boolean;
  displayName: string;
}

export interface IniFile {
  /** Lines in order; entries point back at their index. */
  lines: string[];
  entries: IniEntry[];
  /** The file's own line ending, kept so a rewrite does not churn every line. */
  eol: string;
}

const FIELD = (line: string, name: string): string | null => {
  const match = new RegExp(`[,(]${name}=([^,)]*)`).exec(line);
  return match?.[1] ?? null;
};

export function parseInput(text: string): IniFile {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const entries: IniEntry[] = [];
  lines.forEach((line, index) => {
    if (!line.startsWith("KeybindingsConfig=(")) return;
    const action = FIELD(line, "Action");
    if (action === null) return;
    const display = /DisplayName=NSLOCTEXT\("[^"]*",\s*"[^"]*",\s*"([^"]*)"\)/.exec(line);
    entries.push({
      raw: line,
      index,
      action,
      group: (FIELD(line, "GroupName") ?? "").replace(/"/g, ""),
      category: Number(FIELD(line, "Category") ?? "-1"),
      key: FIELD(line, "Key1") ?? "None",
      key2: FIELD(line, "Key2") ?? "None",
      scale: Number(FIELD(line, "Scale") ?? "1"),
      isAxis: (FIELD(line, "bIsAxis") ?? "False") === "True",
      displayName: display?.[1] ?? action,
    });
  });
  return { lines, entries, eol };
}

/** Our key names to the names Unreal uses in this file. */
const TO_UE: Record<string, string> = {
  Escape: "Escape",
  Tab: "Tab",
  Space: "SpaceBar",
  Enter: "Enter",
  ShiftLeft: "LeftShift",
  ShiftRight: "RightShift",
  ControlLeft: "LeftControl",
  ControlRight: "RightControl",
  AltLeft: "LeftAlt",
  AltRight: "RightAlt",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Equal: "Equals",
  Minus: "Hyphen",
  NumpadAdd: "Add",
  NumpadSubtract: "Subtract",
  NumpadMultiply: "Multiply",
  NumpadDivide: "Divide",
  NumpadDecimal: "Decimal",
  Backspace: "BackSpace",
  CapsLock: "CapsLock",
  Backquote: "Tilde",
  BracketLeft: "LeftBracket",
  BracketRight: "RightBracket",
  Semicolon: "Semicolon",
  Quote: "Apostrophe",
  Comma: "Comma",
  Period: "Period",
  Slash: "Slash",
  Backslash: "Backslash",
  Insert: "Insert",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};
const NUMPAD_NAMES = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
];
const DIGIT_NAMES = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
];
const MOUSE_TO_UE: Record<string, string> = {
  left: "LeftMouseButton",
  middle: "MiddleMouseButton",
  right: "RightMouseButton",
};

/** The Unreal key name an action sends, or null when it sends nothing nameable. */
export function ueKeyFor(spec: ActionSpec): string | null {
  if (spec.mouse) return MOUSE_TO_UE[spec.mouse] ?? null;
  const name = spec.key ?? spec.meta ?? null;
  if (name === null) return null;
  if (name in TO_UE) return TO_UE[name] ?? null;
  const letter = /^Key([A-Z])$/.exec(name);
  if (letter?.[1]) return letter[1];
  const digit = /^Digit([0-9])$/.exec(name);
  if (digit?.[1]) return DIGIT_NAMES[Number(digit[1])] ?? null;
  const numpad = /^Numpad([0-9])$/.exec(name);
  if (numpad?.[1]) return `NumPad${NUMPAD_NAMES[Number(numpad[1])] ?? ""}`;
  if (/^F([1-9]|1[0-2])$/.test(name)) return name;
  return null;
}

export interface Comparison {
  action: string;
  label: string;
  /** What actions.yaml says the keypad sends. */
  ours: string | null;
  /** What the game is bound to, per matching entry. */
  theirs: { action: string; display: string; key: string; scale: number }[];
  status: "agrees" | "differs" | "unmatched" | "unsendable";
}

/**
 * Line our vocabulary up with the game's, by key.
 *
 * Matching on the key rather than the name is deliberate: an action id here is ours, and
 * the game's action names are its own, so the only thing the two share is the key that
 * actually travels between them.
 */
export function compareToGame(actions: ActionSet, file: IniFile): Comparison[] {
  const keyboard = file.entries.filter((entry) => entry.group === KEYBOARD_GROUP);
  const rows = keyboardRows(file);
  const byKey = new Map<string, IniEntry[]>();
  for (const entry of keyboard) {
    if (entry.key === "None") continue;
    const list = byKey.get(entry.key) ?? [];
    list.push(entry);
    byKey.set(entry.key, list);
  }

  return Object.entries(actions.actions).map(([id, spec]) => {
    const label = spec.label ?? id;
    if (spec.provided_by) {
      return { action: id, label, ours: null, theirs: [], status: "unsendable" as const };
    }
    const ours = ueKeyFor(spec);
    // An action that names its row is checked against that row, not matched by key: a key
    // the game has put on some other action is exactly what this has to catch.
    if (spec.ingame !== undefined) {
      const row = rows.get(rowId(spec.ingame, spec.ingame_scale));
      if (!row) {
        return { action: id, label, ours, theirs: [], status: "unmatched" as const };
      }
      const theirs = [
        { action: row.action, display: row.displayName, key: row.key, scale: row.scale },
      ];
      const agrees = row.key === (ours ?? "None");
      return { action: id, label, ours, theirs, status: agrees ? "agrees" : "differs" } as const;
    }
    if (ours === null) {
      return { action: id, label, ours: null, theirs: [], status: "unsendable" as const };
    }
    const matches = (byKey.get(ours) ?? []).map((entry) => ({
      action: entry.action,
      display: entry.displayName,
      key: entry.key,
      scale: entry.scale,
    }));
    if (matches.length === 0) {
      return { action: id, label, ours, theirs: [], status: "unmatched" as const };
    }
    return { action: id, label, ours, theirs: matches, status: "agrees" as const };
  });
}

/** Keys the game binds more than once in the keyboard group. */
export function gameCollisions(file: IniFile): { key: string; actions: string[] }[] {
  const byKey = new Map<string, Set<string>>();
  for (const entry of file.entries) {
    if (entry.group !== KEYBOARD_GROUP || entry.key === "None") continue;
    const set = byKey.get(entry.key) ?? new Set<string>();
    set.add(entry.displayName);
    byKey.set(entry.key, set);
  }
  return [...byKey.entries()]
    .filter(([, actionsFor]) => actionsFor.size > 1)
    .map(([key, actionsFor]) => ({ key, actions: [...actionsFor].sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** Rewrite Key1 on one keyboard row, leaving every other field untouched. */
export function setKey(line: string, key: string): string {
  return line.replace(/([,(])Key1=[^,)]*/, `$1Key1=${key}`);
}

/** Rewrite Key2 on one keyboard row. */
function setKey2(line: string, key: string): string {
  return line.replace(/([,(])Key2=[^,)]*/, `$1Key2=${key}`);
}

function rowId(action: string, scale: number | undefined): string {
  return `${action}@${String(scale ?? 1)}`;
}

/** The keyboard rows that carry a key, by action and scale. Axis rows are for devices. */
function keyboardRows(file: IniFile): Map<string, IniEntry> {
  const rows = new Map<string, IniEntry>();
  for (const entry of file.entries) {
    if (entry.group !== KEYBOARD_GROUP || entry.isAxis) continue;
    rows.set(rowId(entry.action, entry.scale), entry);
  }
  return rows;
}

export class IngameError extends Error {}

export interface IngameChange {
  action: string;
  display: string;
  category: number;
  from: string;
  to: string;
  /** Our action, or null for a row this repo owns but no action names. */
  by: string | null;
}

/**
 * Make the game's keyboard rows agree with `actions.yaml`.
 *
 * Every non-axis keyboard row in an owned category is written from the action that names
 * it, and `Key2` is cleared so nothing reaches it by a second route. An owned row that no
 * action names is refused rather than guessed at or silently unbound: the vocabulary has
 * to cover everything live while flying, or the generated half is not the whole story.
 * Rows in other categories -- menus, photo mode -- and every other group pass through.
 */
export function applyVocabulary(
  file: IniFile,
  actions: ActionSet,
  owned: ReadonlySet<number>,
): { text: string; changes: IngameChange[] } {
  const rows = keyboardRows(file);
  const byRow = new Map<string, string>();
  const problems: string[] = [];

  for (const [id, spec] of Object.entries(actions.actions)) {
    if (spec.ingame === undefined) continue;
    const key = rowId(spec.ingame, spec.ingame_scale);
    const row = rows.get(key);
    if (!row) {
      problems.push(
        `${id}: the game has no keyboard row '${spec.ingame}'` +
          (spec.ingame_scale === undefined ? "" : ` at scale ${String(spec.ingame_scale)}`),
      );
      continue;
    }
    if (!owned.has(row.category)) {
      problems.push(
        `${id}: '${spec.ingame}' is in category ${String(row.category)}, which this game does ` +
          "not own -- add the category to ingame_owned_categories, or drop the reference",
      );
      continue;
    }
    const other = byRow.get(key);
    if (other !== undefined) problems.push(`${id} and ${other} both name '${spec.ingame}'`);
    if (spec.key && spec.meta) {
      problems.push(`${id}: a key with a modifier cannot be written as one game key`);
    }
    // An action that names a key the game's file has no spelling for would otherwise be
    // written as unbound, and the layout would quietly lose that binding in game.
    const sends = spec.mouse ?? spec.key ?? spec.meta;
    if (sends !== undefined && ueKeyFor(spec) === null) {
      problems.push(
        `${id}: '${sends}' has no Unreal key name, so '${spec.ingame}' cannot be bound to it -- ` +
          "use a key the game's file can spell, or remove the key to leave the row unbound",
      );
    }
    byRow.set(key, id);
  }

  for (const [key, row] of rows) {
    if (!owned.has(row.category) || byRow.has(key)) continue;
    problems.push(
      `'${row.action}' (${row.displayName}, category ${String(row.category)}) is owned but ` +
        "no action names it -- add one to actions.yaml, with no key to leave it unbound",
    );
  }
  if (problems.length > 0) throw new IngameError(problems.join("\n"));

  const lines = [...file.lines];
  const changes: IngameChange[] = [];
  for (const [key, row] of rows) {
    const id = byRow.get(key);
    if (id === undefined) continue;
    const spec = actions.actions[id];
    const to = (spec ? ueKeyFor(spec) : null) ?? "None";
    let line = setKey(row.raw, to);
    if (row.key2 !== "None") line = setKey2(line, "None");
    if (line === row.raw) continue;
    lines[row.index] = line;
    changes.push({
      action: row.action,
      display: row.displayName,
      category: row.category,
      from: row.key2 === "None" ? row.key : `${row.key} / ${row.key2}`,
      to,
      by: id,
    });
  }
  changes.sort((a, b) => a.category - b.category || a.action.localeCompare(b.action));
  return { text: lines.join(file.eol), changes };
}

/**
 * Keys two live rows share after generating, beyond the pairs the vocabulary allows. A
 * collision only counts inside the owned categories: menus reuse flight keys on purpose.
 */
export function ownedCollisions(
  file: IniFile,
  owned: ReadonlySet<number>,
): { key: string; actions: string[] }[] {
  const byKey = new Map<string, Set<string>>();
  for (const entry of file.entries) {
    if (entry.group !== KEYBOARD_GROUP || entry.isAxis) continue;
    if (!owned.has(entry.category) || entry.key === "None") continue;
    const set = byKey.get(entry.key) ?? new Set<string>();
    set.add(entry.displayName);
    byKey.set(entry.key, set);
  }
  return [...byKey.entries()]
    .filter(([, names]) => names.size > 1)
    .map(([key, names]) => ({ key, actions: [...names].sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------------------
// The Joystick group: axis rows, for the pedals
// ---------------------------------------------------------------------------------------
//
// The keyboard side is written from `actions.yaml`. The Joystick group's flight rows are
// axes (`bIsAxis=True`, `Key1=None`) waiting for a device, and a layout's pedals say which
// device axis goes on which. The same guarantees hold: only rows this generator owns are
// rewritten, only the fields it was told about change, and every other line -- the
// flight stick's button bindings above all -- is carried through byte for byte.

export const JOYSTICK_GROUP = "Joystick";

/** One pedal axis, resolved to the row it drives and the name the game gives it. */
export interface PedalRowBinding {
  pedalAxis: string;
  label: string;
  /** The row's `Action=`, e.g. `Yaw`. */
  row: string;
  /** The game's name for the axis, or null while it is still waiting for capture. */
  name: string | null;
  /** How far `name` is trusted. Generation writes any of them, and says which it was using. */
  status?: NameStatus;
  invert?: boolean;
  deadZone?: number;
  scale?: number;
  sensitivity?: number;
  exponent?: number;
}

export interface PedalPlan {
  /** In the order they take a row's slots: the first is Key1, a shared second is Key2. */
  bindings: readonly PedalRowBinding[];
  /** Every axis row the generator owns, assigned or not. */
  ownedRows: ReadonlySet<string>;
  /** Names the pedals are known by in this game; only these are ever cleared. */
  knownNames: ReadonlySet<string>;
}

export interface PedalChange {
  pedalAxis: string | null;
  row: string;
  display: string;
  /** `Key1`, `Key2`, `bInvert`, `DeadZone`, ... */
  field: string;
  from: string;
  to: string;
  /** How far the name written is trusted, for a change that wrote one. */
  status?: NameStatus;
}

export interface PedalWaiting {
  pedalAxis: string;
  label: string;
  row: string;
  display: string;
}

/** The Joystick axis rows by `Action=`. */
export function joystickAxisRows(file: IniFile): Map<string, IniEntry> {
  const rows = new Map<string, IniEntry>();
  for (const entry of file.entries) {
    if (entry.group === JOYSTICK_GROUP && entry.isAxis) rows.set(entry.action, entry);
  }
  return rows;
}

/**
 * A joystick input as the game names it: `JS<index>_<Device>_<Input>`, e.g.
 * `JS0_SaitekProFlightRudderPedals_Axis1`. The index is the game's own count of connected
 * devices and CAN BE NEGATIVE -- the flight stick's presets read `JS-1_T16000M_Button0`,
 * a stick that is not plugged in -- so `JS-1_` and `JS0_` are the same shape. The index
 * says nothing lasting about the device; the name between the underscores does.
 */
const JOYSTICK_KEY = /^JS(-?\d+)_(.+)_([^_]+)$/;

/** True for a key that is a joystick input, whatever its device and index. */
export function isJoystickKey(key: string): boolean {
  return JOYSTICK_KEY.test(key);
}

/** The device in a joystick input's name, or null for a key that is not one. */
export function joystickDeviceOf(name: string): string | null {
  return JOYSTICK_KEY.exec(name)?.[2] ?? null;
}

export interface JoystickAxisBinding {
  name: string;
  row: string;
  display: string;
  slot: "Key1" | "Key2";
}

/** Every joystick input sitting on a Joystick axis row, in file order. */
export function joystickAxisBindings(file: IniFile): JoystickAxisBinding[] {
  const found: JoystickAxisBinding[] = [];
  for (const entry of file.entries) {
    if (entry.group !== JOYSTICK_GROUP || !entry.isAxis) continue;
    for (const [slot, name] of [
      ["Key1", entry.key],
      ["Key2", entry.key2],
    ] as const) {
      if (isJoystickKey(name)) {
        found.push({ name, row: entry.action, display: entry.displayName, slot });
      }
    }
  }
  return found;
}

function setField(line: string, field: string, value: string): string {
  return line.replace(new RegExp(`([,(])${field}=[^,)]*`), `$1${field}=${value}`);
}

const number = (value: number): string => value.toFixed(6);
const flag = (value: boolean): string => (value ? "True" : "False");

/**
 * Write a layout's pedal axes into the Joystick group.
 *
 * A pedal axis whose game name has not been captured is reported as waiting and writes
 * nothing -- the name is a fact about a real file, never made up. `strict` turns waiting
 * into a refusal, for a caller that wants the pedals bound or nothing.
 *
 * Refused, with the axis named: a row the game does not have; a name that would break the
 * line; a slot already holding a binding this layout did not put there and cannot
 * recognise (a flight stick on the yaw axis is not ours to overwrite).
 */
export function applyPedalRows(
  file: IniFile,
  plan: PedalPlan,
  options: { strict?: boolean } = {},
): { text: string; changes: PedalChange[]; waiting: PedalWaiting[] } {
  const rows = joystickAxisRows(file);
  const problems: string[] = [];
  const waiting: PedalWaiting[] = [];
  const byRow = new Map<string, PedalRowBinding[]>();

  const names = new Map<string, string>();
  for (const binding of plan.bindings) {
    const list = byRow.get(binding.row) ?? [];
    list.push(binding);
    byRow.set(binding.row, list);
    const row = rows.get(binding.row);
    if (!row) {
      problems.push(
        `${binding.pedalAxis}: the game has no Joystick axis row '${binding.row}' to put it on`,
      );
      continue;
    }
    if (binding.name === null) {
      waiting.push({
        pedalAxis: binding.pedalAxis,
        label: binding.label,
        row: binding.row,
        display: row.displayName,
      });
      continue;
    }
    if (/[,()=\r\n"]/.test(binding.name) || binding.name.trim() === "") {
      problems.push(
        `${binding.pedalAxis}: '${binding.name}' cannot be written into the game's file`,
      );
    }
    const other = names.get(binding.name);
    if (other !== undefined) {
      problems.push(`${binding.pedalAxis} and ${other} have the same game name '${binding.name}'`);
    }
    names.set(binding.name, binding.pedalAxis);
  }
  if (options.strict === true) {
    for (const entry of waiting) {
      problems.push(
        `${entry.pedalAxis} (${entry.label}): its game name has not been captured -- bind it ` +
          `on the '${entry.row}' axis in the game, then run \`azeron ingame --capture-pedals\``,
      );
    }
  }

  const lines = [...file.lines];
  const changes: PedalChange[] = [];
  for (const rowName of plan.ownedRows) {
    const row = rows.get(rowName);
    if (!row) continue;
    const bindings = byRow.get(rowName) ?? [];
    let line = row.raw;
    const note = (
      axis: string | null,
      field: string,
      from: string,
      to: string,
      status?: NameStatus,
    ): void => {
      changes.push({
        pedalAxis: axis,
        row: rowName,
        display: row.displayName,
        field,
        from,
        to,
        ...(status === undefined ? {} : { status }),
      });
    };

    (
      [
        ["Key1", row.key],
        ["Key2", row.key2],
      ] as const
    ).forEach(([slot, current], index) => {
      const binding = bindings[index];
      if (binding === undefined) {
        // Nothing assigned to this slot. A pedal name left by an earlier layout goes; any
        // other binding is not ours and stays.
        if (current !== "None" && plan.knownNames.has(current)) {
          line = setField(line, slot, "None");
          note(null, slot, current, "None");
        }
        return;
      }
      if (binding.name === null || current === binding.name) return;
      if (current !== "None" && !plan.knownNames.has(current)) {
        problems.push(
          `${binding.pedalAxis}: ${slot} of '${rowName}' is bound to ${current}, which is not a ` +
            "pedal this layout knows -- clear it in the game's controls screen first",
        );
        return;
      }
      line = setField(line, slot, binding.name);
      note(binding.pedalAxis, slot, current, binding.name, binding.status);
    });

    // Tuning goes on the row, once a name is there for it to tune.
    for (const binding of bindings) {
      if (binding.name === null) continue;
      const tuning: [string, string | undefined][] = [
        ["bInvert", binding.invert === undefined ? undefined : flag(binding.invert)],
        ["DeadZone", binding.deadZone === undefined ? undefined : number(binding.deadZone)],
        ["Scale", binding.scale === undefined ? undefined : number(binding.scale)],
        [
          "Sensitivity",
          binding.sensitivity === undefined ? undefined : number(binding.sensitivity),
        ],
        ["Exponent", binding.exponent === undefined ? undefined : number(binding.exponent)],
      ];
      for (const [field, value] of tuning) {
        if (value === undefined) continue;
        const was = FIELD(line, field);
        if (was === null) {
          problems.push(`${binding.pedalAxis}: '${rowName}' has no ${field} to set`);
        } else if (was !== value) {
          line = setField(line, field, value);
          note(binding.pedalAxis, field, was, value);
        }
      }
    }
    if (line !== row.raw) lines[row.index] = line;
  }

  if (problems.length > 0) throw new IngameError(problems.join("\n"));
  return { text: lines.join(file.eol), changes, waiting };
}
