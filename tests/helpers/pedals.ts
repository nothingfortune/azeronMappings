/**
 * A game file as it would be once a flight stick and a pair of pedals have been bound in
 * the game, built from the game's own file as it stood before the first generation
 * (tests/fixtures/everspace2-Input.before.ini) -- not the committed copy in dist/, which
 * carries whatever the repo has already written.
 *
 * What is real, from the owner's machine: the flight stick's presets read
 * `JS-1_T16000M_Button0` (index -1: a stick that is not plugged in); the game's own log
 * registers exactly three inputs for the pedals, `JS0_SaitekProFlightRudderPedals_Axis0`
 * to `_Axis2`; and the owner's Input.ini has Yaw on `Axis1`, which is a toe brake that won
 * the bind screen, not the rudder.
 *
 * What is not established: which name is which pedal. The rudder being `Axis2` is
 * inferred from enumeration order and the toes' order is less certain still, so the
 * constants below are named for what the repo currently believes, not for what is known.
 */

import { readFileSync } from "node:fs";

import { repoPath } from "../../src/config/paths.js";
import { parseInput, setKey } from "../../src/lib/ingame.js";

export const BASE = readFileSync(repoPath("tests/fixtures/everspace2-Input.before.ini"), "utf8");

export const STICK_BUTTON = "JS-1_T16000M_Button0";
const DEVICE = "JS0_SaitekProFlightRudderPedals";
export const AXIS0 = `${DEVICE}_Axis0`;
export const AXIS1 = `${DEVICE}_Axis1`;
export const AXIS2 = `${DEVICE}_Axis2`;
/** The repo's current belief, from enumeration order. Not flown. */
export const RUDDER = AXIS2;
export const LEFT_TOE = AXIS0;
export const RIGHT_TOE = AXIS1;

/** The line index of one Joystick row, axis or not. */
export function joystickRow(text: string, action: string, axis: boolean, scale = 1): number {
  const found = parseInput(text).entries.find(
    (entry) =>
      entry.group === "Joystick" &&
      entry.action === action &&
      entry.isAxis === axis &&
      (axis || entry.scale === scale),
  );
  if (!found) throw new Error(`no Joystick ${axis ? "axis " : ""}row ${action}`);
  return found.index;
}

/** Put a key on a Joystick row, without touching any other line. */
export function bindJoystick(
  text: string,
  action: string,
  axis: boolean,
  key: string,
  scale = 1,
): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const index = joystickRow(text, action, axis, scale);
  lines[index] = setKey(lines[index] ?? "", key);
  return lines.join(eol);
}

/** The file with the owner's flight stick bound to a button, as theirs has. */
export function withFlightStick(text = BASE): string {
  return bindJoystick(text, "Boost", false, STICK_BUTTON);
}

/** The owner's file as it is today: Yaw on Axis1, which is a toe brake. */
export function withMisboundYaw(text = withFlightStick()): string {
  return bindJoystick(text, "Yaw", true, AXIS1);
}

/** The rudder on Yaw as the repo now believes it should be. */
export function withRudderBound(text = withFlightStick()): string {
  return bindJoystick(text, "Yaw", true, RUDDER);
}
