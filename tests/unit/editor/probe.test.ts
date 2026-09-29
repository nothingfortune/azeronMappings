// @vitest-environment happy-dom
/** Press-test page behaviour: prompting, capture on keydown, and per-unit state. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/probe.js";
import { start as startEditor } from "../../../src/editor/app.js";
import { buildPayload as buildEditorPayload } from "../../../src/lib/editor/payload.js";
import { loadDevice, loadTemplate } from "../../../src/lib/io.js";
import { buildProbeProfile, buildStickCalibrationProfile } from "../../../src/lib/probe.js";
import type { ProbePayload } from "../../../src/types/probe.js";

function payload(): ProbePayload {
  const left = loadDevice("cyborg2-left");
  const right = loadDevice("cyborg2-right");
  const template = loadTemplate("templates/everspace2-v5.json");
  const { assignments } = buildProbeProfile(template, {
    id: "00000000-0000-4000-8000-000000000000",
    name: "PROBE",
    unknownPins: [...left.unknownPins],
  });
  const calibration = buildStickCalibrationProfile(template, {
    id: "00000000-0000-4000-8000-000000000001",
    name: "PROBE stick",
  });
  return {
    generatedAt: new Date().toISOString(),
    profileName: "PROBE",
    devices: {
      "cyborg2-left": left.data,
      "cyborg2-right": right.data,
    },
    units: [
      { hand: "left", device: "cyborg2-left" },
      { hand: "right", device: "cyborg2-right" },
    ],
    assignments,
    stickAssignments: calibration.assignments,
  };
}

let probePayload: ProbePayload;

function press(code: string): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }));
}

function keyForPin(pin: number): string {
  const entry = probePayload.assignments.find((item) => item.pin === pin && item.kind === "button");
  if (!entry) throw new Error(`no probe key for pin ${String(pin)}`);
  return entry.key;
}

describe("the press test", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    probePayload = payload();
    start(probePayload);
  });

  it("asks for one position at a time, sweeping the unit left to right", () => {
    expect(document.querySelector(".prompt b")?.textContent).toBe("press pinky_side");
    expect(document.querySelectorAll(".cell.active").length).toBe(1);
  });

  it("shows both units at once, with the one being pressed picked out", () => {
    expect(document.querySelectorAll(".hand").length).toBe(2);
    expect(document.querySelectorAll(".hand.active-hand").length).toBe(1);
    expect(document.querySelector(".hand.active-hand .hand-title b")?.textContent).toBe(
      "left unit",
    );
  });

  it("records the pin that actually fired, not the one we assumed", () => {
    // The outer side key is prompted first; report pin 1 whatever the map predicted.
    press(keyForPin(1));
    const recorded = document.querySelector(".cell.done .pin")?.textContent;
    expect(recorded).toBe("pin 1");
    expect(document.querySelector(".prompt b")?.textContent).toBe("press pinky_1");
  });

  it("refuses a key that is not part of the probe profile", () => {
    press("Backquote");
    expect(document.querySelector(".prompt .bad")?.textContent).toContain(
      "not one of the probe keys",
    );
    expect(document.querySelector(".prompt b")?.textContent).toBe("press pinky_side");
  });

  it("rejects a button press when it asked for the stick", () => {
    const buttons = document.querySelectorAll(".cell").length;
    expect(buttons).toBeGreaterThan(0);
    const skip = [...document.querySelectorAll("button")].find((b) => b.textContent === "Skip");
    for (let i = 0; i < 30; i += 1) skip?.click();
    expect(document.querySelector(".prompt b")?.textContent).toContain("stick");
    press(keyForPin(1));
    expect(document.querySelector(".prompt .bad")?.textContent).toContain("not the stick");
  });

  it("keeps the two units' captures apart", () => {
    press(keyForPin(1));
    const unitSelect = document.querySelector<HTMLSelectElement>("header select");
    if (!unitSelect) throw new Error("no unit selector");
    unitSelect.value = "1";
    unitSelect.dispatchEvent(new Event("change"));
    expect(document.querySelectorAll(".hand.active-hand .cell.done").length).toBe(0);
    // The mirrored unit sweeps from its own outer edge, which is the other side.
    expect(document.querySelector(".prompt b")?.textContent).toBe("press index_side");
  });
});

describe("the stick zero pass", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    probePayload = payload();
    start(probePayload);
    const zeroTab = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Stick zero",
    );
    zeroTab?.click();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * One push: the key, the settle window that commits it, and the lockout that follows,
   * so the next push is not swallowed as the tail of this one.
   */
  function hold(sector: string): void {
    const entry = probePayload.stickAssignments.find((item) => item.sector === sector);
    if (!entry) throw new Error(`no calibration key for ${sector}`);
    press(entry.key);
    vi.advanceTimersByTime(800);
  }

  it("asks for a physical push, described relative to the unit", () => {
    // "hold", not "push": a flick sweeps through neighbouring sectors on the way.
    expect(document.querySelector(".prompt b")?.textContent).toBe(
      "hold the stick straight AWAY from you",
    );
  });

  it("records which sector the firmware reported for that push", () => {
    hold("right");
    expect(document.querySelector(".zero-grid .cell.done .pin")?.textContent).toBe("right");
    expect(document.querySelector(".prompt b")?.textContent).toContain("diagonal");
  });

  it("rejects a key from the pin sweep profile", () => {
    press(keyForPin(1));
    expect(document.querySelector(".prompt .bad")?.textContent).toContain(
      "not one of the stick calibration keys",
    );
  });

  it("reports the rotation once the pushes are in", () => {
    // Push each physical direction; report each one a quarter turn clockwise.
    const sectors = [
      "up",
      "up_right",
      "right",
      "down_right",
      "down",
      "down_left",
      "left",
      "up_left",
    ];
    for (let i = 0; i < sectors.length; i += 1) {
      const reported = sectors[(i + 2) % sectors.length];
      if (reported === undefined) throw new Error("bad sector index");
      hold(reported);
    }
    const notes = [...document.querySelectorAll(".note")]
      .map((node) => node.textContent)
      .join(" | ");
    expect(notes).toContain("90deg");
    expect(notes).toContain("stick_angle: 90");
  });
});

