/**
 * A keyboard, a mouse and a controller, drawn with what each key or control does in the
 * game: the keyboard-and-mouse and controller bindings of every action, at a glance.
 *
 * Drawn from the bindings, never edited here: a bound key is a button that says which
 * action it is and calls `pick` with it, so the page can take the owner to that action.
 */
import { kbmLabel, padLabel, parseKbm } from "../lib/controls.js";
import type { ActionSpec } from "../types/profile.js";

type El = HTMLElement;

function el(tag: string, attrs: Record<string, string> = {}, children: (El | string)[] = []): El {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

/** A keyboard's rows, by `KeyboardEvent.code`, with a width in key units where not 1. */
const KEYBOARD: readonly (readonly [string, number?][])[] = [
  [
    ["Escape"],
    ["F1"],
    ["F2"],
    ["F3"],
    ["F4"],
    ["F5"],
    ["F6"],
    ["F7"],
    ["F8"],
    ["F9"],
    ["F10"],
    ["F11"],
    ["F12"],
  ],
  [
    ["Backquote"],
    ["Digit1"],
    ["Digit2"],
    ["Digit3"],
    ["Digit4"],
    ["Digit5"],
    ["Digit6"],
    ["Digit7"],
    ["Digit8"],
    ["Digit9"],
    ["Digit0"],
    ["Minus"],
    ["Equal"],
    ["Backspace", 2],
  ],
  [
    ["Tab", 1.5],
    ["KeyQ"],
    ["KeyW"],
    ["KeyE"],
    ["KeyR"],
    ["KeyT"],
    ["KeyY"],
    ["KeyU"],
    ["KeyI"],
    ["KeyO"],
    ["KeyP"],
    ["BracketLeft"],
    ["BracketRight"],
    ["Backslash", 1.5],
  ],
  [
    ["CapsLock", 1.75],
    ["KeyA"],
    ["KeyS"],
    ["KeyD"],
    ["KeyF"],
    ["KeyG"],
    ["KeyH"],
    ["KeyJ"],
    ["KeyK"],
    ["KeyL"],
    ["Semicolon"],
    ["Quote"],
    ["Enter", 2.25],
  ],
  [
    ["ShiftLeft", 2.25],
    ["KeyZ"],
    ["KeyX"],
    ["KeyC"],
    ["KeyV"],
    ["KeyB"],
    ["KeyN"],
    ["KeyM"],
    ["Comma"],
    ["Period"],
    ["Slash"],
    ["ShiftRight", 2.75],
  ],
  [
    ["ControlLeft", 1.5],
    ["AltLeft", 1.5],
    ["Space", 6],
    ["AltRight", 1.5],
    ["ControlRight", 1.5],
    ["ArrowLeft"],
    ["ArrowUp"],
    ["ArrowDown"],
    ["ArrowRight"],
  ],
];

const MOUSE = [
  "MouseLeft",
  "MouseMiddle",
  "MouseRight",
  "WheelUp",
  "WheelDown",
  "Mouse4",
  "Mouse5",
];

/** The pad's controls laid out as a pad is held: shoulders, then the two halves. */
const PAD: readonly (readonly string[])[] = [
  ["LT", "LB", "View", "Menu", "RB", "RT"],
  ["LeftStickUp", "DpadUp", "LS", "RS", "Y", "RightStickUp"],
  [
    "LeftStickLeft",
    "LeftStickRight",
    "DpadLeft",
    "DpadRight",
    "X",
    "B",
    "RightStickLeft",
    "RightStickRight",
  ],
  ["LeftStickDown", "DpadDown", "A", "RightStickDown"],
];

/** Which actions are on each key or control; a chord counts on the key pressed last. */
function byBinding(
  actions: Readonly<Record<string, ActionSpec>>,
  field: "kbm" | "pad",
): Map<string, { id: string; label: string; chord?: string }[]> {
  const found = new Map<string, { id: string; label: string; chord?: string }[]>();
  for (const [id, spec] of Object.entries(actions)) {
    const value = spec[field];
    if (typeof value !== "string") continue;
    let at = value;
    let chord: string | undefined;
    if (field === "kbm") {
      const parsed = parseKbm(value);
      if (parsed === null) continue;
      at = parsed.input;
      if (parsed.modifiers.length > 0) chord = kbmLabel(value);
    }
    const list = found.get(at) ?? [];
    list.push({ id, label: spec.label ?? id, ...(chord === undefined ? {} : { chord }) });
    found.set(at, list);
  }
  return found;
}

/** A key's short name on the drawing: "Q", "Shift", "Space". */
function shortName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  const named: Record<string, string> = {
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    ShiftLeft: "Shift",
    ShiftRight: "Shift",
    ControlLeft: "Ctrl",
    ControlRight: "Ctrl",
    AltLeft: "Alt",
    AltRight: "Alt",
    ArrowLeft: "←",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowRight: "→",
    Escape: "Esc",
    CapsLock: "Caps",
    Backspace: "⌫",
  };
  return named[code] ?? kbmLabel(code);
}

