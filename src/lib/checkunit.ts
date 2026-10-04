/**
 * Checking a unit against a layout by pressing it.
 *
 * What a unit runs lives in its own memory, which only the Azeron app reads, over a
 * protocol it does not publish. What a unit sends does not: every key it is pressed on
 * arrives at the page as a keystroke or a mouse button. So the page asks for each control
 * in turn, and compares what arrives with what the layout puts there. That is the unit
 * itself answering, whatever the app's copy says and whichever onboard profile it is on.
 *
 * Node-free; the editor imports it.
 */

import { bindingLabel, isModifier } from "./keys.js";
import { handLayout, positionLabel } from "./layout.js";
import type { ActionSet, Device } from "./model-core.js";
import { STICK_DIRECTIONS } from "../types/azeron.js";
import type { StickDirection } from "../types/azeron.js";
import type { KeySlotSpec, ProfileData, SlotSpec } from "../types/profile.js";

/** What a press sends: a key with the modifiers held for it, or a mouse button. */
export type Sent =
  { kind: "key"; code: string; modifiers: string[] } | { kind: "mouse"; button: string };

export interface ExpectedPress {
  /** `ring_4`, or `stick:up` for a stick direction. */
  id: string;
  position: string;
  direction?: StickDirection;
  /** What to do: "Ring 4", "the stick up". */
  prompt: string;
  /** What the layout has there, in words: "Ultimate (G)". */
  does: string;
  sends: Sent;
}

const STICK_PROMPTS: Record<StickDirection, string> = {
  up: "the stick away from you",
  right: "the stick right",
  down: "the stick toward you",
  left: "the stick left",
};

/** A binding as the page will see it arrive, or null when it sends nothing it can see. */
function sentBy(binding: KeySlotSpec): Sent | null {
  if (binding.mouse) return { kind: "mouse", button: binding.mouse };
  if (binding.key) {
    return { kind: "key", code: binding.key, modifiers: binding.meta ? [binding.meta] : [] };
  }
  // A modifier on its own is sent as itself.
  if (binding.meta) return { kind: "key", code: binding.meta, modifiers: [] };
  return null;
}

function bindingOf(value: SlotSpec | undefined, actions: ActionSet): KeySlotSpec | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const spec = actions.actions[value];
    if (spec === undefined || spec.provided_by) return null;
    return { key: spec.key ?? null, meta: spec.meta ?? null, mouse: spec.mouse ?? null };
  }
  // A raw token cannot be named, so what it should arrive as is not known.
  if ("key_raw" in value || "type_raw" in value) return null;
  return value as KeySlotSpec;
}

function bindingFor(sent: Sent): KeySlotSpec {
  if (sent.kind === "mouse") return { mouse: sent.button };
  // A modifier on its own is how an action with only a `meta` is sent.
  if (isModifier(sent.code) && sent.modifiers.length === 0) return { meta: sent.code };
  return { key: sent.code, meta: sent.modifiers[0] ?? null };
}

function keysOf(sent: Sent): string {
  return (
    bindingLabel(bindingFor(sent)) ??
    (sent.kind === "key" ? sent.code : `${sent.button} mouse button`)
  );
}

/**
 * What arrived, in words, after every action on it: "Inventory (I)", or "Cruise drive or
 * Interact (F)" for a key two actions share -- which of them a key was meant for is the
 * layout's to say, not the key's.
 */
export function describeSent(sent: Sent, actions: ActionSet): string {
  const want = bindingFor(sent);
  const names = Object.entries(actions.actions)
    .filter(([, spec]) => !spec.provided_by)
    .filter(
      ([, spec]) =>
        (spec.key ?? null) === (want.key ?? null) &&
        (spec.meta ?? null) === (want.meta ?? null) &&
        (spec.mouse ?? null) === (want.mouse ?? null),
    )
    .map(([id]) => actions.label(id));
  return names.length === 0 ? keysOf(sent) : `${names.join(" or ")} (${keysOf(sent)})`;
}

