/**
 * Stick modes, after the convention RC transmitters use.
 *
 * A mode is an assignment of four action pairs to the four stick axes a pair of units
 * has — left vertical and horizontal, right vertical and horizontal. Applying one
 * rewrites the two `stick.directions` blocks and touches nothing else, so it can be
 * tried and undone without disturbing the rest of a layout.
 *
 * A mode also has a with-pedals variant. Rudder pedals carry yaw, so a stick that still
 * sends yaw duplicates them; the variant hands that stick axis to something the mode
 * otherwise leaves off the sticks. What pedals take, and what each mode does with the
 * slot they free, is data in `stick-modes.yaml` (`pedals.takes`, and `with_pedals` on a
 * mode). With no pedals nothing here changes: every function defaults to the plain mode.
 */

import type { StickDirection } from "../types/azeron.js";
import type { PositionSpec } from "../types/profile.js";

export interface AxisPair {
  /** Action sent when the axis goes up or right. */
  up: string;
  /** Action sent when it goes down or left. */
  down: string;
  /**
   * True when the game reads this axis as -1..+1 about a centre. Every flight axis does;
   * a pedal that rests at one end bound to one is the toe-brake question. Absent is
   * treated as centred, because that is the conservative reading.
   */
  centred?: boolean;
}

export interface StickModeSide {
  vertical: string;
  horizontal: string;
}

export interface StickMode {
  label: string;
  note?: string;
  left: StickModeSide;
  right: StickModeSide;
  /**
   * What each stick does when the layout has pedals: the slots to replace, and nothing
   * else. Every slot that holds an axis the pedals take must be replaced, and only those.
   * A mode with no yaw to give up has none.
   */
  with_pedals?: { left?: Partial<StickModeSide>; right?: Partial<StickModeSide> };
}

export interface StickModeSet {
  modes: Record<string, StickMode>;
  axes: Record<string, AxisPair>;
  /** Which axes pedals carry, so no stick needs to. */
  pedals?: { takes: string[] };
}

export class StickModeError extends Error {}

/** The sides of a mode, with the pedal variant laid over them when asked for. */
export function sidesFor(
  mode: StickMode,
  withPedals: boolean,
): { left: StickModeSide; right: StickModeSide } {
  if (!withPedals || mode.with_pedals === undefined) return { left: mode.left, right: mode.right };
  return {
    left: { ...mode.left, ...mode.with_pedals.left },
    right: { ...mode.right, ...mode.with_pedals.right },
  };
}

/** The axes the pedals take in this genre. */
export function pedalAxes(set: StickModeSet): readonly string[] {
  return set.pedals?.takes ?? [];
}

/** The four directions a mode gives one stick, optionally in its with-pedals variant. */
export function directionsFor(
  set: StickModeSet,
  mode: StickMode,
  hand: "left" | "right",
  withPedals = false,
): Record<StickDirection, string> {
  const side = sidesFor(mode, withPedals)[hand];
  const vertical = set.axes[side.vertical];
  const horizontal = set.axes[side.horizontal];
  if (!vertical) throw new StickModeError(`unknown axis '${side.vertical}'`);
  if (!horizontal) throw new StickModeError(`unknown axis '${side.horizontal}'`);
  return {
    up: vertical.up,
    down: vertical.down,
    right: horizontal.up,
    left: horizontal.down,
  };
}

/**
 * Everything wrong with a stick-mode file, as sentences, or an empty list.
 *
 * The with-pedals variant is where this can go quietly wrong: a slot that still holds an
 * axis the pedals carry sends it twice, a slot replaced that held something else loses a
 * job for no reason, and an axis on two slots is one stick doing a job twice.
 */
