import { describe, expect, it } from "vitest";

import {
  diffCaptures,
  extractEvents,
  filterEvents,
  formatDevices,
  formatDiff,
  formatEvents,
  summariseDevices,
  toHex,
} from "../../../src/lib/hidcapture.js";
import { CaptureFormatError, readUsbPcap } from "../../../src/lib/usbpcap.js";
import type { FakePacket } from "../../helpers/usbpcap.js";
import { pcapFile, pcapngFile } from "../../helpers/usbpcap.js";

/** SET_REPORT, feature report 0x05, to interface 4: bmRequestType 0x21, bRequest 0x09. */
const SET_FEATURE_05 = [0x21, 0x09, 0x05, 0x03, 0x04, 0x00, 0x04, 0x00];
/** GET_REPORT, input report 0x02, from interface 4. */
const GET_INPUT_02 = [0xa1, 0x01, 0x02, 0x01, 0x04, 0x00, 0x04, 0x00];

function setReport(payload: number[], time = 1, device = 4): FakePacket[] {
  return [
    { transfer: "control", stage: "setup", setup: SET_FEATURE_05, endpoint: 0x00, time, device },
    { transfer: "control", stage: "data", payload, endpoint: 0x00, time: time + 0.001, device },
    {
      transfer: "control",
      stage: "status",
      endpoint: 0x80,
      completion: true,
      time: time + 0.002,
      device,
    },
  ];
}

describe("readUsbPcap", () => {
  it("reads the packets of a classic pcap in order", () => {
    const read = readUsbPcap(pcapFile([{ payload: [1, 2, 3], completion: true, time: 5.5 }]));
    expect(read.packets).toHaveLength(1);
    const [packet] = read.packets;
    expect(packet?.number).toBe(1);
    expect(packet?.time).toBeCloseTo(5.5, 5);
    expect(packet?.bus).toBe(1);
    expect(packet?.device).toBe(4);
    expect(packet?.endpoint).toBe(0x84);
    expect(packet?.transfer).toBe("interrupt");
    expect([...(packet?.payload ?? [])]).toEqual([1, 2, 3]);
    expect(read.truncated).toBe(false);
  });

  it("reads a pcapng the way Wireshark saves one", () => {
    const read = readUsbPcap(pcapngFile([{ payload: [9, 8], completion: true }]));
    expect(read.packets).toHaveLength(1);
    expect([...(read.packets[0]?.payload ?? [])]).toEqual([9, 8]);
  });

  it("parses the setup packet and keeps the stage", () => {
    const [packet] = readUsbPcap(pcapFile(setReport([1]))).packets;
    expect(packet?.stage).toBe("setup");
    expect(packet?.setup).toEqual({
      requestType: 0x21,
      request: 9,
      value: 0x0305,
      index: 4,
      length: 4,
    });
  });

  it("keeps what it read of a capture stopped mid-write, and says so", () => {
    const read = readUsbPcap(pcapFile([{ payload: [1] }, { payload: [2, 3, 4, 5] }], { cutBy: 3 }));
    expect(read.packets).toHaveLength(1);
    expect(read.truncated).toBe(true);
  });

  it("refuses a file that is not a capture, and one that is not USBPcap", () => {
    expect(() => readUsbPcap(new Uint8Array(40))).toThrow(CaptureFormatError);
    expect(() => readUsbPcap(new Uint8Array([1, 2, 3]))).toThrow(CaptureFormatError);
    expect(() => readUsbPcap(pcapngFile([{ payload: [1] }], 1))).toThrow(/not USBPcap|no USBPcap/);
  });
});

describe("extractEvents", () => {
  it("makes one event of a SET_REPORT's three packets, with the report id from the setup", () => {
    const events = extractEvents(readUsbPcap(pcapFile(setReport([5, 0xaa, 0xbb]))).packets);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.kind).toBe("set-report");
    expect(event?.reportType).toBe("feature");
    expect(event?.reportId).toBe(5);
    expect(event?.interfaceNumber).toBe(4);
    expect(toHex(event?.bytes ?? new Uint8Array())).toBe("05 aa bb");
  });

  it("places a GET_REPORT's data on its completion, and ignores the empty submission", () => {
    const events = extractEvents(
      readUsbPcap(
        pcapFile([
          { transfer: "control", stage: "setup", setup: GET_INPUT_02, endpoint: 0x00 },
          { transfer: "control", stage: "data", payload: [], endpoint: 0x80 },
          {
            transfer: "control",
            stage: "data",
            payload: [2, 7, 7],
            endpoint: 0x80,
            completion: true,
          },
          { transfer: "control", stage: "status", endpoint: 0x00, completion: true },
        ]),
      ).packets,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("get-report");
    expect(events[0]?.reportType).toBe("input");
    expect([...(events[0]?.bytes ?? [])]).toEqual([2, 7, 7]);
  });

  it("keeps a request with no data stage, like SET_IDLE", () => {
    const events = extractEvents(
      readUsbPcap(
        pcapFile([
          {
            transfer: "control",
            stage: "setup",
            setup: [0x21, 0x0a, 0, 0, 4, 0, 0, 0],
            endpoint: 0x00,
          },
          { transfer: "control", stage: "status", endpoint: 0x80, completion: true },
        ]),
      ).packets,
    );
    expect(events.map((event) => event.kind)).toEqual(["set-idle"]);
    expect(events[0]?.bytes).toHaveLength(0);
  });

  it("takes interrupt data at the completion of an IN and the submission of an OUT", () => {
    const events = extractEvents(
      readUsbPcap(
        pcapFile([
          { endpoint: 0x84, payload: [], completion: false },
          { endpoint: 0x84, payload: [1, 2], completion: true },
          { endpoint: 0x04, payload: [3, 4], completion: false },
          { endpoint: 0x04, payload: [], completion: true },
        ]),
      ).packets,
    );
    expect(events.map((event) => event.kind)).toEqual(["interrupt-in", "interrupt-out"]);
    expect(events.map((event) => toHex(event.bytes))).toEqual(["01 02", "03 04"]);
    expect(events.every((event) => event.reportId === null)).toBe(true);
  });

  it("names the descriptor a GET_DESCRIPTOR asked for", () => {
    const events = extractEvents(
      readUsbPcap(
        pcapFile([
          {
            transfer: "control",
            stage: "setup",
            setup: [0x81, 6, 0, 0x22, 4, 0, 0x40, 0],
            endpoint: 0x80,
          },
          {
            transfer: "control",
            stage: "data",
            payload: [6, 0, 0xff],
            endpoint: 0x80,
            completion: true,
          },
        ]),
      ).packets,
    );
    expect(events[0]?.kind).toBe("get-descriptor");
    expect(events[0]?.descriptor).toEqual({ type: 0x22, index: 0 });
  });
});

