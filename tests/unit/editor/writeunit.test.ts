// @vitest-environment happy-dom
/**
 * Writing the layout into the units from the header, over a fake WebHID in front of fake
 * units that behave as the real ones did: the page finds the units it has been given,
 * knows which is which by asking, and writes each hand into the slot that holds it.
 */
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import type { ConfigDevice, InputReportLike } from "../../../src/editor/unit-write.js";
import { repoPath } from "../../../src/config/paths.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { Command } from "../../../src/lib/unitproto.js";
import type { ExportDocument, InputRecord } from "../../../src/types/azeron.js";
import { FakeUnit } from "../../helpers/fakeunit.js";
import type { FakeUnitOptions } from "../../helpers/fakeunit.js";
import { LIVE_SET } from "../../helpers/fixtures.js";

const PAYLOAD = buildPayload();
/** A whole write, under a busy test run: comfortably longer than the second it takes alone. */
const WAIT = { timeout: 15_000 };

const compiled = (side: "left" | "right"): InputRecord[] => {
  const document = JSON.parse(
    readFileSync(repoPath(`dist/SpaceSims/everspace/everspace_akimbo_v10_${side}.json`), "utf8"),
  ) as ExportDocument;
  return document.profiles[0]?.inputs ?? [];
};

/** WebHID's device in front of a fake unit: what the unit says arrives as input reports. */
class FakeHidDevice implements ConfigDevice {
  opened = false;
  readonly productName = "Azeron Keypad - C0nf1gur4t0r";
  readonly vendorId = 0x16d0;
  readonly productId = 0x12f7;
  readonly collections = [{ usagePage: 0xff01 }];
  failOpen = false;
  private readonly listeners = new Set<(event: InputReportLike) => void>();
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
function makeUnit(
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

function plugIn(given: FakeHidDevice[], toPick: FakeHidDevice[] = []): void {
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

function barButton(label: string | RegExp): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>(".write-bar button")].find(
    (button) =>
      typeof label === "string" ? button.textContent === label : label.test(button.textContent),
  );
  if (!found) throw new Error(`no ${String(label)} button in: ${bar()}`);
  return found;
}

function writeToUnits(): void {
  const button = document.querySelector<HTMLButtonElement>("header .write-units");
  if (!button) throw new Error("no Write to units button");
  button.click();
}

beforeEach(() => {
  // The page asks the server about the Azeron app only when it is served; these are not.
  mount();
});

afterEach(() => {
  const close = [...document.querySelectorAll<HTMLButtonElement>(".write-bar button")].find(
    (button) => button.textContent === "Cancel" || button.textContent === "Close",
  );
  close?.click();
  vi.restoreAllMocks();
});

describe("writing the layout into the units", () => {
  it("is one button in the header", () => {
    expect(document.querySelector("header .write-units")?.textContent).toBe("Write to units");
  });

  it("finds both units it has been given, knows which is which, and picks the slot that holds the layout", async () => {
    const left = makeUnit("left");
    const right = makeUnit("right");
    // Given in the other order: the page goes by what each unit says, not the order.
    plugIn([right, left]);
    writeToUnits();
    await vi.waitFor(() => {
      expect(bar()).toContain("Left unit (49229) →");
    }, WAIT);
    expect(bar()).toContain("Right unit (29993) →");
    const chosen = [...document.querySelectorAll<HTMLSelectElement>(".write-plan select")].map(
      (select) => select.value,
    );
    expect(chosen).toEqual(["2", "2"]);
    expect(bar()).toContain("1 control(s) change");
  });

  it("writes both hands with one more click, and reads each back", async () => {
    const left = makeUnit("left");
    const right = makeUnit("right");
    plugIn([left, right]);
    writeToUnits();
    await vi.waitFor(() => {
      expect(bar()).toContain("Right unit (29993) →");
    }, WAIT);
    barButton("Write").click();
    await vi.waitFor(() => {
      expect(bar()).toContain('Left unit: slot 2 now holds "Everspace 2 akimbo"');
      expect(bar()).toContain('Right unit: slot 2 now holds "Everspace 2 akimbo"');
    }, WAIT);
    expect(bar()).toContain("read back as written");
    expect(left.unit.received.some((report) => report[2] === Command.CHECK_PROFILE)).toBe(false);
    expect(left.opened).toBe(false);
  });

  it("leaves each unit running the slot it was just given", async () => {
    // Both units are on slot 0 when the write starts.
    const left = makeUnit("left", { activeSlot: 0 });
    const right = makeUnit("right", { activeSlot: 0 });
    plugIn([left, right]);
    writeToUnits();
    await vi.waitFor(() => {
      expect(bar()).toContain("Right unit (29993) →");
    }, WAIT);
    barButton("Write").click();
    await vi.waitFor(() => {
      expect(bar()).toContain("The left unit is running it now.");
      expect(bar()).toContain("The right unit is running it now.");
    }, WAIT);
    expect(left.unit.received.some((report) => report[2] === Command.SWITCH_PROFILE)).toBe(true);
  });

  it("says a slot that already holds the layout has nothing to write", async () => {
    plugIn([makeUnit("left", {}, compiled("left")), makeUnit("right", {}, compiled("right"))]);
    writeToUnits();
    await vi.waitFor(() => {
      expect(bar()).toContain("already holds this layout; nothing to write");
    }, WAIT);
    expect(
      [...document.querySelectorAll(".write-bar button")].map((button) => button.textContent),
    ).not.toContain("Write");
  });

  it("asks once for a unit it has not been given, and works out which one it got", async () => {
    const right = makeUnit("right");
    plugIn([makeUnit("left")], [right]);
    writeToUnits();
    await vi.waitFor(() => {
      expect(bar()).toContain("Right unit (29993): not found");
    }, WAIT);
    barButton("Give the page a unit…").click();
    await vi.waitFor(() => {
      expect(bar()).toContain("Right unit (29993) →");
    }, WAIT);
    expect(barButton("Write")).toBeTruthy();
  });

  it("says plainly when a unit cannot be opened, and still offers the other", async () => {
    const left = makeUnit("left");
    left.failOpen = true;
    plugIn([left, makeUnit("right")]);
    writeToUnits();
    await vi.waitFor(() => {
      expect(bar()).toContain("could not be opened");
    }, WAIT);
    expect(bar()).toContain("close the Azeron app, or unplug the unit and plug it back in");
    expect(bar()).toContain("Left unit (49229): not found");
    expect(barButton("Write the right unit")).toBeTruthy();
  });

  it("says plainly when a unit stops answering in the middle of a write", async () => {
    const left = makeUnit("left");
    plugIn([left, makeUnit("right")]);
    writeToUnits();
    await vi.waitFor(() => {
      expect(bar()).toContain("Right unit (29993) →");
    }, WAIT);
    // Silent from the next report on: the write starts and gets no answer.
    Object.assign(left.unit, {
      options: {
        ...(left.unit as unknown as { options: object }).options,
        goSilentAfter: left.unit.received.length + 3,
      },
    });
    barButton("Write").click();
    await vi.waitFor(() => {
      expect(bar()).toMatch(
        /Left unit: The unit stopped answering while writing input \d+ \(\d+ of 31\)/,
      );
      expect(bar()).toContain("so the slot holds part of the layout: write it again");
    }, WAIT);
    expect(bar()).toContain('Right unit: slot 2 now holds "Everspace 2 akimbo"');
  });

  it("warns before changing which way a stick is inverted", async () => {
    // The right unit's slot as the Azeron app wrote it in October: Y inverted, not X.
    const appWritten = compiled("right").map((input) =>
      input.types[0] === "4"
        ? {
            ...input,
            analogSettings: {
              ...input.analogSettings,
              invertXAxis: false,
              invertYAxis: true,
            } as InputRecord["analogSettings"],
          }
        : input,
    );
    plugIn([makeUnit("left"), makeUnit("right", {}, appWritten as InputRecord[])]);
    writeToUnits();
    await vi.waitFor(() => {
      expect(bar()).toContain("This changes how the right unit's stick is inverted");
    }, WAIT);
    expect(bar()).toContain("stick inverts X is false on the unit, true in the layout");
    expect(bar()).toContain("stick inverts Y is true on the unit, false in the layout");
  });

  it("says when the browser has no WebHID", async () => {
    Object.defineProperty(navigator, "hid", { configurable: true, value: undefined });
    writeToUnits();
    await vi.waitFor(() => {
      expect(bar()).toContain("This browser has no WebHID");
    }, WAIT);
    expect(barButton("Try again")).toBeTruthy();
  });
});
