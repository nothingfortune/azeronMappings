/**
 * The Cyborg II's configuration protocol, as Azeron Software 2.0.2 speaks it to firmware 111.
 *
 * Recovered on 2026-10-14 by logging every HID report the app sent and received while it
 * connected to a unit, read its onboard profiles, and wrote one into a free slot -- and by
 * reading the command table out of the running app. Nothing here is guessed from the
 * firmware: every command this module builds is one the app was seen to send, in the shape
 * the app sent it. `docs/guides/unit-protocol.md` has the evidence and what is still open.
 *
 * Node-free on purpose: the editor sends these reports over WebHID.
 */

import type { AnalogSettings, InputRecord } from "../types/azeron.js";
import { LEGACY_KEY_TOKENS, NONE_TOKEN, analogToName } from "./keys.js";

export const AZERON_VENDOR_ID = 0x16d0;
export const CYBORG2_PRODUCT_ID = 0x12f7;
/** The vendor-defined interface the app configures over (Windows lists it as MI_04). */
export const CONFIG_USAGE_PAGE = 0xff01;
export const CONFIG_USAGE = 0x0001;

/** Firmware this module has been checked against. Anything else is refused. */
export const KNOWN_FIRMWARE = [111] as const;
/** keypadType the unit reports: 8 is the Cyborg II. */
export const CYBORG2_KEYPAD_TYPE = 8;

/** Every report is 64 bytes, sent with report id 0. */
export const REPORT_LENGTH = 64;
const HEADER_LENGTH = 7;
/** Payload bytes one report carries. */
export const PART_CAPACITY = REPORT_LENGTH - HEADER_LENGTH;

/**
 * The app's command table (its `enum`, read from the running app). Numbers are the command
 * byte of a report.
 */
export const Command = {
  KEYPAD_STATUS: 1,
  KEYPAD_DETAILS: 2,
  KEYPAD_DETAILS_SAVE: 3,
  PROFILE_PAYLOAD: 4,
  FIRMWARE_VERSION: 5,
  MODE_SWITCH: 6,
  LED_STATE: 7,
  SET_THROTTLE_TYPE: 8,
  SET_LED_BRIGHTNESS: 9,
  BUTTON_BIND: 10,
  OBM_COPY: 11,
  RESET: 12,
  DFU: 13,
  HARDWARE_PROFILE_INDEX: 14,
  PURE_ANALOG: 15,
  PROFILE_NAME: 16,
  LEGACY_MODE_SWITCH: 17,
  PING_DEVICE: 18,
  GET_ALL_GLOBAL_MOUSE_SETTINGS: 19,
  SET_GLOBAL_MOUSE_SENSOR_STATE: 20,
  SET_GLOBAL_MOUSE_SENSOR_SENSITIVITY: 21,
  SET_GLOBAL_MOUSE_SENSOR_ANGLE: 22,
  SET_MOUSE_SENSOR_SENSITIVITY_SETTINGS: 23,
  SET_MOUSE_SENSOR_STATE_SETTINGS: 24,
  SET_MOUSE_SENSOR_ANGLE_SETTINGS: 25,
  SWITCH_PROFILE: 26,
  ADD_PROFILE: 27,
  DELETE_PROFILE: 28,
  CHECK_PROFILE: 29,
  REQUEST_PROFILE: 30,
  PROFILE_LIMIT: 31,
  SOFTWARE_BUTTON: 32,
  RIGHT_ANALOG: 33,
  SET_THROTTLE_VALUE: 34,
  ANALOG_CALIBRATION_DATA: 35,
  SWITCH_BUTTON_STATE: 36,
  DPI_BUTTON_STATE: 37,
  SW_ANALOG_SETTINGS: 38,
  SW_BUTTON_WHEEL: 39,
  OBM_PROFILE_SETTINGS_COPY: 40,
  UPDATE_DEVICE_ID: 41,
  RELEASE_SW_BUTTONS: 42,
  PROFILE_INPUT_PIECE: 43,
  LED_EFFECT: 44,
  ANALOG_BIND: 45,
  PROFILE_PAYLOAD_V2: 46,
  RGB_LED_STATE: 47,
  SET_ANALOG_THROTTLE: 48,
  SET_GLOBAL_ANGLE: 49,
  ADVANCE_ANALOG_BIND: 50,
  TOGGLE_ANALOG_POSITION: 51,
  RELEASED_ALL_BUTTONS: 52,
  DEVICE_DIAGNOSTICS: 53,
  DEFAULT_LED_COLOR: 54,
  JOYSTICK_POSITION: 55,
  PURE_JOYSTICK_POSITION: 56,
  BUTTON_POSITION: 57,
  SET_LED_SLEEP_BEHAVIOR: 58,
  CHECK_DEVICE: 59,
  SW_MOUSE_WHEEL_SETTINGS: 60,
} as const;

export type CommandName = keyof typeof Command;

const COMMAND_NAMES = new Map<number, CommandName>(
  (Object.entries(Command) as [CommandName, number][]).map(([name, code]) => [code, name]),
);

export function commandName(code: number): string {
  return COMMAND_NAMES.get(code) ?? `0x${code.toString(16).padStart(2, "0")}`;
}

