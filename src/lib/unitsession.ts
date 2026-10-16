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
  /**
   * The id the Azeron app files the unit under: `software_device_id` in its device map. The
   * only thing that tells the two units apart; both say the same about which hand they are.
   */
  deviceId: number;
  profileLimit: number;
  activeSlot: number;
}

/** The app had every reply within a few milliseconds; a second is a dead unit. */
const REPLY_TIMEOUT_MS = 1000;
/** A whole profile stream, three slots of it, took the app under a second. */
const STREAM_TIMEOUT_MS = 10_000;

export class UnitSession {
  private seq = 0;
  /** How many slots the unit holds, once they have been read; a write needs to know. */
  private slotCount: number | null = null;
  private profileLimit: number | null = null;

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
      profileLimit: limit[0] ?? 0,
      activeSlot: active[0] ?? 0,
    };
    this.profileLimit = identity.profileLimit;
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
  async readAll(): Promise<StoredProfile[]> {
    const slots = await this.stream(Command.PROFILE_PAYLOAD_V2, new Uint8Array());
    this.slotCount = slots.length;
    return slots;
  }

  /**
   * One slot, as stored. Read from the whole list: REQUEST_PROFILE answers with the slot
   * the unit is running whatever it is asked (seen 2026-10-15), so it cannot read another.
   */
  async readSlot(slot: number): Promise<StoredProfile> {
    const found = (await this.readAll()).find((profile) => profile.slot === slot);
    if (found === undefined) throw new ProtocolError(`the unit has no slot ${String(slot)}`);
    return found;
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

    if (this.slotCount === null || this.profileLimit === null) {
      throw new ProtocolError("read the unit's slots before writing one");
    }
    if (slot > this.slotCount || slot >= this.profileLimit) {
      throw new ProtocolError(
        `slot ${String(slot)} is past the end: the unit has ${String(this.slotCount)} of ` +
          `${String(this.profileLimit)}, and a new one goes at ${String(this.slotCount)}`,
      );
    }
    // CHECK_PROFILE is how the app adds a slot: the unit answers it for the next free one
    // and ignores it for one that exists (seen 2026-10-15). An existing slot is renamed and
    // written over without it.
    if (slot === this.slotCount) {
      await this.ask(Command.CHECK_PROFILE, Uint8Array.of(slot));
      this.slotCount++;
    }
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
    const differences = compareStored(inputs, stored);
    const problems = differences.map(describeDifference);
    if (stored.name !== name) problems.push(`the slot is named "${stored.name}", not "${name}"`);
    return { slot, written, stored, problems, differences };
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
  differences: SlotDifference[];
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

/** One way a slot differs from the layout: what the unit holds where the layout wants another. */
export interface SlotDifference {
  /** The input's id and pin, and its label when the layout gives one. */
  id: number;
  pin: number;
  label: string | null;
  /** The field, as the export names it: `keyValues[0]`, `invertXAxis`, `analogKeys.left.up[0]`. */
  field: string;
  held: string;
  wanted: string;
}

export function describeDifference(difference: SlotDifference): string {
  return (
    `input ${String(difference.id)} (pin ${String(difference.pin)}) ${difference.field} is ` +
    `${difference.held}, not ${difference.wanted}`
  );
}

/**
 * What differs between the inputs that were (or would be) written and a slot as the unit
 * holds it. Keys are compared by the code the unit stores, so "16" and "ShiftLeft" are the
 * same key. The stick's switches are compared by name where the app's decoding names them,
 * and counted where it does not.
 */
export function compareStored(
  inputs: readonly InputRecord[],
  stored: StoredProfile,
): SlotDifference[] {
  const differences: SlotDifference[] = [];
  const byId = new Map(stored.inputs.map((input) => [input.id, input]));
  for (const input of inputs) {
    const label = typeof input.label === "string" && input.label !== "" ? input.label : null;
    const differ = (field: string, held: unknown, wanted: unknown): void => {
      differences.push({
        id: input.id,
        pin: input.pinOne,
        label,
        field,
        held: String(held),
        wanted: String(wanted),
      });
    };
    const held = byId.get(input.id);
    if (!held) {
      differ("record", "missing", "present");
      continue;
    }
    if (held.pinOne !== input.pinOne || held.pinTwo !== input.pinTwo) {
      differ(
        "pins",
        `${String(held.pinOne)}/${String(held.pinTwo)}`,
        `${String(input.pinOne)}/${String(input.pinTwo)}`,
      );
    }
    if (input.types[0] === "4") {
      compareStick(input, held, differ);
      continue;
    }
    if (held.types.join() !== input.types.join())
      differ("types", held.types.join("/"), input.types.join("/"));
    KEY_LISTS.forEach((list, index) => {
      const mouse = input.types[Math.floor(index / 2)] === "15" && list.startsWith("key");
      const wanted = (input[list] as unknown[] | undefined) ?? [];
      held[list].forEach((token, i) => {
        if (canonical(wanted[i] ?? "0", mouse) !== canonical(token, mouse)) {
          differ(
            `${list}[${String(i)}]`,
            token,
            typeof wanted[i] === "string" || typeof wanted[i] === "number" ? wanted[i] : "0",
          );
        }
      });
    });
    for (const field of PLAIN) {
      const wanted = input[field] ?? DEFAULTS[field];
      if (wanted !== held[field]) differ(field, held[field], wanted);
    }
    for (const field of ["featureDelay", "doubleDelay"] as const) {
      if (input[field] !== held[field]) differ(field, held[field], input[field]);
    }
  }
  return differences;
}

function compareStick(
  input: InputRecord,
  held: StoredInput,
  differ: (field: string, held: unknown, wanted: unknown) => void,
): void {
  const stick = held.stick;
  const analog = input.analogSettings as Record<string, unknown> | undefined;
  if (!stick || !analog) {
    differ("stick", "not a stick", "a stick");
    return;
  }
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
    if (expected !== actual) differ(field, actual, expected);
  }
  for (const field of [
    "isEightDirectionalTrigger",
    "isAnalogSmoothing",
    "isRightAnalog",
    "invertXAxis",
    "invertYAxis",
  ] as const) {
    if ((analog[field] === true) !== stick[field])
      differ(field, stick[field], analog[field] === true);
  }
  // Which of these three is which bit is not known, so they are counted, not named.
  const others = ["isCombinedAnalog", "isHoldTrigger", "isAngleLock"].filter(
    (field) => analog[field] === true,
  ).length;
  const othersStored = [1, 2, 4].filter((bit) => (stick.flags & bit) !== 0).length;
  if (others !== othersStored)
    differ("combined / hold trigger / angle lock switched on", othersStored, others);
  let index = 0;
  for (const group of ["analogKeys", "diagonalKeys"] as const) {
    const directions =
      group === "analogKeys"
        ? ["up", "right", "down", "left"]
        : ["up_right", "up_left", "down_left", "down_right"];
    for (const side of ["left", "right"]) {
      for (const direction of directions) {
        const block = analog[group] as Record<string, Record<string, unknown[]>> | undefined;
        const entry = block?.[side]?.[direction] ?? [];
        const storedKeys = stick.keys[index] ?? ["0", "0", "0"];
        for (let k = 0; k < 3; k++) {
          if (stickKeyCode(entry[k]) !== storedKeyCode(storedKeys[k])) {
            const wanted = entry[k];
            differ(
              `${group}.${side}.${direction}[${String(k)}]`,
              storedKeys[k] ?? "0",
              typeof wanted === "string" || typeof wanted === "number" ? wanted : "0",
            );
          }
        }
        index++;
      }
    }
  }
}
