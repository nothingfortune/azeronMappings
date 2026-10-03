/**
 * Translation between human-readable key names and Azeron export tokens.
 *
 * The export mixes two encodings for the same concept:
 *   - `KeyboardEvent.code` strings -- "KeyF", "Digit1", "F4", "Escape"
 *   - legacy numeric JS keyCodes as strings -- "37".."40" (arrows), "16" (Shift)
 *
 * Which one the Azeron app writes depends on the key, so the tables below record what
 * has actually been observed in a real export rather than a guess. Any token that does
 * not survive name -> token -> name is preserved verbatim by the decompiler, so an
 * unfamiliar encoding is never silently rewritten.
 */

export const NONE_TOKEN = "0";

/** Numeric token to canonical name, for tokens observed in the wild. */
export const LEGACY_KEY_TOKENS: Record<string, string> = {
  "8": "Backspace",
  "9": "Tab",
  "13": "Enter",
  "16": "ShiftLeft",
  "17": "ControlLeft",
  "18": "AltLeft",
  "27": "Escape",
  "32": "Space",
  "37": "ArrowLeft",
  "38": "ArrowUp",
  "39": "ArrowRight",
  "40": "ArrowDown",
};

/** Names the app writes numerically in key slots (verified in everspace2-v5). */
export const EMIT_NUMERIC_KEYS = ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"];

/**
 * Names the app writes numerically in modifier slots.
 *
 * Empty as of 2026-09-28: everspace2-v5 (software 2.0.x, older profile) holds Shift as
 * the legacy "16", but a profile edited in 2.0.2 writes "ShiftLeft". The code string is
 * emitted for new output; "16" is still read, and is preserved as a raw value when a
 * template carries it.
 */
export const EMIT_NUMERIC_METAS: string[] = [];

const NAME_TO_LEGACY: Record<string, string> = Object.fromEntries(
  Object.entries(LEGACY_KEY_TOKENS).map(([token, name]) => [name, token]),
);

/**
 * Mouse button codes.
 *
 * All three confirmed 2026-09-29 from two sides at once: a profile labelled "Fire
 * Primary" sends 1 and "Fire Secondary" sends 3, and Everspace 2's own config binds
 * FirePrimary to LeftMouseButton and FireSecondary to RightMouseButton. 2 was already
 * confirmed as middle in the app UI.
 */
export const MOUSE_BUTTONS: Record<string, string> = {
  "1": "left",
  "2": "middle",
  "3": "right",
};
const MOUSE_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(MOUSE_BUTTONS).map(([code, name]) => [name, code]),
);

/** Keyboard-mode stick directions store integer JS keyCodes. */
export const ANALOG_KEYCODES: Record<string, number> = {
  KeyA: 65,
  KeyB: 66,
  KeyC: 67,
  KeyD: 68,
  KeyE: 69,
  KeyF: 70,
  KeyG: 71,
  KeyH: 72,
  KeyI: 73,
  KeyJ: 74,
  KeyK: 75,
  KeyL: 76,
  KeyM: 77,
  KeyN: 78,
  KeyO: 79,
  KeyP: 80,
  KeyQ: 81,
  KeyR: 82,
  KeyS: 83,
  KeyT: 84,
  KeyU: 85,
  KeyV: 86,
  KeyW: 87,
  KeyX: 88,
  KeyY: 89,
  KeyZ: 90,
  Digit0: 48,
  Digit1: 49,
  Digit2: 50,
  Digit3: 51,
  Digit4: 52,
  Digit5: 53,
  Digit6: 54,
  Digit7: 55,
  Digit8: 56,
  Digit9: 57,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Space: 32,
  Tab: 9,
  Escape: 27,
  Enter: 13,
  ShiftLeft: 16,
  ControlLeft: 17,
  AltLeft: 18,
  // F1-F12 are 112-123. The function keys are verified as ordinary bindings (v5 sends
  // F1, F2, F4, F9 and F10); whether the firmware accepts one in a stick direction is
  // not. Without them an action like hover -- F9 and F10 in Everspace 2 -- could never
  // sit on a stick at all.
  F1: 112,
  F2: 113,
  F3: 114,
  F4: 115,
  F5: 116,
  F6: 117,
  F7: 118,
  F8: 119,
  F9: 120,
  F10: 121,
  F11: 122,
  F12: 123,
  // The keys the editor hands out when it wires an action (WIRE_POOL in wiring.ts), with
  // their standard keyCodes, so an action given one can sit on a stick direction as well as
  // on a key. Like the function keys, not yet seen in a stick direction of a real export.
  Insert: 45,
  Home: 36,
  PageUp: 33,
  Delete: 46,
  End: 35,
  PageDown: 34,
  NumpadAdd: 107,
  NumpadSubtract: 109,
  NumpadMultiply: 106,
  NumpadDivide: 111,
  BracketLeft: 219,
  BracketRight: 221,
  Semicolon: 186,
  Quote: 222,
  Comma: 188,
  Period: 190,
  Slash: 191,
  Backslash: 220,
  Minus: 189,
  Numpad0: 96,
  Numpad1: 97,
  Numpad2: 98,
  Numpad3: 99,
  Numpad4: 100,
  Numpad5: 101,
  Numpad6: 102,
  Numpad7: 103,
  Numpad8: 104,
  Numpad9: 105,
  NumpadDecimal: 110,
  Backquote: 192,
};