/**
 * The only commands this repo will put on the wire. Each was seen the app send, with the
 * payload this module builds for it. Reset, DFU, the device id and the keypad details save
 * are not here and cannot be sent: `hostReports` refuses anything outside this set.
 */
export const SENDABLE_COMMANDS: ReadonlySet<number> = new Set([
  Command.FIRMWARE_VERSION,
  Command.KEYPAD_DETAILS,
  Command.PROFILE_LIMIT,
  Command.HARDWARE_PROFILE_INDEX,
  Command.PROFILE_PAYLOAD_V2,
  Command.PROFILE_INPUT_PIECE,
  Command.CHECK_PROFILE,
  Command.PROFILE_NAME,
  Command.OBM_COPY,
  // Seen 2026-10-14 when a slot was picked in the app: [slot]; the unit answers with it.
  Command.SWITCH_PROFILE,
  // Seen 2026-10-17 when a slot was deleted in the app: [slot]; the unit answers empty.
  Command.DELETE_PROFILE,
]);

export class ProtocolError extends Error {}

/**
 * A host report: `[0][length][command][seq][parts][part][part length][payload…]`, zero
 * padded to 64 bytes. A payload longer than one report is split, every part carrying the
 * whole length in byte 1 and its own in byte 6 -- an input record goes as 57 + 11 bytes and
 * the stick's as 57 + 57 + 20, exactly as the app splits them.
 *
 * Byte 0 was 0 in every report the app sent, all of them under 256 bytes long; a longer
 * payload is refused rather than guessed at.
 */
export function hostReports(command: number, firstSeq: number, payload: Uint8Array): Uint8Array[] {
  if (!SENDABLE_COMMANDS.has(command)) {
    throw new ProtocolError(
      `refusing to send ${commandName(command)}: not a command this repo sends`,
    );
  }
  if (payload.length > 0xff) {
    throw new ProtocolError(
      `a ${String(payload.length)}-byte payload is longer than any the app sent`,
    );
  }
  const parts = Math.max(1, Math.ceil(payload.length / PART_CAPACITY));
  const reports: Uint8Array[] = [];
  for (let part = 0; part < parts; part++) {
    const chunk = payload.subarray(part * PART_CAPACITY, (part + 1) * PART_CAPACITY);
    const report = new Uint8Array(REPORT_LENGTH);
    report[0] = 0;
    report[1] = payload.length;
    report[2] = command;
    report[3] = (firstSeq + part) & 0xff;
    report[4] = parts;
    report[5] = part + 1;
    report[6] = chunk.length;
    report.set(chunk, HEADER_LENGTH);
    reports.push(report);
  }
  return reports;
}

export interface DeviceReport {
  command: number;
  seq: number;
  /** For a profile stream, the index of the stream's last item; 1 otherwise. */
  parts: number;
  /** For a profile stream, the item this report belongs to. */
  part: number;
  payload: Uint8Array;
}

/** A report from the unit: `[length lo][length hi][command][seq][parts][part][part length][payload…]`. */
export function parseDeviceReport(report: Uint8Array): DeviceReport {
  if (report.length < HEADER_LENGTH)
    throw new ProtocolError("a device report shorter than its header");
  const length = report[6] ?? 0;
  if (HEADER_LENGTH + length > report.length) {
    throw new ProtocolError(`a device report claims ${String(length)} bytes it does not have`);
  }
  return {
    command: report[2] ?? 0,
    seq: report[3] ?? 0,
    parts: report[4] ?? 0,
    part: report[5] ?? 0,
    payload: report.slice(HEADER_LENGTH, HEADER_LENGTH + length),
  };
}

// ---------------------------------------------------------------------------------------
// Keys

/**
 * The unit's key codes: `0xF000 | HID usage` for a key, `0xE000 | modifier bit` for a
 * modifier, `0xE400 | consumer usage` for a media key. The app's own table, read from it.
 */
