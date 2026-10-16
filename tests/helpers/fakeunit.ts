/**
 * A Cyborg II on the bench: answers the commands the session sends the way the real unit
 * answered the Azeron app (tests/fixtures/unit-protocol), and stores what it is sent in the
 * unit's own record layout, so writing and reading back go through both halves of the
 * protocol rather than an echo.
 *
 * It refuses -- by not answering -- anything outside what the real unit was seen to do.
 */
import {
  Command,
  REPORT_LENGTH,
  encodeInputRecord,
  isWritableInput,
} from "../../src/lib/unitproto.js";
import type { InputRecord } from "../../src/types/azeron.js";
import type { UnitTransport } from "../../src/lib/unitsession.js";

interface Slot {
  name: string;
  /** Stored records by input id, in the unit's layout (68 or 134 bytes). */
  records: Map<number, Uint8Array>;
}

export interface FakeUnitOptions {
  firmware?: number;
  deviceId?: number;
  activeSlot?: number;
  profileLimit?: number;
  /** Change a record as it is stored, to stand for a unit that took a write differently. */
  corrupt?: (id: number, stored: Uint8Array) => void;
  /** Stop answering after this many host reports. */
  goSilentAfter?: number;
}

/** The settings piece the left unit sent for its akimbo slot; the fake does not model it. */
const SETTINGS_PIECE = Uint8Array.from(
  Buffer.from(
    "000101000101001400500096 00c8002c010100000a3f500a3f500a3f5001010101320000".replace(/ /g, ""),
    "hex",
  ),
);

const be16 = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);

/** OBM_COPY's layout to the unit's stored one (see unitproto.ts). */
function store(write: Uint8Array): Uint8Array {
  const id = write[1] ?? 0;
  const out: number[] = [2, id, write[2] ?? 0, write[3] ?? 0];
  const le = (value: number): void => {
    out.push(value & 0xff, value >> 8);
  };
  if (write[4] === 4) {
    out.push(4, 0, 0);
    let at = 5;
    const u8 = (): number => write[at++] ?? 0;
    const u16 = (): number => {
      const value = be16(write, at);
      at += 2;
      return value;
    };
    const upper = u16();
    const lower = u16();
    const angle = u16();
    const sensitivity = u16();
    const coneA = u8();
    const coneB = u8();
    const eight = u8();
    const mouseSensitivity = u8();
    const throttle = u8();
    const smoothing = u8();
    const triggerMagnitude = u8();
    const combined = u8();
    const combinedMagnitude = u8();
    const holdTrigger = u8();
    const holdMagnitude = u8();
    const holdType = u8();
    const holdKeys = [u16(), u16(), u16()];
    const rotate = u8();
    const angleLock = u8();
    const lockAngle = u8();
    const lockSize = u8();
    const right = u8();
    const invertX = u8();
    const invertY = u8();
    le(upper);
    le(lower);
    le(angle);
    le(sensitivity);
    out.push(coneA, coneB, eight);
    for (let i = 0; i < 48; i++) le(u16());
    // The real bit order is not known; this one only has to be consistent with itself.
    // As the real unit stores them: 0x08 invert X, 0x10 invert Y (the app's decoding
    // says so), the other three in an order of the fake's own.
    const flags =
      combined | (holdTrigger << 1) | (angleLock << 2) | (invertX << 3) | (invertY << 4);
    out.push(
      mouseSensitivity,
      throttle,
      smoothing,
      triggerMagnitude,
      flags,
      combinedMagnitude,
      holdMagnitude,
      holdType,
    );
    for (const key of holdKeys) le(key);
    out.push(rotate, lockAngle, lockSize, right, 0, 0);
    return Uint8Array.from(out);
  }
  const blocks = [4, 24, 46];
  const types = blocks.map((at) => write[at] ?? 0);
  out.push(...types);
  for (const at of blocks) {
    for (let i = 0; i < 7; i++) le(be16(write, at + 1 + i * 2));
  }
  le(be16(write, 40)); // featureDelay
  le(be16(write, 62)); // doubleDelay
  const hold = [write[19], write[39], write[61]].reduce<number>(
    (flags, value, i) => flags | ((value ?? 0) << i),
    0,
  );
  out.push(hold);
  le(be16(write, 20));
  out.push(write[22] ?? 0, write[23] ?? 0);
  le(be16(write, 42));
  out.push(write[44] ?? 0, write[45] ?? 0);
  le(be16(write, 64));
  out.push(write[66] ?? 0, write[67] ?? 0, 0, 0);
  return Uint8Array.from(out);
}

