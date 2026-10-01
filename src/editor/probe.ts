/**
 * The press test.
 *
 * The page prompts for one position at a time. Every pin in the probe profile sends a
 * distinct key, so the key that arrives identifies the pin that fired. The map is
 * measured rather than inferred from the left-handed layout.
 */

import { deviceFromProbe, PHYSICAL_PUSHES, probeDiff, stickZeroFrom } from "../lib/probe.js";
import type { ProbeResult } from "../lib/probe.js";
import { handLayout, positionLabel, probeOrder, unitLabel } from "../lib/layout.js";
import { Device } from "../lib/model-core.js";
import { dumpYaml } from "../lib/yaml.js";
import { STICK_DIRECTIONS } from "../types/azeron.js";
import type { StickDirection, StickSector } from "../types/azeron.js";
import type { CapturedUnit, ProbePayload } from "../types/probe.js";
import { PROBE_CSS } from "./probe-styles.js";

declare global {
  interface Window {
    AZERON_PROBE?: ProbePayload;
  }
}

const STORAGE_KEY = "azeron-probe-v1";
const DIR_GLYPH: Record<string, string> = {
  up: "\u2191",
  right: "\u2192",
  down: "\u2193",
  left: "\u2190",
};

const STICK_PROMPTS: Record<StickDirection, string> = {
  up: "hold the stick AWAY from you",
  right: "hold the stick RIGHT",
  down: "hold the stick TOWARD you",
  left: "hold the stick LEFT",
};

type Mode = "pins" | "zero";

interface State {
  payload: ProbePayload;
  mode: Mode;
  unitIndex: number;
  step: number;
  zeroStep: number;
  captured: Record<string, CapturedUnit>;
  lastKey: string | null;
  message: string | null;
  /** Readings collected during one stick push, before the modal one is committed. */
  burstVotes: Record<string, number>;
  burstTimer: ReturnType<typeof setTimeout> | null;
  burstNote: string | null;
  /** Ignore input until this time, so one press is not read twice. */
  lockUntil: number;
}

let state: State;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

function currentUnit(): { hand: string; device: string } {
  const unit = state.payload.units[state.unitIndex];
  if (!unit) throw new Error("no unit selected");
  return unit;
}

function deviceOf(name: string): Device {
  const data = state.payload.devices[name];
  if (!data) throw new Error(`unknown device ${name}`);
  return new Device(data);
}

function captureFor(hand: string): CapturedUnit {
  const existing = state.captured[hand];
  if (existing) return existing;
  const fresh: CapturedUnit = { pins: {}, stick: {}, sectors: {} };
  state.captured[hand] = fresh;
  return fresh;
}

/** Button positions first, then the four stick directions. */
function steps(): { kind: "button"; position: string }[] | never[] {
  return probeOrder(deviceOf(currentUnit().device)).map((position) => ({
    kind: "button" as const,
    position,
  }));
}

function totalSteps(): number {
  return steps().length + STICK_DIRECTIONS.length;
}

function currentPrompt(): {
  label: string;
  position: string | null;
  direction: StickDirection | null;
} {
  const buttons = steps();
  const button = buttons[state.step];
  if (button) {
    return { label: positionLabel(button.position), position: button.position, direction: null };
  }
  const direction = STICK_DIRECTIONS[state.step - buttons.length];
  if (direction) return { label: `stick ${direction}`, position: "stick", direction };
  return { label: "done", position: null, direction: null };
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.captured));
  } catch {
    // Private windows and locked-down browsers throw here; the page still works.
  }
}

function restore(): Record<string, CapturedUnit> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, CapturedUnit>;
  } catch {
    // ignore
  }
  return {};
}

/**
 * A button press is one event; a stick push is a burst.
 *
 * Deflecting a stick crosses neighbouring sectors, and the firmware repeats while the
 * stick is held, so one push arrives as several distinct keys. Readings inside
 * STICK_SETTLE_MS are collected and the most frequent sector is committed; a held
 * position accumulates the majority of readings.
 */
