/**
 * Detecting the units over WebHID. The browser only reports what is connected;
 * configuration still goes through the Azeron software.
 */

import { describe, expect, it } from "vitest";

import {
  AZERON_PRODUCT_ID,
  alreadyGranted,
  hex4,
  matchToDevices,
  requestUnits,
} from "../../../src/lib/hid.js";
import type { HidDeviceLike, HidLike } from "../../../src/lib/hid.js";

const unit = (productId = AZERON_PRODUCT_ID): HidDeviceLike => ({
  vendorId: 0x1209,
  productId,
  productName: "Azeron Cyborg II",
  collections: [{}, {}, {}, {}, {}],
});

function hid(devices: HidDeviceLike[], picked: HidDeviceLike[] = []): HidLike {
  return {
    getDevices: () => Promise.resolve(devices),
    requestDevice: () => Promise.resolve(picked),
  };
}

describe("detection", () => {
  it("says so when the browser has no WebHID at all", async () => {
    const result = await alreadyGranted(undefined);
    expect(result.status).toBe("unsupported");
    expect(result).toHaveProperty("reason", expect.stringContaining("Firefox"));
  });

  it("reports the units the page already has access to", async () => {
    const result = await alreadyGranted(hid([unit()]));
    expect(result).toEqual({
      status: "found",
      units: [
        {
          vendorId: 0x1209,
          productId: AZERON_PRODUCT_ID,
          productName: "Azeron Cyborg II",
          collections: 5,
        },
      ],
    });
  });

  it("ignores devices that are not an Azeron", async () => {
    expect((await alreadyGranted(hid([unit(0x0001)]))).status).toBe("none");
  });

  it("distinguishes 'not granted yet' from 'nothing connected'", async () => {
    // WebHID returns nothing until the user has picked a device, so an empty list is
    // not evidence that the units are unplugged.
    expect((await alreadyGranted(hid([]))).status).toBe("none");
    expect((await requestUnits(hid([], [unit()]))).status).toBe("found");
  });

  it("formats a product id the way lsusb and the software do", () => {
    expect(hex4(AZERON_PRODUCT_ID)).toBe("12f7");
    expect(AZERON_PRODUCT_ID).toBe(4855);
  });
});

describe("matching a detection to a device map", () => {
  const maps = [
    { name: "cyborg2-left", softwareDeviceId: "49229" },
    { name: "cyborg2-right", softwareDeviceId: "29993" },
  ];

  it("names both maps when both units are connected", () => {
    expect(
      matchToDevices(
        [unit(), unit()].map((d) => ({ ...d, collections: 5 })),
        maps,
      ),
    ).toEqual(["cyborg2-left", "cyborg2-right"]);
  });

  it("refuses to guess which unit a single connection is", () => {
    // Both units report the same product id, so USB alone cannot tell them apart.
    expect(matchToDevices([{ ...unit(), collections: 5 }], maps)).toEqual([]);
  });
});
