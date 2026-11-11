// @vitest-environment happy-dom
/**
 * The press test put onto the units from its own tab, over a fake WebHID in front of fake
 * units: no file to download and nothing to import anywhere else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { PROBE_SLOT_NAMES } from "../../../src/editor/probe-units.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { makeUnit, plugIn } from "../../helpers/fakehid.js";
import type { FakeHidDevice } from "../../helpers/fakehid.js";

const PAYLOAD = buildPayload();
/** A unit takes a dozen seconds over the fake WebHID, which waits out each quiet spell. */
const WAIT = { timeout: 90_000 };
const SLOW = { timeout: 180_000 };
const SERVED = window as unknown as { AZERON_SERVED?: boolean };

const bar = (): string => document.querySelector(".probe-units")?.textContent ?? "";

function click(label: string | RegExp, scope = ".probe-units"): void {
  const found = [...document.querySelectorAll<HTMLButtonElement>(`${scope} button`)].find(
    (button) =>
      typeof label === "string" ? button.textContent === label : label.test(button.textContent),
  );
  if (!found) throw new Error(`no ${String(label)} button in: ${bar()}`);
  found.click();
}

function openPressTest(payload = PAYLOAD): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(payload));
  click("Press test", "header .tabs");
}

const slotNames = (device: FakeHidDevice): string[] =>
  [...device.unit.slots.values()].map((slot) => slot.name);

/** Put the press test on, saying nothing else is open where the page cannot tell. */
async function putOn(): Promise<void> {
  click("Put the press test on the units");
  await vi.waitFor(() => {
    expect(bar()).toMatch(/Nothing else is open|press test is on it/);
  }, WAIT);
  if (bar().includes("Nothing else is open")) click("Nothing else is open");
  await vi.waitFor(() => {
    expect(bar()).toContain("Take the press test off");
  }, WAIT);
}

beforeEach(() => {
  SERVED.AZERON_SERVED = false;
});

afterEach(() => {
  SERVED.AZERON_SERVED = false;
  vi.unstubAllGlobals();
});

