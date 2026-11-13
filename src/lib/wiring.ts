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
 * Two ways to pick one. A game whose binding file the repo writes (Everspace 2, Elite) gets
 * a key from the pool below and is told it. A game whose file cannot be written gets the
 * key the game already listens for -- the action's keyboard binding, `kbm` -- so nothing
 * has to be changed in the game (`wireFromGame`); the pool is the fallback when that
 * binding is not one a unit can send or another action already sends it.
 *
 * Node-free, because the editor imports it.
 */

import type { ActionSpec } from "../types/profile.js";
import { isMouseToken, parseKbm } from "./controls.js";
import { ANALOG_KEYCODES, isModifier } from "./keys.js";
import { actionsLiveTogether, type LiveTogether } from "./modes.js";

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
  // Added 2026-11-10, at the end so no key already given moves: enough for a default
  // layout on both units. The arrows come late because menus use them. F13 to F24 come
  // last: on no keyboard sold today, so no game default is on them, but some games cannot
  // bind them at all (Unreal has no name for them), and a game whose file cannot name
  // them is skipped past them.
  "Equal",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "F13",
  "F14",
  "F15",
  "F16",
  "F17",
  "F18",
  "F19",
  "F20",
  "F21",
  "F22",
  "F23",
  "F24",
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
  /** Whether an action is live at the same time as the one being wired; only those count. */
  live: (other: ActionSpec) => boolean = () => true,
): string | null {
  const taken = new Set<string>();
  for (const spec of Object.values(actions)) {
    if (!live(spec)) continue;
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
  live?: (other: ActionSpec) => boolean,
): string | null {
  const spec = actions[id];
  if (!needsWire(spec)) return null;
  const key = freeKey(actions, usable, live);
  if (key === null) return null;
  actions[id] = { ...spec, key };
  return key;
}

/** What a unit sends for an action: a key, a modifier, both, or a mouse button. */
export interface UnitSend {
  key?: string;
  meta?: string;
  mouse?: string;
}

const UNIT_MOUSE: Readonly<Record<string, string>> = {
  MouseLeft: "left",
  MouseMiddle: "middle",
  MouseRight: "right",
};

/**
 * A keyboard-and-mouse binding as a unit would send it, or null when a unit cannot: two
 * modifiers held, the wheel, the side buttons, or a modifier with a mouse button.
 */
export function unitSendFor(kbm: unknown): UnitSend | null {
  const parsed = parseKbm(kbm);
  if (parsed === null || parsed.modifiers.length > 1) return null;
  const [modifier] = parsed.modifiers;
  const { input } = parsed;
  if (isMouseToken(input)) {
    const mouse = UNIT_MOUSE[input];
    return mouse === undefined || modifier !== undefined ? null : { mouse };
  }
  if (isModifier(input)) return modifier === undefined ? { meta: input } : null;
  // A key a stick direction could send as well as a button: the keycodes the app knows.
  if (!(input in ANALOG_KEYCODES)) return null;
  return modifier === undefined ? { key: input } : { meta: modifier, key: input };
}

/** Whether two sends would reach the game as the same press. */
function sameSend(a: UnitSend, b: ActionSpec): boolean {
  if (a.mouse !== undefined) return b.mouse === a.mouse;
  if (a.key !== undefined) return b.key === a.key && (b.meta ?? undefined) === a.meta;
  return b.meta === a.meta && (b.key === undefined || b.key === null);
}

/**
 * Give `id` the key the game already has it on, its `kbm`, when it has no key and a unit can
 * send that binding and no other action live with it sends the same. Returns what it was
 * given, or null -- and then the caller falls back to the pool. `actions` is changed in
 * place.
 */
export function wireFromGame(
  actions: Record<string, ActionSpec>,
  id: string,
  live: LiveTogether = () => true,
  /** The action is on a stick direction, which sends a plain key and nothing else. */
  onStick = false,
): UnitSend | null {
  const spec = actions[id];
  if (!needsWire(spec) || spec === undefined) return null;
  const send = unitSendFor(spec.kbm);
  if (send === null) return null;
  if (onStick && (send.key === undefined || send.meta !== undefined)) return null;
  const taken = Object.entries(actions).some(
    ([other, otherSpec]) =>
      other !== id && actionsLiveTogether(live, spec, otherSpec) && sameSend(send, otherSpec),
  );
  if (taken) return null;
  actions[id] = { ...spec, ...send };
  return send;
}