export const DEVICE_KEY_CODES: Readonly<Record<string, number>> = {
  ControlLeft: 0xe001,
  ShiftLeft: 0xe002,
  AltLeft: 0xe004,
  MetaLeft: 0xe008,
  ControlRight: 0xe010,
  ShiftRight: 0xe020,
  AltRight: 0xe040,
  MetaRight: 0xe080,
  MediaTrackNext: 0xe4b5,
  MediaTrackPrevious: 0xe4b6,
  MediaStop: 0xe4b7,
  MediaPlayPause: 0xe4cd,
  AudioVolumeMute: 0xe4e2,
  AudioVolumeUp: 0xe4e9,
  AudioVolumeDown: 0xe4ea,
  KeyA: 0xf004,
  KeyB: 0xf005,
  KeyC: 0xf006,
  KeyD: 0xf007,
  KeyE: 0xf008,
  KeyF: 0xf009,
  KeyG: 0xf00a,
  KeyH: 0xf00b,
  KeyI: 0xf00c,
  KeyJ: 0xf00d,
  KeyK: 0xf00e,
  KeyL: 0xf00f,
  KeyM: 0xf010,
  KeyN: 0xf011,
  KeyO: 0xf012,
  KeyP: 0xf013,
  KeyQ: 0xf014,
  KeyR: 0xf015,
  KeyS: 0xf016,
  KeyT: 0xf017,
  KeyU: 0xf018,
  KeyV: 0xf019,
  KeyW: 0xf01a,
  KeyX: 0xf01b,
  KeyY: 0xf01c,
  KeyZ: 0xf01d,
  Digit1: 0xf01e,
  Digit2: 0xf01f,
  Digit3: 0xf020,
  Digit4: 0xf021,
  Digit5: 0xf022,
  Digit6: 0xf023,
  Digit7: 0xf024,
  Digit8: 0xf025,
  Digit9: 0xf026,
  Digit0: 0xf027,
  Enter: 0xf028,
  Escape: 0xf029,
  Backspace: 0xf02a,
  Tab: 0xf02b,
  Space: 0xf02c,
  Minus: 0xf02d,
  Equal: 0xf02e,
  BracketLeft: 0xf02f,
  BracketRight: 0xf030,
  Backslash: 0xf031,
  Semicolon: 0xf033,
  Quote: 0xf034,
  Backquote: 0xf035,
  Comma: 0xf036,
  Period: 0xf037,
  Slash: 0xf038,
  CapsLock: 0xf039,
  F1: 0xf03a,
  F2: 0xf03b,
  F3: 0xf03c,
  F4: 0xf03d,
  F5: 0xf03e,
  F6: 0xf03f,
  F7: 0xf040,
  F8: 0xf041,
  F9: 0xf042,
  F10: 0xf043,
  F11: 0xf044,
  F12: 0xf045,
  PrintScreen: 0xf046,
  ScrollLock: 0xf047,
  Pause: 0xf048,
  Insert: 0xf049,
  Home: 0xf04a,
  PageUp: 0xf04b,
  Delete: 0xf04c,
  End: 0xf04d,
  PageDown: 0xf04e,
  ArrowRight: 0xf04f,
  ArrowLeft: 0xf050,
  ArrowDown: 0xf051,
  ArrowUp: 0xf052,
  NumLock: 0xf053,
  NumpadDivide: 0xf054,
  NumpadMultiply: 0xf055,
  NumpadSubtract: 0xf056,
  NumpadAdd: 0xf057,
  NumpadEnter: 0xf058,
  Numpad1: 0xf059,
  Numpad2: 0xf05a,
  Numpad3: 0xf05b,
  Numpad4: 0xf05c,
  Numpad5: 0xf05d,
  Numpad6: 0xf05e,
  Numpad7: 0xf05f,
  Numpad8: 0xf060,
  Numpad9: 0xf061,
  Numpad0: 0xf062,
  NumpadDecimal: 0xf063,
  ContextMenu: 0xf065,
  F13: 0xf068,
  F14: 0xf069,
  F15: 0xf06a,
  F16: 0xf06b,
  F17: 0xf06c,
  F18: 0xf06d,
  F19: 0xf06e,
  F20: 0xf06f,
  F21: 0xf070,
  F22: 0xf071,
  F23: 0xf072,
  F24: 0xf073,
};

const KEY_NAMES = new Map<number, string>(
  Object.entries(DEVICE_KEY_CODES).map(([name, code]) => [code, name]),
);

/** An export key token ("KeyF", or the legacy "16") to the unit's code; 0 for an empty slot. */
export function keyCode(token: string | number | null | undefined): number {
  if (token === null || token === undefined || token === NONE_TOKEN || token === 0) return 0;
  const text = String(token);
  const name = LEGACY_KEY_TOKENS[text] ?? text;
  const code = DEVICE_KEY_CODES[name];
  if (code === undefined) throw new ProtocolError(`the unit has no code for the key "${text}"`);
  return code;
}

/**
 * A key as read back from the unit, to its code: `keyCode`, plus the "0x…" a code with no
 * name decodes to. Only for comparing what a slot holds -- never for writing.
 */
export function storedKeyCode(token: string | number | null | undefined): number {
  const text = String(token ?? NONE_TOKEN);
  return /^0x[0-9a-f]{4}$/.test(text) ? Number.parseInt(text.slice(2), 16) : keyCode(text);
}

/**
 * The unit's code back to the name the app shows; "0" for an empty slot. A code with no
 * name comes back as "0x…", so a slot holding something unexpected is reported, not lost.
 */
