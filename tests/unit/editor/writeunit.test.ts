// @vitest-environment happy-dom
/**
 * Writing the layout into the units from the header, over a fake WebHID in front of fake
 * units that behave as the real ones did: the page finds the units it has been given,
 * knows which is which by asking, and writes each hand into the slot that holds it.
 */
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { WebHidTransport } from "../../../src/editor/unit-write.js";
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

async function writeToUnits(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>("header .write-units");
  if (!button) throw new Error("no Write to units button");
  button.click();
  // Unserved, the page cannot ask whether the Azeron app is running, so it asks the owner.
  await vi.waitFor(() => {
    if (/Getting ready|Checking the Azeron app/.test(bar())) throw new Error("still getting ready");
  });
  const carry = [...document.querySelectorAll<HTMLButtonElement>(".write-bar button")].find(
    (node) => node.textContent === "It is closed: carry on",
  );
  carry?.click();
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
    await writeToUnits();
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
    await writeToUnits();
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
    await writeToUnits();
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

  it("says the sensor and DPI step are not written, and which DPI steps the slot holds", async () => {
    // The left unit's slots hold steps of their own; the right unit's are the layout's.
    plugIn([
      makeUnit("left", { sensitivityValues: [800, 1600, 3200, 6400, 12800] }),
      makeUnit("right"),
    ]);
    await writeToUnits();
    await vi.waitFor(() => {
      expect(bar()).toContain("Right unit (29993) →");
    }, WAIT);
    const notes = [...document.querySelectorAll(".write-settings")].map((note) => note.textContent);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain(
      "Not written yet: the layout wants the sensor on and DPI step 2 (4000 DPI)",
    );
    expect(notes[0]).toContain(
      "The slot's DPI steps are 800, 1600, 3200, 6400, 12800; the layout's are 1000, 4000, 7500, 10000, 15000.",
    );
    expect(notes[1]).toContain("the layout wants the sensor off");
    expect(notes[1]).not.toContain("The slot's DPI steps");
  });

  it("says a slot that already holds the layout has nothing to write", async () => {
    plugIn([makeUnit("left", {}, compiled("left")), makeUnit("right", {}, compiled("right"))]);
    await writeToUnits();
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
    await writeToUnits();
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
    await writeToUnits();
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
    await writeToUnits();
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
    await writeToUnits();
    await vi.waitFor(() => {
      expect(bar()).toContain("This changes how the right unit's stick is inverted");
    }, WAIT);
    expect(bar()).toContain("stick inverts X is false on the unit, true in the layout");
    expect(bar()).toContain("stick inverts Y is true on the unit, false in the layout");
  });

  it("says when the browser has no WebHID", async () => {
    Object.defineProperty(navigator, "hid", { configurable: true, value: undefined });
    await writeToUnits();
    await vi.waitFor(() => {
      expect(bar()).toContain("This browser has no WebHID");
    }, WAIT);
    expect(barButton("Try again")).toBeTruthy();
  });
});

describe("the WebHID transport", () => {
  it("hands each report to the next wait in turn, and loses none when waits overlap", async () => {
    const device = new FakeHidDevice(new FakeUnit());
    const transport = new WebHidTransport(device);
    const send = (byte: number): void => {
      const report = new Uint8Array(64);
      report[0] = byte;
      device.listeners.forEach((listener) => {
        listener({ reportId: 0, data: new DataView(report.buffer) });
      });
    };
    const short = transport.receive(20);
    const long = transport.receive(500);
    expect(await short).toBeNull();
    send(7);
    expect((await long)?.[0]).toBe(7);
    // A report with another id is not the configuration interface's.
    const other = new Uint8Array(64);
    device.listeners.forEach((listener) => {
      listener({ reportId: 3, data: new DataView(other.buffer) });
    });
    expect(await transport.receive(20)).toBeNull();
  });
});

