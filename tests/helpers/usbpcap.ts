/** Builds USBPcap captures byte by byte, to the layout USBPcap documents. */

export interface FakePacket {
  /** Seconds since the epoch. */
  time?: number;
  irpId?: bigint;
  bus?: number;
  device?: number;
  endpoint?: number;
  transfer?: "interrupt" | "control" | "bulk";
  /** The info byte's low bit: set on the packet that reports a finished request. */
  completion?: boolean;
  stage?: "setup" | "data" | "status";
  /** Eight bytes, for a setup stage. */
  setup?: number[];
  payload?: number[];
}

const TRANSFER = { interrupt: 1, control: 2, bulk: 3 } as const;
const STAGE = { setup: 0, data: 1, status: 2 } as const;

export function usbpcapRecord(packet: FakePacket): Uint8Array {
  const transfer = packet.transfer ?? "interrupt";
  const control = transfer === "control";
  const body = [...(packet.setup ?? []), ...(packet.payload ?? [])];
  const headerLength = control ? 28 : 27;
  const bytes = new Uint8Array(headerLength + body.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, headerLength, true);
  view.setBigUint64(2, packet.irpId ?? 1n, true);
  view.setUint32(10, 0, true);
  view.setUint16(14, 0, true);
  view.setUint8(16, packet.completion ? 1 : 0);
  view.setUint16(17, packet.bus ?? 1, true);
  view.setUint16(19, packet.device ?? 4, true);
  view.setUint8(21, packet.endpoint ?? 0x84);
  view.setUint8(22, TRANSFER[transfer]);
  view.setUint32(23, body.length, true);
  if (control) view.setUint8(27, STAGE[packet.stage ?? "setup"]);
  bytes.set(body, headerLength);
  return bytes;
}

/** A classic little-endian microsecond pcap with link type 249. */
export function pcapFile(packets: FakePacket[], options: { cutBy?: number } = {}): Uint8Array {
  const records = packets.map((packet) => ({
    time: packet.time ?? 100,
    data: usbpcapRecord(packet),
  }));
  const size = 24 + records.reduce((sum, record) => sum + 16 + record.data.length, 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0xa1b2c3d4, true);
  view.setUint16(4, 2, true);
  view.setUint16(6, 4, true);
  view.setUint32(16, 65535, true);
  view.setUint32(20, 249, true);
  let offset = 24;
  for (const record of records) {
    view.setUint32(offset, Math.floor(record.time), true);
    view.setUint32(offset + 4, Math.round((record.time % 1) * 1e6), true);
    view.setUint32(offset + 8, record.data.length, true);
    view.setUint32(offset + 12, record.data.length, true);
    bytes.set(record.data, offset + 16);
    offset += 16 + record.data.length;
  }
  return options.cutBy ? bytes.subarray(0, bytes.length - options.cutBy) : bytes;
}

function block(type: number, body: number[]): number[] {
  const padded = [...body, ...new Array<number>((4 - (body.length % 4)) % 4).fill(0)];
  const total = padded.length + 12;
  const word = (value: number): number[] => [
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
  return [...word(type), ...word(total), ...padded, ...word(total)];
}

/** The same packets as a little-endian pcapng, the way Wireshark saves them. */
export function pcapngFile(packets: FakePacket[], linkType = 249): Uint8Array {
  const word = (value: number): number[] => [
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
  const out: number[] = [];
  out.push(
    ...block(0x0a0d0d0a, [...word(0x1a2b3c4d), 1, 0, 0, 0, ...new Array<number>(8).fill(0xff)]),
  );
  out.push(...block(0x00000001, [linkType & 0xff, linkType >> 8, 0, 0, ...word(65535)]));
  for (const packet of packets) {
    const data = [...usbpcapRecord(packet)];
    const micros = Math.round((packet.time ?? 100) * 1e6);
    out.push(
      ...block(0x00000006, [
        ...word(0),
        ...word(Math.floor(micros / 2 ** 32)),
        ...word(micros >>> 0),
        ...word(data.length),
        ...word(data.length),
        ...data,
      ]),
    );
  }
  return new Uint8Array(out);
}
