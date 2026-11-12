/**
 * Read a game's controls out of its own input file, so they need not be typed in.
 *
 * Two shapes are understood, both Unreal's:
 * - the engine's own `[/Script/Engine.InputSettings]` lines, `ActionMappings=(ActionName=
 *   "Jump",...,Key=SpaceBar)` and `AxisMappings=(AxisName="MoveForward",Scale=1.0,Key=W)`,
 *   in a game's `Input.ini` or `DefaultInput.ini`;
 * - Everspace 2's `KeybindingsConfig=(...)` rows, one per action and input group.
 *
 * Each control becomes an action with a name, the keyboard-and-mouse and controller keys
 * the file gives it, and, for Everspace's rows, the row it is (`ingame`). Node-free.
 */
import { canonicalKbm } from "./controls.js";
import { parseInput, TO_UE, UE_GAMEPAD, UE_MOUSE, ueKeyFor } from "./ingame.js";

export interface DiscoveredAction {
  id: string;
  label: string;
  kbm?: string;
  pad?: string;
  /** The row in the game's own file, for a file the editor can write back into. */
  ingame?: string;
  ingame_scale?: number;
  /** The category of that row, so a game that owns only some categories can tell. */
  category?: number;
}

/** Every key Unreal names, back to the `KeyboardEvent.code` the editor uses. */
const FROM_UE: ReadonlyMap<string, string> = (() => {
  const codes = [
    ...Object.keys(TO_UE),
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `Key${letter}`),
    ...Array.from({ length: 10 }, (_, digit) => `Digit${String(digit)}`),
    ...Array.from({ length: 10 }, (_, digit) => `Numpad${String(digit)}`),
    ...Array.from({ length: 12 }, (_, index) => `F${String(index + 1)}`),
  ];
  const map = new Map<string, string>();
  for (const code of codes) {
    const ue = ueKeyFor({ key: code });
    if (ue !== null && !map.has(ue)) map.set(ue, code);
  }
  for (const [token, ue] of Object.entries(UE_MOUSE)) map.set(ue, token);
  return map;
})();

const PAD_FROM_UE: ReadonlyMap<string, string> = new Map(
  Object.entries(UE_GAMEPAD).map(([control, ue]) => [ue, control]),
);

/** A stick axis and the sign of its scale, as a stick direction. Up is positive in Unreal. */
const STICK_AXES: Readonly<Record<string, [string, string]>> = {
  Gamepad_LeftX: ["LeftStickRight", "LeftStickLeft"],
  Gamepad_LeftY: ["LeftStickUp", "LeftStickDown"],
  Gamepad_RightX: ["RightStickRight", "RightStickLeft"],
  Gamepad_RightY: ["RightStickUp", "RightStickDown"],
};

/** One device's key, sorted into keyboard-and-mouse or controller, or neither. */
function sortKey(ue: string, scale: number): { kbm?: string; pad?: string } {
  const code = FROM_UE.get(ue);
  if (code !== undefined) return { kbm: code };
  const pad = PAD_FROM_UE.get(ue);
  if (pad !== undefined) return { pad };
  const stick = STICK_AXES[ue];
  if (stick !== undefined) return { pad: scale < 0 ? stick[1] : stick[0] };
  return {};
}

/** An action id from a game's name for it: "MoveForward" is `move_forward`, as ids are here. */
function idFrom(name: string): string {
  const id = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return /^[a-z_]/.test(id) ? id : `control_${id}`;
}

