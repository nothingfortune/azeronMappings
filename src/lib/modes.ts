/**
 * Modes of play, for a game that has them.
 *
 * Elite Dangerous is one game in several: flying the ship, driving the buggy, walking about.
 * A key is one thing in each, and the game decides which by where you are, so two actions
 * may share a key as long as they are never live at the same time. What is live together
 * is said by the layouts: each entry in a game's sets.yaml can list the `modes` it plays,
 * and two modes are live together when some layout plays both. A game whose layouts list no
 * modes -- Everspace 2 -- has every action live at once, as before.
 *
 * Node-free.
 */

import type { SetsData } from "../types/pedals.js";
import type { ActionSpec } from "../types/profile.js";

/** Whether actions in two modes can be live at once. An action with no mode always is. */
export type LiveTogether = (a: string | undefined, b: string | undefined) => boolean;

export function liveTogether(sets: SetsData | undefined): LiveTogether {
  const groups = Object.values(sets?.sets ?? {})
    .map((layout) => layout.modes)
    .filter((modes): modes is string[] => modes !== undefined && modes.length > 0);
  if (groups.length === 0) return () => true;
  return (a, b) =>
    a === undefined ||
    b === undefined ||
    a === b ||
    groups.some((modes) => modes.includes(a) && modes.includes(b));
}

/** Whether two actions can be live at once. */
export function actionsLiveTogether(
  live: LiveTogether,
  a: ActionSpec | undefined,
  b: ActionSpec | undefined,
): boolean {
  return live(a?.mode, b?.mode);
}

/** The modes a layout plays, or null when it does not say: then it plays every action. */
export function layoutModes(
  sets: SetsData | undefined,
  setName: string,
): ReadonlySet<string> | null {
  const modes = sets?.sets[setName]?.modes;
  return modes === undefined || modes.length === 0 ? null : new Set(modes);
}

/** Whether a layout plays an action: its mode is one of the layout's, or it has none. */
export function playsAction(
  modes: ReadonlySet<string> | null,
  spec: ActionSpec | undefined,
): boolean {
  return modes === null || spec?.mode === undefined || modes.has(spec.mode);
}