describe("devices", () => {
  it("reads the vendor and product id from a captured device descriptor", () => {
    const descriptor = [18, 1, 0, 2, 0, 0, 0, 64, 0xd0, 0x16, 0xf7, 0x12, 0, 1, 1, 2, 3, 1];
    const read = readUsbPcap(
      pcapFile([
        {
          transfer: "control",
          stage: "setup",
          setup: [0x80, 6, 0, 1, 0, 0, 18, 0],
          endpoint: 0x80,
          device: 4,
        },
        {
          transfer: "control",
          stage: "data",
          payload: descriptor,
          endpoint: 0x80,
          completion: true,
          device: 4,
        },
        { endpoint: 0x84, payload: [1], completion: true, device: 4 },
        { endpoint: 0x81, payload: [1], completion: true, device: 7 },
      ]),
    );
    const devices = summariseDevices(read.packets, extractEvents(read.packets));
    expect(devices.map((entry) => entry.device)).toEqual([4, 7]);
    expect(devices[0]?.vendorId).toBe(0x16d0);
    expect(devices[0]?.productId).toBe(0x12f7);
    expect(devices[1]?.vendorId).toBeNull();
    expect(formatDevices(devices)[0]).toContain("16d0:12f7");
    expect(formatDevices(devices)[1]).toContain("id not captured");
  });
});

describe("filterEvents and formatEvents", () => {
  const events = extractEvents(
    readUsbPcap(
      pcapFile([
        ...setReport([5, 1], 1, 4),
        ...setReport([5, 1], 2, 7),
        { endpoint: 0x84, payload: [9], completion: true, device: 4, time: 3 },
        { endpoint: 0x84, payload: [9], completion: true, device: 4, time: 3.1 },
      ]),
    ).packets,
  );

  it("narrows to one device or one endpoint", () => {
    expect(filterEvents(events, { device: 7 })).toHaveLength(1);
    expect(filterEvents(events, { endpoint: 0x84 })).toHaveLength(2);
    expect(filterEvents(events, { kinds: ["set-report"] })).toHaveLength(2);
  });

  it("folds identical events in a row into a count", () => {
    const lines = formatEvents(filterEvents(events, { endpoint: 0x84 }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/x2$/);
  });

  it("cuts a long payload unless asked for all of it", () => {
    const long = extractEvents(
      readUsbPcap(pcapFile(setReport(new Array<number>(100).fill(0xab)))).packets,
    );
    expect(formatEvents(long)[0]).toContain("...");
    expect(formatEvents(long, { full: true })[0]).not.toContain("...");
  });
});

describe("diffCaptures", () => {
  const capture = (payload: number[]) =>
    extractEvents(readUsbPcap(pcapFile(setReport(payload))).packets);

  it("is empty for two captures that say the same thing", () => {
    const diff = diffCaptures(capture([5, 1, 2]), capture([5, 1, 2]));
    expect(diff.changed).toEqual([]);
    expect(diff.missing).toEqual([]);
    expect(formatDiff(diff)[0]).toContain("same payloads");
  });

  it("names the byte offsets that moved between two captures", () => {
    const diff = diffCaptures(capture([5, 1, 2, 3]), capture([5, 1, 9, 3]));
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]?.offsets).toEqual([2]);
    expect(diff.changed[0]?.added).toEqual(["05 01 09 03"]);
    expect(diff.changed[0]?.knownBefore).toBe(true);
  });

  it("reports a channel the first capture never used, and one only it used", () => {
    const interrupt = extractEvents(
      readUsbPcap(pcapFile([{ endpoint: 0x04, payload: [1, 2], completion: false }])).packets,
    );
    const diff = diffCaptures(capture([5, 1]), interrupt);
    expect(diff.changed[0]?.knownBefore).toBe(false);
    expect(diff.missing).toHaveLength(1);
    expect(formatDiff(diff).join("\n")).toContain("only in the first capture");
  });
});
