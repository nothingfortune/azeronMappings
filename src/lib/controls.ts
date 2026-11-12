/**
 * What an action is on for a person playing without the keypads: a keyboard key or mouse
 * button (`kbm`) and an Xbox-style controller control (`pad`).
 *
 * These sit beside the key an Azeron control sends (`key`/`meta`/`mouse`, which the
 * compiler reads) and never reach the units: the compiler does not read them, so the
 * compiled layouts are unchanged by anything here. Node-free, because the editor imports it.
 */
import { ANALOG_KEYCODES, isModifier, keyLabel } from "./keys.js";
import { XBOX_CONTROLS, xboxLabel } from "./xbox.js";

/** Mouse buttons and the wheel, as a `kbm` binding names them. */
export const MOUSE_TOKENS = [
  "MouseLeft",
  "MouseRight",
  "MouseMiddle",
  "Mouse4",
  "Mouse5",
  "WheelUp",
  "WheelDown",
] as const;

const MOUSE_LABELS: Readonly<Record<string, string>> = {
  MouseLeft: "Left click",
  MouseRight: "Right click",
  MouseMiddle: "Middle click",
  Mouse4: "Mouse 4",
  Mouse5: "Mouse 5",
  WheelUp: "Wheel up",
  WheelDown: "Wheel down",
};

/** `MouseEvent.button` to its token: 0 left, 1 middle, 2 right, 3 and 4 the side buttons. */
export const MOUSE_BUTTON_TOKENS: Readonly<Record<number, string>> = {
  0: "MouseLeft",
  1: "MouseMiddle",
  2: "MouseRight",
  3: "Mouse4",
  4: "Mouse5",
};

/**
 * Every key a standard keyboard reports, by `KeyboardEvent.code`. The keypads' keycode
 * table is narrower -- it is what a keypad can send -- and a person's keyboard has more.
 */
const OTHER_KEYS = new Set([
  ...Array.from({ length: 26 }, (_, index) => `Key${String.fromCharCode(65 + index)}`),
  ...Array.from({ length: 10 }, (_, digit) => `Digit${String(digit)}`),
  ...Array.from({ length: 10 }, (_, digit) => `Numpad${String(digit)}`),
  ...Array.from({ length: 24 }, (_, index) => `F${String(index + 1)}`),
  "NumpadAdd",
  "NumpadSubtract",
  "NumpadMultiply",
  "NumpadDivide",
  "NumpadDecimal",
  "NumpadEnter",
  "NumpadEqual",
  "Escape",
  "Tab",
  "CapsLock",
  "Enter",
  "Backspace",
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Insert",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Backquote",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "IntlBackslash",
  "Semicolon",
  "Quote",
  "Comma",
  "Period",
  "Slash",
  "MetaLeft",
  "MetaRight",
  "ContextMenu",
  "PrintScreen",
  "ScrollLock",
  "Pause",
  "NumLock",
]);

function isKnownInput(input: string): boolean {
  return (
    input in ANALOG_KEYCODES ||
    OTHER_KEYS.has(input) ||
    isModifier(input) ||
    (MOUSE_TOKENS as readonly string[]).includes(input)
  );
}

/** A key as `KeyboardEvent.code` spells it, as far as a binding needs to check. */
const CODE = /^[A-Z][A-Za-z0-9]*$/;

export interface KbmBinding {
  /** Held with it, in the order written. */
  modifiers: string[];
  /** The key or mouse token pressed. */
  input: string;
}

/**
 * Read a `kbm` binding: `KeyR`, `ControlLeft+KeyR`, `MouseRight`, `ShiftLeft+WheelUp`, or a
 * modifier on its own (`ShiftLeft`). Null for anything else.
 */
export function parseKbm(token: unknown): KbmBinding | null {
  // A hand edit can leave a number or nothing here: that is not a binding, not a crash.
  if (typeof token !== "string") return null;
  const parts = token.split("+");
  if (parts.some((part) => !CODE.test(part))) return null;
  const input = parts.at(-1);
  if (input === undefined) return null;
  const modifiers = parts.slice(0, -1);
  if (!modifiers.every((part) => isModifier(part))) return null;
  // A real key or mouse button, not anything that looks like one: `KeyRR` is a typo.
  if (!isKnownInput(input)) return null;
  if (new Set(modifiers).size !== modifiers.length || modifiers.includes(input)) return null;
  return { modifiers, input };
}

