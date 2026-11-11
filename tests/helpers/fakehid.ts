/**
 * WebHID in front of fake units, for the editor's tests: the units the page has been given,
 * and the ones the browser's picker would offer next.
 */
import { readFileSync } from "node:fs";

import { expect } from "vitest";

import { repoPath } from "../../src/config/paths.js";
import type { ConfigDevice, InputReportLike } from "../../src/editor/unit-write.js";
import type { ExportDocument, InputRecord } from "../../src/types/azeron.js";
import { FakeUnit } from "./fakeunit.js";
import type { FakeUnitOptions } from "./fakeunit.js";

export const compiled = (side: "left" | "right"): InputRecord[] => {
  const document = JSON.parse(
    readFileSync(repoPath(`dist/SpaceSims/everspace/everspace_akimbo_v10_${side}.json`), "utf8"),
  ) as ExportDocument;
  return document.profiles[0]?.inputs ?? [];
};

/** WebHID's device in front of a fake unit: what the unit says arrives as input reports. */
export class FakeHidDevice implements ConfigDevice {
  opened = false;
  readonly productName = "Azeron Keypad - C0nf1gur4t0r";
  readonly vendorId = 0x16d0;
  readonly productId = 0x12f7;
  readonly collections = [{ usagePage: 0xff01 }];
  failOpen = false;
  readonly listeners = new Set<(event: InputReportLike) => void>();
  constructor(readonly unit: FakeUnit) {}
  open(): Promise<void> {
    if (this.failOpen) {
      const error = new Error("Failed to open the device.");
      error.name = "InvalidStateError";
      return Promise.reject(error);
    }
    this.opened = true;
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.opened = false;
    return Promise.resolve();
  }
  async sendReport(reportId: number, data: Uint8Array): Promise<void> {
    expect(reportId).toBe(0);
    await this.unit.send(data);
    for (;;) {
      const report = await this.unit.receive();
      if (report === null) break;
      setTimeout(() => {
        for (const listener of this.listeners)
          listener({ reportId: 0, data: new DataView(report.buffer) });
      }, 0);
    }
  }
  addEventListener(_type: "inputreport", listener: (event: InputReportLike) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "inputreport", listener: (event: InputReportLike) => void): void {
    this.listeners.delete(listener);
  }
}

/** A unit as it comes: three slots, running the third, which holds an older layout. */
export function makeUnit(
  side: "left" | "right",
  options: FakeUnitOptions = {},
  third?: InputRecord[],
): FakeHidDevice {
  const unit = new FakeUnit({ deviceId: side === "left" ? 49229 : 29993, ...options });
  const older =
    third ??
    compiled(side).map((input) =>
      input.id === 1 ? { ...input, keyValues: ["KeyZ", "0", "0", "0"] } : input,
    );
  unit
    .seed("Basic", compiled(side))
    .seed("Joystick", compiled(side))
    .seed("Everspace 2 akimbo", older);
  return new FakeHidDevice(unit);
}

let granted: FakeHidDevice[] = [];
let pickable: FakeHidDevice[] = [];

export function plugIn(given: FakeHidDevice[], toPick: FakeHidDevice[] = []): void {
  granted = [...given];
  pickable = [...toPick];
  Object.defineProperty(navigator, "hid", {
    configurable: true,
    value: {
      getDevices: () => Promise.resolve([...granted]),
      requestDevice: () => {
        const picked = pickable.shift();
        if (picked) granted.push(picked);
        return Promise.resolve(picked ? [picked] : []);
      },
    },
  });
}
