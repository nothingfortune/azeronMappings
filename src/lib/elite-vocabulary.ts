/**
 * Elite Dangerous's actions, made from the game's own bindings files.
 *
 * Every button control in every file given becomes an action: its name, its mode of play
 * and its role from `describeControl`, `ingame:` the control's tag, and the key the first
 * file (the preset the owner plays with) binds it to, where the keypad can send that key.
 * Axis controls are not actions: a key cannot drive one, and pedals and sticks are bound
 * to them by device.
 *
 * The first file is the base: its keys seed the wiring, so a layout starts from the keys
 * the owner already knows. Later files only add controls the base lacks -- the game's
 * presets do not all carry the same list, and "every control there is" is the union.
 *
 * Node-free.
 */

import { describeControl, isBound, nameForEliteKey } from "./elite.js";
import type { EliteBinds, EliteControl, EliteSlot } from "./elite.js";
import type { ActionSpec } from "../types/profile.js";

/**
 * The ship's movement controls go by the ids the space-sim stick modes use, so a stick mode
 * puts thrust, strafe, vertical thrust, yaw, pitch and roll on the sticks for Elite exactly
 * as it does for Everspace. Every other control goes by its tag.
 */
const SHARED_IDS: Record<string, string> = {
  ForwardThrustButton: "throttle_up",
  BackwardThrustButton: "throttle_down",
  LeftThrustButton: "strafe_left",
  RightThrustButton: "strafe_right",
  UpThrustButton: "hover_up",
  DownThrustButton: "hover_down",
  YawLeftButton: "yaw_left",
  YawRightButton: "yaw_right",
  PitchUpButton: "pitch_up",
  PitchDownButton: "pitch_down",
  RollLeftButton: "roll_left",
  RollRightButton: "roll_right",
};

/**
 * What each mode cannot be played without, by control. Kept short: moving, the one or two
 * things a mode exists for, and getting about. The checks complain while none of these is
 * on a control of a layout that plays that mode.
 */
const REQUIRED = new Set([
  // Ship: thrust, boost, the frame shift drive, firing, landing.
  "ForwardKey",
  "BackwardKey",
  "UseBoostJuice",
  "HyperSuperCombination",
  "PrimaryFire",
  "SecondaryFire",
  "LandingGearToggle",
  // Buggy: drive and steer.
  "IncreaseSpeedButtonMax",
  "DecreaseSpeedButtonMax",
  "SteerLeftButton",
  "SteerRightButton",
  // On foot: walk, jump, shoot, use things.
  "HumanoidForwardButton",
  "HumanoidBackwardButton",
  "HumanoidStrafeLeftButton",
  "HumanoidStrafeRightButton",
  "HumanoidJumpButton",
  "HumanoidPrimaryFireButton",
  "HumanoidPrimaryInteractButton",
]);

/** `GalaxyMapOpen_Buggy` -> `galaxy_map_open_buggy`. */
export function eliteActionId(tag: string): string {
  const shared = SHARED_IDS[tag];
  if (shared !== undefined) return shared;
  return tag
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/__+/g, "_")
    .toLowerCase();
}

const MODIFIERS = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
]);
/** The game's mouse buttons, by this repo's names for them. Elite numbers right before middle. */
const MOUSE_NAMES: Record<string, string> = {
  Mouse_1: "left",
  Mouse_2: "right",
  Mouse_3: "middle",
};

/**
 * What the keypad would send for one slot of the base file, or null when it cannot: a
 * key with no name here, more than one held modifier, a mouse button the keypad has not
 * been seen to send, or another device altogether.
 */
function bindingOf(slot: EliteSlot): Pick<ActionSpec, "key" | "meta" | "mouse"> | null {
  if (!isBound(slot)) return null;
  if (slot.device === "Mouse") {
    const mouse = MOUSE_NAMES[slot.key];
    return mouse === undefined || slot.modifiers.length > 0 ? null : { mouse };
  }
  if (slot.device !== "Keyboard") return null;
  const key = nameForEliteKey(slot.key);
  if (key === null) return null;
  const held = slot.modifiers.filter((entry) => entry.device === "Keyboard");
  if (held.length !== slot.modifiers.length || held.length > 1) return null;
  const modifier = held[0] === undefined ? null : nameForEliteKey(held[0].key);
  if (held.length === 1 && (modifier === null || !MODIFIERS.has(modifier))) return null;
  // A modifier on its own is sent as one, the way boost is Left Shift in Everspace.
  if (modifier === null) return MODIFIERS.has(key) ? { meta: key } : { key };
  return { key, meta: modifier };
}

/** The base file's binding for a control: its first slot the keypad could send. */
function seededBinding(
  control: EliteControl | undefined,
): Pick<ActionSpec, "key" | "meta" | "mouse"> {
  for (const slot of control?.slots ?? []) {
    const binding = bindingOf(slot);
    if (binding !== null) return binding;
  }
  return {};
}

