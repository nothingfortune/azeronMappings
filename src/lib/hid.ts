/**
 * Detecting the units from the browser, over WebHID.
 *
 * This only reports what is connected; configuration still goes through the Azeron
 * software, which speaks a proprietary protocol on its own HID interface. Both Cyborg II
 * units report USB product id 0x12f7, which is 4855 in decimal -- the same number the
 * software uses for the DevicesStorage folder that holds profiles filed before the units
 * were told apart.
 */

export const AZERON_PRODUCT_ID = 0x12f7;

export interface DetectedUnit {
  vendorId: number;
  productId: number;
  productName: string;
  /** Interfaces the browser exposes; the software configures over one of these. */
  collections: number;
  /** Whether it reports the product id both Cyborg II units share. */
  isAzeron: boolean;
}

export type DetectionState =
  | { status: "unsupported"; reason: string }
  | { status: "none" }
  | { status: "found"; units: DetectedUnit[] };

/** The subset of WebHID this uses, so the module does not depend on DOM lib typings. */
export interface HidLike {
  getDevices(): Promise<HidDeviceLike[]>;
  requestDevice(options: {
    filters: { vendorId?: number; productId?: number }[];
  }): Promise<HidDeviceLike[]>;
}

export interface HidDeviceLike {
  vendorId: number;
  productId: number;
  productName: string;
  collections: unknown[];
}

function describe(device: HidDeviceLike): DetectedUnit {
  return {
    vendorId: device.vendorId,
    productId: device.productId,
    productName: device.productName,
    collections: device.collections.length,
    isAzeron: device.productId === AZERON_PRODUCT_ID,
  };
}

/** Format a USB id the way lsusb and the Azeron software do. */
export function hex4(value: number): string {
  return value.toString(16).padStart(4, "0");
}

/**
 * Units the page has already been granted access to.
 *
 * WebHID gives nothing back until the user has picked a device, so an empty result means
 * "not yet granted", not "not plugged in".
 */
export async function alreadyGranted(hid: HidLike | undefined): Promise<DetectionState> {
  if (!hid) {
    return {
      status: "unsupported",
      reason: "This browser has no WebHID. Chrome and Edge do; Firefox and Safari do not.",
    };
  }
  try {
    const devices = await hid.getDevices();
    const units = devices.map(describe);
    return units.length > 0 ? { status: "found", units } : { status: "none" };
  } catch (error) {
    return { status: "unsupported", reason: `could not list devices: ${(error as Error).message}` };
  }
}

/**
 * Ask the user to pick their units.
 *
 * The filter list is empty on purpose. WebHID rejects a filter that gives a product id
 * without a vendor id, and the Azeron vendor id is not recorded anywhere here -- so the
 * picker shows everything and the result is labelled afterwards. Requires a click; the
 * browser enforces that.
 */
export async function requestUnits(hid: HidLike | undefined): Promise<DetectionState> {
  if (!hid) {
    return {
      status: "unsupported",
      reason: "This browser has no WebHID. Chrome and Edge do; Firefox and Safari do not.",
    };
  }
  try {
    const devices = await hid.requestDevice({ filters: [] });
    const units = devices.map(describe);
    return units.length > 0 ? { status: "found", units } : { status: "none" };
  } catch (error) {
    // A rejected promise here is normal -- a dismissed picker looks the same as a real
    // failure -- so it is reported rather than swallowed.
    return { status: "unsupported", reason: `the picker failed: ${(error as Error).message}` };
  }
}

/** Which device maps a detection matches, by the id the software files them under. */
export function matchToDevices(
  units: readonly DetectedUnit[],
  devices: readonly { name: string; softwareDeviceId: string | undefined }[],
): string[] {
  if (units.length === 0) return [];
  const named = devices.filter((device) => device.softwareDeviceId !== undefined);
  if (units.length >= 2 && named.length >= 2) return named.map((device) => device.name);
  // One unit connected, or no ids recorded: the product id is shared, so which unit this
  // is cannot be told from USB alone.
  return [];
}
