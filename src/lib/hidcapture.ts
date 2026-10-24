/**
 * What a USB capture says the Azeron app and a unit said to each other.
 *
 * `usbpcap.ts` reads the packets; this turns them into the HID conversation: reports the
 * host set or asked for, reports the unit sent, the descriptors it was asked for. Reading
 * only. The repo does not speak the units' configuration protocol, and a guessed request
 * could change what a unit holds, so the way to learn it is to look at what the app sends
 * while one setting at a time is changed, and `diffCaptures` is for that.
 *
 * A report id is only known for a control transfer, which carries it in the setup packet.
 * On an interrupt endpoint the first byte is the id only when the interface's report
 * descriptor numbers its reports, and that descriptor is only in a capture made while the
 * unit was plugged in, so those events keep the raw bytes and say nothing more.
 */

import type { SetupPacket, UsbPacket } from "./usbpcap.js";

export type ReportType = "input" | "output" | "feature";

export type HidEventKind =
  | "set-report"
  | "get-report"
  | "set-idle"
  | "get-idle"
  | "set-protocol"
  | "get-protocol"
  | "get-descriptor"
  | "control-other"
  | "interrupt-in"
  | "interrupt-out";

export interface HidEvent {
  /** Record number of the packet that carried the data (or closed the transfer). */
  number: number;
  time: number;
  bus: number;
  device: number;
  kind: HidEventKind;
  endpoint: number;
  /** From a control transfer's setup packet; absent on an interrupt endpoint. */
  interfaceNumber: number | null;
  reportType: ReportType | null;
  reportId: number | null;
  /** Descriptor type and index of a GET_DESCRIPTOR. */
  descriptor: { type: number; index: number } | null;
  setup: SetupPacket | null;
  bytes: Uint8Array;
}

export interface DeviceSummary {
  bus: number;
  device: number;
  packets: number;
  /** Endpoint addresses with their transfer types, as seen. */
  endpoints: string[];
  /** Only known when the capture caught the device descriptor being read. */
  vendorId: number | null;
  productId: number | null;
}

const REPORT_TYPES: Record<number, ReportType> = { 1: "input", 2: "output", 3: "feature" };

const DESCRIPTOR_NAMES: Record<number, string> = {
  1: "device",
  2: "configuration",
  3: "string",
  4: "interface",
  5: "endpoint",
  0x21: "HID",
  0x22: "HID report",
  0x23: "HID physical",
};

const REQUEST_GET_DESCRIPTOR = 6;

function classify(
  setup: SetupPacket,
): Pick<HidEvent, "kind" | "reportType" | "reportId" | "descriptor"> {
  const none = { reportType: null, reportId: null, descriptor: null };
  const standard = (setup.requestType & 0x60) === 0x00;
  const classRequest = (setup.requestType & 0x60) === 0x20;
  if (standard && setup.request === REQUEST_GET_DESCRIPTOR) {
    return {
      kind: "get-descriptor",
      reportType: null,
      reportId: null,
      descriptor: { type: setup.value >> 8, index: setup.value & 0xff },
    };
  }
  if (classRequest) {
    const report = {
      reportType: REPORT_TYPES[setup.value >> 8] ?? null,
      reportId: setup.value & 0xff,
      descriptor: null,
    };
    switch (setup.request) {
      case 0x01:
        return { kind: "get-report", ...report };
      case 0x09:
        return { kind: "set-report", ...report };
      case 0x02:
        return { kind: "get-idle", ...none };
      case 0x0a:
        return { kind: "set-idle", ...none };
      case 0x03:
        return { kind: "get-protocol", ...none };
      case 0x0b:
        return { kind: "set-protocol", ...none };
      default:
        break;
    }
  }
  return { kind: "control-other", ...none };
}

interface PendingControl {
  setup: SetupPacket;
  endpoint: number;
  number: number;
  time: number;
}

/**
 * The HID conversation in a capture, in the order it happened.
 *
 * A control transfer is three packets (setup, data, status) and becomes one event, placed
 * at the packet that carried its data. An interrupt transfer becomes one event when the
 * data is in flight: the completion of an IN request, the submission of an OUT one.
 * Empty transfers and a poll that returned nothing are not events.
 */
