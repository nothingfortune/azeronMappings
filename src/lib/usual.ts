/**
 * The usual bindings: what a game of the genre usually puts each action on for a keyboard
 * and mouse (`keyboard:`) and for a controller (`xbox:`), turned into the game's own `kbm`
 * and `pad` where it has none -- a place to start, changed on the In-game tab like any other.
 *
 * A suggestion is skipped rather than made a clash: one that another action live at the same
 * time is already on stays off, and so does a key from the pool the units are wired from,
 * which some action may be sent on now or later. Node-free, so the editor and `startGame`
 * share it.
 */

import type { ActionSpec } from "../types/profile.js";
import { canonicalKbm, isPadControl, parseKbm } from "./controls.js";
import { actionsLiveTogether, type LiveTogether } from "./modes.js";
import { WIRE_POOL } from "./wiring.js";

/** A unit's mouse buttons, as a keyboard-and-mouse binding names them. */
const UNIT_MOUSE: Readonly<Record<string, string>> = {
  left: "MouseLeft",
  middle: "MouseMiddle",
  right: "MouseRight",
};

export interface UsualBinding {
  kbm?: string;
  pad?: string;
}

/**
 * The bindings to add: for each action, a `kbm` from its `keyboard` and a `pad` from its
 * `xbox`, only where the action has none of its own. Actions are taken in the file's order,
 * so of two suggesting one binding the first keeps it.
 */
export function usualBindings(
  actions: Readonly<Record<string, ActionSpec>>,
  live: LiveTogether = () => true,
): Record<string, UsualBinding> {
  const added: Record<string, UsualBinding> = {};
  /** What an action is on, as the game would see it, for one kind of binding. */
  const holds = (id: string, spec: ActionSpec, field: "kbm" | "pad"): string[] => {
    const own = spec[field] ?? added[id]?.[field];
    if (field === "pad") return typeof own === "string" ? [own] : [];
    const held = typeof own === "string" ? [canonicalKbm(own)] : [];
    // The key a unit sends reaches the game as a keyboard key too: another action's usual
    // binding on it would be two actions on one key.
    const sent = [spec.meta, spec.key].filter((part): part is string => typeof part === "string");
    if (sent.length > 0) held.push(canonicalKbm(sent.join("+")));
    const mouse = typeof spec.mouse === "string" ? UNIT_MOUSE[spec.mouse] : undefined;
    if (mouse !== undefined) held.push(mouse);
    return held;
  };
  for (const [id, spec] of Object.entries(actions)) {
    const free = (field: "kbm" | "pad", value: string): boolean =>
      !Object.entries(actions).some(
        ([otherId, other]) =>
          otherId !== id &&
          holds(otherId, other, field).includes(value) &&
          actionsLiveTogether(live, spec, other),
      );
    if (spec.kbm === undefined && typeof spec.keyboard === "string") {
      const parsed = parseKbm(spec.keyboard);
      const value =
        parsed === null || WIRE_POOL.includes(spec.keyboard) ? null : canonicalKbm(spec.keyboard);
      if (value !== null && free("kbm", value)) added[id] = { ...added[id], kbm: value };
    }
    if (spec.pad === undefined && isPadControl(spec.xbox) && typeof spec.xbox === "string") {
      if (free("pad", spec.xbox)) added[id] = { ...added[id], pad: spec.xbox };
    }
  }
  return added;
}