/** What the layout has on a control, after the action it put there. */
function describeExpected(value: SlotSpec | undefined, sent: Sent, actions: ActionSet): string {
  return typeof value === "string"
    ? `${actions.label(value)} (${keysOf(sent)})`
    : describeSent(sent, actions);
}

/** Whether what arrived is what the layout sends. */
export function sameSent(expected: Sent, arrived: Sent): boolean {
  if (expected.kind === "mouse" || arrived.kind === "mouse") {
    return (
      expected.kind === "mouse" && arrived.kind === "mouse" && expected.button === arrived.button
    );
  }
  const held = (modifiers: string[]): string => [...new Set(modifiers)].sort().join("+");
  return expected.code === arrived.code && held(expected.modifiers) === held(arrived.modifiers);
}

/**
 * Every control of a unit that sends something the page can see, in the order the board
 * lays them out: the finger columns, then the stick's four directions, the d-pad, the
 * stick pressed in and the thumb keys. The tap only: a long press or a double tap is the
 * same key held or pressed twice, and asking for each would double the walk for little.
 */
export function expectedPresses(
  data: ProfileData,
  device: Device,
  actions: ActionSet,
): ExpectedPress[] {
  const layout = handLayout(device);
  const presses: ExpectedPress[] = [];
  const key = (position: string): void => {
    const spec = data.positions[position];
    const binding = bindingOf(spec?.tap, actions);
    const sends = binding === null ? null : sentBy(binding);
    if (spec === undefined || sends === null) return;
    presses.push({
      id: position,
      position,
      prompt: positionLabel(position),
      does: describeExpected(spec.tap, sends, actions),
      sends,
    });
  };

  for (const column of layout.columns) column.positions.forEach(key);
  const stick = layout.stick === null ? undefined : data.positions[layout.stick];
  if (layout.stick !== null && stick?.mode === "keyboard") {
    for (const direction of STICK_DIRECTIONS) {
      const value = stick.directions?.[direction];
      const binding =
        typeof value === "string"
          ? bindingOf(value, actions)
          : value?.key
            ? { key: value.key }
            : null;
      const sends = binding === null ? null : sentBy(binding);
      if (sends === null) continue;
      presses.push({
        id: `${layout.stick}:${direction}`,
        position: layout.stick,
        direction,
        prompt: STICK_PROMPTS[direction],
        does: describeExpected(value, sends, actions),
        sends,
      });
    }
  }
  for (const [position] of layout.dpad) key(position);
  if (layout.stickPress !== null) key(layout.stickPress);
  layout.aux.forEach(key);
  return presses;
}

export interface CheckVerdict {
  /** Every control that was pressed sent what the layout has. */
  matches: boolean;
  checked: number;
  skipped: number;
  differing: { press: ExpectedPress; arrived: string }[];
  /** Most of what arrived was the press-test profile's keys: the unit is on that slot. */
  onProbe: boolean;
}

/**
 * What a run comes to. `probeKeys` is the key the press-test profile sends from each
 * position, so a unit left on that onboard slot -- two of three still hold it -- is named
 * as such rather than as a layout gone wrong key by key.
 */
export function verdict(
  presses: readonly ExpectedPress[],
  results: ReadonlyMap<string, { arrived: Sent; text: string } | "skipped">,
  probeKeys: ReadonlyMap<string, string> = new Map(),
): CheckVerdict {
  const differing: { press: ExpectedPress; arrived: string }[] = [];
  let checked = 0;
  let skipped = 0;
  let probe = 0;
  for (const press of presses) {
    const result = results.get(press.id);
    if (result === undefined) continue;
    if (result === "skipped") {
      skipped += 1;
      continue;
    }
    checked += 1;
    if (sameSent(press.sends, result.arrived)) continue;
    differing.push({ press, arrived: result.text });
    if (
      result.arrived.kind === "key" &&
      press.direction === undefined &&
      probeKeys.get(press.position) === result.arrived.code
    ) {
      probe += 1;
    }
  }
  return {
    matches: checked > 0 && differing.length === 0,
    checked,
    skipped,
    differing,
    onProbe: differing.length > 0 && probe * 2 > differing.length,
  };
}