export function extractEvents(packets: readonly UsbPacket[]): HidEvent[] {
  const events: HidEvent[] = [];
  const pending = new Map<string, PendingControl>();

  const emit = (
    packet: Pick<UsbPacket, "number" | "time" | "bus" | "device" | "endpoint">,
    base: PendingControl,
    bytes: Uint8Array,
  ): void => {
    events.push({
      number: packet.number,
      time: packet.time,
      bus: packet.bus,
      device: packet.device,
      endpoint: base.endpoint,
      interfaceNumber: base.setup.index & 0xff,
      setup: base.setup,
      bytes,
      ...classify(base.setup),
    });
  };

  for (const packet of packets) {
    const key = `${String(packet.bus)}:${String(packet.device)}`;
    if (packet.transfer === "control") {
      const open = pending.get(key);
      if (packet.stage === "setup" && packet.setup && !packet.completion) {
        // A new request while one was open: the earlier one had no data stage.
        if (open) emit(packet, open, new Uint8Array(0));
        const request: PendingControl = {
          setup: packet.setup,
          endpoint: packet.endpoint,
          number: packet.number,
          time: packet.time,
        };
        // Some captures carry an OUT request's data in the setup packet itself.
        if (packet.payload.length > 0 && (packet.setup.requestType & 0x80) === 0) {
          emit(packet, request, packet.payload);
          pending.delete(key);
        } else {
          pending.set(key, request);
        }
      } else if (packet.stage === "data" && open && packet.payload.length > 0) {
        emit(packet, open, packet.payload);
        pending.delete(key);
      } else if (packet.stage === "status" && open) {
        emit(packet, open, new Uint8Array(0));
        pending.delete(key);
      }
      continue;
    }
    if (packet.transfer !== "interrupt" && packet.transfer !== "bulk") continue;
    if (packet.payload.length === 0) continue;
    const incoming = (packet.endpoint & 0x80) !== 0;
    if (incoming !== packet.completion) continue;
    events.push({
      number: packet.number,
      time: packet.time,
      bus: packet.bus,
      device: packet.device,
      kind: incoming ? "interrupt-in" : "interrupt-out",
      endpoint: packet.endpoint,
      interfaceNumber: null,
      reportType: null,
      reportId: null,
      descriptor: null,
      setup: null,
      bytes: packet.payload,
    });
  }
  return events;
}

/** Every device address in the capture, with its vendor and product id when it was caught. */
export function summariseDevices(
  packets: readonly UsbPacket[],
  events: readonly HidEvent[],
): DeviceSummary[] {
  const found = new Map<string, DeviceSummary>();
  const seen = new Map<string, Set<string>>();
  for (const packet of packets) {
    const key = `${String(packet.bus)}:${String(packet.device)}`;
    let entry = found.get(key);
    if (!entry) {
      entry = {
        bus: packet.bus,
        device: packet.device,
        packets: 0,
        endpoints: [],
        vendorId: null,
        productId: null,
      };
      found.set(key, entry);
    }
    entry.packets += 1;
    const labels = seen.get(key) ?? new Set<string>();
    seen.set(key, labels);
    const label = `${endpointName(packet.endpoint)} ${packet.transfer}`;
    if (!labels.has(label)) {
      labels.add(label);
      entry.endpoints.push(label);
    }
  }
  for (const event of events) {
    const descriptor = event.descriptor;
    if (event.kind !== "get-descriptor" || descriptor?.type !== 1) continue;
    if (event.bytes.length < 18 || event.bytes[1] !== 1) continue;
    const entry = found.get(`${String(event.bus)}:${String(event.device)}`);
    if (!entry) continue;
    entry.vendorId = (event.bytes[8] ?? 0) | ((event.bytes[9] ?? 0) << 8);
    entry.productId = (event.bytes[10] ?? 0) | ((event.bytes[11] ?? 0) << 8);
  }
  return [...found.values()].sort((a, b) => a.bus - b.bus || a.device - b.device);
}

