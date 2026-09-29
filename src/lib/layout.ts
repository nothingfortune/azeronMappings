/** The physical shape of a Cyborg II, shared by the editor, the cheatsheet and the probe. */

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