/**
 * One spelling per chord: modifiers in a fixed order, so Ctrl+Shift+R and Shift+Ctrl+R --
 * the same keys, pressed in another order -- are one binding. A token that is not a
 * binding comes back as it was.
 */
export function canonicalKbm(token: string): string {
  const parsed = parseKbm(token);
  if (parsed === null) return token;
  return [...[...parsed.modifiers].sort(), parsed.input].join("+");
}

export function isMouseToken(token: string): boolean {
  return (MOUSE_TOKENS as readonly string[]).includes(token);
}

/** A binding in words: "Ctrl + R", "Right click", "Shift + Wheel up". */
export function kbmLabel(token: unknown): string {
  const parsed = parseKbm(token);
  if (parsed === null) return typeof token === "string" ? token : "—";
  const name = (part: string): string => MOUSE_LABELS[part] ?? keyLabel(part);
  return [...parsed.modifiers, parsed.input].map(name).join(" + ");
}

/** The pad's controls, in the order a pad is read: face buttons first. */
export const PAD_CONTROLS: readonly string[] = Object.keys(XBOX_CONTROLS);

export function isPadControl(control: unknown): boolean {
  return typeof control === "string" && control in XBOX_CONTROLS;
}

export const padLabel = xboxLabel;

/**
 * The browser's Gamepad API "standard" mapping: button index to control. Chrome and Edge
 * give every pad they recognise this layout, Xbox and PlayStation alike.
 */
export const STANDARD_BUTTONS: readonly (string | null)[] = [
  "A",
  "B",
  "X",
  "Y",
  "LB",
  "RB",
  "LT",
  "RT",
  "View",
  "Menu",
  "LS",
  "RS",
  "DpadUp",
  "DpadDown",
  "DpadLeft",
  "DpadRight",
];

/** How far a stick must be pushed to count as a direction: past the drift of a worn one. */
const STICK_THRESHOLD = 0.6;

/**
 * The control being pressed on a pad, as the Gamepad API reports it, or null when nothing
 * is. A button wins over a stick, and the stick pushed furthest wins between the two.
 */
export function padControlFrom(
  buttons: readonly { pressed: boolean }[],
  axes: readonly number[],
): string | null {
  const button = buttons.findIndex((entry) => entry.pressed);
  if (button !== -1) return STANDARD_BUTTONS[button] ?? null;
  const sticks: [string, number, number][] = [
    ["Left", axes[0] ?? 0, axes[1] ?? 0],
    ["Right", axes[2] ?? 0, axes[3] ?? 0],
  ];
  let best: { control: string; amount: number } | null = null;
  for (const [stick, x, y] of sticks) {
    const along = Math.abs(x) >= Math.abs(y);
    const amount = along ? Math.abs(x) : Math.abs(y);
    if (amount < STICK_THRESHOLD) continue;
    // The Gamepad API reads up as negative.
    const direction = along ? (x < 0 ? "Left" : "Right") : y < 0 ? "Up" : "Down";
    if (best === null || amount > best.amount) {
      best = { control: `${stick}Stick${direction}`, amount };
    }
  }
  return best?.control ?? null;
}

/** Words a person writes for a key, lower case, to the key's code. */
const KEY_WORDS: Readonly<Record<string, string>> = {
  space: "Space",
  spacebar: "Space",
  tab: "Tab",
  enter: "Enter",
  return: "Enter",
  esc: "Escape",
  escape: "Escape",
  backspace: "Backspace",
  caps: "CapsLock",
  capslock: "CapsLock",
  shift: "ShiftLeft",
  lshift: "ShiftLeft",
  "left shift": "ShiftLeft",
  rshift: "ShiftRight",
  "right shift": "ShiftRight",
  ctrl: "ControlLeft",
  control: "ControlLeft",
  lctrl: "ControlLeft",
  "left ctrl": "ControlLeft",
  rctrl: "ControlRight",
  "right ctrl": "ControlRight",
  alt: "AltLeft",
  lalt: "AltLeft",
  "left alt": "AltLeft",
  ralt: "AltRight",
  "right alt": "AltRight",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  "up arrow": "ArrowUp",
  "down arrow": "ArrowDown",
  "left arrow": "ArrowLeft",
  "right arrow": "ArrowRight",
  insert: "Insert",
  ins: "Insert",
  delete: "Delete",
  del: "Delete",
  home: "Home",
  end: "End",
  pgup: "PageUp",
  "page up": "PageUp",
  pgdn: "PageDown",
  "page down": "PageDown",
  "`": "Backquote",
  "~": "Backquote",
  tilde: "Backquote",
  "-": "Minus",
  "=": "Equal",
  "[": "BracketLeft",
  "]": "BracketRight",
  ";": "Semicolon",
  "'": "Quote",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "left click": "MouseLeft",
  lmb: "MouseLeft",
  mouse1: "MouseLeft",
  "right click": "MouseRight",
  rmb: "MouseRight",
  mouse2: "MouseRight",
  "middle click": "MouseMiddle",
  mmb: "MouseMiddle",
  mouse3: "MouseMiddle",
  mouse4: "Mouse4",
  "mouse 4": "Mouse4",
  mouse5: "Mouse5",
  "mouse 5": "Mouse5",
  "wheel up": "WheelUp",
  "scroll up": "WheelUp",
  "wheel down": "WheelDown",
  "scroll down": "WheelDown",
};