export function keyName(code: number): string {
  if (code === 0) return NONE_TOKEN;
  return KEY_NAMES.get(code) ?? `0x${code.toString(16).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------------------
// Writing an input: OBM_COPY

/** types[] codes a record may be written with; the app writes nothing else either. */
const WRITABLE_TYPES = new Map<string, number>([
  ["1", 1],
  ["11", 11],
  ["15", 15],
]);
const TYPE_STICK = 4;

/** The bytes OBM_COPY carries for one key-like input. */
export const INPUT_RECORD_LENGTH = 68;
/** The bytes OBM_COPY carries for a keyboard-mode stick. */
export const STICK_RECORD_LENGTH = 134;

class Writer {
  readonly bytes: Uint8Array;
  private at = 0;
  constructor(length: number) {
    this.bytes = new Uint8Array(length);
  }
  u8(value: number, what: string): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new ProtocolError(`${what} is ${String(value)}; the unit stores it in one byte`);
    }
    this.bytes[this.at++] = value;
  }
  /** Big-endian: OBM_COPY sends every 16-bit value high byte first. */
  u16(value: number, what: string): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new ProtocolError(`${what} is ${String(value)}; the unit stores it in two bytes`);
    }
    this.bytes[this.at++] = value >> 8;
    this.bytes[this.at++] = value & 0xff;
  }
  i16(value: number, what: string): void {
    if (!Number.isInteger(value) || value < -0x8000 || value > 0x7fff) {
      throw new ProtocolError(
        `${what} is ${String(value)}; the unit stores it as a signed 16-bit value`,
      );
    }
    this.u16(value & 0xffff, what);
  }
  flag(value: unknown): void {
    this.bytes[this.at++] = value === true ? 1 : 0;
  }
  get length(): number {
    return this.at;
  }
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function tokens(list: unknown, count: number): (string | number)[] {
  const out: (string | number)[] = [];
  const source = Array.isArray(list) ? (list as unknown[]) : [];
  for (let i = 0; i < count; i++) {
    const value = source[i];
    out.push(typeof value === "string" || typeof value === "number" ? value : NONE_TOKEN);
  }
  return out;
}

const TRIGGERS = [
  {
    keys: "keyValues",
    metas: "metaValues",
    hold: "isHold",
    holdTime: "holdTime",
    turbo: "isTurbo",
    turboInterval: "turboInterval",
    delay: null,
  },
  {
    keys: "keyValuesLong",
    metas: "metaValuesLong",
    hold: "isHoldLong",
    holdTime: "holdTimeLong",
    turbo: "isTurboLong",
    turboInterval: "turboIntervalLong",
    delay: "featureDelay",
  },
  {
    keys: "keyValuesDouble",
    metas: "metaValuesDouble",
    hold: "isHoldDouble",
    holdTime: "holdTimeDouble",
    turbo: "isTurboDouble",
    turboInterval: "turboIntervalDouble",
    delay: "doubleDelay",
  },
] as const;

const DEFAULT_DELAYS: Record<string, number> = { featureDelay: 500, doubleDelay: 150 };

/**
 * Whether the app would write this input to a unit. It skips a slot with no pin (255), the
 * profile switch on pin 0, pins nobody has identified, and any type it does not write.
 */
export function isWritableInput(input: InputRecord, unknownPins: readonly number[] = []): boolean {
  if (input.pinOne === 255 || input.pinOne === 0) return false;
  if (unknownPins.includes(input.pinOne)) return false;
  const type = input.types[0];
  if (type === String(TYPE_STICK)) return true;
  return input.types.every((t) => WRITABLE_TYPES.has(t));
}

/**
 * One input as OBM_COPY carries it: `[slot][id][pinOne][pinTwo]` then a block per trigger
 * (tap, long, double): `[type][4 keys][3 modifiers][hold][delay?][hold time][turbo][turbo
 * interval]`. The tap block has no delay; long carries featureDelay and double doubleDelay.
 */
export function encodeInputRecord(slot: number, input: InputRecord): Uint8Array {
  if (input.types[0] === String(TYPE_STICK)) return encodeStickRecord(slot, input);
  const w = new Writer(INPUT_RECORD_LENGTH);
  const where = `input ${String(input.id)}`;
  w.u8(slot, "slot");
  w.u8(input.id, `${where} id`);
  w.u8(input.pinOne, `${where} pinOne`);
  w.u8(input.pinTwo, `${where} pinTwo`);
  TRIGGERS.forEach((trigger, index) => {
    const typeToken = input.types[index] ?? "11";
    const type = WRITABLE_TYPES.get(typeToken);
    if (type === undefined)
      throw new ProtocolError(`${where}: type ${typeToken} is not one the app writes`);
    w.u8(type, `${where} type`);
    for (const token of tokens(input[trigger.keys], 4)) {
      w.u16(type === 15 ? Number(token) : keyCode(token), `${where} ${trigger.keys}`);
    }
    for (const token of tokens(input[trigger.metas], 3)) {
      w.u16(keyCode(token), `${where} ${trigger.metas}`);
    }
    w.flag(input[trigger.hold]);
    if (trigger.delay !== null) {
      w.u16(
        num(input[trigger.delay], DEFAULT_DELAYS[trigger.delay] ?? 0),
        `${where} ${trigger.delay}`,
      );
    }
    w.u16(num(input[trigger.holdTime], 0), `${where} ${trigger.holdTime}`);
    w.flag(input[trigger.turbo]);
    w.u8(num(input[trigger.turboInterval], 0), `${where} ${trigger.turboInterval}`);
  });
  return w.bytes;
}

const STICK_KEY_ORDER: readonly [string, string, string][] = [
  ["analogKeys", "left", "up"],
  ["analogKeys", "left", "right"],
  ["analogKeys", "left", "down"],
  ["analogKeys", "left", "left"],
  ["analogKeys", "right", "up"],
  ["analogKeys", "right", "right"],
  ["analogKeys", "right", "down"],
  ["analogKeys", "right", "left"],
  ["diagonalKeys", "left", "up_right"],
  ["diagonalKeys", "left", "up_left"],
  ["diagonalKeys", "left", "down_left"],
  ["diagonalKeys", "left", "down_right"],
  ["diagonalKeys", "right", "up_right"],
  ["diagonalKeys", "right", "up_left"],
  ["diagonalKeys", "right", "down_left"],
  ["diagonalKeys", "right", "down_right"],
];

function stickEntry(analog: AnalogSettings, path: readonly [string, string, string]): unknown[] {
  const [group, side, direction] = path;
  const block = (analog as Record<string, unknown>)[group];
  if (typeof block !== "object" || block === null) return [];
  const sideBlock = (block as Record<string, unknown>)[side];
  if (typeof sideBlock !== "object" || sideBlock === null) return [];
  const entry = (sideBlock as Record<string, unknown>)[direction];
  return Array.isArray(entry) ? (entry as unknown[]) : [];
}

/**
 * The keyboard-mode stick. Its 33 bytes of tuning come in the order the app sends them;
 * every value was told apart by giving it a value no other field had. `isRightAnalog`,
 * `invertXAxis` and `invertYAxis` were confirmed on 2026-10-15 by the app's own decoding of
 * a right-unit slot this wrote. Still inferred from the order: which of the three booleans
 * set together in that first write -- combined, hold trigger, angle lock -- is which.
 */
export function encodeStickRecord(slot: number, input: InputRecord): Uint8Array {
  const analog = input.analogSettings;
  if (analog === undefined)
    throw new ProtocolError(`stick ${String(input.id)} has no analogSettings`);
  const a = analog as Record<string, unknown>;
  const cones = (a.analogCones ?? {}) as Record<string, unknown>;
  const w = new Writer(STICK_RECORD_LENGTH);
  const where = `stick ${String(input.id)}`;
  w.u8(slot, "slot");
  w.u8(input.id, `${where} id`);
  w.u8(input.pinOne, `${where} pinOne`);
  w.u8(input.pinTwo, `${where} pinTwo`);
  w.u8(TYPE_STICK, `${where} type`);
  w.u16(num(a.upperLimit, 0), `${where} upperLimit`);
  w.u16(num(a.lowerLimit, 0), `${where} lowerLimit`);
  w.i16(num(a.angle, 0), `${where} angle`);
  w.u16(num(a.sensitivity, 0), `${where} sensitivity`);
  w.u8(num(cones.verticalCone, 45), `${where} verticalCone`);
  w.u8(num(cones.horizontalCone, 45), `${where} horizontalCone`);
  w.flag(a.isEightDirectionalTrigger);
  w.u8(num(a.mouseSensitivity, 5), `${where} mouseSensitivity`);
  w.u8(num(a.analogThrottle, 0), `${where} analogThrottle`);
  w.flag(a.isAnalogSmoothing);
  w.u8(num(a.triggerMagnitude, 4), `${where} triggerMagnitude`);
  w.flag(a.isCombinedAnalog);
  w.u8(num(a.combinedAnalogMagnitude, 6), `${where} combinedAnalogMagnitude`);
  w.flag(a.isHoldTrigger);
  w.u8(num(a.holdMagnitude, 9), `${where} holdMagnitude`);
  w.u8(Number(a.holdType ?? 1), `${where} holdType`);
  for (const token of tokens(a.holdKeyValues, 3))
    w.u16(holdKeyCode(token), `${where} holdKeyValues`);
  w.u8(num(a.rotateStickButtonId, 0), `${where} rotateStickButtonId`);
  w.flag(a.isAngleLock);
  w.u8(num(a.lockZoneAngle, 70), `${where} lockZoneAngle`);
  w.u8(num(a.lockZoneSize, 30), `${where} lockZoneSize`);
  w.flag(a.isRightAnalog);
  w.flag(a.invertXAxis);
  w.flag(a.invertYAxis);
  for (const path of STICK_KEY_ORDER) {
    const entry = stickEntry(analog, path);
    w.u16(stickKeyCode(entry[0]), `${where} ${path.join(".")}`);
    w.u16(stickKeyCode(entry[1]), `${where} ${path.join(".")} modifier`);
    w.u16(stickKeyCode(entry[2]), `${where} ${path.join(".")} modifier`);
  }
  if (w.length !== STICK_RECORD_LENGTH) throw new ProtocolError("stick record length drifted");
  return w.bytes;
}

/**
 * A hold-trigger key as the app sends it. "16", the app's own default, goes as Shift's code
 * (0xE002) -- every slot the app wrote from a layout holds that -- while any other number
 * goes as itself ("17" was sent as 0x0011, 2026-10-14). Seen both ways; nothing else is.
 */
export function holdKeyCode(token: unknown): number {
  const text = typeof token === "string" || typeof token === "number" ? String(token) : "0";
  if (text === "16") return DEVICE_KEY_CODES.ShiftLeft ?? 0xe002;
  const value = Number(text);
  if (!Number.isInteger(value))
    throw new ProtocolError(`the hold key "${text}" is not one the app was seen to send`);
  return value;
}

/**
 * A stick direction's key. A 2.0.2 profile holds `KeyboardEvent.code` strings ("ArrowUp");
 * the compiler and older exports hold integer JS keyCodes (87 for W). Both are the same
 * key to the unit; an integer the repo has no name for is refused, never reinterpreted.
 */
export function stickKeyCode(value: unknown): number {
  if (typeof value === "string" && /^0x[0-9a-f]{4}$/.test(value)) {
    throw new ProtocolError(`the stick key ${value} is a raw code, not a key`);
  }
  if (typeof value === "number" && value !== 0) {
    const name = analogToName(value);
    if (name === null)
      throw new ProtocolError(`the stick key ${String(value)} is not one the repo can name`);
    return keyCode(name);
  }
  return keyCode(typeof value === "string" ? value : NONE_TOKEN);
}

// ---------------------------------------------------------------------------------------
// The profile name and the slot check

/** Longest name seen stored: the unit kept 19 characters of a longer one. */
export const MAX_PROFILE_NAME = 19;

export function profileNamePayload(slot: number, name: string): Uint8Array {
  const bytes = Array.from(name, (ch) => ch.charCodeAt(0));
  if (bytes.some((b) => b < 0x20 || b > 0x7e)) {
    throw new ProtocolError(`profile name "${name}" has characters outside printable ASCII`);
  }
  if (bytes.length === 0 || bytes.length > MAX_PROFILE_NAME) {
    throw new ProtocolError(
      `profile name "${name}" is ${String(bytes.length)} characters; the unit keeps 1 to ${String(MAX_PROFILE_NAME)}`,
    );
  }
  return Uint8Array.from([slot, bytes.length, ...bytes]);
}

// ---------------------------------------------------------------------------------------
// Reading: the profile stream

/**
 * One onboard profile as the unit sends it. Records are the unit's own layout (values
 * little-endian), decoded into the fields the app shows.
 */
export interface StoredProfile {
  slot: number;
  name: string;
  inputs: StoredInput[];
  /** The slot's own settings piece, or null when the stream carried none. */
  settings: StoredSettings | null;
}

/**
 * A slot's settings piece, as far as it is known. Each field was told apart against the
 * app's own decoding of the same bytes (tests/fixtures/unit-protocol): the sensitivity steps
 * by their distinct values, the lights by a slot whose lights were set apart from the rest.
 *
 * Not decoded, because every slot seen holds the same value and the bytes it could be in
 * hold that value too: the current sensitivity step (1), whether the sensor is on (true)
 * and the sensor's angle (0) are among `01 01 00` before the steps and `01 00 00` after
 * them. The LED colours are stored transformed in a way not yet worked out. All of it is
 * kept in `raw`.
 */
export interface StoredSettings {
  /** The five DPI steps, stored in units of 50. */
  sensitivityValues: number[];
  isLedsOn: boolean[];
  ledEffect: number;
  ledBrightness: number;
  /** The 32 bytes after the piece's prefix, as stored. */
  raw: Uint8Array;
}

/** Bytes of the settings piece, after its four-byte prefix. */
const SETTINGS_LENGTH = 32;

export function decodeSettings(data: Uint8Array): StoredSettings {
  if (data.length < SETTINGS_LENGTH) {
    throw new ProtocolError(
      `a slot's settings were ${String(data.length)} bytes, not ${String(SETTINGS_LENGTH)}`,
    );
  }
  const u16 = (at: number): number => (data[at] ?? 0) | ((data[at + 1] ?? 0) << 8);
  return {
    sensitivityValues: [3, 5, 7, 9, 11].map((at) => u16(at) * 50),
    isLedsOn: [25, 26, 27].map((at) => data[at] === 1),
    ledEffect: data[28] ?? 0,
    ledBrightness: data[29] ?? 0,
    raw: data.slice(0, SETTINGS_LENGTH),
  };
}