describe("stick bursts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    probePayload = payload();
    start(probePayload);
    const zeroTab = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Stick zero",
    );
    zeroTab?.click();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function sectorKey(sector: string): string {
    const entry = probePayload.stickAssignments.find((item) => item.sector === sector);
    if (!entry) throw new Error(`no calibration key for ${sector}`);
    return entry.key;
  }

  it("treats one flick that fires five keys as a single reading", () => {
    // Sweeping into a direction clips the neighbours on the way.
    for (const sector of ["up_left", "up", "up", "up", "up_right"]) press(sectorKey(sector));
    // Still sampling: nothing committed until the window closes.
    expect(document.querySelectorAll(".zero-grid .cell.done").length).toBe(0);

    vi.advanceTimersByTime(500);
    expect(document.querySelectorAll(".zero-grid .cell.done").length).toBe(1);
    expect(document.querySelector(".zero-grid .cell.done .pin")?.textContent).toBe("up");
    expect(document.querySelector(".prompt b")?.textContent).toContain("RIGHT");
  });

  it("says it is still sampling while the stick is held", () => {
    press(sectorKey("right"));
    press(sectorKey("right"));
    expect(document.querySelector(".prompt .muted")?.textContent).toContain("2 reading(s)");
  });

  it("reports how many readings the committed one won from", () => {
    for (const sector of ["down", "down", "down_left"]) press(sectorKey(sector));
    vi.advanceTimersByTime(500);
    expect(document.querySelector(".prompt .muted")?.textContent).toContain("best of 3");
  });

  it("ignores the tail of a burst that has already been committed", () => {
    press(sectorKey("up"));
    vi.advanceTimersByTime(500);
    expect(document.querySelector(".zero-grid .cell.done")?.textContent).toContain("up");

    // The stick is still settling and fires again immediately.
    press(sectorKey("left"));
    vi.advanceTimersByTime(500);
    // Only the first push was recorded; the lockout swallowed the rest.
    expect(document.querySelectorAll(".zero-grid .cell.done").length).toBe(1);
  });
});

describe("button presses", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    probePayload = payload();
    start(probePayload);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not advance twice when a held key auto-repeats", () => {
    const code = keyForPin(1);
    press(code);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { code, repeat: true, bubbles: true, cancelable: true }),
    );
    vi.advanceTimersByTime(400);
    expect(document.querySelectorAll(".hand.active-hand .cell.done").length).toBe(1);
    expect(document.querySelector(".prompt b")?.textContent).toBe("press pinky_1");
  });
});

describe("unit detection", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    probePayload = payload();
  });

  function openPressTest(): void {
    startEditor(buildEditorPayload());
    const tab = [...document.querySelectorAll("header button")].find(
      (button) => button.textContent === "Press test",
    );
    (tab as HTMLButtonElement).click();
  }

  it("does not claim anything before it has been asked", () => {
    openPressTest();
    const panel = [...document.querySelectorAll(".panel")].find(
      (node) => node.querySelector("h2")?.textContent === "Units",
    );
    expect(panel?.textContent).toContain("Not checked yet");
    expect([...(panel?.querySelectorAll("button") ?? [])][0]?.textContent).toBe("Detect units");
  });

  it("says plainly when the browser cannot do it", async () => {
    openPressTest();
    const button = [...document.querySelectorAll("button")].find(
      (node) => node.textContent === "Detect units",
    );
    // happy-dom has no navigator.hid, which is the same situation as Firefox.
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const panel = [...document.querySelectorAll(".panel")].find(
      (node) => node.querySelector("h2")?.textContent === "Units",
    );
    expect(panel?.textContent).toContain("no WebHID");
  });
});
