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
  return padShape("device-board pad-board", (control) =>
    cap(padLabel(control), bound.get(control), pick, 1.6),
  );
}

/** Three cells in a cross, the middle one optional: a stick and its click, or a d-pad. */
function cross(
  cell: (control: string) => El,
  up: string,
  left: string,
  right: string,
  down: string,
  middle?: string,
): El {
  const grid = el("div", { class: "pad-cross" });
  const place = (control: string | undefined, area: string): void => {
    if (control === undefined) return;
    const node = cell(control);
    node.style.gridArea = area;
    grid.append(node);
  };
  place(up, "1 / 2");
  place(left, "2 / 1");
  place(middle, "2 / 2");
  place(right, "2 / 3");
  place(down, "3 / 2");
  return grid;
}

/**
 * The pad as it is held: the left hand's trigger, bumper, stick and d-pad; View and Menu in
 * the middle; the right hand's bumper, trigger, face buttons and stick.
 */
function padShape(className: string, cell: (control: string) => El): El {
  const side = (...children: El[]): El => el("div", { class: "pad-side" }, children);
  const row = (...controls: string[]): El => el("div", { class: "device-row" }, controls.map(cell));
  return el("div", { class: className }, [
    side(
      row("LT", "LB"),
      el("div", { class: "device-caption" }, ["Left stick"]),
      cross(cell, "LeftStickUp", "LeftStickLeft", "LeftStickRight", "LeftStickDown", "LS"),
      el("div", { class: "device-caption" }, ["D-pad"]),
      cross(cell, "DpadUp", "DpadLeft", "DpadRight", "DpadDown"),
    ),
    side(row("View", "Menu")),
    side(
      row("RB", "RT"),
      el("div", { class: "device-caption" }, ["Buttons"]),
      cross(cell, "Y", "X", "B", "A"),
      el("div", { class: "device-caption" }, ["Right stick"]),
      cross(cell, "RightStickUp", "RightStickLeft", "RightStickRight", "RightStickDown", "RS"),
    ),
  ]);
}

/** Keys off the main block, offered when choosing a key: navigation, then the numpad. */
const EXTRA_KEYS: readonly (readonly string[])[] = [
  ["Insert", "Home", "PageUp", "Delete", "End", "PageDown"],
  ["Numpad7", "Numpad8", "Numpad9", "NumpadSubtract", "Numpad4", "Numpad5", "Numpad6", "NumpadAdd"],
  ["Numpad1", "Numpad2", "Numpad3", "Numpad0", "NumpadDecimal", "NumpadMultiply", "NumpadDivide"],
];

/** One choosable key or control: always enabled, marked when it is the current one. */
function choice(
  name: string,
  value: string,
  current: string | undefined,
  pick: (value: string) => void,
  width = 1,
): El {
  const node = el(
    "button",
    {
      type: "button",
      class: `device-key choosable${value === current ? " bound" : ""}`,
      style: `--w: ${String(width)}`,
      "data-choose": value,
      title: name,
    },
    [el("span", { class: "device-key-name" }, [name])],
  );
  node.addEventListener("click", () => {
    pick(value);
  });
  return node;
}

/**
 * A whole keyboard to choose one key from: the main block, the navigation keys and the
 * numpad, and the mouse buttons given.
 */
export function keyChooser(
  pick: (code: string) => void,
  options: { current?: string; mouse?: readonly string[] } = {},
): El {
  const board = el("div", { class: "device-board keyboard-board chooser" });
  for (const row of KEYBOARD) {
    const line = el("div", { class: "device-row" });
    for (const [code, width] of row)
      line.append(choice(shortName(code), code, options.current, pick, width));
    board.append(line);
  }
  board.append(el("div", { class: "device-caption" }, ["Navigation and numpad"]));
  for (const row of EXTRA_KEYS) {
    const line = el("div", { class: "device-row" });
    for (const code of row) line.append(choice(kbmLabel(code), code, options.current, pick, 1.6));
    board.append(line);
  }
  const mouse = options.mouse ?? MOUSE;
  if (mouse.length > 0) {
    const line = el("div", { class: "device-row" });
    for (const token of mouse)
      line.append(choice(kbmLabel(token), token, options.current, pick, 1.6));
    board.append(el("div", { class: "device-caption" }, ["Mouse"]), line);
  }
  return board;
}

/** The pad laid out as it is held, to choose one control from. */
export function padChooser(pick: (control: string) => void, current?: string): El {
  return padShape("device-board pad-board chooser", (control) =>
    choice(padLabel(control), control, current, pick, 1.6),
  );
}