export interface StoredInput {
  id: number;
  pinOne: number;
  pinTwo: number;
  types: string[];
  keyValues: string[];
  metaValues: string[];
  keyValuesLong: string[];
  metaValuesLong: string[];
  keyValuesDouble: string[];
  metaValuesDouble: string[];
  featureDelay: number;
  doubleDelay: number;
  isHold: boolean;
  isHoldLong: boolean;
  isHoldDouble: boolean;
  holdTime: number;
  holdTimeLong: number;
  holdTimeDouble: number;
  isTurbo: boolean;
  isTurboLong: boolean;
  isTurboDouble: boolean;
  turboInterval: number;
  turboIntervalLong: number;
  turboIntervalDouble: number;
  stick?: StoredStick;
  /** The record exactly as stored, page 0 then page 1. */
  raw: Uint8Array;
}

export interface StoredStick {
  upperLimit: number;
  lowerLimit: number;
  angle: number;
  sensitivity: number;
  /** The two cone bytes as stored. The app reads them as vertical then horizontal. */
  cones: [number, number];
  isEightDirectionalTrigger: boolean;
  mouseSensitivity: number;
  analogThrottle: number;
  isAnalogSmoothing: boolean;
  triggerMagnitude: number;
  /**
   * The packed switches: 0x08 invert X and 0x10 invert Y (confirmed by the app's decoding),
   * and combined, hold trigger and angle lock in 0x07, in an order not yet known.
   */
  flags: number;
  invertXAxis: boolean;
  invertYAxis: boolean;
  /** Stored in its own byte after the lock zone. */
  isRightAnalog: boolean;
  combinedAnalogMagnitude: number;
  holdMagnitude: number;
  holdType: number;
  holdKeyValues: number[];
  rotateStickButtonId: number;
  lockZoneAngle: number;
  lockZoneSize: number;
  /** [key, modifier, modifier] for the 16 stick directions, in STICK_KEY_ORDER. */
  keys: [string, string, string][];
}