const ANALOG_BY_CODE: Record<number, string> = Object.fromEntries(
  Object.entries(ANALOG_KEYCODES).map(([name, code]) => [code, name]),
);

function isEmpty(token: string | number | null | undefined): boolean {
  return token === null || token === undefined || token === NONE_TOKEN || token === 0;
}

/** Export key token to canonical name, or null when the slot is empty. */
export function keyToName(token: string | number | null | undefined): string | null {
  if (isEmpty(token)) return null;
  const text = String(token);
  return LEGACY_KEY_TOKENS[text] ?? text;
}

export function nameToKey(name: string | null | undefined): string {
  if (name === null || name === undefined) return NONE_TOKEN;
  return EMIT_NUMERIC_KEYS.includes(name) ? (NAME_TO_LEGACY[name] ?? name) : name;
}

export function metaToName(token: string | number | null | undefined): string | null {
  if (isEmpty(token)) return null;
  const text = String(token);
  return LEGACY_KEY_TOKENS[text] ?? text;
}

export function nameToMeta(name: string | null | undefined): string {
  if (name === null || name === undefined) return NONE_TOKEN;
  return EMIT_NUMERIC_METAS.includes(name) ? (NAME_TO_LEGACY[name] ?? name) : name;
}

export function mouseToName(token: string | number | null | undefined): string | null {
  if (isEmpty(token)) return null;
  return MOUSE_BUTTONS[String(token)] ?? null;
}

export function nameToMouse(name: string | null | undefined): string | null {
  if (name === null || name === undefined) return null;
  return MOUSE_BY_NAME[name] ?? null;
}

/**
 * Stick directions appear in two encodings: everspace2-v5 holds integer JS keycodes
 * (87 for W), while a profile edited in 2.0.2 holds `KeyboardEvent.code` strings
 * ("ArrowUp"). Both resolve to the same name.
 */
export function analogToName(code: string | number | null | undefined): string | null {
  if (isEmpty(code)) return null;
  const parsed = Number(code);
  if (Number.isFinite(parsed)) return ANALOG_BY_CODE[parsed] ?? null;
  const text = String(code);
  return text in ANALOG_KEYCODES ? text : null;
}

export function nameToAnalog(name: string | null | undefined): number | null {
  if (name === null || name === undefined) return 0;
  return ANALOG_KEYCODES[name] ?? null;
}

/** True when a token survives token -> name -> token unchanged. */
export function keyRoundTrips(token: string | number | null | undefined): boolean {
  const expected = isEmpty(token) ? NONE_TOKEN : String(token);
  return nameToKey(keyToName(token)) === expected;
}

export function metaRoundTrips(token: string | number | null | undefined): boolean {
  const expected = isEmpty(token) ? NONE_TOKEN : String(token);
  return nameToMeta(metaToName(token)) === expected;
}

/** Names for keys whose code does not say what is printed on them. */
const KEY_LABELS: Record<string, string> = {
  ShiftLeft: "Left Shift",
  ShiftRight: "Right Shift",
  ControlLeft: "Left Ctrl",
  ControlRight: "Right Ctrl",
  AltLeft: "Left Alt",
  AltRight: "Right Alt",
  ArrowUp: "↑ Up",
  ArrowDown: "↓ Down",
  ArrowLeft: "← Left",
  ArrowRight: "→ Right",
  Space: "Space",
  Enter: "Enter",
  Escape: "Esc",
  Tab: "Tab",
  Backspace: "Backspace",
  CapsLock: "Caps Lock",
  Equal: "=",
  Minus: "-",
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Insert: "Insert",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "Page Up",
  PageDown: "Page Down",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
  NumpadMultiply: "Num *",
  NumpadDivide: "Num /",
  NumpadDecimal: "Num .",
  NumpadEnter: "Num Enter",
};

/**
 * A key the way it is printed on the keyboard, for a person to read.
 *
 * The names this repo stores are `KeyboardEvent.code` -- `KeyW`, `Digit5`, `ShiftLeft` --
 * which is right for a file and wrong for a screen. Anything not recognised is shown as
 * stored rather than guessed at.
 */
export function keyLabel(name: string): string {
  const known = KEY_LABELS[name];
  if (known !== undefined) return known;
  const letter = /^Key([A-Z])$/.exec(name);
  if (letter?.[1]) return letter[1];
  const digit = /^Digit([0-9])$/.exec(name);
  if (digit?.[1]) return digit[1];
  const numpad = /^Numpad([0-9])$/.exec(name);
  if (numpad?.[1]) return `Num ${numpad[1]}`;
  return name;
}

/** Whether a key is a modifier, which the game and the app treat as a key of its own. */
export function isModifier(name: string): boolean {
  return /^(Shift|Control|Alt|Meta)(Left|Right)$/.test(name);
}

/** What a binding sends, for a person: "W", "Left Shift", "Left mouse button". */
export function bindingLabel(spec: {
  key?: string | null;
  meta?: string | null;
  mouse?: string | null;
}): string | null {
  if (spec.mouse) return `${spec.mouse[0]?.toUpperCase() ?? ""}${spec.mouse.slice(1)} mouse button`;
  const parts = [spec.meta, spec.key].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.map(keyLabel).join(" + ") : null;
}
