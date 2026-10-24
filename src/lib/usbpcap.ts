/**
 * Reading a USBPcap capture.
 *
 * USBPcap is the Windows USB filter driver Wireshark uses. It is the only way to see what
 * the Azeron app sends a unit: that traffic is between the app and the device, below
 * anything a program running beside the app can open. This module only reads the file;
 * it never talks to a device, and nothing here can send a request to one.
 *
 * Node-free on purpose, like `lint.ts`: it takes bytes, so the file read lives in `io.ts`.
 *
 * Two container formats are read, because USBPcapCMD writes classic pcap and Wireshark
 * saves pcapng by default. Both must carry link type 249 (USBPcap). The packet layout is
 * the one USBPcap documents (`USBPCAP_BUFFER_PACKET_HEADER`).
 */

export const LINKTYPE_USBPCAP = 249;

export type TransferType =
  "isochronous" | "interrupt" | "control" | "bulk" | "irp-info" | "unknown";
export type ControlStage = "setup" | "data" | "status";

export interface SetupPacket {
  requestType: number;
  request: number;
  value: number;
  index: number;
  length: number;
}

export interface UsbPacket {
  /** 1-based record number in the file, as Wireshark's No. column shows it. */
  number: number;
  /** Seconds since the epoch, with the fraction. */
  time: number;
  irpId: bigint;
  /** USBD_STATUS; 0 is success. */
  status: number;
  bus: number;
  device: number;
  /** Endpoint address, direction bit included (0x84 is endpoint 4, IN). */
  endpoint: number;
  transfer: TransferType;
  /** True for the packet that reports a finished request; false for the one that sent it. */
  completion: boolean;
  stage: ControlStage | null;
  /** Present on the setup stage of a control transfer. */
  setup: SetupPacket | null;
  /** Everything after the USBPcap header; for a setup stage, after the 8 setup bytes. */
  payload: Uint8Array;
}

export interface CaptureRead {
  packets: UsbPacket[];
  /** The file ended inside a record: a capture that was stopped by killing the program. */
  truncated: boolean;
  /** Records on an interface that is not USBPcap, or too short to hold a header. */
  skipped: number;
}

export class CaptureFormatError extends Error {}

interface RawRecord {
  time: number;
  data: Uint8Array;
}

const PCAP_MAGICS = new Map<number, { little: boolean; nanos: boolean }>([
  [0xa1b2c3d4, { little: true, nanos: false }],
  [0xa1b23c4d, { little: true, nanos: true }],
  [0xd4c3b2a1, { little: false, nanos: false }],
  [0x4d3cb2a1, { little: false, nanos: true }],
]);

const PCAPNG_SECTION_HEADER = 0x0a0d0d0a;

/** USBPcap packet header: 27 bytes, 28 for a control transfer, which adds the stage. */
const HEADER_MIN = 27;

function transferName(code: number): TransferType {
  switch (code) {
    case 0:
      return "isochronous";
    case 1:
      return "interrupt";
    case 2:
      return "control";
    case 3:
      return "bulk";
    case 254:
      return "irp-info";
    default:
      return "unknown";
  }
}

