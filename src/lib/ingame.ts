/**
 * The game's own binding file.
 *
 * Everspace 2 keeps its bindings in `Input.ini` under
 * `[/Script/ES2.CustomPlayerInput]`, one `KeybindingsConfig=(...)` line per action and
 * input group (Keyboard, Gamepad, Joystick). Only `Key1` and `Key1Mod` on the Keyboard
 * rows are ever rewritten; every other field on every other line is carried through
 * verbatim, because this file belongs to the game and most of it is not understood here.
 */

import type { ActionSpec } from "../types/profile.js";
import type { ActionSet } from "./model-core.js";

export const KEYBOARD_GROUP = "Keyboard";

export interface IniEntry {
  /** The whole line, so anything not rewritten survives exactly. */
  raw: string;
  action: string;
  group: string;
  key: string;
  scale: number;
  isAxis: boolean;
  displayName: string;
}

export interface IniFile {
  /** Lines in order; entries point back at their index. */
  lines: string[];
  entries: IniEntry[];
}

const FIELD = (line: string, name: string): string | null => {
  const match = new RegExp(`[,(]${name}=([^,)]*)`).exec(line);
  return match?.[1] ?? null;
};

export function parseInput(text: string): IniFile {
  const lines = text.split(/\r?\n/);
  const entries: IniEntry[] = [];
  lines.forEach((line) => {
    if (!line.startsWith("KeybindingsConfig=(")) return;
    const action = FIELD(line, "Action");
    if (action === null) return;
    const display = /DisplayName=NSLOCTEXT\("[^"]*",\s*"[^"]*",\s*"([^"]*)"\)/.exec(line);
    entries.push({
      raw: line,
      action,
      group: (FIELD(line, "GroupName") ?? "").replace(/"/g, ""),
      key: FIELD(line, "Key1") ?? "None",
      scale: Number(FIELD(line, "Scale") ?? "1"),
      isAxis: (FIELD(line, "bIsAxis") ?? "False") === "True",
      displayName: display?.[1] ?? action,
    });
  });
  return { lines, entries };
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
  Backspace: "BackSpace",
};
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
