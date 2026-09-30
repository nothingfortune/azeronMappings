/**
 * Stick modes, after the convention RC transmitters use.
 *
 * A mode is an assignment of four action pairs to the four stick axes a pair of units
 * has — left vertical and horizontal, right vertical and horizontal. Applying one
 * rewrites the two `stick.directions` blocks and touches nothing else, so it can be
 * tried and undone without disturbing the rest of a layout.
 */

import type { StickDirection } from "../types/azeron.js";
import type { PositionSpec } from "../types/profile.js";

export interface AxisPair {
  /** Action sent when the axis goes up or right. */
  up: string;
  /** Action sent when it goes down or left. */
  down: string;
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
}

export interface StickModeSet {
  modes: Record<string, StickMode>;
  axes: Record<string, AxisPair>;
}

export class StickModeError extends Error {}

/** The four directions a mode gives one stick. */
export function directionsFor(
  set: StickModeSet,
  mode: StickMode,
  hand: "left" | "right",
): Record<StickDirection, string> {
  const side = hand === "left" ? mode.left : mode.right;
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
): PositionSpec {
  return { ...(spec ?? { mode: "keyboard" }), directions: directionsFor(set, mode, hand) };
}

/** Which mode a stick is already in, if any. */
export function detectMode(
  set: StickModeSet,
  left: PositionSpec | undefined,
  right: PositionSpec | undefined,
): string | null {
  for (const [id, mode] of Object.entries(set.modes)) {
    const wantLeft = directionsFor(set, mode, "left");
    const wantRight = directionsFor(set, mode, "right");
    const matches = (spec: PositionSpec | undefined, want: Record<string, string>): boolean =>
      Object.entries(want).every(([direction, action]) => {
        const actual = spec?.directions?.[direction as StickDirection];
        return typeof actual === "string" && actual === action;
      });
    if (matches(left, wantLeft) && matches(right, wantRight)) return id;
  }
  return null;
}