function stageName(code: number): ControlStage | null {
  switch (code) {
    case 0:
      return "setup";
    case 1:
      return "data";
    case 2:
      return "status";
    default:
      return null;
  }
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readPcap(bytes: Uint8Array): {
  records: RawRecord[];
  truncated: boolean;
  skipped: number;
} {
  const view = viewOf(bytes);
  const format = PCAP_MAGICS.get(view.getUint32(0, true));
  if (!format) throw new CaptureFormatError("not a pcap or pcapng file");
  if (bytes.length < 24) throw new CaptureFormatError("pcap header is cut short");
  const { little, nanos } = format;
  const linkType = view.getUint32(20, little);
  if (linkType !== LINKTYPE_USBPCAP) {
    throw new CaptureFormatError(
      `link type ${String(linkType)}, not USBPcap (${String(LINKTYPE_USBPCAP)}); ` +
        "this is not a USB capture made with USBPcap",
    );
  }
  const records: RawRecord[] = [];
  let offset = 24;
  let truncated = false;
  while (offset < bytes.length) {
    if (offset + 16 > bytes.length) {
      truncated = true;
      break;
    }
    const seconds = view.getUint32(offset, little);
    const fraction = view.getUint32(offset + 4, little);
    const included = view.getUint32(offset + 8, little);
    offset += 16;
    if (offset + included > bytes.length) {
      truncated = true;
      break;
    }
    records.push({
      time: seconds + fraction / (nanos ? 1e9 : 1e6),
      data: bytes.subarray(offset, offset + included),
    });
    offset += included;
  }
  return { records, truncated, skipped: 0 };
}

/** The `if_tsresol` option of an interface description block, as seconds per tick. */
function pcapngResolution(view: DataView, start: number, end: number, little: boolean): number {
  let offset = start;
  while (offset + 4 <= end) {
    const code = view.getUint16(offset, little);
    const length = view.getUint16(offset + 2, little);
    if (code === 0) break;
    if (code === 9 && length >= 1 && offset + 4 < end) {
      const raw = view.getUint8(offset + 4);
      return raw & 0x80 ? 2 ** -(raw & 0x7f) : 10 ** -raw;
    }
    offset += 4 + Math.ceil(length / 4) * 4;
  }
  return 1e-6;
}

function readPcapng(bytes: Uint8Array): {
  records: RawRecord[];
  truncated: boolean;
  skipped: number;
} {
  const view = viewOf(bytes);
  const records: RawRecord[] = [];
  const interfaces: { linkType: number; resolution: number }[] = [];
  let little = true;
  let offset = 0;
  let truncated = false;
  let skipped = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      truncated = true;
      break;
    }
    const type = view.getUint32(offset, true);
    if (type === PCAPNG_SECTION_HEADER) {
      // The byte-order magic decides how every later block in this section is read.
      const order = view.getUint32(offset + 8, true);
      if (order === 0x1a2b3c4d) little = true;
      else if (order === 0x4d3c2b1a) little = false;
      else throw new CaptureFormatError("pcapng section has an unreadable byte-order mark");
      interfaces.length = 0;
    }
    const blockType = view.getUint32(offset, little);
    const total = view.getUint32(offset + 4, little);
    if (total < 12 || total % 4 !== 0) {
      throw new CaptureFormatError(
        `pcapng block at byte ${String(offset)} has length ${String(total)}`,
      );
    }
    if (offset + total > bytes.length) {
      truncated = true;
      break;
    }
    const bodyEnd = offset + total - 4;
    if (blockType === 0x00000001) {
      interfaces.push({
        linkType: view.getUint16(offset + 8, little),
        resolution: pcapngResolution(view, offset + 16, bodyEnd, little),
      });
    } else if (blockType === 0x00000006) {
      const id = view.getUint32(offset + 8, little);
      const iface = interfaces[id];
      const captured = view.getUint32(offset + 20, little);
      if (iface?.linkType !== LINKTYPE_USBPCAP || offset + 28 + captured > bodyEnd) {
        skipped += 1;
      } else {
        const ticks =
          view.getUint32(offset + 12, little) * 2 ** 32 + view.getUint32(offset + 16, little);
        records.push({
          time: ticks * iface.resolution,
          data: bytes.subarray(offset + 28, offset + 28 + captured),
        });
      }
    }
    offset += total;
  }
  if (!interfaces.some((entry) => entry.linkType === LINKTYPE_USBPCAP)) {
    throw new CaptureFormatError(
      `no USBPcap interface in this pcapng (link types: ${
        interfaces.map((entry) => String(entry.linkType)).join(", ") || "none"
      })`,
    );
  }
  return { records, truncated, skipped };
}

function parsePacket(record: RawRecord, number: number): UsbPacket | null {
  const { data } = record;
  if (data.length < HEADER_MIN) return null;
  const view = viewOf(data);
  const headerLength = view.getUint16(0, true);
  if (headerLength < HEADER_MIN || headerLength > data.length) return null;
  const transferCode = view.getUint8(22);
  const dataLength = view.getUint32(23, true);
  const stage =
    transferCode === 2 && headerLength > HEADER_MIN ? stageName(view.getUint8(27)) : null;
  const body = data.subarray(headerLength, Math.min(data.length, headerLength + dataLength));

  let setup: SetupPacket | null = null;
  let payload = body;
  if (stage === "setup" && body.length >= 8) {
    const body8 = viewOf(body);
    setup = {
      requestType: body8.getUint8(0),
      request: body8.getUint8(1),
      value: body8.getUint16(2, true),
      index: body8.getUint16(4, true),
      length: body8.getUint16(6, true),
    };
    payload = body.subarray(8);
  }
  return {
    number,
    time: record.time,
    irpId: view.getBigUint64(2, true),
    status: view.getUint32(10, true),
    bus: view.getUint16(17, true),
    device: view.getUint16(19, true),
    endpoint: view.getUint8(21),
    transfer: transferName(transferCode),
    completion: (view.getUint8(16) & 1) === 1,
    stage,
    setup,
    payload,
  };
}

/** Read every USB packet in a pcap or pcapng file written by USBPcap. */
export function readUsbPcap(bytes: Uint8Array): CaptureRead {
  if (bytes.length < 12) throw new CaptureFormatError("too short to be a capture file");
  const magic = viewOf(bytes).getUint32(0, true);
  const raw = magic === PCAPNG_SECTION_HEADER ? readPcapng(bytes) : readPcap(bytes);
  const packets: UsbPacket[] = [];
  let skipped = raw.skipped;
  raw.records.forEach((record, position) => {
    const packet = parsePacket(record, position + 1);
    if (packet) packets.push(packet);
    else skipped += 1;
  });
  return { packets, truncated: raw.truncated, skipped };
}