const STICK_SETTLE_MS = 450;
const LOCKOUT_MS = 250;

function now(): number {
  return Date.now();
}

function clearBurst(): void {
  if (state.burstTimer !== null) clearTimeout(state.burstTimer);
  state.burstTimer = null;
  state.burstVotes = {};
}

/** Whatever the burst saw most; ties go to whichever reached that count first. */
function modalVote(votes: Record<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of Object.entries(votes)) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function commitStickBurst(): void {
  const winner = modalVote(state.burstVotes);
  const samples = Object.values(state.burstVotes).reduce((sum, count) => sum + count, 0);
  clearBurst();
  if (winner === null) {
    render();
    return;
  }

  const capture = captureFor(currentUnit().hand);
  if (state.mode === "zero") {
    const push = PHYSICAL_PUSHES[state.zeroStep];
    if (!push) return;
    capture.sectors ??= {};
    capture.sectors[push.id] = winner as StickSector;
    state.zeroStep += 1;
  } else {
    const prompt = currentPrompt();
    if (!prompt.direction) return;
    capture.stick[prompt.direction] = winner as StickDirection;
    state.step += 1;
  }
  state.message = null;
  state.burstNote = samples > 1 ? `${winner} (best of ${String(samples)} readings)` : winner;
  state.lockUntil = now() + LOCKOUT_MS;
  save();
  render();
}

function voteStick(value: string): void {
  state.burstVotes[value] ??= 0;
  state.burstVotes[value] += 1;
  // ??= short-circuits, so the timer is only started once per burst.
  state.burstTimer ??= setTimeout(commitStickBurst, STICK_SETTLE_MS);
  render();
}

function onZeroKey(event: KeyboardEvent): void {
  const push = PHYSICAL_PUSHES[state.zeroStep];
  if (!push) return;
  event.preventDefault();
  state.lastKey = event.code;

  const assignment = state.payload.stickAssignments.find((entry) => entry.key === event.code);
  if (!assignment?.sector) {
    state.message =
      `${event.code} is not one of the stick calibration keys. ` +
      "Is probe-2-stick-zero.json the profile currently on this unit?";
    render();
    return;
  }

  state.message = null;
  voteStick(assignment.sector);
}

function onKey(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  // A held key auto-repeats, and the lockout swallows the tail of a burst that has
  // already been committed. Neither is a new reading.
  if (now() < state.lockUntil) {
    event.preventDefault();
    return;
  }
  if (event.repeat && state.burstTimer === null) {
    event.preventDefault();
    return;
  }

  if (state.mode === "zero") {
    onZeroKey(event);
    return;
  }
  const prompt = currentPrompt();
  if (!prompt.position) return;
  event.preventDefault();

  state.lastKey = event.code;
  const assignment = state.payload.assignments.find((entry) => entry.key === event.code);
  if (!assignment) {
    state.message = `${event.code} is not one of the probe keys. Is the probe profile loaded on this unit?`;
    render();
    return;
  }

  const capture = captureFor(currentUnit().hand);
  if (prompt.direction) {
    if (assignment.kind !== "stick" || !assignment.direction) {
      state.message = `${event.code} is pin ${String(assignment.pin)}, a button -- that was not the stick.`;
      render();
      return;
    }
    state.message = null;
    voteStick(assignment.direction);
    return;
  }

  if (assignment.kind !== "button") {
    state.message = `${event.code} is a stick direction, not a button.`;
    render();
    return;
  }
  capture.pins[prompt.position] = assignment.pin;
  state.message = null;
  state.burstNote = null;
  state.step += 1;
  state.lockUntil = now() + LOCKOUT_MS;
  save();
  render();
}

function resultFor(hand: string): ProbeResult {
  const capture = captureFor(hand);
  return { pins: capture.pins, stick: capture.stick, sectors: capture.sectors ?? {} };
}

