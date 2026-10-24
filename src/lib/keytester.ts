/**
 * The live key tester: what arrived from a unit, and which control of the layout sends it.
 *
 * A press is matched against every control of the layout on screen (`expectedPresses`,
 * the tap of each). The exact keystroke first -- key and modifiers -- and, when nothing
 * sends that, the key alone, since a modifier still held from another press would
 * otherwise hide the control that sent it. Node-free, like the check run it shares
 * `Sent` and `sameSent` with.
 */

import type { ExpectedPress, Sent } from "./checkunit.js";
import { sameSent } from "./checkunit.js";

export interface UnitPresses {
  slug: string;
  /** "left" or "right", for saying which unit. */
  unit: string;
  presses: readonly ExpectedPress[];
}

export interface LiveHit {
  slug: string;
  unit: string;
  press: ExpectedPress;
  /** True when only the key matched: a modifier was held that this control does not send. */
  loose: boolean;
}

export function matchSent(sent: Sent, units: readonly UnitPresses[]): LiveHit[] {
  const exact: LiveHit[] = [];
  const loose: LiveHit[] = [];
  for (const { slug, unit, presses } of units) {
    for (const press of presses) {
      if (sameSent(press.sends, sent)) {
        exact.push({ slug, unit, press, loose: false });
      } else if (
        sent.kind === "key" &&
        press.sends.kind === "key" &&
        press.sends.code === sent.code &&
        press.sends.modifiers.every((modifier) => sent.modifiers.includes(modifier))
      ) {
        loose.push({ slug, unit, press, loose: true });
      }
    }
  }
  return exact.length > 0 ? exact : loose;
}

/** What a press is called on the board: "Ring 4", or "Thumbstick up". */
export function hitName(hit: LiveHit): string {
  return hit.press.direction === undefined ? hit.press.prompt : `stick ${hit.press.direction}`;
}