export function endpointName(endpoint: number): string {
  return `EP${String(endpoint & 0x0f)} ${endpoint & 0x80 ? "IN" : "OUT"}`;
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

export interface EventFilter {
  bus?: number | undefined;
  device?: number | undefined;
  endpoint?: number | undefined;
  kinds?: readonly HidEventKind[] | undefined;
}

export function filterEvents(events: readonly HidEvent[], filter: EventFilter): HidEvent[] {
  return events.filter(
    (event) =>
      (filter.bus === undefined || event.bus === filter.bus) &&
      (filter.device === undefined || event.device === filter.device) &&
      (filter.endpoint === undefined || (event.endpoint & 0x8f) === (filter.endpoint & 0x8f)) &&
      (filter.kinds === undefined || filter.kinds.includes(event.kind)),
  );
}

/** What an event is about: a channel, with the report id when the transfer states one. */
function channelOf(event: HidEvent): string {
  const parts: string[] = [event.kind];
  if (event.reportType) parts.push(event.reportType);
  if (event.reportId !== null) parts.push(`id 0x${event.reportId.toString(16).padStart(2, "0")}`);
  if (event.descriptor) {
    parts.push(
      DESCRIPTOR_NAMES[event.descriptor.type] ?? `type 0x${event.descriptor.type.toString(16)}`,
    );
  }
  if (event.interfaceNumber !== null) parts.push(`if ${String(event.interfaceNumber)}`);
  parts.push(endpointName(event.endpoint));
  return parts.join(" ");
}

export interface FormatOptions {
  /** Print whole payloads instead of the first 64 bytes. */
  full?: boolean;
}

/** One line per event, identical events in a row folded into a count. */
export function formatEvents(events: readonly HidEvent[], options: FormatOptions = {}): string[] {
  const lines: string[] = [];
  const first = events[0]?.time ?? 0;
  let previous = "";
  let count = 0;
  let lastIndex = -1;
  const limit = options.full ? Number.POSITIVE_INFINITY : 64;
  for (const event of events) {
    const shown = event.bytes.subarray(0, limit);
    const text = `${channelOf(event)}  ${String(event.bytes.length)} B  ${toHex(shown)}${
      event.bytes.length > shown.length ? " ..." : ""
    }`;
    const signature = `${String(event.device)}|${text}`;
    if (signature === previous && lastIndex >= 0) {
      count += 1;
      lines[lastIndex] = `${lines[lastIndex]?.replace(/ {2}x\d+$/, "") ?? ""}  x${String(count)}`;
      continue;
    }
    previous = signature;
    count = 1;
    lastIndex = lines.length;
    lines.push(
      `#${String(event.number).padEnd(6)} +${(event.time - first).toFixed(3).padStart(9)}s  dev ${String(
        event.device,
      ).padEnd(3)} ${text}`,
    );
  }
  return lines;
}

export interface ChannelDiff {
  channel: string;
  /** Payloads only the second capture has. */
  added: string[];
  /** Byte offsets that differ between the added payloads and the first capture's commonest one. */
  offsets: number[];
  /** Whether the first capture had this channel at all. */
  knownBefore: boolean;
}

export interface CaptureDiff {
  /** Channels the second capture has payloads for that the first never sent. */
  changed: ChannelDiff[];
  /** Channels that were only in the first capture. */
  missing: string[];
}

function channelKey(event: HidEvent): string {
  return `${channelOf(event)} len ${String(event.bytes.length)}`;
}

function tally(events: readonly HidEvent[]): Map<string, Map<string, number>> {
  const channels = new Map<string, Map<string, number>>();
  for (const event of events) {
    const key = channelKey(event);
    const payloads = channels.get(key) ?? new Map<string, number>();
    const hex = toHex(event.bytes);
    payloads.set(hex, (payloads.get(hex) ?? 0) + 1);
    channels.set(key, payloads);
  }
  return channels;
}

function commonest(payloads: ReadonlyMap<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const [hex, count] of payloads) {
    if (count > bestCount) {
      best = hex;
      bestCount = count;
    }
  }
  return best;
}

/**
 * What the second capture sent that the first did not.
 *
 * Capture the same stretch twice with one setting changed between them, and the offsets
 * that move are where that setting lives. Payloads are compared as whole transfers; the
 * input noise a held button makes shows up as `added` too, so diff captures made with the
 * hands off the keys, or narrow with `--endpoint`.
 */
export function diffCaptures(before: readonly HidEvent[], after: readonly HidEvent[]): CaptureDiff {
  const a = tally(before);
  const b = tally(after);
  const changed: ChannelDiff[] = [];
  for (const [channel, payloads] of b) {
    const known = a.get(channel);
    const added = [...payloads.keys()].filter((hex) => !known?.has(hex));
    if (added.length === 0) continue;
    const baseline = known ? commonest(known) : undefined;
    const offsets = new Set<number>();
    if (baseline !== undefined) {
      const base = baseline.split(" ");
      for (const hex of added) {
        hex.split(" ").forEach((byte, position) => {
          if (byte !== base[position]) offsets.add(position);
        });
      }
    }
    changed.push({
      channel,
      added: added.sort(),
      offsets: [...offsets].sort((x, y) => x - y),
      knownBefore: known !== undefined,
    });
  }
  const missing = [...a.keys()].filter((channel) => !b.has(channel)).sort();
  changed.sort((x, y) => x.channel.localeCompare(y.channel));
  return { changed, missing };
}

export function formatDiff(diff: CaptureDiff): string[] {
  const lines: string[] = [];
  if (diff.changed.length === 0 && diff.missing.length === 0) {
    lines.push("The two captures carry the same payloads on every channel.");
    return lines;
  }
  for (const entry of diff.changed) {
    lines.push(
      `${entry.channel}  ${entry.knownBefore ? "" : "(not in the first capture)  "}${String(
        entry.added.length,
      )} new payload(s)`,
    );
    if (entry.offsets.length > 0) {
      lines.push(
        `    bytes that differ: ${entry.offsets.map((offset) => String(offset)).join(", ")}`,
      );
    }
    for (const hex of entry.added.slice(0, 8)) lines.push(`    ${hex}`);
    if (entry.added.length > 8) lines.push(`    ... ${String(entry.added.length - 8)} more`);
  }
  for (const channel of diff.missing) lines.push(`${channel}  only in the first capture`);
  return lines;
}

export function formatDevices(devices: readonly DeviceSummary[]): string[] {
  return devices.map((entry) => {
    const id =
      entry.vendorId === null || entry.productId === null
        ? "id not captured (replug the unit while capturing to get it)"
        : `${entry.vendorId.toString(16).padStart(4, "0")}:${entry.productId
            .toString(16)
            .padStart(4, "0")}`;
    return (
      `bus ${String(entry.bus)} device ${String(entry.device)}  ${id}  ` +
      `${String(entry.packets)} packets  ${entry.endpoints.join(", ")}`
    );
  });
}
