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