/** Every button control in `files`, as actions, with the keys of the first. */
export function eliteVocabulary(files: readonly EliteBinds[]): Record<string, ActionSpec> {
  const base = files[0];
  const controls = new Map<string, EliteControl>();
  for (const file of files) {
    for (const control of file.controls) {
      if (control.kind !== "button" || controls.has(control.tag)) continue;
      controls.set(control.tag, control);
    }
  }
  const baseControls = new Map(
    (base?.controls ?? []).filter((control) => control.kind === "button").map((c) => [c.tag, c]),
  );

  const actions: Record<string, ActionSpec> = {};
  const seen = new Map<string, string>();
  for (const tag of controls.keys()) {
    const id = eliteActionId(tag);
    const other = seen.get(id);
    if (other !== undefined) throw new Error(`${tag} and ${other} would both be '${id}'`);
    seen.set(id, tag);
    const told = describeControl(tag);
    actions[id] = {
      label: told.label,
      tags: REQUIRED.has(tag) ? [told.role, "required"] : [told.role],
      mode: told.mode,
      ingame: tag,
      ...seededBinding(baseControls.get(tag)),
    };
  }
  return actions;
}

/** Actions that share a key and are live at the same time, as the base file has them. */
export function sharedKeys(
  actions: Readonly<Record<string, ActionSpec>>,
  live: (a: ActionSpec, b: ActionSpec) => boolean,
): { key: string; actions: string[] }[] {
  const bySignature = new Map<string, string[]>();
  for (const [id, spec] of Object.entries(actions)) {
    const name = spec.key ?? spec.meta ?? spec.mouse;
    if (name === undefined || name === null) continue;
    const signature = spec.mouse ? `mouse:${spec.mouse}` : `${spec.meta ?? ""}+${spec.key ?? ""}`;
    bySignature.set(signature, [...(bySignature.get(signature) ?? []), id]);
  }
  const out: { key: string; actions: string[] }[] = [];
  for (const ids of bySignature.values()) {
    const clashing = ids.filter((id, index) =>
      ids.some((other, at) => {
        const a = actions[id];
        const b = actions[other];
        return at !== index && a !== undefined && b !== undefined && live(a, b);
      }),
    );
    const first = actions[clashing[0] ?? ""];
    if (clashing.length < 2 || first === undefined) continue;
    const key = first.mouse ? `mouse:${first.mouse}` : (first.key ?? first.meta ?? "");
    out.push({ key, actions: clashing });
  }
  return out;
}

/** A label as YAML writes it in a flow mapping: bare when that reads back the same. */
function scalar(text: string): string {
  return /^[A-Za-z][A-Za-z0-9 ()/'.%-]*$/.test(text) && !/^(true|false|null|yes|no)$/i.test(text)
    ? text
    : JSON.stringify(text);
}

/**
 * The text of Elite's actions.yaml: one line per action, grouped by mode, every line a flow
 * mapping so the editor's line patcher can change a key, a name or the roles in place.
 */
export function eliteActionsYaml(
  actions: Readonly<Record<string, ActionSpec>>,
  modeLabels: Readonly<Record<string, string>>,
  allowlist: readonly { key: string; actions: string[] }[],
  header: string,
): string {
  const ids = Object.keys(actions);
  const width = Math.max(0, ...ids.map((id) => id.length)) + 1;
  const lines: string[] = [header.trimEnd(), "game: Elite Dangerous", "", "actions:"];
  for (const [mode, label] of Object.entries(modeLabels)) {
    const inMode = ids.filter((id) => actions[id]?.mode === mode);
    if (inMode.length === 0) continue;
    lines.push(`  # --- ${label} ${"-".repeat(Math.max(3, 84 - label.length))}`);
    for (const id of inMode) {
      const spec = actions[id] ?? {};
      const fields: string[] = [];
      if (spec.key) fields.push(`key: ${spec.key}`);
      if (spec.meta) fields.push(`meta: ${spec.meta}`);
      if (spec.mouse) fields.push(`mouse: ${spec.mouse}`);
      fields.push(`ingame: ${spec.ingame ?? ""}`);
      fields.push(`mode: ${mode}`);
      if (spec.label !== undefined) fields.push(`label: ${scalar(spec.label)}`);
      if (spec.tags !== undefined) fields.push(`tags: [${spec.tags.join(", ")}]`);
      lines.push(`  ${`${id}:`.padEnd(width)} {${fields.join(", ")}}`);
    }
    lines.push("");
  }
  if (allowlist.length > 0) {
    lines.push(
      "# Keys the game's own default puts on more than one action live at the same time. It",
      "# tells them apart by what you are doing -- placing a settlement, aiming the camera --",
      "# so they are kept as the game has them. A key the editor gives is never one of these.",
      "duplicate_key_allowlist:",
    );
    for (const entry of allowlist) {
      const key = entry.key.includes(":") ? JSON.stringify(entry.key) : entry.key;
      lines.push(`  - {key: ${key}, actions: [${entry.actions.join(", ")}]}`);
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
