/**
 * The layouts a new game starts with: a pair of units, in one of a genre's styles.
 *
 * A genre's `layouts.yaml` names each style -- `controller`, the pair held like an Xbox
 * pad, and `keyboard`, the pair as a keyboard -- and says what goes on each unit. A
 * controller style starts from every action's `xbox:` control (xbox.ts); either may take
 * the genre's single-unit default for a hand, and either may fly a stick mode, in its
 * with-pedals variant when the layout has pedals.
 *
 * Node-free and pure: the files are read by the caller.
 */

import type { ActionSpec, PositionSpec } from "../types/profile.js";
import { applyMode } from "./stickmodes.js";
import type { StickModeSet } from "./stickmodes.js";
import { xboxLayout } from "./xbox.js";
import type { Hand } from "./xbox.js";

export interface StyleSpec {
  label: string;
  note?: string;
  /** A mode in the genre's stick-modes.yaml, for both sticks. */
  stick_mode?: string;
  /** What the new game's actions.yaml says of an action beyond its key; null removes. */
  actions?: Record<string, Record<string, unknown>>;
  /** Mirrored positions whose two hands do different jobs on purpose, and why. */
  acknowledge?: { reason: string; positions: string[] };
  /** A hand's positions, or `default` for the genre's single-unit default.yaml. */
  left?: "default" | Record<string, PositionSpec>;
  right?: "default" | Record<string, PositionSpec>;
}

/** The styles, in the order they are offered: the first is the default. */
export const STYLE_ORDER = ["controller", "keyboard"] as const;

export class StyleError extends Error {
  override name = "StyleError";
}

/** A genre's layouts.yaml, checked enough that a typo says where it is. */
export function parseStyles(data: unknown, where: string): Record<string, StyleSpec> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new StyleError(`${where}: expected a mapping of styles`);
  }
  const styles: Record<string, StyleSpec> = {};
  for (const [name, raw] of Object.entries(data as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new StyleError(`${where}: ${name} is not a mapping`);
    }
    const spec = raw as StyleSpec;
    if (typeof spec.label !== "string") throw new StyleError(`${where}: ${name} has no label`);
    styles[name] = spec;
  }
  return styles;
}

export interface BuiltStyle {
  left: Record<string, PositionSpec>;
  right: Record<string, PositionSpec>;
  /** Positions both hands use, for different jobs on purpose; for lint.acknowledged. */
  acknowledge: { reason: string; positions: string[] } | null;
  /** Overrides for the new game's actions.yaml. */
  actions: Record<string, Record<string, unknown>>;
}

export interface StyleInputs {
  /** The genre's vocabulary. */
  actions: Readonly<Record<string, ActionSpec>>;
  /** The genre's single-unit default.yaml positions. */
  defaults: Readonly<Record<string, PositionSpec>>;
  modes?: StickModeSet | undefined;
  withPedals?: boolean;
}

/** Both hands of a style, as profile positions. Throws on a style that cannot be built. */
export function buildStyle(name: string, style: StyleSpec, inputs: StyleInputs): BuiltStyle {
  const base =
    name === "controller" ? xboxLayout(inputs.actions) : { left: {}, right: {}, problems: [] };
  if (base.problems.length > 0) throw new StyleError(base.problems.join("; "));
  const hand = (which: Hand): Record<string, PositionSpec> => {
    const own = style[which];
    const extra = own === "default" ? inputs.defaults : (own ?? {});
    const positions: Record<string, PositionSpec> = structuredClone(base[which]);
    for (const [position, spec] of Object.entries(extra)) {
      if (position in positions && position !== "stick") {
        throw new StyleError(`${name}: ${which} ${position} already has its Xbox control`);
      }
      positions[position] = structuredClone(spec);
    }
    return positions;
  };
  const left = hand("left");
  const right = hand("right");
  if (style.stick_mode !== undefined) {
    const mode = inputs.modes?.modes[style.stick_mode];
    if (inputs.modes === undefined || mode === undefined) {
      throw new StyleError(`${name}: no stick mode '${style.stick_mode}' in this genre`);
    }
    const pedals = inputs.withPedals === true;
    left.stick = applyMode(left.stick, inputs.modes, mode, "left", pedals);
    right.stick = applyMode(right.stick, inputs.modes, mode, "right", pedals);
  }
  for (const id of [left, right].flatMap(placedActions)) {
    if (!(id in inputs.actions)) throw new StyleError(`${name}: '${id}' is not an action`);
  }
  return {
    left,
    right,
    acknowledge: style.acknowledge ?? null,
    actions: structuredClone(style.actions ?? {}),
  };
}

function placedActions(positions: Readonly<Record<string, PositionSpec>>): string[] {
  return Object.values(positions).flatMap((spec) => [
    ...[spec.tap, spec.long, spec.double].filter((value) => typeof value === "string"),
    ...Object.values(spec.directions ?? {}).filter((value) => typeof value === "string"),
  ]);
}
