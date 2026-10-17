/**
 * Talking to one unit: who it is, what its slots hold, and writing a layout into a slot.
 *
 * The order of every exchange is the order the Azeron app used (unitproto.ts says what is
 * known about the bytes). A write is checked by reading the slot back and comparing it,
 * input by input, with what was meant -- so a write the unit took differently is reported,
 * not assumed. Node-free: the editor drives this over WebHID, and tests over a fake unit.
 */

import type { ExportProfile, InputRecord } from "../types/azeron.js";
import { messageOf } from "./object.js";
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
/** How long the line must be quiet before an operation starts. */
const DRAIN_MS = 30;
/** And the longest a drain may take, however much the unit is saying. */
const DRAIN_LIMIT_MS = 300;

/** What kind of thing went wrong, so the page can say what to do about it. */
export type UnitErrorKind =
  /** The unit did not answer in time, after the one retry an idempotent step gets. */
  | "no-answer"
  /** Sending failed: the unit was unplugged, or something else holds it. */
  | "transport"
  /** The unit is not one this protocol was read from. */
  | "unsupported"
  /** The unit said something this code cannot make sense of. */
  | "protocol";

export class UnitError extends Error {
  constructor(
    readonly kind: UnitErrorKind,
    message: string,
    /** The step it was on: "identifying", "reading the slots", "writing input 7 of 31". */
    readonly step: string,
    /** How many inputs of a write had gone in before it stopped. */
    readonly written = 0,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "UnitError";
  }
}

export interface SessionHooks {
  /** A line of what the session is doing, for a person. */
  log?: (line: string) => void;
  /** Every report out and in, for a log kept for when something fails. */
  trace?: (line: string) => void;
}

const hex = (bytes: Uint8Array, length: number): string =>
  Array.from(bytes.subarray(0, length), (byte) => byte.toString(16).padStart(2, "0")).join("");

export class UnitSession {
  private seq = 0;
  /** How many slots the unit holds, once they have been read; a write needs to know. */
  private slotCount: number | null = null;
  private profileLimit: number | null = null;
  /** One operation at a time: a second one waits for the first rather than interleaving. */
  private queue: Promise<unknown> = Promise.resolve();
  private step = "starting";
  private readonly log: (line: string) => void;
  private readonly trace: (line: string) => void;

  constructor(
    private readonly transport: UnitTransport,
    hooks: SessionHooks | ((line: string) => void) = {},
  ) {
    const given = typeof hooks === "function" ? { log: hooks } : hooks;
    this.log = given.log ?? (() => undefined);
    this.trace = given.trace ?? (() => undefined);
  }

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private fail(kind: UnitErrorKind, message: string, written = 0, cause?: unknown): UnitError {
    this.log(`failed while ${this.step}: ${message}`);
    return new UnitError(
      kind,
      message,
      this.step,
      written,
      cause === undefined ? undefined : { cause },
    );
  }

  /**
   * Reports left over from before -- input, a late answer -- are read and dropped. Bounded:
   * a unit that keeps talking (a thumb resting on the stick sends its position) must not
   * keep an operation from starting.
   */
  private async drain(): Promise<void> {
    let dropped = 0;
    const until = Date.now() + DRAIN_LIMIT_MS;
    while (Date.now() < until && (await this.transport.receive(DRAIN_MS)) !== null) dropped++;
    if (dropped > 0) this.trace(`dropped ${String(dropped)} report(s) left over from before`);
  }

  private async send(command: number, payload: Uint8Array): Promise<void> {
    const reports = hostReports(command, this.seq, payload);
    this.seq = (this.seq + reports.length) & 0xff;
    for (const report of reports) {
      this.trace(`→ ${commandName(command)} ${hex(report, 7 + Math.min(report[6] ?? 0, 16))}`);
      try {
        await this.transport.send(report);
      } catch (error) {
        throw this.fail(
          "transport",
          `sending ${commandName(command)} failed: ${messageOf(error)}`,
          0,
          error,
        );
      }
      // The unit answers each part of a record with the part's own sequence number, so a
      // late answer to an earlier part is told apart rather than taken for this one's.
      if (reports.length > 1) await this.reply(command, REPLY_TIMEOUT_MS, report[3]);
    }
  }

