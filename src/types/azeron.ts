/**
 * The Azeron export format, as reverse-engineered from a real 2.0.2 export.
 *
 * Only the fields the compiler writes are named. Everything else rides along in the
 * index signature so it survives a round trip untouched -- macros, turbo settings,
 * `subType`, analog tuning and the records for pins nobody has identified yet.
 */

export type KeyToken = string;

export interface AnalogDirections {
  up: (number | string)[];
  right: (number | string)[];
  down: (number | string)[];
  left: (number | string)[];
}

export interface AnalogDiagonals {
  up_right: (number | string)[];
  up_left: (number | string)[];
  down_left: (number | string)[];
  down_right: (number | string)[];
}

export interface AnalogSettings {
  analogKeys: { left: AnalogDirections; right: AnalogDirections };
  diagonalKeys?: { left: AnalogDiagonals; right: AnalogDiagonals };
  /** Rotation of the stick's zero. Semantics unverified -- only written when measured. */
  angle?: number;
  isEightDirectionalTrigger?: boolean;
  [key: string]: unknown;
}

export interface InputRecord {
  id: number;
  pinOne: number;
  pinTwo: number;
  types: string[];
  keyValues: KeyToken[];
  metaValues: KeyToken[];
  keyValuesLong: KeyToken[];
  metaValuesLong: KeyToken[];
  keyValuesDouble: KeyToken[];
  metaValuesDouble: KeyToken[];
  featureDelay: number;
  doubleDelay: number;
  isHold: boolean;
  isHoldLong: boolean;
  isHoldDouble: boolean;
  label?: string;
  analogSettings?: AnalogSettings;
  [key: string]: unknown;
}

export interface ExportProfile {
  id: string;
  name: string;
  inputs: InputRecord[];
  [key: string]: unknown;
}

export interface ExportDocument {
  version: string;
  profiles: ExportProfile[];
  [key: string]: unknown;
}

/** types[] codes. Anything not listed is unknown and is preserved, never invented. */
export const TYPE_NONE = "11";
export const TYPE_KEYBOARD = "1";
export const TYPE_MOUSE = "15";
export const TYPE_STICK_KEYBOARD = "4";

/** The app's defaults for an untouched key. */
export const DEFAULT_FEATURE_DELAY = 500;
export const DEFAULT_DOUBLE_DELAY = 150;

export const SLOTS = ["tap", "long", "double"] as const;
export type Slot = (typeof SLOTS)[number];

export const STICK_DIRECTIONS = ["up", "right", "down", "left"] as const;
export type StickDirection = (typeof STICK_DIRECTIONS)[number];

export const STICK_DIAGONALS = ["up_right", "down_right", "down_left", "up_left"] as const;
export type StickDiagonal = (typeof STICK_DIAGONALS)[number];

/** The eight sectors an eight-directional stick reports, clockwise from up. */
export const STICK_SECTORS = [
  "up",
  "up_right",
  "right",
  "down_right",
  "down",
  "down_left",
  "left",
  "up_left",
] as const;
export type StickSector = (typeof STICK_SECTORS)[number];

/** One sector is 360 / 8 degrees wide. */
export const SECTOR_DEGREES = 45;

export const SLOT_FIELDS: Record<Slot, readonly [keyof InputRecord, keyof InputRecord]> = {
  tap: ["keyValues", "metaValues"],
  long: ["keyValuesLong", "metaValuesLong"],
  double: ["keyValuesDouble", "metaValuesDouble"],
};

export const HOLD_FIELDS: Record<Slot, "isHold" | "isHoldLong" | "isHoldDouble"> = {
  tap: "isHold",
  long: "isHoldLong",
  double: "isHoldDouble",
};

/**
 * Stick mode name to types[0] code. Only keyboard mode is verified; gamepad mode is
 * forbidden for Everspace 2 anyway (it made the game stutter), and mouse mode has never
 * been captured from a real export.
 */
export const STICK_MODES: Record<string, string> = { [TYPE_STICK_KEYBOARD]: "keyboard" };
export const STICK_MODE_CODES: Record<string, string> = { keyboard: TYPE_STICK_KEYBOARD };
