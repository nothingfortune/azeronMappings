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

/** "2" = middle click is confirmed in the app UI. The rest are not, so they are absent. */
export const MOUSE_BUTTONS: Record<string, string> = { "2": "middle" };
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

export function analogToName(code: string | number | null | undefined): string | null {
  if (isEmpty(code)) return null;
  const parsed = Number(code);
  return Number.isFinite(parsed) ? (ANALOG_BY_CODE[parsed] ?? null) : null;
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
