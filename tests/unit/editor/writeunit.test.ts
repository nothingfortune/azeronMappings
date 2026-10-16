// @vitest-environment happy-dom
/**
 * Writing a layout into a unit from the Edit board, over a fake WebHID device that is a
 * fake unit underneath: pick the unit, see its slots, write, and read back what it holds.
 */
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import type { ConfigDevice, InputReportLike } from "../../../src/editor/unit-write.js";
import { repoPath } from "../../../src/config/paths.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { Command } from "../../../src/lib/unitproto.js";
import { UnitSession } from "../../../src/lib/unitsession.js";
import type { ExportDocument, ExportProfile } from "../../../src/types/azeron.js";
import { FakeUnit } from "../../helpers/fakeunit.js";
import type { FakeUnitOptions } from "../../helpers/fakeunit.js";
import { LIVE_SET } from "../../helpers/fixtures.js";

const PAYLOAD = buildPayload();
/** A whole write, under a busy test run: comfortably longer than the second it takes alone. */
const WRITE = { timeout: 15_000 };

/** WebHID's device, standing in front of a fake unit: what it says arrives as input reports. */
class FakeHidDevice implements ConfigDevice {
  opened = false;
  readonly productName = "Azeron Keypad - C0nf1gur4t0r";
  private readonly listeners = new Set<(event: InputReportLike) => void>();
  constructor(readonly unit: FakeUnit) {}
  open(): Promise<void> {
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

let unit: FakeUnit;
let filters: unknown;

const compiled = (side: "left" | "right"): ExportProfile => {
  const document = JSON.parse(
    readFileSync(repoPath(`dist/SpaceSims/everspace/everspace_akimbo_v10_${side}.json`), "utf8"),
  ) as ExportDocument;
  const profile = document.profiles[0];
  if (!profile) throw new Error("no profile");
  return profile;
};

/** A unit as it comes: three slots already on it, as the left unit had. */
async function plugIn(options: FakeUnitOptions = {}): Promise<void> {
  unit = new FakeUnit(options);
  const seed = new UnitSession(unit);
  const side = options.isRightStick === true ? "right" : "left";
  for (const [slot, name] of ["PROBE press test", "PROBE 1 pins", "Everspace 2 akimbo"].entries()) {
    await seed.writeProfile({ slot, name, profile: compiled(side), unknownPins: [0, 28, 29] });
  }
  unit.received.length = 0;
  const device = new FakeHidDevice(unit);
  Object.defineProperty(navigator, "hid", {
    configurable: true,
    value: {
      requestDevice: (options: { filters: unknown }) => {
        filters = options.filters;
        return Promise.resolve([device]);
      },
    },
  });
}

function mount(): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(PAYLOAD));
  const select = document.querySelectorAll<HTMLSelectElement>("header select")[1];
  if (select && select.value !== LIVE_SET) {
    select.value = LIVE_SET;
    select.dispatchEvent(new Event("change"));
  }
}

const bar = (): string => document.querySelector(".write-bar")?.textContent ?? "";

function barButton(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>(".write-bar button")].find(
    (button) => button.textContent === label,
  );
  if (!found) throw new Error(`no ${label} button in: ${bar()}`);
  return found;
}

function writeButton(hand: 0 | 1): HTMLButtonElement {
  const found = document
    .querySelectorAll(".hand")
    [hand]?.querySelector<HTMLButtonElement>(".write-unit");
  if (!found) throw new Error("no Write to unit button");
  return found;
}

