/** The physical shape of a Cyborg II, shared by the editor and the probe. */

import type { Device } from "./model-core.js";

export const FINGER_COLUMNS = ["pinky", "ring", "middle", "index"] as const;
/**
 * The thumb cluster is two devices, not one pile of keys: a d-pad that clicks, and a
 * thumbstick that clicks. Each is laid out as its own plus so which is which is obvious.
 */
export const DPAD_POSITIONS: readonly (readonly [position: string, cell: string])[] = [
  ["dpad_up", "up"],
  ["dpad_left", "left"],
  ["dpad_press", "center"],
  ["dpad_right", "right"],
  ["dpad_down", "down"],
];
export const STICK_POSITION = "stick";
export const STICK_PRESS_POSITION = "stick_press";
/** Whatever else sits by the thumb and belongs to neither. */
export const AUX_POSITIONS = ["thumb_aux_upper", "thumb_aux_lower"] as const;

export interface HandColumn {
  name: string;
  positions: string[];
  /** Side keys are single keys standing beside a finger column, not a column of five. */
  kind: "finger" | "side";
}

export interface HandLayout {
  /** Already in the order they appear on the unit, seen from above. */
  columns: HandColumn[];
  /** The d-pad, as [position, grid cell] pairs. */
  dpad: (readonly [string, string])[];
  aux: string[];
  stick: string | null;
  stickPress: string | null;
  /** Which end of the columns the thumb cluster sits at. */
  thumbSide: "left" | "right";
}

function column(device: Device, name: string): HandColumn {
  return {
    name,
    kind: "finger",
    positions: [1, 2, 3, 4, 5]
      .map((row) => `${name}_${String(row)}`)
      .filter((position) => position in device.positions),
  };
}

function sideColumn(device: Device, position: string, label: string): HandColumn[] {
  return position in device.positions ? [{ name: label, kind: "side", positions: [position] }] : [];
}

/**
 * Lay a unit out the way it sits under the hand.
 *
 * On a left-handed unit the thumb falls to the right of the index finger, so the columns
 * read pinky-to-index left to right. A right-handed unit is the mirror of that, thumb on
 * the left and pinky on the outside — which puts the two thumbs together when the pair is
 * drawn side by side, as the hands actually rest.
 *
 * The side keys are not a column of their own: `pinky_side` sits outboard of the pinky
 * and `index_side` inboard by the thumb, on whichever end that is for this hand.
 */
export function handLayout(device: Device): HandLayout {
  const fingers = FINGER_COLUMNS.map((name) => column(device, name));
  const outer = sideColumn(device, "pinky_side", "pinky side");
  const inner = sideColumn(device, "index_side", "index side");

  const columns = device.mirrored
    ? [...inner, ...[...fingers].reverse(), ...outer]
    : [...outer, ...fingers, ...inner];

  return {
    columns,
    dpad: DPAD_POSITIONS.filter(([position]) => position in device.positions),
    aux: AUX_POSITIONS.filter((position) => position in device.positions),
    stick: STICK_POSITION in device.positions ? STICK_POSITION : null,
    stickPress: STICK_PRESS_POSITION in device.positions ? STICK_PRESS_POSITION : null,
    thumbSide: device.mirrored ? "left" : "right",
  };
}

/** The order a press test sweeps the unit in: columns as laid out, then the thumb. */
export function probeOrder(device: Device): string[] {
  const layout = handLayout(device);
  return [
    ...layout.columns.flatMap((entry) => entry.positions),
    ...layout.dpad.map(([position]) => position),
    ...(layout.stickPress === null ? [] : [layout.stickPress]),
    ...layout.aux,
  ];
}

const FINGER_NAMES: Record<string, string> = {
  pinky: "Pinky",
  ring: "Ring",
  middle: "Middle",
  index: "Index",
};

const NAMED_POSITIONS: Record<string, string> = {
  pinky_side: "Pinky side",
  index_side: "Index side",
  dpad_up: "D-pad up",
  dpad_down: "D-pad down",
  dpad_left: "D-pad left",
  dpad_right: "D-pad right",
  dpad_press: "D-pad press",
  thumb_aux_upper: "Thumb upper",
  thumb_aux_lower: "Thumb lower",
  stick: "Stick",
  stick_press: "Stick press",
};

/**
 * A position the way a person names it: "Pinky 1", "Index side", "D-pad up".
 *
 * The ids are the repo's -- `pinky_1`, `thumb_aux_upper` -- and every screen showed them
 * as they are stored, down to "PRESS PINKY_SIDE" on the press test. Finger rows are
 * numbered as the device maps record them, 1 at the top. A name this does not recognise
 * is tidied rather than guessed at.
 */
export function positionLabel(name: string): string {
  const known = NAMED_POSITIONS[name];
  if (known !== undefined) return known;
  const finger = /^(pinky|ring|middle|index)_(\d+)$/.exec(name);
  if (finger?.[1] && finger[2]) return `${FINGER_NAMES[finger[1]] ?? finger[1]} ${finger[2]}`;
  const words = name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "Left" or "Right" for a unit, or the unit as written when it is neither. */
export function unitLabel(unit: string | undefined): string {
  if (unit === "left") return "Left";
  if (unit === "right") return "Right";
  return unit ?? "?";
}

/** Where something is sent from, for a list: "Left Pinky 1", "Right Stick up". */
export function whereLabel(unit: string | undefined, position: string, direction?: string): string {
  const place = positionLabel(position);
  return `${unitLabel(unit)} ${direction === undefined ? place : `${place} ${direction}`}`;
}
