/**
 * The wiring: which key carries an action from a keypad to the game.
 *
 * A layout says which control does which action. The key in between is not something the
 * owner chooses or needs to see: the keypad has to send something, the game has to listen
 * for the same thing, and any key that nothing else is on will do. This module picks one.
 *
 * A key, once given, is written into the game's `actions.yaml` and stays. Nothing is
 * re-dealt: the compiled layouts, the golden fixture and the game's own file all depend on
 * an action keeping the key it has.
 *
 * Node-free, because the editor imports it.
 */

import type { ActionSpec } from "../types/profile.js";

/**
 * Keys the editor may hand out, most out of the way first.
 *
 * Left out on purpose: letters, digits and F1 to F11, which a game's own defaults and its
 * menus use; F12, which Steam takes for screenshots; Enter, Space, Tab, Escape, Backspace
 * and Caps Lock, which mean something in every menu and text box; and the modifiers, which
 * change what other keys do. The numpad digits come late because Windows reads them as
 * navigation keys when Num Lock is off, and the backquote last because games put a console
 * on it.
 */
export const WIRE_POOL: readonly string[] = [
  "Insert",
  "Home",
  "PageUp",
  "Delete",
  "End",
  "PageDown",
  "NumpadAdd",
  "NumpadSubtract",
  "NumpadMultiply",
  "NumpadDivide",
  "BracketLeft",
  "BracketRight",
  "Semicolon",
  "Quote",
  "Comma",
  "Period",
  "Slash",
  "Backslash",
  "Minus",
  "Numpad0",
  "Numpad1",
  "Numpad2",
  "Numpad3",
  "Numpad4",
  "Numpad5",
  "Numpad6",
  "Numpad7",
  "Numpad8",
  "Numpad9",
  "NumpadDecimal",
  "Backquote",
];

/** Whether a control with this action on it would send anything at all. */
export function sendsSomething(spec: ActionSpec | undefined): boolean {
  if (spec === undefined) return false;
  return [spec.key, spec.meta, spec.mouse].some((value) => value !== undefined && value !== null);
}

/**
 * Whether an action has to be given a key before a control can carry it. An action the
 * unit's sensor supplies is not a key and never gets one.
 */
export function needsWire(spec: ActionSpec | undefined): boolean {
  return spec !== undefined && !spec.provided_by && !sendsSomething(spec);
}

/**
 * The first key in the pool that no action of the game is on, or null when the pool is
 * spent. `usable` narrows the pool to what the game can be told to listen for: a key the
 * game's file has no name for would be sent and never heard.
 */
export function freeKey(
  actions: Readonly<Record<string, ActionSpec>>,
  usable: (key: string) => boolean = () => true,
): string | null {
  const taken = new Set<string>();
  for (const spec of Object.values(actions)) {
    for (const value of [spec.key, spec.meta]) {
      if (typeof value === "string") taken.add(value);
    }
  }
  return WIRE_POOL.find((key) => !taken.has(key) && usable(key)) ?? null;
}

/**
 * Give `id` a key if it has none. Returns the key it was given, or null when it needed
 * none, is not an action, or there was no key left to give. `actions` is changed in place.
 */
export function wireAction(
  actions: Record<string, ActionSpec>,
  id: string,
  usable?: (key: string) => boolean,
): string | null {
  const spec = actions[id];
  if (!needsWire(spec)) return null;
  const key = freeKey(actions, usable);
  if (key === null) return null;
  actions[id] = { ...spec, key };
  return key;
}