beforeEach(() => {
  mount();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("writing a layout into a unit", () => {
  it("is offered on each unit, beside checking it", () => {
    expect(writeButton(0).textContent).toBe("Write to unit");
    expect(writeButton(1).textContent).toBe("Write to unit");
  });

  it("asks the browser only for the units' configuration interface", async () => {
    await plugIn();
    writeButton(0).click();
    barButton("Pick the unit…").click();
    await vi.waitFor(() => {
      expect(bar()).toContain("slots used");
    }, WRITE);
    expect(filters).toEqual([{ vendorId: 0x16d0, productId: 0x12f7, usagePage: 0xff01 }]);
  });

  it("offers to replace the slot that already has the layout's name", async () => {
    await plugIn();
    writeButton(0).click();
    expect(bar()).toContain("Write the left layout");
    barButton("Pick the unit…").click();
    await vi.waitFor(() => {
      expect(bar()).toContain("Unit 49229, firmware 111: 3 of 6 slots used, running slot 2.");
    }, WRITE);
    expect(bar()).toContain("slot 2: Everspace 2 akimbo (running) — replace it");
    expect(bar()).toContain("a new slot (3)");
    const chosen = document.querySelector<HTMLInputElement>(".write-slots input[checked]");
    expect(chosen?.value).toBe("2");
  });

  it(
    "writes into a new slot and reads it back as written",
    async () => {
      await plugIn();
      writeButton(0).click();
      barButton("Pick the unit…").click();
      await vi.waitFor(() => {
        expect(bar()).toContain("a new slot (3)");
      }, WRITE);
      const fresh = document.querySelector<HTMLInputElement>('.write-slots input[value="3"]');
      fresh?.dispatchEvent(new Event("change"));
      barButton("Write").click();
      await vi.waitFor(() => {
        expect(bar()).toContain("read back as written");
      }, WRITE);
      expect(bar()).toContain('Slot 3 now holds "Everspace 2 akimbo"');
      expect(bar()).toContain("The unit is running slot 2.");
      expect(unit.slots.get(3)?.records.size).toBeGreaterThan(20);
    },
    WRITE.timeout,
  );

  it(
    "replaces a slot only once asked, and keeps what it held",
    async () => {
      await plugIn();
      const confirm = vi.fn(() => true);
      Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
      writeButton(0).click();
      barButton("Pick the unit…").click();
      await vi.waitFor(() => {
        expect(bar()).toContain("replace it");
      }, WRITE);
      barButton("Write").click();
      expect(confirm).toHaveBeenCalledWith(
        'Replace slot 2, "Everspace 2 akimbo", on the unit with this layout?',
      );
      await vi.waitFor(() => {
        expect(bar()).toContain("read back as written");
      }, WRITE);
      expect(barButton("Download what slot 2 held")).toBeTruthy();
    },
    WRITE.timeout,
  );

  it("writes nothing when the replacement is not confirmed", async () => {
    await plugIn();
    Object.defineProperty(window, "confirm", { configurable: true, value: () => false });
    writeButton(0).click();
    barButton("Pick the unit…").click();
    await vi.waitFor(() => {
      expect(bar()).toContain("replace it");
    }, WRITE);
    unit.received.length = 0;
    barButton("Write").click();
    expect(unit.received).toEqual([]);
    expect(bar()).toContain("replace it");
  });

  it("refuses to write the left layout into the right unit", async () => {
    await plugIn({ deviceId: 29993, isRightStick: true });
    writeButton(0).click();
    barButton("Pick the unit…").click();
    await vi.waitFor(() => {
      expect(bar()).toContain("Nothing was written");
    }, WRITE);
    expect(bar()).toContain("That is unit 29993, the cyborg2-right");
    expect(unit.received.some((report) => report[2] === Command.OBM_COPY)).toBe(false);
    expect(unit.received.some((report) => report[2] === Command.PROFILE_NAME)).toBe(false);
  });

  it("refuses firmware it was not checked against, before writing anything", async () => {
    await plugIn({ firmware: 112 });
    writeButton(1).click();
    barButton("Pick the unit…").click();
    await vi.waitFor(() => {
      expect(bar()).toContain("firmware 112 is not one this was checked against");
    }, WRITE);
    expect(unit.received.every((report) => report[2] === Command.FIRMWARE_VERSION)).toBe(true);
  });
});