export function validateStickModes(set: StickModeSet): string[] {
  const problems: string[] = [];
  const takes = pedalAxes(set);
  for (const axis of takes) {
    if (!(axis in set.axes)) problems.push(`pedals.takes names '${axis}', which is not an axis`);
  }
  for (const [id, mode] of Object.entries(set.modes)) {
    for (const withPedals of [false, true]) {
      if (withPedals && mode.with_pedals === undefined) continue;
      const sides = sidesFor(mode, withPedals);
      const slots = (["left", "right"] as const).flatMap((hand) =>
        (["vertical", "horizontal"] as const).map(
          (slot) => [`${hand} ${slot}`, sides[hand][slot]] as const,
        ),
      );
      const name = withPedals ? `${id} with pedals` : id;
      const seen = new Map<string, string>();
      for (const [slot, axis] of slots) {
        if (!(axis in set.axes)) problems.push(`${name}: ${slot} is '${axis}', not an axis`);
        const earlier = seen.get(axis);
        if (earlier !== undefined) {
          problems.push(`${name}: '${axis}' is on both ${earlier} and ${slot}`);
        }
        seen.set(axis, slot);
        if (withPedals && takes.includes(axis)) {
          problems.push(`${name}: ${slot} still sends '${axis}', which the pedals carry`);
        }
      }
    }
    for (const hand of ["left", "right"] as const) {
      const replaced = mode.with_pedals?.[hand] ?? {};
      for (const slot of ["vertical", "horizontal"] as const) {
        const replacement = replaced[slot];
        if (replacement === undefined) continue;
        const was = mode[hand][slot];
        if (!takes.includes(was)) {
          problems.push(
            `${id}: with_pedals replaces ${hand} ${slot}, which holds '${was}' -- not an axis ` +
              "the pedals take",
          );
        }
      }
    }
    const held = [
      mode.left.vertical,
      mode.left.horizontal,
      mode.right.vertical,
      mode.right.horizontal,
    ];
    for (const axis of takes) {
      if (held.includes(axis) && mode.with_pedals === undefined) {
        problems.push(`${id} sends '${axis}' on a stick and has no with_pedals to give it up`);
      }
    }
  }
  return problems;
}

/**
 * Apply a mode to a stick, keeping everything else on that position.
 *
 * The mode owns the four directions and nothing more: the stick's own mode, and any
 * `raw` the template needed, are left exactly as they were.
 */
export function applyMode(
  spec: PositionSpec | undefined,
  set: StickModeSet,
  mode: StickMode,
  hand: "left" | "right",
  withPedals = false,
): PositionSpec {
  return {
    ...(spec ?? { mode: "keyboard" }),
    directions: directionsFor(set, mode, hand, withPedals),
  };
}

export interface StickModeMatch {
  mode: string;
  /** True when the sticks are in the mode's with-pedals variant. */
  pedals: boolean;
}

function sticksMatch(
  set: StickModeSet,
  mode: StickMode,
  withPedals: boolean,
  left: PositionSpec | undefined,
  right: PositionSpec | undefined,
): boolean {
  const matches = (spec: PositionSpec | undefined, want: Record<string, string>): boolean =>
    Object.entries(want).every(([direction, action]) => {
      const actual = spec?.directions?.[direction as StickDirection];
      return typeof actual === "string" && actual === action;
    });
  return (
    matches(left, directionsFor(set, mode, "left", withPedals)) &&
    matches(right, directionsFor(set, mode, "right", withPedals))
  );
}

/**
 * Every mode the sticks are in, and whether each is the plain mode or its with-pedals
 * variant. A mode with nothing to give up has no variant, so it is listed once.
 *
 * More than one match is ordinary: Mode 2 with pedals puts roll where yaw was, which is
 * exactly Mode 2, roll for yaw. The sticks cannot say which they are; the layout can, by
 * whether it has pedals.
 */
export function detectStickModes(
  set: StickModeSet,
  left: PositionSpec | undefined,
  right: PositionSpec | undefined,
): StickModeMatch[] {
  const found: StickModeMatch[] = [];
  for (const [id, mode] of Object.entries(set.modes)) {
    if (sticksMatch(set, mode, false, left, right)) found.push({ mode: id, pedals: false });
    if (mode.with_pedals !== undefined && sticksMatch(set, mode, true, left, right)) {
      found.push({ mode: id, pedals: true });
    }
  }
  return found;
}

/**
 * Which mode a stick is already in, if any. `withPedals` says which world to look in:
 * the layout has pedals, so the with-pedals variants are the ones in play. Without it the
 * answer is what it always was.
 */
export function detectMode(
  set: StickModeSet,
  left: PositionSpec | undefined,
  right: PositionSpec | undefined,
  withPedals = false,
): string | null {
  for (const [id, mode] of Object.entries(set.modes)) {
    if (sticksMatch(set, mode, withPedals, left, right)) return id;
  }
  return null;
}

/** The axes a set of sticks sends, by the vocabulary's axis names. */
export function axesOnSticks(
  set: StickModeSet,
  sticks: readonly (PositionSpec | undefined)[],
): Set<string> {
  const byAction = new Map<string, string>();
  for (const [axis, ends] of Object.entries(set.axes)) {
    byAction.set(ends.up, axis);
    byAction.set(ends.down, axis);
  }
  const found = new Set<string>();
  for (const spec of sticks) {
    for (const value of Object.values(spec?.directions ?? {})) {
      const axis = typeof value === "string" ? byAction.get(value) : undefined;
      if (axis !== undefined) found.add(axis);
    }
  }
  return found;
}