function download(name: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportDevice(hand: string): void {
  const unit = state.payload.units.find((entry) => entry.hand === hand);
  if (!unit) return;
  const assumed = state.payload.devices[unit.device];
  if (!assumed) return;
  const capture = captureFor(hand);
  const result = resultFor(hand);
  const next = deviceFromProbe(assumed, result);

  const passes: string[] = [];
  if (Object.keys(capture.pins).length > 0) passes.push("pins");
  if (Object.keys(capture.sectors ?? {}).length > 0) passes.push("zero");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  const header =
    `# Press-tested with \`azeron probe\` on ${new Date().toISOString().slice(0, 10)}.\n` +
    `# Passes captured: ${passes.join(" + ") || "none"}.\n` +
    `# Every pin below is an observation, not an inheritance from the left-hand map.\n` +
    `# Save this over devices/${unit.device}.yaml.\n`;

  if (saveDevice !== null) {
    saveDevice(`devices/${unit.device}.yaml`, dumpYaml(next, header));
    return;
  }

  // The two passes produce different files for the same unit, so the name says which
  // passes are in it and when -- otherwise the second download is just "(1)".
  download(
    `${unit.device}.${passes.join("+") || "empty"}.${stamp}.yaml`,
    dumpYaml(next, header),
    "text/yaml",
  );
}

function renderDiagram(unitIndex: number): HTMLElement {
  const unit = state.payload.units[unitIndex];
  if (!unit) return el("div");
  const isActive = unitIndex === state.unitIndex;
  const device = deviceOf(unit.device);
  const layout = handLayout(device);
  const capture = captureFor(unit.hand);
  const prompt = isActive ? currentPrompt() : { position: null, direction: null, label: "" };

  const cell = (position: string, extra = ""): HTMLElement => {
    const done = capture.pins[position];
    const active = isActive && prompt.position === position && !prompt.direction;
    const classes = ["cell", extra, active ? "active" : "", done === undefined ? "" : "done"]
      .filter(Boolean)
      .join(" ");
    return el("div", { class: classes }, [
      el("span", { class: "pos" }, [positionLabel(position)]),
      el("span", { class: "pin" }, [done === undefined ? "" : `pin ${String(done)}`]),
    ]);
  };

  const body = el("div", { class: "hand-body" });
  const columns = layout.columns.map((entry) =>
    el("div", { class: `col ${entry.kind}` }, [
      el("div", { class: "head" }, [entry.name]),
      ...entry.positions.map((position) => cell(position)),
    ]),
  );

  const thumb = el("div", { class: "thumb" });
  if (layout.stick) {
    // The measured mapping is directional, so it is drawn directionally: each cell is a
    // physical push, and its label is the direction the firmware reported for it.
    const dial = el("div", { class: "stick-dial" });
    for (const direction of STICK_DIRECTIONS) {
      const mapped = capture.stick[direction];
      const active = isActive && prompt.direction === direction;
      const cell = el("div", {
        class: `dir ${direction}${mapped ? " done" : ""}${active ? " active" : ""}`,
      });
      cell.append(el("span", { class: "glyph" }, [DIR_GLYPH[direction] ?? ""]));
      cell.append(el("span", { class: "pin" }, [mapped ?? ""]));
      dial.append(cell);
    }
    const pressPin = layout.stickPress === null ? undefined : capture.pins[layout.stickPress];
    const pressActive = isActive && prompt.position === layout.stickPress;
    dial.append(
      el(
        "div",
        {
          class: `dir hub${pressPin === undefined ? "" : " done"}${pressActive ? " active" : ""}`,
        },
        [
          el("span", { class: "pos" }, [positionLabel(layout.stickPress ?? "stick")]),
          el("span", { class: "pin" }, [
            pressPin === undefined ? "click" : `pin ${String(pressPin)}`,
          ]),
        ],
      ),
    );
    thumb.append(dial);
  }
  for (const [position, css] of layout.dpad) thumb.append(cell(position, css));
  thumb.append(
    el(
      "div",
      { class: "aux" },
      layout.aux.map((position) => cell(position)),
    ),
  );

  const thumbBlock = el("div", {}, [el("div", { class: "head" }, ["thumb"]), thumb]);
  if (layout.thumbSide === "left") body.append(thumbBlock, ...columns);
  else body.append(...columns, thumbBlock);

  const done = Object.keys(capture.pins).length;
  const total = Object.keys(device.positions).length - (layout.stick ? 1 : 0);
  const wrap = el("div", { class: `hand ${isActive ? "active-hand" : ""}` }, [
    el("div", { class: "hand-title" }, [
      el("b", {}, [`${unitLabel(unit.hand)} unit`]),
      el("span", {}, [`${String(done)} of ${String(total)} captured`]),
      isActive ? el("span", { class: "badge" }, ["testing this one"]) : el("span", {}),
    ]),
    body,
  ]);
  if (!isActive) {
    wrap.addEventListener("click", () => {
      state.unitIndex = unitIndex;
      state.step = 0;
      state.message = null;
      clearBurst();
      render();
    });
  }
  return wrap;
}

function renderZero(): HTMLElement {
  const panel = el("div", { class: "panel" });
  const capture = captureFor(currentUnit().hand);
  const sectors = capture.sectors ?? {};
  panel.append(el("h2", {}, ["Stick zero"]));
  panel.append(
    el("div", { class: "note" }, [
      "Import dist/probe/probe-2-stick-zero.json onto this unit first. It binds all eight " +
        "sectors, so each push reports where the firmware thinks the stick is pointing.",
    ]),
  );

  const table = el("div", { class: "zero-grid" });
  for (const push of PHYSICAL_PUSHES) {
    const reported = sectors[push.id];
    const active = PHYSICAL_PUSHES[state.zeroStep]?.id === push.id;
    const cell = el("div", {
      class: ["cell", active ? "active" : "", reported ? "done" : ""].filter(Boolean).join(" "),
    });
    cell.append(el("span", { class: "pos" }, [push.id.replace(/_/g, "-")]));
    cell.append(el("span", { class: "pin" }, [reported ?? ""]));
    table.append(cell);
  }
  panel.append(table);

  const zero = stickZeroFrom(sectors);
  if (zero.samples > 0) {
    panel.append(el("h2", {}, ["Measured"]));
    panel.append(
      el("div", { class: "note" }, [
        zero.offsetDegrees === 0
          ? "Zero is where the software assumes it is: pushing away reports 'up'."
          : `The firmware's sectors sit ${String(zero.offsetDegrees)}deg from the unit. ` +
            `Pushing ${String(zero.zeroPush)} is what it reports as 'up'.`,
      ]),
    );
    panel.append(
      el("div", { class: "note" }, [
        `${String(zero.agreement)} of ${String(zero.samples)} pushes agree on that rotation.`,
      ]),
    );
    if (zero.offsetDegrees !== 0) {
      panel.append(
        el("div", { class: "note" }, [
          `Suggested: stick_angle: ${String(zero.offsetDegrees)} on this device. The units ` +
            "of analogSettings.angle are unverified -- set it, rebuild, and run this pass " +
            "again to confirm the cardinals line up.",
        ]),
      );
    }
  }
  return panel;
}

function renderSummary(): HTMLElement {
  const panel = el("div", { class: "panel" });
  panel.append(el("h2", {}, ["Captured"]));

  for (const unit of state.payload.units) {
    const capture = state.captured[unit.hand];
    const count = capture ? Object.keys(capture.pins).length : 0;
    const row = el("div", { class: "summary-row" });
    row.append(
      el("b", {}, [`${unitLabel(unit.hand)} unit`]),
      el("span", {}, [`${String(count)} captured`]),
    );
    const button = el("button", { class: "btn", type: "button" }, [
      saveDevice === null ? "Download its map" : "Save its map",
    ]);
    button.addEventListener("click", () => {
      exportDevice(unit.hand);
    });
    if (count === 0) button.setAttribute("disabled", "disabled");
    row.append(button);
    panel.append(row);

    const assumed = state.payload.devices[unit.device];
    if (assumed && count > 0) {
      const notes = probeDiff(assumed, resultFor(unit.hand)).filter(
        (note) => !note.includes("never fired"),
      );
      if (notes.length > 0) {
        panel.append(el("div", { class: "head" }, ["differs from the assumed map"]));
        for (const note of notes.slice(0, 12)) {
          panel.append(el("div", { class: "note" }, [note]));
        }
      }
    }
  }

  const both = state.payload.units.every(
    (unit) => Object.keys(state.captured[unit.hand]?.pins ?? {}).length > 0,
  );
  if (both) {
    const [first, second] = state.payload.units;
    if (first && second) {
      const a = captureFor(first.hand).pins;
      const b = captureFor(second.hand).pins;
      const differing = Object.keys(a).filter(
        (position) => b[position] !== undefined && b[position] !== a[position],
      );
      panel.append(el("h2", {}, ["Left vs right"]));
      panel.append(
        el("div", { class: "note" }, [
          differing.length === 0
            ? "Every position captured on both units reports the same pin."
            : `${String(differing.length)} position(s) report different pins: ${differing.map(positionLabel).join(", ")}`,
        ]),
      );
    }
  }
  return panel;
}

let mountPoint: HTMLElement | null = null;

/**
 * Where a measured device map goes when there is somewhere better than Downloads.
 *
 * The editor sets this when it is served, so the map lands in `devices/` directly instead
 * of as a timestamped file to rename and copy over by hand.
 */
let saveDevice: ((path: string, content: string) => void) | null = null;

/** The key the probe profile binds to whatever is being asked for. */
function expectedKey(): string | null {
  if (state.mode === "zero") {
    const push = PHYSICAL_PUSHES[state.zeroStep];
    if (!push) return null;
    return state.payload.stickAssignments.find((entry) => entry.sector === push.id)?.key ?? null;
  }
  const prompt = currentPrompt();
  if (prompt.direction) {
    return (
      state.payload.assignments.find(
        (entry) => entry.kind === "stick" && entry.direction === prompt.direction,
      )?.key ?? null
    );
  }
  if (prompt.position === null) return null;
  const device = deviceOf(currentUnit().device);
  const pin = device.positions[prompt.position]?.pin;
  if (pin === undefined) return null;
  return (
    state.payload.assignments.find((entry) => entry.kind === "button" && entry.pin === pin)?.key ??
    null
  );
}

function render(): void {
  const root = mountPoint;
  if (!root) return;
  root.replaceChildren();

  // A toolbar, not a <header>: inside the editor a header picked up the editor's own --
  // sticky, full-width -- and sat over the page as a second one.
  const header = el("div", { class: "probe-bar" });
  header.append(el("h2", {}, ["Press test"]));
  const unitSelect = el("select", {});
  state.payload.units.forEach((unit, index) => {
    const option = el("option", { value: String(index) }, [`${unitLabel(unit.hand)} unit`]);
    if (index === state.unitIndex) option.setAttribute("selected", "selected");
    unitSelect.append(option);
  });
  unitSelect.addEventListener("change", () => {
    state.unitIndex = Number(unitSelect.value);
    state.step = 0;
    state.message = null;
    clearBurst();
    render();
  });
  header.append(unitSelect);

  for (const mode of ["pins", "zero"] as Mode[]) {
    const button = el(
      "button",
      { class: `btn ${state.mode === mode ? "on" : ""}`, type: "button" },
      [mode === "pins" ? "Pins" : "Stick zero"],
    );
    button.addEventListener("click", () => {
      state.mode = mode;
      state.message = null;
      state.burstNote = null;
      clearBurst();
      render();
    });
    header.append(button);
  }
  header.append(el("span", { class: "spacer" }));

  const back = el("button", { class: "btn", type: "button" }, ["Back"]);
  back.addEventListener("click", () => {
    if (state.mode === "zero") state.zeroStep = Math.max(0, state.zeroStep - 1);
    else state.step = Math.max(0, state.step - 1);
    render();
  });
  const skip = el("button", { class: "btn", type: "button" }, ["Skip"]);
  skip.addEventListener("click", () => {
    if (state.mode === "zero") {
      state.zeroStep = Math.min(PHYSICAL_PUSHES.length, state.zeroStep + 1);
    } else {
      state.step = Math.min(totalSteps(), state.step + 1);
    }
    render();
  });
  const restart = el("button", { class: "btn", type: "button" }, ["Restart this unit"]);
  restart.addEventListener("click", () => {
    state.captured[currentUnit().hand] = { pins: {}, stick: {}, sectors: {} };
    state.step = 0;
    state.zeroStep = 0;
    state.burstNote = null;
    clearBurst();
    save();
    render();
  });
  header.append(back, skip, restart);
  root.append(header);

  const banner = el("div", { class: "prompt" });
  if (state.mode === "zero") {
    const push = PHYSICAL_PUSHES[state.zeroStep];
    if (push) {
      banner.append(
        el("b", {}, [push.prompt]),
        el("span", {}, [`${String(state.zeroStep + 1)} / ${String(PHYSICAL_PUSHES.length)}`]),
      );
    } else {
      banner.append(el("b", {}, ["Zero measured."]), el("span", {}, ["Export the map below."]));
    }
  } else {
    const prompt = currentPrompt();
    if (state.step >= totalSteps()) {
      banner.append(el("b", {}, ["Done."]), el("span", {}, ["Export the map below."]));
    } else {
      banner.append(
        el("b", {}, [prompt.direction ? STICK_PROMPTS[prompt.direction] : `Press ${prompt.label}`]),
        el("span", {}, [`${String(state.step + 1)} / ${String(totalSteps())}`]),
      );
    }
  }
  const sampling = Object.values(state.burstVotes).reduce((sum, count) => sum + count, 0);
  const expected = expectedKey();
  if (expected !== null) {
    banner.append(el("span", { class: "muted" }, [`expecting ${expected}`]));
  }
  if (state.lastKey !== null) {
    banner.append(el("span", { class: "muted" }, [`last key seen: ${state.lastKey}`]));
  }
  if (state.message) banner.append(el("span", { class: "bad" }, [state.message]));
  else if (sampling > 0)
    banner.append(
      el("span", { class: "muted sampling" }, [
        `sampling... ${String(sampling)} reading(s), hold it`,
      ]),
    );
  else if (state.burstNote)
    banner.append(el("span", { class: "muted read" }, [`read ${state.burstNote}`]));
  root.append(banner);

  const workspace = el("div", { class: "workspace" });
  if (state.mode === "zero") {
    workspace.append(renderZero());
  } else {
    // Both units stay on screen; the one being pressed is the bright one, and clicking
    // the other switches to it.
    const stage = el("div", { class: "stage" });
    state.payload.units.forEach((_unit, index) => {
      stage.append(renderDiagram(index));
    });
    workspace.append(stage);
  }
  workspace.append(renderSummary());
  root.append(workspace);
}

/** Mount the press test into a container. Exported so tests can drive it directly. */
export function start(
  payload = window.AZERON_PROBE,
  root?: HTMLElement,
  options: { save?: (path: string, content: string) => void } = {},
): void {
  if (!payload) throw new Error("no probe payload embedded in the page");
  saveDevice = options.save ?? null;
  if (!document.getElementById("azeron-probe-styles")) {
    const style = document.createElement("style");
    style.id = "azeron-probe-styles";
    style.textContent = PROBE_CSS;
    document.head.append(style);
  }
  mountPoint = root ?? document.getElementById("app");
  mountPoint?.classList.add("probe");

  state = {
    payload,
    mode: "pins",
    unitIndex: 0,
    step: 0,
    zeroStep: 0,
    captured: restore(),
    lastKey: null,
    message: null,
    burstVotes: {},
    burstTimer: null,
    burstNote: null,
    lockUntil: 0,
  };
  document.removeEventListener("keydown", onKey);
  document.addEventListener("keydown", onKey);
  render();
}

/** Stop capturing keys; used when the editor switches away from the press test. */
export function stop(): void {
  document.removeEventListener("keydown", onKey);
  clearBurst();
  mountPoint = null;
  saveDevice = null;
}