export class FakeUnit implements UnitTransport {
  readonly slots = new Map<number, Slot>();
  /** Every report the host sent, in order. */
  readonly received: Uint8Array[] = [];
  private readonly outbox: Uint8Array[] = [];
  private seq = 0x40;
  private incoming: { command: number; seq: number; parts: number; chunks: Uint8Array[] } | null =
    null;
  private streaming: Uint8Array[] | null = null;
  private readonly options: Required<Omit<FakeUnitOptions, "corrupt" | "goSilentAfter">> & {
    corrupt: FakeUnitOptions["corrupt"] | undefined;
    goSilentAfter: number | undefined;
  };

  constructor(options: FakeUnitOptions = {}) {
    this.options = {
      firmware: options.firmware ?? 111,
      deviceId: options.deviceId ?? 49229,
      activeSlot: options.activeSlot ?? 2,
      profileLimit: options.profileLimit ?? 6,
      corrupt: options.corrupt,
      goSilentAfter: options.goSilentAfter,
    };
  }

  private reply(
    command: number,
    payload: Uint8Array | number[] = [],
    seq?: number,
    parts = 1,
    part = 1,
  ): void {
    const bytes = Uint8Array.from(payload);
    const report = new Uint8Array(REPORT_LENGTH);
    report[0] = bytes.length & 0xff;
    report[1] = bytes.length >> 8;
    report[2] = command;
    report[3] = seq ?? this.seq++ & 0xff;
    report[4] = parts;
    report[5] = part;
    report[6] = bytes.length;
    report.set(bytes, 7);
    this.outbox.push(report);
  }

  /** Put a slot on the unit as if it had always been there, after the ones it has. */
  seed(
    name: string,
    inputs: readonly InputRecord[],
    unknownPins: readonly number[] = [0, 28, 29],
  ): this {
    const slot = this.slots.size;
    const records = new Map<number, Uint8Array>();
    for (const input of inputs.filter((entry) => isWritableInput(entry, unknownPins))) {
      records.set(input.id, store(encodeInputRecord(slot, input)));
    }
    this.slots.set(slot, { name, records });
    return this;
  }

  send(report: Uint8Array): Promise<void> {
    this.received.push(Uint8Array.from(report));
    const silent =
      this.options.goSilentAfter !== undefined && this.received.length > this.options.goSilentAfter;
    if (!silent) this.handle(report);
    return Promise.resolve();
  }

  receive(): Promise<Uint8Array | null> {
    return Promise.resolve(this.outbox.shift() ?? null);
  }

  private handle(report: Uint8Array): void {
    const [, total = 0, command = 0, seq = 0, parts = 0, part = 0, length = 0] = report;
    const chunk = report.slice(7, 7 + length);
    if (part === 1) this.incoming = { command, seq, parts, chunks: [] };
    if (this.incoming?.command !== command) return;
    this.incoming.chunks.push(chunk);
    if (command === Command.OBM_COPY) this.reply(Command.OBM_COPY, [], seq);
    if (part < parts) return;
    const payload = Uint8Array.from(this.incoming.chunks.flatMap((c) => [...c]));
    this.incoming = null;
    if (payload.length !== total) return;
    this.dispatch(command, payload);
  }