  /**
   * Waits for the unit's answer to `command` -- and, when given, to that sequence number --
   * passing over everything else it says.
   */
  private async reply(
    command: number,
    timeoutMs = REPLY_TIMEOUT_MS,
    seq?: number,
  ): Promise<DeviceReport> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const left = deadline - Date.now();
      const raw = left > 0 ? await this.transport.receive(left) : null;
      if (raw === null) {
        this.trace(`… no ${commandName(command)} in ${String(timeoutMs)} ms`);
        throw new UnitError(
          "no-answer",
          `the unit did not answer ${commandName(command)}`,
          this.step,
        );
      }
      let report: DeviceReport;
      try {
        report = parseDeviceReport(raw);
      } catch (error) {
        // Not a report this code can read. If it was the answer, the wait runs out and says
        // so; one stray report must not end the whole operation.
        this.trace(`← (unreadable, passed over: ${messageOf(error)}) ${hex(raw, 16)}`);
        continue;
      }
      this.trace(
        `← ${commandName(report.command)} ${hex(raw, 7 + Math.min(report.payload.length, 16))}`,
      );
      if (report.command === command && (seq === undefined || report.seq === seq)) return report;
      if (report.command === command) {
        this.trace(`  a late answer, to sequence ${String(report.seq)}; passed over`);
      }
      // Button positions, diagnostics, released-all-buttons and input arrive unasked.
    }
  }

  /**
   * Sends `command` and waits for its answer. A step that is safe to repeat -- every read,
   * a rename, an input record -- is tried once more when the answer does not come.
   */
  private async ask(
    command: number,
    payload: Uint8Array = new Uint8Array(),
    repeatable = true,
  ): Promise<DeviceReport> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.send(command, payload);
        return await this.reply(command);
      } catch (error) {
        if (
          !(error instanceof UnitError) ||
          error.kind !== "no-answer" ||
          !repeatable ||
          attempt > 1
        ) {
          throw error instanceof UnitError && error.kind === "no-answer"
            ? this.fail("no-answer", error.message, 0, error)
            : error;
        }
        this.log(`no answer to ${commandName(command)}; trying once more`);
        await this.drain();
      }
    }
  }

  /** Who this unit is. Refuses firmware or hardware this protocol was not read from. */
  identify(): Promise<UnitIdentity> {
    return this.exclusive(async () => {
      this.step = "asking the unit who it is";
      await this.drain();
      const version = await this.ask(Command.FIRMWARE_VERSION);
      const firmware = version.payload[0] ?? 0;
      const keypadType = version.payload[1] ?? 0;
      if (!(KNOWN_FIRMWARE as readonly number[]).includes(firmware)) {
        throw this.fail(
          "unsupported",
          `firmware ${String(firmware)} is not one this was checked against (${KNOWN_FIRMWARE.join(", ")})`,
        );
      }
      if (keypadType !== CYBORG2_KEYPAD_TYPE) {
        throw this.fail("unsupported", `keypad type ${String(keypadType)} is not a Cyborg II`);
      }
      const details = (await this.ask(Command.KEYPAD_DETAILS)).payload;
      if (details.length < 19)
        throw this.fail("protocol", "the unit's details were too short to hold its id");
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
    });
  }

  private async streamOnce(): Promise<StoredProfile[]> {
    await this.send(Command.PROFILE_PAYLOAD_V2, new Uint8Array());
    const stream = new ProfileStream();
    const deadline = Date.now() + STREAM_TIMEOUT_MS;
    while (!stream.done) {
      const report = await this.reply(
        Command.PROFILE_PAYLOAD_V2,
        Math.min(REPLY_TIMEOUT_MS, deadline - Date.now()),
      );
      try {
        stream.push(report);
      } catch (error) {
        throw this.fail("protocol", messageOf(error), 0, error);
      }
      // Every piece is acknowledged before the unit sends the next, as the app does.
      await this.send(Command.PROFILE_INPUT_PIECE, new Uint8Array());
    }
    return stream.result();
  }

  /** Every onboard slot, as stored. A stream that stops part way is read again, once. */
  readAll(): Promise<StoredProfile[]> {
    return this.exclusive(async () => {
      this.step = "reading the slots";
      await this.drain();
      let slots: StoredProfile[];
      try {
        slots = await this.streamOnce();
      } catch (error) {
        if (!(error instanceof UnitError) || error.kind !== "no-answer") throw error;
        this.log("the slots stopped coming part way; reading them again");
        await this.drain();
        try {
          slots = await this.streamOnce();
        } catch (again) {
          throw again instanceof UnitError && again.kind === "no-answer"
            ? this.fail("no-answer", again.message, 0, again)
            : again;
        }
      }
      this.slotCount = slots.length;
      this.log(
        `read ${String(slots.length)} slot(s): ${slots.map((slot) => `${String(slot.slot)} "${slot.name}"`).join(", ")}`,
      );
      return slots;
    });
  }

  /**
   * One slot, as stored. Read from the whole list: REQUEST_PROFILE answers with the slot
   * the unit is running whatever it is asked (seen 2026-10-15), so it cannot read another.
   */
  async readSlot(slot: number): Promise<StoredProfile> {
    const found = (await this.readAll()).find((profile) => profile.slot === slot);
    if (found === undefined)
      throw new UnitError("protocol", `the unit has no slot ${String(slot)}`, "reading the slots");
    return found;
  }

  /**
   * Makes the unit run `slot`, as the app does after writing one, and checks that it does.
   * SWITCH_PROFILE carries the slot; the unit answers with it.
   */
  switchTo(slot: number): Promise<number> {
    return this.exclusive(async () => {
      this.step = `switching to slot ${String(slot)}`;
      await this.drain();
      await this.ask(Command.SWITCH_PROFILE, Uint8Array.of(slot));
      const active = (await this.ask(Command.HARDWARE_PROFILE_INDEX)).payload[0] ?? -1;
      if (active !== slot) {
        throw this.fail(
          "protocol",
          `asked to run slot ${String(slot)}, and it is running ${String(active)}`,
        );
      }
      this.log(`running slot ${String(slot)}`);
      return active;
    });
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

    const written = await this.exclusive(async () => {
      if (this.slotCount === null || this.profileLimit === null) {
        throw new ProtocolError("read the unit's slots before writing one");
      }
      if (slot > this.slotCount || slot >= this.profileLimit) {
        throw new ProtocolError(
          `slot ${String(slot)} is past the end: the unit has ${String(this.slotCount)} of ` +
            `${String(this.profileLimit)}, and a new one goes at ${String(this.slotCount)}`,
        );
      }
      this.log(`writing "${name}" into slot ${String(slot)}: ${String(records.length)} inputs`);
      await this.drain();
      // CHECK_PROFILE is how the app adds a slot: the unit answers it for the next free one
      // and ignores it for one that exists (seen 2026-10-15). An existing slot is renamed
      // and written over without it. It is not repeated: a lost answer may mean it worked.
      if (slot === this.slotCount) {
        this.step = `adding slot ${String(slot)}`;
        try {
          await this.ask(Command.CHECK_PROFILE, Uint8Array.of(slot), false);
        } catch (error) {
          if (!(error instanceof UnitError) || error.kind !== "no-answer") throw error;
          throw this.fail(
            "no-answer",
            `the unit did not add slot ${String(slot)}; nothing else was sent`,
            0,
            error,
          );
        }
        this.slotCount++;
      }
      this.step = `naming slot ${String(slot)}`;
      await this.ask(Command.PROFILE_NAME, namePayload);
      let count = 0;
      for (const record of records) {
        this.step = `writing input ${String(record.input.id)} (${String(count + 1)} of ${String(records.length)})`;
        try {
          await this.sendRecord(record.bytes);
        } catch (error) {
          if (error instanceof UnitError) {
            throw new UnitError(error.kind, error.message, this.step, count, { cause: error });
          }
          throw error;
        }
        count++;
        this.log(
          `input ${String(record.input.id)} written (${String(count)}/${String(records.length)})`,
        );
      }
      return count;
    });
    let stored: StoredProfile;
    try {
      stored = await this.readSlot(slot);
    } catch (error) {
      // Everything went in; only the check did not happen. Say so, rather than imply nothing
      // was written.
      if (error instanceof UnitError) {
        throw new UnitError(
          error.kind,
          `all ${String(written)} inputs were written, but reading the slot back failed: ${error.message}`,
          "reading the slot back",
          written,
          { cause: error },
        );
      }
      throw error;
    }
    const differences = compareStored(inputs, stored);
    const problems = differences.map(describeDifference);
    if (stored.name !== name) problems.push(`the slot is named "${stored.name}", not "${name}"`);
    this.log(`slot ${String(slot)} read back: ${String(problems.length)} difference(s)`);
    return { slot, written, stored, problems, differences };
  }

  /** One input record, every part acknowledged. Sent again, whole, if an answer is lost. */
  private async sendRecord(bytes: Uint8Array): Promise<void> {
    try {
      // `send` waits for the unit's answer to each part of a record that takes several.
      await this.send(Command.OBM_COPY, bytes);
    } catch (error) {
      if (!(error instanceof UnitError) || error.kind !== "no-answer") throw error;
      this.log("no answer to an input record; sending it once more");
      await this.drain();
      try {
        await this.send(Command.OBM_COPY, bytes);
      } catch (again) {
        throw again instanceof UnitError && again.kind === "no-answer"
          ? this.fail("no-answer", again.message, 0, again)
          : again;
      }
    }
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
  // The hold trigger's type and keys go to the unit as the numbers they are written as
  // ("16" is 0x0010, as the app's own OBM_COPY sends it); a slot the app wrote another way
  // shows here rather than being written over unseen.
  const holdType = Number(analog.holdType ?? 1);
  if (holdType !== stick.holdType) differ("holdType", stick.holdType, holdType);
  const holdKeys = Array.isArray(analog.holdKeyValues) ? (analog.holdKeyValues as unknown[]) : [];
  stick.holdKeyValues.forEach((held, index) => {
    const wanted = Number(holdKeys[index] ?? 0);
    if (wanted !== held) differ(`holdKeyValues[${String(index)}]`, held, wanted);
  });
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
