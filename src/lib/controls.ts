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

/** Keys a keyboard has that the keypads' keycode table leaves out. */
const OTHER_KEYS = new Set([
  "CapsLock",
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