/** Bits of the stored stick switches the app's own decoding names. */
export const STICK_INVERT_X = 0x08;
export const STICK_INVERT_Y = 0x10;
/** Combined, hold trigger and angle lock, in an order not yet known. */
export const STICK_OTHER_SWITCHES = 0x07;

class Reader {
  private at = 0;
  constructor(private readonly bytes: Uint8Array) {}
  u8(): number {
    const value = this.bytes[this.at];
    if (value === undefined) throw new ProtocolError("a stored record ended early");
    this.at++;
    return value;
  }
  u16(): number {
    const lo = this.u8();
    return lo | (this.u8() << 8);
  }
  i16(): number {
    const value = this.u16();
    return value >= 0x8000 ? value - 0x10000 : value;
  }
  skip(count: number): void {
    this.at += count;
  }
}

function typeName(code: number): string {
  return String(code);
}

function decodeRecord(record: Uint8Array): StoredInput {
  const r = new Reader(record);
  r.u8(); // 2 in every record seen
  const id = r.u8();
  const pinOne = r.u8();
  const pinTwo = r.u8();
  const types = [typeName(r.u8()), typeName(r.u8()), typeName(r.u8())];
  if (types[0] === String(TYPE_STICK)) return decodeStick(r, { id, pinOne, pinTwo, types }, record);
  const metas = (): string[] => [0, 1, 2].map(() => keyName(r.u16()));
  // A mouse trigger stores the button number where a key trigger stores a key code.
  const readKeys = (type: string | undefined): string[] =>
    [0, 1, 2, 3].map(() => {
      const value = r.u16();
      return type === "15" ? String(value) : keyName(value);
    });
  const keyValues = readKeys(types[0]);
  const metaValues = metas();
  const keyValuesLong = readKeys(types[1]);
  const metaValuesLong = metas();
  const keyValuesDouble = readKeys(types[2]);
  const metaValuesDouble = metas();
  const featureDelay = r.u16();
  const doubleDelay = r.u16();
  const holdFlags = r.u8();
  const holdTime = r.u16();
  const isTurbo = r.u8() === 1;
  const turboInterval = r.u8();
  const holdTimeLong = r.u16();
  const isTurboLong = r.u8() === 1;
  const turboIntervalLong = r.u8();
  const holdTimeDouble = r.u16();
  const isTurboDouble = r.u8() === 1;
  const turboIntervalDouble = r.u8();
  return {
    id,
    pinOne,
    pinTwo,
    types,
    keyValues,
    metaValues,
    keyValuesLong,
    metaValuesLong,
    keyValuesDouble,
    metaValuesDouble,
    featureDelay,
    doubleDelay,
    isHold: (holdFlags & 1) !== 0,
    isHoldLong: (holdFlags & 2) !== 0,
    isHoldDouble: (holdFlags & 4) !== 0,
    holdTime,
    holdTimeLong,
    holdTimeDouble,
    isTurbo,
    isTurboLong,
    isTurboDouble,
    turboInterval,
    turboIntervalLong,
    turboIntervalDouble,
    raw: record,
  };
}