/** Words for the pad's controls besides their own names, lower case. */
const PAD_WORDS: Readonly<Record<string, string>> = {
  back: "View",
  select: "View",
  view: "View",
  start: "Menu",
  menu: "Menu",
  l1: "LB",
  r1: "RB",
  l2: "LT",
  r2: "RT",
  l3: "LS",
  r3: "RS",
};

/** One key written in words -- "R", "F5", "Shift", "Left click", "Numpad 4" -- or null. */
function keyFromWord(word: string): string | null {
  const text = word.trim().toLowerCase().replace(/\s+/g, " ");
  if (text === "") return null;
  const named = KEY_WORDS[text];
  if (named !== undefined) return named;
  if (/^[a-z]$/.test(text)) return `Key${text.toUpperCase()}`;
  if (/^[0-9]$/.test(text)) return `Digit${text}`;
  const fn = /^f([1-9]|1[0-9]|2[0-4])$/.exec(text);
  if (fn?.[1] !== undefined) return `F${fn[1]}`;
  const pad = /^num(?:pad)? ?([0-9])$/.exec(text);
  if (pad?.[1] !== undefined) return `Numpad${pad[1]}`;
  // Already a code, as the editor writes one: KeyR, ShiftLeft, MouseRight.
  const code = word.trim();
  return parseKbm(code) === null ? null : code;
}

/** A controller control written in words -- "A", "RT", "D-pad up", "Left stick up" -- or null. */
function padFromWords(words: string): string | null {
  const text = words.trim().toLowerCase().replace(/\s+/g, " ");
  if (text === "") return null;
  const word = PAD_WORDS[text];
  if (word !== undefined) return word;
  return (
    PAD_CONTROLS.find(
      (control) => control.toLowerCase() === text || padLabel(control).toLowerCase() === text,
    ) ?? null
  );
}

/**
 * A binding written in words, as someone listing a game's controls would: a key with any
 * modifiers ("Ctrl + R", "Shift"), a mouse button ("Right click"), or a controller control
 * ("RT", "D-pad up"). A part that is neither comes back in `unread`, to be said, not guessed.
 * A single letter is read as a key, so a pad's A, B, X and Y are written as "A button".
 */
export function bindingFromWords(text: string): { kbm?: string; pad?: string; unread: string[] } {
  const out: { kbm?: string; pad?: string; unread: string[] } = { unread: [] };
  for (const part of text.split(/\s*[/|]\s*|\s*,\s*/)) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const asButton = /^(.+?)\s+button$/i.exec(trimmed)?.[1];
    if (asButton === undefined && out.kbm === undefined) {
      const keys = trimmed.split(/\s*\+\s*/).map(keyFromWord);
      if (keys.every((key): key is string => key !== null)) {
        const chord = canonicalKbm(keys.join("+"));
        if (parseKbm(chord) !== null) {
          out.kbm = chord;
          continue;
        }
      }
    }
    const pad = padFromWords(asButton ?? trimmed);
    if (pad !== null && out.pad === undefined) {
      out.pad = pad;
      continue;
    }
    out.unread.push(trimmed);
  }
  return out;
}

/** One control on a line of a list: "Reload: R / X button", or just "Reload". */
export function controlFromLine(
  line: string,
): { label: string; kbm?: string; pad?: string; unread: string[] } | null {
  const trimmed = line.trim().replace(/^[-*•]\s*/, "");
  if (trimmed === "") return null;
  const colon = trimmed.indexOf(":");
  const label = (colon === -1 ? trimmed : trimmed.slice(0, colon)).trim();
  if (label === "") return null;
  if (colon === -1) return { label, unread: [] };
  return { label, ...bindingFromWords(trimmed.slice(colon + 1)) };
}
