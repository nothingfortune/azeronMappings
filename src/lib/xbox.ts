/**
 * An Xbox controller, laid over a pair of units.
 *
 * Each genre action may say which control a game usually puts it on (`xbox:` in the
 * genre's actions.yaml): jump on A, reload on X. That is reference, not wiring -- the
 * units still send keys -- but it gives the controller-style default its shape. With the
 * pair held like a controller, the left unit is the left half of the pad and the right
 * unit the right half:
 *
 *   sticks           the units' sticks, and their presses the stick clicks
 *   A B X Y          the right unit's thumb pad (A at the bottom, as on the pad)
 *   d-pad            the left unit's thumb pad
 *   LB / LT, RB / RT the index finger's top two keys, bumper above trigger
 *   View / Menu      the upper thumb key on the left / right unit
 *
 * Node-free, because the editor imports it.
 */

import type { StickDirection } from "../types/azeron.js";
import type { ActionSpec, PositionSpec } from "../types/profile.js";

export type Hand = "left" | "right";

export interface XboxPlace {
  hand: Hand;
  position: string;
  /** Set for a stick direction. */
  direction?: StickDirection;
}

const stick = (hand: Hand, direction: StickDirection): XboxPlace => ({
  hand,
  position: "stick",
  direction,
});

/** Every control on the pad, and where it sits on the pair. */
export const XBOX_CONTROLS: Readonly<Record<string, XboxPlace>> = {
  A: { hand: "right", position: "dpad_down" },
  B: { hand: "right", position: "dpad_right" },
  X: { hand: "right", position: "dpad_left" },
  Y: { hand: "right", position: "dpad_up" },
  LB: { hand: "left", position: "index_2" },
  LT: { hand: "left", position: "index_3" },
  RB: { hand: "right", position: "index_2" },
  RT: { hand: "right", position: "index_3" },
  LS: { hand: "left", position: "stick_press" },
  RS: { hand: "right", position: "stick_press" },
  View: { hand: "left", position: "thumb_aux_upper" },
  Menu: { hand: "right", position: "thumb_aux_upper" },
  DpadUp: { hand: "left", position: "dpad_up" },
  DpadDown: { hand: "left", position: "dpad_down" },
  DpadLeft: { hand: "left", position: "dpad_left" },
  DpadRight: { hand: "left", position: "dpad_right" },
  LeftStickUp: stick("left", "up"),
  LeftStickDown: stick("left", "down"),
  LeftStickLeft: stick("left", "left"),
  LeftStickRight: stick("left", "right"),
  RightStickUp: stick("right", "up"),
  RightStickDown: stick("right", "down"),
  RightStickLeft: stick("right", "left"),
  RightStickRight: stick("right", "right"),
};

/** What the editor calls a control: "A", "Left stick up". */
export function xboxLabel(control: string): string {
  const words = control
    .replace(/^Dpad/, "D-pad")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ");
  return words.map((word, index) => (index === 0 ? word : word.toLowerCase())).join(" ");
}

/**
 * The actions of a vocabulary placed where their Xbox control sits, one layout per hand.
 * Two actions on one control is a mistake in the vocabulary, and the first keeps it.
 * Problems come back as sentences rather than thrown, for the tests to list.
 */
export function xboxLayout(actions: Readonly<Record<string, ActionSpec>>): {
  left: Record<string, PositionSpec>;
  right: Record<string, PositionSpec>;
  problems: string[];
} {
  const hands: Record<Hand, Record<string, PositionSpec>> = { left: {}, right: {} };
  const problems: string[] = [];
  const taken = new Map<string, string>();
  for (const [id, spec] of Object.entries(actions)) {
    const control = spec.xbox;
    if (control === undefined) continue;
    const place = XBOX_CONTROLS[control];
    if (place === undefined) {
      problems.push(`${id}: '${control}' is not an Xbox control`);
      continue;
    }
    const earlier = taken.get(control);
    if (earlier !== undefined) {
      problems.push(`${id} and ${earlier} are both on ${control}`);
      continue;
    }
    taken.set(control, id);
    const positions = hands[place.hand];
    if (place.direction !== undefined) {
      const current = positions[place.position] ?? { mode: "keyboard" };
      positions[place.position] = {
        ...current,
        directions: { ...current.directions, [place.direction]: id },
      };
    } else {
      positions[place.position] = { label: spec.label ?? id, tap: id };
    }
  }
  return { ...hands, problems };
}
