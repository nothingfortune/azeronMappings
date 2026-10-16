/**
 * Talking to one unit: who it is, what its slots hold, and writing a layout into a slot.
 *
 * The order of every exchange is the order the Azeron app used (unitproto.ts says what is
 * known about the bytes). A write is checked by reading the slot back and comparing it,
 * input by input, with what was meant -- so a write the unit took differently is reported,
 * not assumed. Node-free: the editor drives this over WebHID, and tests over a fake unit.
 */

import type { ExportProfile, InputRecord } from "../types/azeron.js";
import {
  CYBORG2_KEYPAD_TYPE,
  Command,
  KNOWN_FIRMWARE,
  ProfileStream,
  ProtocolError,
  commandName,
  encodeInputRecord,
  hostReports,
  isWritableInput,
  parseDeviceReport,
  profileNamePayload,
  stickKeyCode,
  storedKeyCode,
} from "./unitproto.js";
import type { DeviceReport, StoredInput, StoredProfile } from "./unitproto.js";

/** How the session reaches the unit: one 64-byte report out, the next one in. */
export interface UnitTransport {
  send(report: Uint8Array): Promise<void>;
  /** The next report from the unit, or null when none came in time. */
  receive(timeoutMs: number): Promise<Uint8Array | null>;
}

export interface UnitIdentity {
  firmware: number;
  keypadType: number;
  /** The id the Azeron app files the unit under: `software_device_id` in its device map. */
  deviceId: number;
  isRightStick: boolean;
  profileLimit: number;
  activeSlot: number;
}

/** The app had every reply within a few milliseconds; a second is a dead unit. */
const REPLY_TIMEOUT_MS = 1000;
/** A whole profile stream, three slots of it, took the app under a second. */
const STREAM_TIMEOUT_MS = 10_000;

export class UnitSession {
  private seq = 0;

  constructor(
    private readonly transport: UnitTransport,
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  private async send(command: number, payload: Uint8Array): Promise<void> {
    const reports = hostReports(command, this.seq, payload);
    this.seq = (this.seq + reports.length) & 0xff;
    for (const report of reports) {
      await this.transport.send(report);
      if (reports.length > 1) await this.reply(command);
    }
  }

  /** Waits for the unit's answer to `command`, passing over everything else it says. */
  private async reply(command: number, timeoutMs = REPLY_TIMEOUT_MS): Promise<DeviceReport> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const left = deadline - Date.now();
      const raw = left > 0 ? await this.transport.receive(left) : null;
      if (raw === null) throw new ProtocolError(`the unit did not answer ${commandName(command)}`);
      const report = parseDeviceReport(raw);
      if (report.command === command) return report;
      // Button positions, diagnostics, released-all-buttons and input arrive unasked.
    }
  }

  private async ask(
    command: number,
    payload: Uint8Array = new Uint8Array(),
  ): Promise<DeviceReport> {
    await this.send(command, payload);
    return this.reply(command);
  }

  /** Who this unit is. Refuses firmware or hardware this protocol was not read from. */
  async identify(): Promise<UnitIdentity> {
    const version = await this.ask(Command.FIRMWARE_VERSION);
    const firmware = version.payload[0] ?? 0;
    const keypadType = version.payload[1] ?? 0;
    if (!(KNOWN_FIRMWARE as readonly number[]).includes(firmware)) {
      throw new ProtocolError(
        `firmware ${String(firmware)} is not one this was checked against (${KNOWN_FIRMWARE.join(", ")})`,
      );
    }
    if (keypadType !== CYBORG2_KEYPAD_TYPE) {
      throw new ProtocolError(`keypad type ${String(keypadType)} is not a Cyborg II`);
    }
    const details = (await this.ask(Command.KEYPAD_DETAILS)).payload;
    const limit = (await this.ask(Command.PROFILE_LIMIT)).payload;
    const active = (await this.ask(Command.HARDWARE_PROFILE_INDEX)).payload;
    const identity: UnitIdentity = {
      firmware,
      keypadType,
      deviceId: (details[17] ?? 0) | ((details[18] ?? 0) << 8),
      isRightStick: details[4] === 1,
      profileLimit: limit[0] ?? 0,
      activeSlot: active[0] ?? 0,
    };
    this.log(
      `unit ${String(identity.deviceId)}, firmware ${String(firmware)}, ` +
        `slot ${String(identity.activeSlot)} active of ${String(identity.profileLimit)}`,
    );
    return identity;
  }

  private async stream(command: number, payload: Uint8Array): Promise<StoredProfile[]> {
    await this.send(command, payload);
    const stream = new ProfileStream();
    const deadline = Date.now() + STREAM_TIMEOUT_MS;
    while (!stream.done) {
      const report = await this.reply(Command.PROFILE_PAYLOAD_V2, deadline - Date.now());
      stream.push(report);
      // Every piece is acknowledged before the unit sends the next, as the app does.
      await this.send(Command.PROFILE_INPUT_PIECE, new Uint8Array());
    }
    return stream.result();
  }

  /** Every onboard slot, as stored. */
  readAll(): Promise<StoredProfile[]> {
    return this.stream(Command.PROFILE_PAYLOAD_V2, new Uint8Array());
  }

  async readSlot(slot: number): Promise<StoredProfile> {
    const [profile] = await this.stream(Command.REQUEST_PROFILE, Uint8Array.of(slot));
    if (profile?.slot !== slot) {
      throw new ProtocolError(`asked for slot ${String(slot)} and got something else`);
    }
    return profile;
  }

  /**
   * Writes a compiled profile into `slot`, then reads the slot back and compares.
   *
   * Only the inputs the app would write go out (`isWritableInput`); the slot's LED and
   * sensor settings are left as the slot has them.
   */
  async writeProfile(plan: WritePlan): Promise<WriteReport> {
    const { slot, name, profile, unknownPins } = plan;
    const inputs = profile.inputs.filter((input) => isWritableInput(input, unknownPins));
    // Everything is encoded before anything is sent, so a profile the unit cannot hold
    // fails here and the slot is untouched.
    const records = inputs.map((input) => ({ input, bytes: encodeInputRecord(slot, input) }));
    const namePayload = profileNamePayload(slot, name);

    await this.ask(Command.CHECK_PROFILE, Uint8Array.of(slot));
    await this.ask(Command.PROFILE_NAME, namePayload);
    let written = 0;
    for (const record of records) {
      await this.send(Command.OBM_COPY, record.bytes);
      written++;
      this.log(
        `input ${String(record.input.id)} written (${String(written)}/${String(records.length)})`,
      );
    }
    const stored = await this.readSlot(slot);
    const problems = compareStored(inputs, stored);
    if (stored.name !== name) problems.push(`the slot is named "${stored.name}", not "${name}"`);
    return { slot, written, stored, problems };
  }
}