describe("the press test on the units", SLOW, () => {
  it("offers to put it on the units, and no file to download", () => {
    plugIn([]);
    openPressTest();
    expect(bar()).toContain("Put the press test on the units");
    const labels = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels.some((label) => /Download .*profile/.test(label))).toBe(false);
    expect(document.body.textContent).not.toMatch(/Import .*probe|in the Azeron app, delete/);
  });

  it("writes both passes into each unit and runs the pins pass", async () => {
    const left = makeUnit("left");
    const right = makeUnit("right");
    plugIn([left, right]);
    openPressTest();
    await putOn();
    for (const unit of [left, right]) {
      expect(slotNames(unit)).toEqual([
        "Basic",
        "Joystick",
        "Everspace 2 akimbo",
        PROBE_SLOT_NAMES.pins,
        PROBE_SLOT_NAMES.zero,
      ]);
      expect(unit.unit.running).toBe(3);
    }
    expect(bar()).toContain("Left unit: the press test is on it.");
    expect(bar()).toContain("Right unit: the press test is on it.");
  });

  it("switches the units to the stick pass when the page does", async () => {
    const left = makeUnit("left");
    plugIn([left]);
    openPressTest();
    await putOn();
    click("Stick zero", ".probe-bar");
    await vi.waitFor(() => {
      expect(left.unit.running).toBe(4);
    }, WAIT);
    click("Pins", ".probe-bar");
    await vi.waitFor(() => {
      expect(left.unit.running).toBe(3);
    }, WAIT);
  });

  it("follows a pass chosen while the probes were still going on", async () => {
    const left = makeUnit("left");
    plugIn([left]);
    openPressTest();
    click("Put the press test on the units");
    await vi.waitFor(() => {
      expect(bar()).toMatch(/Nothing else is open|Putting the press test on/);
    }, WAIT);
    if (bar().includes("Nothing else is open")) click("Nothing else is open");
    await vi.waitFor(() => {
      expect(bar()).toContain("Putting the press test on");
    }, WAIT);
    // Chosen mid-write: the run is busy and does not follow it there and then.
    click("Stick zero", ".probe-bar");
    await vi.waitFor(() => {
      expect(bar()).toContain("Take the press test off");
    }, WAIT);
    expect(left.unit.running).toBe(4);
  });

  it("lets go of the units before Write to units opens them", async () => {
    const left = makeUnit("left");
    plugIn([left]);
    openPressTest();
    await putOn();
    const seen: string[] = [];
    const open = left.open.bind(left);
    const close = left.close.bind(left);
    left.open = () => {
      seen.push(left.opened ? "open while open" : "open");
      return open();
    };
    left.close = () => {
      seen.push("close");
      return close();
    };
    const write = document.querySelector<HTMLButtonElement>("header .write-units");
    if (!write) throw new Error("no Write to units button");
    write.click();
    // Unserved, the page cannot ask whether the Azeron app is running, so it asks the owner.
    await vi.waitFor(() => {
      const carry = [...document.querySelectorAll<HTMLButtonElement>(".write-bar button")].find(
        (node) => node.textContent === "It is closed: carry on",
      );
      if (!carry) throw new Error("not asked yet");
      carry.click();
    }, WAIT);
    await vi.waitFor(() => {
      expect(seen).toContain("open");
    }, WAIT);
    // The press test's session is closed before the write's is opened, never shared.
    expect(seen.slice(0, 2)).toEqual(["close", "open"]);
    expect(seen).not.toContain("open while open");
  });

  it("takes both passes off again, leaving the unit on one of its own", async () => {
    const left = makeUnit("left");
    plugIn([left]);
    openPressTest();
    await putOn();
    click("Take the press test off");
    await vi.waitFor(() => {
      expect(bar()).toContain("nothing of the press test on it");
    }, WAIT);
    expect(slotNames(left)).toEqual(["Basic", "Joystick", "Everspace 2 akimbo"]);
    expect(left.unit.running).toBe(0);
  });

  it("asks for a unit when the page has been given none", async () => {
    const left = makeUnit("left");
    plugIn([], [left]);
    openPressTest();
    click("Put the press test on the units");
    await vi.waitFor(() => {
      expect(bar()).toContain("Nothing else is open");
    }, WAIT);
    click("Nothing else is open");
    await vi.waitFor(() => {
      expect(bar()).toContain("No unit is open to this page yet");
    }, WAIT);
    click("Choose a unit");
    await vi.waitFor(() => {
      expect(bar()).toContain("Left unit: the press test is on it.");
    }, WAIT);
  });
});

describe("a unit this computer does not know yet", SLOW, () => {
  let named: { device: string; id: string }[] = [];

  function serve(): void {
    SERVED.AZERON_SERVED = true;
    named = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string, init?: { body?: string }) => {
        let body: unknown = { ok: true };
        if (path === "/api/azeron-app") body = { ok: true, running: false };
        if (path === "/api/local/unit") {
          named.push(JSON.parse(init?.body ?? "{}") as { device: string; id: string });
          body = { ok: true, file: "local.yaml" };
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
      }),
    );
  }

  it("is named with one click, into local.yaml, and then gets the press test", async () => {
    serve();
    const stranger = makeUnit("left", { deviceId: 1111 });
    plugIn([stranger]);
    openPressTest();
    click("Put the press test on the units");
    await vi.waitFor(() => {
      expect(bar()).toContain("not a unit this computer knows: unit 1111");
    }, WAIT);
    click("This is the left unit");
    await vi.waitFor(() => {
      expect(bar()).toContain("Left unit: the press test is on it.");
    }, WAIT);
    expect(named).toEqual([{ device: "cyborg2-left", id: "1111" }]);
    expect(slotNames(stranger)).toContain(PROBE_SLOT_NAMES.pins);
  });

  it("is never written to before it is named", async () => {
    serve();
    const stranger = makeUnit("left", { deviceId: 1111 });
    plugIn([stranger]);
    openPressTest();
    click("Put the press test on the units");
    await vi.waitFor(() => {
      expect(bar()).toContain("unit 1111");
    }, WAIT);
    expect(slotNames(stranger)).not.toContain(PROBE_SLOT_NAMES.pins);
  });
});
