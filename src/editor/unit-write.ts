/**
 * Writing a layout into the units from the browser, over WebHID.
 *
 * The page finds the units it has been given before (`getDevices`), opens each one's
 * configuration interface (vendor usage page 0xFF01, the one the Azeron app uses) and asks
 * who it is. The unit's id is the `software_device_id` in its device map, so the page knows
 * which unit is which without being told, and writes each hand's half of the layout into
 * the slot that already holds it. A unit the page has never been given needs one pick from
 * the browser's own dialog, once.
 */

import {
  AZERON_VENDOR_ID,
  CONFIG_USAGE_PAGE,
  CYBORG2_PRODUCT_ID,
  MAX_PROFILE_NAME,
  ProtocolError,
  REPORT_LENGTH,
  isWritableInput,
} from "../lib/unitproto.js";
import type { StoredProfile } from "../lib/unitproto.js";
import { UnitError, UnitSession, compareStored } from "../lib/unitsession.js";
import type {
  SessionHooks,
  SlotDifference,
  UnitIdentity,
  UnitTransport,
} from "../lib/unitsession.js";
import type { ExportProfile } from "../types/azeron.js";

/** The subset of a WebHID device this uses, so nothing depends on DOM typings for WebHID. */
export interface ConfigDevice {
  readonly opened: boolean;
  readonly productName: string;
  readonly vendorId: number;
  readonly productId: number;
  readonly collections: readonly { usagePage?: number }[];
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

export interface ConfigHid {
  getDevices(): Promise<ConfigDevice[]>;
  addEventListener?(type: "disconnect", listener: (event: { device: ConfigDevice }) => void): void;
  requestDevice(options: {
    filters: { vendorId: number; productId: number; usagePage: number }[];
  }): Promise<ConfigDevice[]>;
}

export const CONFIG_FILTER = {
  vendorId: AZERON_VENDOR_ID,
  productId: CYBORG2_PRODUCT_ID,
  usagePage: CONFIG_USAGE_PAGE,
};

/** A unit's configuration interface, not its keyboard, mouse or gamepad. */
export function isConfigInterface(device: ConfigDevice): boolean {
  return (
    device.vendorId === AZERON_VENDOR_ID &&
    device.productId === CYBORG2_PRODUCT_ID &&
    device.collections.some((collection) => collection.usagePage === CONFIG_USAGE_PAGE)
  );
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

  constructor(readonly device: ConfigDevice) {
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

/** A unit the page has open: who it is and what its slots hold. */
export interface FoundUnit {
  transport: WebHidTransport;
  session: UnitSession;
  identity: UnitIdentity;
  slots: StoredProfile[];
}

/** Open one unit, ask who it is and read its slots. Closes it again if any of that fails. */
export async function openUnit(device: ConfigDevice, hooks: SessionHooks): Promise<FoundUnit> {
  try {
    if (!device.opened) await device.open();
  } catch (error) {
    throw new Error(explain(error, "opening the unit"), { cause: error });
  }
  const transport = new WebHidTransport(device);
  const session = new UnitSession(transport, hooks);
  try {
    const identity = await session.identify();
    const slots = await session.readAll();
    return { transport, session, identity, slots };
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw new Error(explain(error, "asking the unit who it is"), { cause: error });
  }
}

/**
 * Every unit the page has been given, opened and identified. A unit that cannot be opened
 * is reported and passed over, so one stuck unit does not stop the other being written.
 */
export async function findUnits(
  hid: ConfigHid,
  hooks: SessionHooks,
): Promise<{ units: FoundUnit[]; problems: string[] }> {
  const units: FoundUnit[] = [];
  const problems: string[] = [];
  for (const device of (await hid.getDevices()).filter(isConfigInterface)) {
    try {
      units.push(await openUnit(device, hooks));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { units, problems };
}

export async function closeUnits(units: readonly FoundUnit[]): Promise<void> {
  for (const unit of units) await unit.transport.close().catch(() => undefined);
}

/** One unit of the layout, as the page knows it. */
export interface WriteTarget {
  slug: string;
  /** "left" or "right", for saying so. */
  unit: string;
  device: string;
  softwareDeviceId: string | undefined;
  /** The name the slot gets on the unit. */
  name: string;
  profile: ExportProfile;
  unknownPins: readonly number[];
}

/** What a write of one unit will do, worked out before anything is sent. */
export interface UnitPlan {
  target: WriteTarget;
  found: FoundUnit | null;
  /** Null when the unit is full and holds no slot by this name. */
  slot: number | null;
  /** The slot being written over, or null for a new one. */
  replaces: StoredProfile | null;
  /** How the slot being written over differs from the layout; empty when it already holds it. */
  changes: SlotDifference[];
}

/** A name that fits the unit: printable ASCII, at most MAX_PROFILE_NAME characters. */
export function slotName(name: string): string {
  const printable = Array.from(name)
    .filter((ch) => ch >= " " && ch <= "~")
    .join("");
  return printable.slice(0, MAX_PROFILE_NAME).trimEnd() || "Layout";
}

export function planFor(target: WriteTarget, units: readonly FoundUnit[]): UnitPlan {
  const found =
    units.find((unit) => String(unit.identity.deviceId) === target.softwareDeviceId) ?? null;
  if (found === null) return { target, found, slot: null, replaces: null, changes: [] };
  const same = found.slots.find((slot) => slot.name === target.name);
  const slot =
    same?.slot ?? (found.slots.length < found.identity.profileLimit ? found.slots.length : null);
  return withSlot({ target, found, slot, replaces: null, changes: [] }, slot);
}

/** The plan with another slot chosen. */
export function withSlot(plan: UnitPlan, slot: number | null): UnitPlan {
  const replaces =
    slot === null ? null : (plan.found?.slots.find((entry) => entry.slot === slot) ?? null);
  const inputs = plan.target.profile.inputs.filter((input) =>
    isWritableInput(input, plan.target.unknownPins),
  );
  return {
    ...plan,
    slot,
    replaces,
    changes: replaces === null ? [] : compareStored(inputs, replaces),
  };
}

/** True when the slot already holds the layout and writing it again would change nothing. */
export function upToDate(plan: UnitPlan): boolean {
  return (
    plan.replaces !== null && plan.changes.length === 0 && plan.replaces.name === plan.target.name
  );
}

/** Plain words for what went wrong, and what to do about it. */
export function explain(error: unknown, doing: string): string {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof UnitError) {
    const where = `while ${error.step}`;
    const partly =
      error.written > 0
        ? ` ${String(error.written)} input(s) had gone in, so the slot holds part of the layout: write it again.`
        : "";
    switch (error.kind) {
      case "no-answer":
        return `The unit stopped answering ${where} (${message}).${partly} Unplug it, plug it back in, and try again.`;
      case "transport":
        return `The unit could not be reached ${where} (${message}).${partly} Check it is plugged in, close the Azeron app, and try again.`;
      case "unsupported":
        return `${message}. Nothing was written: the page only writes to units it was checked against.`;
      case "protocol":
        return `The unit answered in a way the page did not expect ${where}: ${message}.${partly}`;
    }
  }
  if (name === "NotFoundError" || /no device selected/i.test(message)) {
    return "No unit was picked in the browser's dialog.";
  }
  if (name === "SecurityError") {
    return "The browser would not let the page reach the unit. Open the editor from `azeron serve` in Chrome or Edge.";
  }
  if (
    name === "NotAllowedError" ||
    name === "InvalidStateError" ||
    /failed to open/i.test(message)
  ) {
    return (
      `The unit could not be opened while ${doing}. Something else may have it open: close the ` +
      "Azeron app, or unplug the unit and plug it back in."
    );
  }
  if (error instanceof ProtocolError) {
    // Refused before anything was sent: the layout itself cannot go on a unit as it is.
    return `Nothing was written: ${message}.`;
  }
  return `${message} (while ${doing})`;
}