  private dispatch(command: number, payload: Uint8Array): void {
    const o = this.options;
    switch (command) {
      case Command.FIRMWARE_VERSION: {
        this.reply(command, [o.firmware, 8]);
        return;
      }
      case Command.KEYPAD_DETAILS: {
        const details = [1, 50, 1, 10, 0, 0, 8, 5, 0xd7, 0xff, 0xdc, 0xff, 52, 0, 69, 0, 0];
        this.reply(command, [
          ...details,
          o.deviceId & 0xff,
          o.deviceId >> 8,
          21,
          0,
          0xec,
          3,
          0x6a,
          0,
          0xa7,
          3,
          0,
          0,
          0,
          0,
          0x37,
          0xad,
          0xad,
          1,
        ]);
        return;
      }
      case Command.PROFILE_LIMIT: {
        this.reply(command, [o.profileLimit]);
        return;
      }
      case Command.HARDWARE_PROFILE_INDEX: {
        this.reply(command, [o.activeSlot, 0]);
        return;
      }
      case Command.CHECK_PROFILE: {
        // Answered only for the next free slot, which it adds; a slot that exists is ignored.
        const slot = payload[0] ?? 0;
        if (slot !== this.slots.size || slot >= o.profileLimit) return;
        this.slots.set(slot, { name: "", records: new Map<number, Uint8Array>() });
        this.reply(Command.RELEASED_ALL_BUTTONS);
        this.reply(command);
        return;
      }
      case Command.PROFILE_NAME: {
        const slot = payload[0] ?? 0;
        const name = String.fromCharCode(...payload.slice(2, 2 + (payload[1] ?? 0)));
        const existing = this.slots.get(slot);
        if (!existing) return;
        existing.name = name;
        this.reply(command);
        return;
      }
      case Command.OBM_COPY: {
        const slot = this.slots.get(payload[0] ?? 0);
        if (!slot) return;
        const stored = store(payload);
        o.corrupt?.(payload[1] ?? 0, stored);
        slot.records.set(payload[1] ?? 0, stored);
        this.reply(Command.BUTTON_POSITION, [payload[1] ?? 0, 0]);
        return;
      }
      case Command.REQUEST_PROFILE: {
        // Whatever it is asked, the unit sends the slot it is running.
        this.beginStream([o.activeSlot]);
        return;
      }
      case Command.PROFILE_PAYLOAD_V2: {
        this.beginStream([...this.slots.keys()].sort());
        return;
      }
      case Command.PROFILE_INPUT_PIECE: {
        const next = this.streaming?.shift();
        if (next) this.outbox.push(next);
        else this.streaming = null;
        return;
      }
      default:
        return;
    }
  }

  /** The slots as the unit streams them: name, settings, then each record's pages. */
  private beginStream(slots: number[]): void {
    const items: Uint8Array[][] = [];
    for (const index of slots) {
      const slot = this.slots.get(index);
      if (!slot) continue;
      const name = Array.from({ length: slot.name.length }, (_, i) => slot.name.charCodeAt(i));
      items.push([Uint8Array.from([0, 0, 1, 1, 0, 0x0c, index, name.length + 1, ...name, 0, 0])]);
      items.push([SETTINGS_PIECE]);
      for (const [id, record] of [...slot.records].sort(([a], [b]) => a - b)) {
        const split = record.length === 134 ? 106 : 53;
        const pieces: Uint8Array[] = [];
        for (const [page, bytes] of [record.slice(0, split), record.slice(split)].entries()) {
          for (let at = 0; at < bytes.length; at += 53) {
            pieces.push(Uint8Array.from([id, 2, page, id ^ 2 ^ page, ...bytes.slice(at, at + 53)]));
          }
        }
        items.push(pieces);
      }
    }
    const last = items.length - 1;
    const frames: Uint8Array[] = [];
    items.forEach((pieces, index) => {
      for (const piece of pieces) {
        const report = new Uint8Array(REPORT_LENGTH);
        report[0] = piece.length;
        report[2] = Command.PROFILE_PAYLOAD_V2;
        report[3] = this.seq++ & 0xff;
        report[4] = last;
        report[5] = index;
        report[6] = piece.length;
        report.set(piece, 7);
        frames.push(report);
      }
    });
    this.streaming = frames;
    const first = this.streaming.shift();
    if (first) this.outbox.push(first);
  }
}
