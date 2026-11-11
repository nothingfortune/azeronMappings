/**
 * The page knows a unit by the id this person's unit reports, which `local.yaml` gives,
 * and a press test saved from the page never commits that id into a shared device map.
 */
import { describe, expect, it } from "vitest";

import { buildPayload } from "../../../src/lib/editor/payload.js";
import { keepDeviceId } from "../../../src/lib/serve.js";

describe("the page's units", () => {
  it("carry the id local.yaml gives, as the CLI's loadDevice does", () => {
    const committed = buildPayload({ games: {}, devices: {} }).devices["cyborg2-left"];
    expect(committed?.software_device_id).toBeDefined();
    const named = buildPayload({
      games: {},
      devices: { "cyborg2-left": { software_device_id: "12345" } },
    }).devices;
    expect(named["cyborg2-left"]?.software_device_id).toBe("12345");
    // Only the unit named.
    expect(named["cyborg2-right"]?.software_device_id).toBe(
      buildPayload({ games: {}, devices: {} }).devices["cyborg2-right"]?.software_device_id,
    );
  });
});

describe("saving a device map", () => {
  const existing = 'device: cyborg2-left\nsoftware_device_id: "49229"\npositions: {}\n';

  it("keeps the id the file already has", () => {
    const incoming =
      'device: cyborg2-left\nsoftware_device_id: "12345"\npositions:\n  a: {pin: 1}\n';
    expect(keepDeviceId("devices/cyborg2-left.yaml", existing, incoming)).toBe(
      'device: cyborg2-left\nsoftware_device_id: "49229"\npositions:\n  a: {pin: 1}\n',
    );
  });

  it("adds none to a file that had none", () => {
    const bare = "device: x\npositions: {}\n";
    const incoming = 'device: x\nsoftware_device_id: "12345"\npositions: {}\n';
    expect(keepDeviceId("devices/x.yaml", bare, incoming)).toBe(bare);
  });

  it("leaves a new file and any other kind of file as sent", () => {
    const incoming = 'device: x\nsoftware_device_id: "12345"\n';
    expect(keepDeviceId("devices/x.yaml", null, incoming)).toBe(incoming);
    expect(keepDeviceId("games/G/g/sets.yaml", existing, incoming)).toBe(incoming);
  });
});