/** "MoveForward" or "move_forward" as words: "Move forward". */
function words(name: string): string {
  const spaced = name
    .replace(/[_.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const FIELD = (line: string, name: string): string | null =>
  new RegExp(`[(,]${name}=("[^"]*"|[^,)]*)`).exec(line)?.[1]?.replace(/^"|"$/g, "") ?? null;

/**
 * The controls in a game's input file, one action each, in the order the file has them.
 * A control on several keys keeps the first keyboard-or-mouse key and the first controller
 * control. Empty for a file that has neither shape.
 */
export function discoverControls(text: string): DiscoveredAction[] {
  const found = new Map<string, DiscoveredAction>();
  const add = (
    key: string,
    action: Omit<DiscoveredAction, "kbm" | "pad">,
    keys: { kbm?: string; pad?: string },
  ): void => {
    const known = found.get(key) ?? { ...action };
    if (known.kbm === undefined && keys.kbm !== undefined) known.kbm = keys.kbm;
    if (known.pad === undefined && keys.pad !== undefined) known.pad = keys.pad;
    found.set(key, known);
  };

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("ActionMappings=") || trimmed.startsWith("+ActionMappings=")) {
      const name = FIELD(trimmed, "ActionName");
      const key = FIELD(trimmed, "Key");
      if (name === null || key === null) continue;
      const keys = sortKey(key, 1);
      // The modifiers the mapping asks to be held, as the chord a binding spells.
      const held = (
        [
          ["bCtrl", "ControlLeft"],
          ["bShift", "ShiftLeft"],
          ["bAlt", "AltLeft"],
          ["bCmd", "MetaLeft"],
        ] as const
      )
        .filter(([flag]) => FIELD(trimmed, flag) === "True")
        .map(([, code]) => code);
      if (keys.kbm !== undefined && held.length > 0) {
        keys.kbm = canonicalKbm([...held, keys.kbm].join("+"));
      }
      add(name, { id: idFrom(name), label: words(name) }, keys);
    } else if (trimmed.startsWith("AxisMappings=") || trimmed.startsWith("+AxisMappings=")) {
      const name = FIELD(trimmed, "AxisName");
      const key = FIELD(trimmed, "Key");
      if (name === null || key === null) continue;
      const scale = Number(FIELD(trimmed, "Scale") ?? "1");
      // A stick drives both ways from one line; a key drives one way, by its scale.
      const axis = STICK_AXES[key];
      // A negative scale turns the stick round: its up drives the axis down.
      const stick: readonly [string, string] | undefined =
        axis === undefined ? undefined : scale < 0 ? [axis[1], axis[0]] : axis;
      if (stick !== undefined) {
        add(`${name}+`, { id: idFrom(name), label: words(name) }, { pad: stick[0] });
        add(
          `${name}-`,
          { id: idFrom(`${name} reverse`), label: `${words(name)} (reverse)` },
          { pad: stick[1] },
        );
        continue;
      }
      const sign = scale < 0 ? "-" : "+";
      add(
        `${name}${sign}`,
        sign === "+"
          ? { id: idFrom(name), label: words(name) }
          : { id: idFrom(`${name} reverse`), label: `${words(name)} (reverse)` },
        sortKey(key, scale),
      );
    }
  }

  // Everspace 2's own rows: one per action and group, the display name the game shows.
  for (const entry of parseInput(text).entries) {
    if (entry.isAxis) continue;
    const scale = entry.scale;
    const reverse = scale < 0;
    const id = idFrom(reverse ? `${entry.action} reverse` : entry.action);
    const label = entry.displayName === entry.action ? words(entry.action) : entry.displayName;
    const row = {
      id,
      label,
      ingame: entry.action,
      ...(scale === 1 ? {} : { ingame_scale: scale }),
      category: entry.category,
    };
    // Both slots, in order: the first keeps what it finds, and Key2 fills what Key1 left --
    // the editor itself writes a keyboard binding there.
    for (const key of [entry.key, entry.key2]) {
      add(`${entry.action}@${String(scale)}`, row, key === "None" ? {} : sortKey(key, scale));
    }
  }

  // One id per action: a name that slugs the same as an earlier one gets a number.
  const taken = new Set<string>();
  return [...found.values()].map((action) => {
    let id = action.id || "control";
    for (let n = 2; taken.has(id); n += 1) id = `${action.id}_${String(n)}`;
    taken.add(id);
    return { ...action, id };
  });
}
