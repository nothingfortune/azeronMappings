/**
 * Writing a layout into a unit from the browser, over WebHID.
 *
 * The unit is reached on its configuration interface (vendor usage page 0xFF01), the one
 * the Azeron app uses. The browser's own picker chooses which unit; the unit then says who
 * it is, and nothing is written unless that is the unit the layout is for.
 */

import {
  AZERON_VENDOR_ID,
  CONFIG_USAGE_PAGE,
  CYBORG2_PRODUCT_ID,
  REPORT_LENGTH,
} from "../lib/unitproto.js";
import { UnitSession } from "../lib/unitsession.js";
import type { UnitIdentity, UnitTransport } from "../lib/unitsession.js";

/** The subset of a WebHID device this uses, so nothing depends on DOM typings for WebHID. */
export interface ConfigDevice {
  readonly opened: boolean;
  readonly productName: string;
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: Uint8Array): Promise<void>;
  addEventListener(type: "inputreport", listener: (event: InputReportLike) => void): void;
  removeEventListener(type: "inputreport", listener: (event: InputReportLike) => void): void;
}

export interface InputReportLike {
  reportId: number;
  data: DataView;
}

export interface ConfigPicker {
  requestDevice(options: {
    filters: { vendorId: number; productId: number; usagePage: number }[];
  }): Promise<ConfigDevice[]>;
}

/** Reports from the unit queue here until the session asks for the next one. */
export class WebHidTransport implements UnitTransport {
  private readonly queue: Uint8Array[] = [];
  private waiting: ((report: Uint8Array | null) => void) | null = null;
  private readonly onReport = (event: InputReportLike): void => {
    const report = new Uint8Array(
      event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength),
    );
    const waiting = this.waiting;
    if (waiting !== null) {
      this.waiting = null;
      waiting(report);
    } else {
      this.queue.push(report);
    }
  };

  constructor(private readonly device: ConfigDevice) {
    device.addEventListener("inputreport", this.onReport);
  }

  send(report: Uint8Array): Promise<void> {
    if (report.length !== REPORT_LENGTH) {
      return Promise.reject(new Error(`a report must be ${String(REPORT_LENGTH)} bytes`));
    }
    return this.device.sendReport(0, report);
  }

  receive(timeoutMs: number): Promise<Uint8Array | null> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        resolve(null);
      }, timeoutMs);
      this.waiting = (report) => {
        clearTimeout(timer);
        resolve(report);
      };
    });
  }

  async close(): Promise<void> {
    this.device.removeEventListener("inputreport", this.onReport);
    if (this.device.opened) await this.device.close();
  }
}

export interface ConnectedUnit {
  transport: WebHidTransport;
  session: UnitSession;
  identity: UnitIdentity;
}

/**
 * Ask the browser for a unit's configuration interface and find out which unit it is.
 * Must be called from a click: the browser will not show its picker otherwise.
 */
export async function connectUnit(
  hid: ConfigPicker | undefined,
  log: (line: string) => void,
): Promise<ConnectedUnit | null> {
  if (!hid) {
    throw new Error("This browser has no WebHID. Chrome and Edge do; Firefox and Safari do not.");
  }
  const [device] = await hid.requestDevice({
    filters: [
      { vendorId: AZERON_VENDOR_ID, productId: CYBORG2_PRODUCT_ID, usagePage: CONFIG_USAGE_PAGE },
    ],
  });
  if (!device) return null;
  if (!device.opened) await device.open();
  const transport = new WebHidTransport(device);
  const session = new UnitSession(transport, log);
  try {
    const identity = await session.identify();
    return { transport, session, identity };
  } catch (error) {
    await transport.close();
    throw error;
  }
}

/** Which unit a device map is for, by the id the unit reports and the map records. */
export function unitMatches(identity: UnitIdentity, softwareDeviceId: string | undefined): boolean {
  return softwareDeviceId !== undefined && String(identity.deviceId) === softwareDeviceId;
}