export interface WritePlan {
  slot: number;
  name: string;
  profile: ExportProfile;
  /** The device map's `unknown_pins`, which are never written. */
  unknownPins: readonly number[];
}

export interface WriteReport {
  slot: number;
  written: number;
  stored: StoredProfile;
  /** Every way the slot as read back differs from what was written. Empty is success. */
  problems: string[];
}

const KEY_LISTS = [
  "keyValues",
  "metaValues",
  "keyValuesLong",
  "metaValuesLong",
  "keyValuesDouble",
  "metaValuesDouble",
] as const;
const PLAIN = [
  "isHold",
  "isHoldLong",
  "isHoldDouble",
  "holdTime",
  "holdTimeLong",
  "holdTimeDouble",
  "isTurbo",
  "isTurboLong",
  "isTurboDouble",
  "turboInterval",
  "turboIntervalLong",
  "turboIntervalDouble",
] as const;

const DEFAULTS: Record<string, unknown> = {
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
};

/** A key as the unit would store it, so "16" and "ShiftLeft" compare equal. */
function canonical(token: unknown, mouse: boolean): string {
  const value = typeof token === "number" || typeof token === "string" ? token : "0";
  return mouse ? String(value) : String(storedKeyCode(value));
}

/**
 * What differs between the inputs that were written and the slot as the unit holds it.
 *
 * Keys are compared by the code the unit stores, so "16" and "ShiftLeft" are the same key.
 * For the stick, the tuning the unit stores plainly is compared; its packed booleans are
 * compared only where none was meant to be set, because which bit is which is not known.
 */
