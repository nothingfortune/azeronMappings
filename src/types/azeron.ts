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
  /**
   * Which of the two `analogKeys` blocks the unit actually reads. A right-hand unit
   * exports `true` and drives `analogKeys.right`; the left-handed software the format was
   * designed around exports `false` and drives `analogKeys.left`.
   */
  isRightAnalog?: boolean;
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

export interface ProfileSettings {
  /** The unit's optical sensor: whether it drives the system pointer. */
  isSensorOn?: boolean;
  profileSensitivitySettings?: {
    currentSensitivityIndex: number;
    sensitivityValues: number[];
  };
  [key: string]: unknown;
}

export interface ExportProfile {
  id: string;
  name: string;
  inputs: InputRecord[];
  profileSettings?: ProfileSettings;
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

export const TURBO_FIELDS: Record<Slot, "isTurbo" | "isTurboLong" | "isTurboDouble"> = {
  tap: "isTurbo",
  long: "isTurboLong",
  double: "isTurboDouble",
};

export const TURBO_INTERVAL_FIELDS: Record<
  Slot,
  "turboInterval" | "turboIntervalLong" | "turboIntervalDouble"
> = {
  tap: "turboInterval",
  long: "turboIntervalLong",
  double: "turboIntervalDouble",
};

/**
 * Stick mode name to types[0] code. Only keyboard mode is verified; gamepad mode is
 * forbidden for Everspace 2 anyway (it made the game stutter), and mouse mode has never
 * been captured from a real export.
 */
export const STICK_MODES: Record<string, string> = { [TYPE_STICK_KEYBOARD]: "keyboard" };
export const STICK_MODE_CODES: Record<string, string> = { keyboard: TYPE_STICK_KEYBOARD };

/**
 * The `analogKeys` block the unit actually reads.
 *
 * A right-hand unit exports `isRightAnalog: true` and drives `analogKeys.right`; the
 * left-handed software the format was designed around drives `analogKeys.left`. Writing
 * the wrong one compiles and lints cleanly and does nothing on the hardware, which is
 * what happened to the akimbo right unit's stick. The other block is left exactly as the
 * template had it -- it is inert, and rewriting it would churn the export for no reason.
 */
export function activeAnalogKeys(settings: AnalogSettings): AnalogDirections {
  return settings.isRightAnalog === true ? settings.analogKeys.right : settings.analogKeys.left;
}

/**
 * Whether a record is an ordinary input the compiler may rewrite.
 *
 * Pin 0 carries type `"2"`, the profile switch, which the Azeron software repairs if it is
 * overwritten -- a probe that rebound it produced a profile the app had to fix on import.
 * The codes `"6"`, `"29"` and `"30"` are not understood at all. Anything whose type is not
 * a plain key, an empty slot, a mouse button or a stick is left exactly as the template
 * has it, however the device map names its pin.
 */
export function isRebindableRecord(record: InputRecord): boolean {
  const type = String(record.types[0]);
  return (
    type === TYPE_KEYBOARD ||
    type === TYPE_NONE ||
    type === TYPE_MOUSE ||
    type === TYPE_STICK_KEYBOARD
  );
}