function cap(
  name: string,
  actions: { id: string; label: string; chord?: string }[] | undefined,
  pick: (id: string) => void,
  width = 1,
): El {
  const bound = actions !== undefined && actions.length > 0;
  const node = el("button", {
    type: "button",
    class: `device-key${bound ? " bound" : ""}${(actions?.length ?? 0) > 1 ? " shared" : ""}`,
    style: `--w: ${String(width)}`,
  });
  node.append(el("span", { class: "device-key-name" }, [name]));
  if (bound) {
    const first = actions[0];
    node.append(el("span", { class: "device-key-action" }, [first?.label ?? ""]));
    node.title = actions
      .map((entry) => (entry.chord === undefined ? entry.label : `${entry.label} (${entry.chord})`))
      .join("\n");
    node.setAttribute("data-action", first?.id ?? "");
    node.addEventListener("click", () => {
      if (first !== undefined) pick(first.id);
    });
  } else {
    node.setAttribute("disabled", "disabled");
  }
  return node;
}

/** The keyboard and the mouse, each key showing the action on it. */
export function keyboardBoard(
  actions: Readonly<Record<string, ActionSpec>>,
  pick: (id: string) => void,
): El {
  const bound = byBinding(actions, "kbm");
  const board = el("div", { class: "device-board keyboard-board" });
  for (const row of KEYBOARD) {
    const line = el("div", { class: "device-row" });
    for (const [code, width] of row)
      line.append(cap(shortName(code), bound.get(code), pick, width));
    board.append(line);
  }
  // Keys bound off the main block -- the numpad, Insert, Page Up -- get a row of their own,
  // so every binding shows somewhere.
  const drawn = new Set<string>([...KEYBOARD.flat().map(([code]) => code), ...MOUSE]);
  const others = [...bound.keys()].filter((code) => !drawn.has(code)).sort();
  if (others.length > 0) {
    const extra = el("div", { class: "device-row other-keys" });
    for (const code of others) extra.append(cap(kbmLabel(code), bound.get(code), pick, 1.6));
    board.append(el("div", { class: "device-caption" }, ["Other keys"]), extra);
  }
  const mouse = el("div", { class: "device-row mouse-row" });
  for (const token of MOUSE) mouse.append(cap(kbmLabel(token), bound.get(token), pick, 1.6));
  board.append(el("div", { class: "device-caption" }, ["Mouse"]), mouse);
  return board;
}

/** The controller, each control showing the action on it. */
export function padBoard(
  actions: Readonly<Record<string, ActionSpec>>,
  pick: (id: string) => void,
): El {
  const bound = byBinding(actions, "pad");
  const board = el("div", { class: "device-board pad-board" });
  for (const row of PAD) {
    const line = el("div", { class: "device-row" });
    for (const control of row) line.append(cap(padLabel(control), bound.get(control), pick, 1.6));
    board.append(line);
  }
  return board;
}