export function compareStored(inputs: readonly InputRecord[], stored: StoredProfile): string[] {
  const problems: string[] = [];
  const byId = new Map(stored.inputs.map((input) => [input.id, input]));
  for (const input of inputs) {
    const held = byId.get(input.id);
    const where = `input ${String(input.id)} (pin ${String(input.pinOne)})`;
    if (!held) {
      problems.push(`${where} is not in the slot`);
      continue;
    }
    if (held.pinOne !== input.pinOne || held.pinTwo !== input.pinTwo) {
      problems.push(`${where} is on pin ${String(held.pinOne)}/${String(held.pinTwo)}`);
    }
    if (held.types.join() !== input.types.join() && input.types[0] !== "4") {
      problems.push(`${where} has types ${held.types.join("/")}, not ${input.types.join("/")}`);
    }
    if (input.types[0] === "4") {
      problems.push(...compareStick(where, input, held));
      continue;
    }
    KEY_LISTS.forEach((list, index) => {
      const mouse = input.types[Math.floor(index / 2)] === "15" && list.startsWith("key");
      const want = ((input[list] as unknown[] | undefined) ?? []).map((t) => canonical(t, mouse));
      const have = held[list].map((t) => canonical(t, mouse));
      for (let i = 0; i < have.length; i++) {
        if ((want[i] ?? "0") !== have[i]) {
          problems.push(`${where} ${list}[${String(i)}] is ${held[list][i] ?? "?"}`);
        }
      }
    });
    for (const field of PLAIN) {
      const want = input[field] ?? DEFAULTS[field];
      if (want !== held[field])
        problems.push(`${where} ${field} is ${String(held[field])}, not ${String(want)}`);
    }
    for (const field of ["featureDelay", "doubleDelay"] as const) {
      if (input[field] !== held[field]) {
        problems.push(`${where} ${field} is ${String(held[field])}, not ${String(input[field])}`);
      }
    }
  }
  return problems;
}

function compareStick(where: string, input: InputRecord, held: StoredInput): string[] {
  const problems: string[] = [];
  const stick = held.stick;
  const analog = input.analogSettings as Record<string, unknown> | undefined;
  if (!stick || !analog) return [`${where} is not a stick in the slot`];
  const want = (field: string, fallback: number): number => {
    const value = analog[field];
    return typeof value === "number" ? value : fallback;
  };
  const plain: [string, number, number][] = [
    ["upperLimit", want("upperLimit", 0), stick.upperLimit],
    ["lowerLimit", want("lowerLimit", 0), stick.lowerLimit],
    ["angle", want("angle", 0), stick.angle],
    ["sensitivity", want("sensitivity", 0), stick.sensitivity],
    ["mouseSensitivity", want("mouseSensitivity", 5), stick.mouseSensitivity],
    ["analogThrottle", want("analogThrottle", 0), stick.analogThrottle],
    ["triggerMagnitude", want("triggerMagnitude", 4), stick.triggerMagnitude],
    ["combinedAnalogMagnitude", want("combinedAnalogMagnitude", 6), stick.combinedAnalogMagnitude],
    ["holdMagnitude", want("holdMagnitude", 9), stick.holdMagnitude],
    ["rotateStickButtonId", want("rotateStickButtonId", 0), stick.rotateStickButtonId],
    ["lockZoneAngle", want("lockZoneAngle", 70), stick.lockZoneAngle],
    ["lockZoneSize", want("lockZoneSize", 30), stick.lockZoneSize],
  ];
  for (const [field, expected, actual] of plain) {
    if (expected !== actual)
      problems.push(`${where} ${field} is ${String(actual)}, not ${String(expected)}`);
  }
  if ((analog.isEightDirectionalTrigger === true) !== stick.isEightDirectionalTrigger) {
    problems.push(
      `${where} isEightDirectionalTrigger is ${String(stick.isEightDirectionalTrigger)}`,
    );
  }
  if ((analog.isAnalogSmoothing === true) !== stick.isAnalogSmoothing) {
    problems.push(`${where} isAnalogSmoothing is ${String(stick.isAnalogSmoothing)}`);
  }
  const packed = ["isCombinedAnalog", "isHoldTrigger", "isAngleLock", "invertXAxis", "invertYAxis"];
  if (
    !packed.some((field) => analog[field] === true) &&
    analog.isRightAnalog !== true &&
    stick.flags !== 0
  ) {
    problems.push(
      `${where} has stick switches set (0x${stick.flags.toString(16)}) that were meant to be off`,
    );
  }
  const groups = ["analogKeys", "diagonalKeys"] as const;
  const order: [number, string, string, string][] = [];
  let index = 0;
  for (const group of groups) {
    const directions =
      group === "analogKeys"
        ? ["up", "right", "down", "left"]
        : ["up_right", "up_left", "down_left", "down_right"];
    for (const side of ["left", "right"]) {
      for (const direction of directions) order.push([index++, group, side, direction]);
    }
  }
  for (const [i, group, side, direction] of order) {
    const block = analog[group] as Record<string, Record<string, unknown[]>> | undefined;
    const entry = block?.[side]?.[direction] ?? [];
    const stored = stick.keys[i] ?? ["0", "0", "0"];
    for (let k = 0; k < 3; k++) {
      if (stickKeyCode(entry[k]) !== storedKeyCode(stored[k])) {
        problems.push(
          `${where} ${group}.${side}.${direction}[${String(k)}] is ${stored[k] ?? "?"}`,
        );
      }
    }
  }
  return problems;
}