function decodeStick(
  r: Reader,
  head: { id: number; pinOne: number; pinTwo: number; types: string[] },
  record: Uint8Array,
): StoredInput {
  const upperLimit = r.u16();
  const lowerLimit = r.u16();
  const angle = r.i16();
  const sensitivity = r.u16();
  const cones: [number, number] = [r.u8(), r.u8()];
  const isEightDirectionalTrigger = r.u8() === 1;
  const keys: [string, string, string][] = STICK_KEY_ORDER.map(() => [
    keyName(r.u16()),
    keyName(r.u16()),
    keyName(r.u16()),
  ]);
  const mouseSensitivity = r.u8();
  const analogThrottle = r.u8();
  const isAnalogSmoothing = r.u8() === 1;
  const triggerMagnitude = r.u8();
  const flags = r.u8();
  const combinedAnalogMagnitude = r.u8();
  const holdMagnitude = r.u8();
  const holdType = r.u8();
  const holdKeyValues = [r.u16(), r.u16(), r.u16()];
  const rotateStickButtonId = r.u8();
  const lockZoneAngle = r.u8();
  const lockZoneSize = r.u8();
  const isRightAnalog = r.u8() === 1;
  const none = (count: number): string[] => Array.from({ length: count }, () => NONE_TOKEN);
  return {
    ...head,
    keyValues: none(4),
    metaValues: none(3),
    keyValuesLong: none(4),
    metaValuesLong: none(3),
    keyValuesDouble: none(4),
    metaValuesDouble: none(3),
    featureDelay: 0,
    doubleDelay: 0,
    isHold: false,
    isHoldLong: false,
    isHoldDouble: false,
    holdTime: 0,
    holdTimeLong: 0,
    holdTimeDouble: 0,
    isTurbo: false,
    isTurboLong: false,
    isTurboDouble: false,
    turboInterval: 0,
    turboIntervalLong: 0,
    turboIntervalDouble: 0,
    stick: {
      upperLimit,
      lowerLimit,
      angle,
      sensitivity,
      cones,
      isEightDirectionalTrigger,
      mouseSensitivity,
      analogThrottle,
      isAnalogSmoothing,
      triggerMagnitude,
      flags,
      invertXAxis: (flags & STICK_INVERT_X) !== 0,
      invertYAxis: (flags & STICK_INVERT_Y) !== 0,
      isRightAnalog,
      combinedAnalogMagnitude,
      holdMagnitude,
      holdType,
      holdKeyValues,
      rotateStickButtonId,
      lockZoneAngle,
      lockZoneSize,
      keys,
    },
    raw: record,
  };
}