describe("a write that is changed or stopped part way", () => {
  it("asks whether the Azeron app is closed when it cannot tell, rather than assuming so", async () => {
    plugIn([makeUnit("left"), makeUnit("right")]);
    document.querySelector<HTMLButtonElement>("header .write-units")?.click();
    await vi.waitFor(() => {
      expect(bar()).toContain("cannot tell whether the Azeron app is running");
    }, WAIT);
    expect(document.querySelector(".write-plan")).toBeNull();
    barButton("It is closed: carry on").click();
    await vi.waitFor(() => {
      expect(bar()).toContain("Right unit (29993) →");
    }, WAIT);
  });

  it("lets go of the units when cancelled while it is still finding them", async () => {
    const left = makeUnit("left");
    const right = makeUnit("right");
    plugIn([left, right]);
    await writeToUnits();
    barButton("Cancel").click();
    expect(document.querySelector(".write-bar")).toBeNull();
    // Whatever was still being asked when it was cancelled is let go of once it answers.
    await vi.waitFor(() => {
      expect(left.opened).toBe(false);
      expect(right.opened).toBe(false);
    }, WAIT);
    expect(document.querySelector(".write-bar")).toBeNull();
  });

  it("looks again rather than write a layout that changed while the bar waited", async () => {
    const left = makeUnit("left");
    plugIn([left, makeUnit("right")]);
    await writeToUnits();
    await vi.waitFor(() => {
      expect(bar()).toContain("Right unit (29993) →");
    }, WAIT);
    // One click on a stick mode changes both sticks: the plan on screen is now out of date.
    document.querySelector<HTMLButtonElement>('[data-dock-tab="pedals"]')?.click();
    [...document.querySelectorAll<HTMLButtonElement>(".mode-row")]
      .find((row) => row.textContent.startsWith("Mode 1"))
      ?.click();
    left.unit.received.length = 0;
    barButton("Write").click();
    await vi.waitFor(() => {
      expect(bar()).toContain("The layout changed since this was worked out");
    }, WAIT);
    expect(left.unit.received.some((report) => report[2] === Command.OBM_COPY)).toBe(false);
  });

  it("ends when another layout is chosen", async () => {
    plugIn([makeUnit("left"), makeUnit("right")]);
    await writeToUnits();
    await vi.waitFor(() => {
      expect(bar()).toContain("Right unit (29993) →");
    }, WAIT);
    const layout = document.querySelectorAll<HTMLSelectElement>("header select")[1];
    const other = [...(layout?.options ?? [])].find((option) => option.value !== LIVE_SET);
    if (!layout || !other) throw new Error("no second layout");
    vi.stubGlobal("confirm", () => true);
    layout.value = other.value;
    layout.dispatchEvent(new Event("change"));
    expect(document.querySelector(".write-bar")).toBeNull();
  });
});

describe("what the page says is on the units, after a direct write", () => {
  const SERVED = window as unknown as { AZERON_SERVED?: boolean };
  let recorded: Record<string, unknown>[] = [];

  /** The server: no Azeron app running, its store holding neither unit's copy, until written. */
  function serve(): void {
    SERVED.AZERON_SERVED = true;
    recorded = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string, init?: { body?: string }) => {
        let body: unknown = { ok: true };
        if (path === "/api/azeron-app") body = { ok: true, running: false };
        if (path === "/api/units/written") {
          recorded.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
        }
        if (path.startsWith("/api/units?")) {
          const units = (["left", "right"] as const).map((unit) => {
            const done = recorded.find((entry) => entry.unit === unit);
            return {
              set: LIVE_SET,
              unit,
              name: `Everspace 2 akimbo v10 (${unit})`,
              file: `dist/SpaceSims/everspace/everspace_akimbo_v10_${unit}.json`,
              importPath: `C:\\repo\\dist\\everspace_akimbo_v10_${unit}.json`,
              status: done === undefined ? "missing" : "written",
              ...(done === undefined ? {} : { written: { slot: done.slot, at: done.at } }),
              copies: 0,
              differences: [],
            };
          });
          body = { ok: true, report: { store: "C:\\store", units } };
        }
        return Promise.resolve({ status: 200, json: () => Promise.resolve(body) });
      }),
    );
    document.body.innerHTML = '<div id="app"></div>';
    start({ ...structuredClone(PAYLOAD), appStore: true });
    const select = document.querySelectorAll<HTMLSelectElement>("header select")[1];
    if (select && select.value !== LIVE_SET) {
      select.value = LIVE_SET;
      select.dispatchEvent(new Event("change"));
    }
  }

  afterEach(() => {
    SERVED.AZERON_SERVED = false;
    vi.unstubAllGlobals();
  });

  it("records each clean write, and stops asking for a re-import", async () => {
    serve();
    await vi.waitFor(() => {
      expect(document.querySelector('header [data-todo="import"]')?.textContent).toBe(
        "Re-import 2",
      );
    }, WAIT);
    plugIn([makeUnit("left"), makeUnit("right")]);
    await writeToUnits();
    await vi.waitFor(() => {
      expect(bar()).toContain("Right unit (29993) →");
    }, WAIT);
    barButton("Write").click();
    await vi.waitFor(() => {
      expect(bar()).toContain("read back as written");
      expect(recorded).toHaveLength(2);
    }, WAIT);
    expect(recorded.map((entry) => [entry.deviceId, entry.slot, entry.unit])).toEqual([
      ["49229", 2, "left"],
      ["29993", 2, "right"],
    ]);
    for (const entry of recorded) expect(entry.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    await vi.waitFor(() => {
      expect(document.querySelector('header [data-todo="import"]')).toBeNull();
    }, WAIT);
  });
});