/**
 * Collects a profile stream (PROFILE_PAYLOAD_V2 for every slot, REQUEST_PROFILE for one).
 *
 * Each report is one piece of an item: the profile's name, its settings, or a page of an
 * input record. A record's piece starts `[ordinal][pages][page][check]`, the check being
 * the other three XORed; a page longer than one report continues in the next with the same
 * four bytes in front. The stream's
 * `parts` byte is the index of its last item.
 */
export class ProfileStream {
  private readonly profiles: StoredProfile[] = [];
  private current: {
    slot: number;
    name: string;
    settings: StoredSettings | null;
    pages: Map<string, Uint8Array>;
  } | null = null;
  private lastItem = -1;
  private finished = false;

  /** Feed one PROFILE_PAYLOAD_V2 report. Returns true once the stream is complete. */
  push(report: DeviceReport): boolean {
    if (report.command !== Command.PROFILE_PAYLOAD_V2) return this.finished;
    const p = report.payload;
    if (((p[0] ?? 0) ^ (p[1] ?? 0) ^ (p[2] ?? 0)) !== (p[3] ?? -1)) {
      // Every piece starts [a][b][c][a^b^c]; one that does not is not a piece of this stream.
      throw new ProtocolError(
        `a profile piece failed its check byte: ${Array.from(p.slice(0, 4)).join(" ")}`,
      );
    }
    this.lastItem = report.parts;
    if (p[0] === 0 && p[1] === 0 && p[2] === 1 && p[3] === 1) {
      this.close();
      const slot = p[6] ?? 0;
      const length = p[7] ?? 0;
      // The app shows the name trimmed; one slot holds "Everspace 2 akimbo " with the space.
      const name = String.fromCharCode(...p.slice(8, 8 + Math.max(0, length - 1))).trimEnd();
      this.current = { slot, name, settings: null, pages: new Map() };
    } else if (p[0] === 0 && p[1] === 1) {
      // The profile's settings: sensitivity steps, lights, and what is not decoded yet.
      if (this.current !== null) this.current.settings = decodeSettings(p.subarray(4));
    } else if (this.current !== null) {
      const key = `${String(p[0])}:${String(p[2])}`;
      const before = this.current.pages.get(key) ?? new Uint8Array(0);
      const joined = new Uint8Array(before.length + p.length - 4);
      joined.set(before);
      joined.set(p.subarray(4), before.length);
      this.current.pages.set(key, joined);
    }
    if (report.part === this.lastItem && this.isLastPageDone(p)) {
      this.close();
      this.finished = true;
    }
    return this.finished;
  }

  /**
   * Whether this piece finishes its item. A name or a settings piece is one report; a
   * record ends with its second page, which always fits one. The last item of a stream is
   * usually a record's, but a slot with no records yet (added, then a write that stopped)
   * ends with its name or settings -- and a stream that waited for a record there would
   * never end, and the unit could not be read again.
   */
  private isLastPageDone(p: Uint8Array): boolean {
    const nameOrSettings = p[0] === 0 && (p[1] === 0 || p[1] === 1);
    return nameOrSettings || ((p[1] ?? 0) === 2 && (p[2] ?? 0) === 1);
  }

  private close(): void {
    if (this.current === null) return;
    const ordinals = new Set<string>();
    for (const key of this.current.pages.keys()) ordinals.add(key.split(":")[0] ?? "");
    const inputs: StoredInput[] = [];
    for (const ordinal of [...ordinals].sort((x, y) => Number(x) - Number(y))) {
      const page0 = this.current.pages.get(`${ordinal}:0`) ?? new Uint8Array(0);
      const page1 = this.current.pages.get(`${ordinal}:1`) ?? new Uint8Array(0);
      const record = new Uint8Array(page0.length + page1.length);
      record.set(page0);
      record.set(page1, page0.length);
      inputs.push(decodeRecord(record));
    }
    this.profiles.push({
      slot: this.current.slot,
      name: this.current.name,
      inputs,
      settings: this.current.settings,
    });
    this.current = null;
  }

  get done(): boolean {
    return this.finished;
  }

  result(): StoredProfile[] {
    return this.profiles;
  }
}
