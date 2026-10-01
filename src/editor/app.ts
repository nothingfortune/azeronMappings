/**
 * The side-by-side profile editor.
 *
 * Imports the same compiler, linter and YAML writer as the CLI, so the page and
 * `azeron build` produce identical output from identical input.
 */

import { renderCheatsheet } from "../lib/cheatsheet.js";
import { compileProfile, dumps } from "../lib/compile.js";
import { dumpProfile } from "../lib/decompile.js";
import { formatFinding, lintProfiles, ROLE_TAGS } from "../lib/lint.js";
import type { Finding } from "../lib/lint.js";
import { handLayout, positionLabel, unitLabel, whereLabel } from "../lib/layout.js";
import { applyMode, detectMode } from "../lib/stickmodes.js";
import type { StickModeSet } from "../lib/stickmodes.js";
import { describeDirection } from "../lib/binding.js";
import type { BindingChange } from "../lib/actionfile.js";
import { ueKeyFor } from "../lib/ingame.js";
import { bindingLabel, isModifier, keyLabel } from "../lib/keys.js";
import { ActionSet, Device, Profile } from "../lib/model-core.js";
import {
  DEFAULT_DOUBLE_DELAY,
  DEFAULT_FEATURE_DELAY,
  SLOTS,
  STICK_DIRECTIONS,
  STICK_MODE_CODES,
} from "../types/azeron.js";
import type { Slot } from "../types/azeron.js";
import type { EditorGame, EditorPayload } from "../types/editor.js";
import type { ActionSpec, PositionSpec, ProfileData } from "../types/profile.js";
import { messageOf, removeKey } from "../lib/object.js";
import { dumpYaml } from "../lib/yaml.js";
import { AZERON_PRODUCT_ID, alreadyGranted, hex4, requestUnits } from "../lib/hid.js";
import type { DetectionState, HidLike } from "../lib/hid.js";
import { buildProbeProfile, buildStickCalibrationProfile } from "../lib/probe.js";
import type { ProbePayload } from "../types/probe.js";
import { start as startProbe, stop as stopProbe } from "./probe.js";
import { CSS } from "./styles.js";

declare global {
  interface Window {
    AZERON_PAYLOAD?: EditorPayload;
  }
}

type Mode = "edit" | "in-game" | "press-test" | "sheet" | "repo";

interface State {
  payload: EditorPayload;
  mode: Mode;
  /**
   * Working copy of the game's action vocabulary -- the in-game half of the mapping.
   * Editing a key here re-runs the linter, so a collision shows up immediately.
   */
  workingActions: Record<string, ActionSpec> | null;
  gameIndex: number;
  setName: string;
  /** Working copies, keyed by profile slug. Edits live here until exported. */
  working: Map<string, ProfileData>;
  selected: { slug: string; position: string } | null;
  slot: Slot;
}

/** What each slot is called on screen -- the Azeron app says long press, not `long`. */
const SLOT_NAMES: Record<Slot, string> = {
  tap: "Tap",
  long: "Long press",
  double: "Double tap",
};

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

const PROBE_ID = "7c3f5f2e-2a3b-4c21-9b7d-0d2f6a1c4e88";
const PROBE_STICK_ID = "b41d9a06-5f8e-4a77-9c15-3e6b2d4f8a19";

function templateFor(game: EditorGame, profile?: Profile) {
  const path = profile?.template ?? game.template;
  const template = state.payload.templates[path];
  if (!template) throw new Error(`no template embedded for ${path}`);
  return template;
}

function probeProfiles() {
  const template = templateFor(currentGame());
  const devices = Object.values(state.payload.devices);
  const unknown = devices[0]?.unknown_pins ?? [];
  return {
    pins: buildProbeProfile(template, { id: PROBE_ID, name: "PROBE 1 pins", unknownPins: unknown }),
    stick: buildStickCalibrationProfile(template, {
      id: PROBE_STICK_ID,
      name: "PROBE 2 stick zero",
    }),
  };
}

function probePayload(): ProbePayload {
  const built = probeProfiles();
  const devices = state.payload.devices;
  return {
    generatedAt: state.payload.generatedAt,
    profileName: "PROBE 1 pins",
    devices,
    units: Object.values(devices).map((device) => ({
      hand: device.hand ?? device.device,
      device: device.device,
    })),
    assignments: built.pins.assignments,
    stickAssignments: built.stick.assignments,
  };
}

function currentGame(): EditorGame {
  const game = state.payload.games[state.gameIndex];
  if (!game) throw new Error("no game selected");
  return game;
}

function actionSetFor(game: EditorGame): ActionSet {
  if (state.workingActions === null) return new ActionSet(game.actions);
  return new ActionSet({
    actions: state.workingActions,
    ...(game.actions.duplicate_key_allowlist
      ? { duplicate_key_allowlist: game.actions.duplicate_key_allowlist }
      : {}),
  });
}

/** Clone the vocabulary on first edit, so the embedded payload stays pristine. */
function editableActions(): Record<string, ActionSpec> {
  state.workingActions ??= structuredClone(currentGame().actions.actions ?? {});
  return state.workingActions;
}

function setsOf(game: EditorGame): Map<string, string[]> {
  const sets = new Map<string, string[]>();
  for (const profile of game.profiles) {
    const key = profile.data.profile.set ?? profile.slug;
    const list = sets.get(key) ?? [];
    list.push(profile.slug);
    sets.set(key, list);
  }
  return sets;
}

function workingData(slug: string): ProfileData {
  const existing = state.working.get(slug);
  if (existing) return existing;
  const source = currentGame().profiles.find((profile) => profile.slug === slug);
  if (!source) throw new Error(`no profile ${slug}`);
  const copy = structuredClone(source.data);
  state.working.set(slug, copy);
  return copy;
}

function profileFor(slug: string): Profile {
  const game = currentGame();
  const data = workingData(slug);
  const deviceData = state.payload.devices[data.profile.device];
  if (!deviceData) throw new Error(`unknown device ${data.profile.device}`);
  const source = game.profiles.find((profile) => profile.slug === slug);
  return new Profile(data, new Device(deviceData), {
    path: source?.path ?? `${slug}.yaml`,
    game: { slug: game.slug, actions: actionSetFor(game), lintConfig: game.lintConfig },
  });
}

function slugsInSet(): string[] {
  const slugs = setsOf(currentGame()).get(state.setName) ?? [];
  return [...slugs].sort((a, b) => {
    const unit = (slug: string): number => (workingData(slug).profile.unit === "right" ? 1 : 0);
    return unit(a) - unit(b) || a.localeCompare(b);
  });
}

function roleOf(actions: ActionSet, spec: PositionSpec | undefined): string | null {
  const tap = spec?.tap;
  if (typeof tap !== "string") return null;
  const tags = actions.tags(tap);
  return ROLE_TAGS.find((tag) => tags.has(tag)) ?? null;
}

function describeSlotValue(actions: ActionSet, value: PositionSpec[Slot]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return actions.label(value);
  if ("mouse" in value && value.mouse) return `mouse ${value.mouse}`;
  if ("key" in value && value.key) return value.key;
  if ("meta" in value && value.meta) return value.meta;
  return "raw";
}

function keyCard(slug: string, position: string, extraClass = ""): HTMLElement {
  const game = currentGame();
  const actions = actionSetFor(game);
  const data = workingData(slug);
  const device = profileFor(slug).device;
  const spec = data.positions[position];
  const isStick = device.isStick(position);
  const selected =
    state.selected?.slug === slug && state.selected.position === position ? " selected" : "";

  const role = roleOf(actions, spec);
  const classes = ["key", extraClass, role ?? "", spec ? "" : "empty", selected]
    .filter(Boolean)
    .join(" ");
  const card = el("button", { class: classes, type: "button", "data-position": position });
  card.append(el("span", { class: "pos" }, [positionLabel(position)]));

  if (!spec) {
    card.classList.add("empty");
  } else if (isStick) {
    card.append(el("span", { class: "name" }, [`Stick (${spec.mode ?? "?"})`]));
    for (const direction of STICK_DIRECTIONS) {
      const value = spec.directions?.[direction];
      if (value === undefined) continue;
      const label = describeDirection((id) => actions.label(id), value) ?? "raw";
      card.append(el("span", { class: "sub" }, [`${direction}  ${label}`]));
    }
  } else {
    const tap = describeSlotValue(actions, spec.tap);
    card.append(el("span", { class: "name" }, [spec.label ?? tap ?? "—"]));
    for (const slot of SLOTS) {
      const text = describeSlotValue(actions, spec[slot]);
      if (!text) continue;
      // The label usually repeats the tap action; only the extra slots need spelling out.
      if (slot === "tap" && spec.label === undefined) continue;
      if (slot === "tap" && text === spec.label) continue;
      card.append(el("span", { class: "sub" }, [`${slot === "tap" ? "" : `${slot} `}${text}`]));
    }
    if (spec.feature_delay && (spec.long ?? spec.double)) {
      card.append(el("span", { class: "flag" }, [`waits ${String(spec.feature_delay)} ms`]));
    }
    if (spec.hold) card.append(el("span", { class: "flag" }, ["latches"]));
  }

  card.addEventListener("click", () => {
    // Back to the tap. `state.slot` only ever changed by focusing a slot's select, and
    // never reset, so a long press armed on one key stayed armed on the next one.
    if (state.selected?.slug !== slug || state.selected.position !== position) {
      state.slot = "tap";
    }
    state.selected = { slug, position };
    render();
  });
  return card;
}

const DIR_GLYPH: Record<string, string> = {
  up: "\u2191",
  right: "\u2192",
  down: "\u2193",
  left: "\u2190",
};

/** The stick as a compass: each direction sits where it points. */
function stickDial(slug: string, position: string, press: string | null): HTMLElement {
  const actions = actionSetFor(currentGame());
  const spec = workingData(slug).positions[position];
  const selected =
    state.selected?.slug === slug && state.selected.position === position ? " selected" : "";
  const dial = el("div", { class: `stick-dial${selected}` });

  const select = (): void => {
    state.selected = { slug, position };
    render();
  };

  for (const direction of STICK_DIRECTIONS) {
    const value = spec?.directions?.[direction];
    const label = describeDirection((id) => actions.label(id), value);
    const cell = el("button", {
      class: `dir ${direction}${label === null ? " empty" : ""}`,
      type: "button",
      title: `stick ${direction}`,
    });
    cell.append(el("span", { class: "glyph" }, [DIR_GLYPH[direction] ?? ""]));
    if (label !== null) cell.append(el("span", { class: "name" }, [label]));
    cell.addEventListener("click", select);
    dial.append(cell);
  }

  // The hub is the stick pressed in -- a real key -- so it selects that position.
  const pressSpec = press === null ? undefined : workingData(slug).positions[press];
  const pressLabel =
    pressSpec === undefined ? null : (pressSpec.label ?? describeSlotValue(actions, pressSpec.tap));
  const hub = el("button", {
    class: `dir hub${pressLabel === null ? " empty" : ""}`,
    type: "button",
    title: press ?? "stick",
  });
  hub.append(el("span", { class: "wheel" }));
  hub.append(el("span", { class: "name" }, [pressLabel ?? "click"]));
  hub.addEventListener("click", () => {
    state.selected = { slug, position: press ?? position };
    render();
  });
  dial.append(hub);
  return dial;
}

function renderHand(slug: string): HTMLElement {
  const profile = profileFor(slug);
  const device = profile.device;
  const data = workingData(slug);

  const wrap = el("div", { class: "hand" });
  wrap.append(
    el("div", { class: "title" }, [
      el("b", {}, [data.profile.name ?? slug]),
      el("span", {}, [`${unitLabel(data.profile.unit)} unit`]),
    ]),
  );

  const layout = handLayout(device);
  const columns = layout.columns.map((entry) =>
    el("div", { class: `col ${entry.kind}` }, [
      el("div", { class: "head" }, [entry.name]),
      ...entry.positions.map((position) => keyCard(slug, position)),
    ]),
  );

  // The thumb cluster sits under the finger columns, on the thumb's side, rather than
  // beside them. Beside them it made each hand ten keys wide, so a pair had to be shrunk
  // to under half size to fit a window and the key text came out at about five pixels.
  const groups: HTMLElement[] = [];
  if (layout.stick) {
    groups.push(
      el("div", { class: "thumb-group" }, [
        el("div", { class: "head" }, [
          `thumbstick \u00b7 ${workingData(slug).positions[layout.stick]?.mode ?? "unbound"}`,
        ]),
        stickDial(slug, layout.stick, layout.stickPress),
      ]),
    );
  }
  if (layout.dpad.length > 0) {
    const pad = el("div", { class: "dpad" });
    for (const [position, cell] of layout.dpad) pad.append(keyCard(slug, position, cell));
    groups.push(
      el("div", { class: "thumb-group" }, [el("div", { class: "head" }, ["d-pad"]), pad]),
    );
  }
  if (layout.aux.length > 0) {
    groups.push(
      el("div", { class: "thumb-group" }, [
        el("div", { class: "head" }, ["aux"]),
        el(
          "div",
          { class: "aux" },
          layout.aux.map((position) => keyCard(slug, position)),
        ),
      ]),
    );
  }

  const thumb = el("div", { class: "thumb-row" }, [
    el("div", { class: "head" }, ["thumb"]),
    el("div", { class: "thumb-cluster" }, layout.thumbSide === "left" ? groups.reverse() : groups),
  ]);
  const body = el("div", { class: `hand-body thumb-${layout.thumbSide}` }, [
    el("div", { class: "fingers" }, columns),
    thumb,
  ]);
  wrap.append(body);
  return wrap;
}

/**
 * Where a finding is, in words: "Left Pinky 1", or the key, or the whole layout.
 *
 * Findings name a profile by its id and a position by its id; the unit is the useful part
 * of the first, and the second wants its human name.
 */
function findingWhere(finding: Finding): string {
  const unit = /-(left|right)$/.exec(finding.profile ?? "")?.[1];
  if (finding.position !== undefined) {
    return unit === undefined
      ? positionLabel(finding.position)
      : whereLabel(unit, finding.position);
  }
  if (finding.key !== undefined) return keyLabel(finding.key);
  return "the whole layout";
}

function boundActions(): Map<string, string[]> {
  const bound = new Map<string, string[]>();
  const add = (action: string | undefined, where: string): void => {
    if (!action) return;
    const list = bound.get(action) ?? [];
    list.push(where);
    bound.set(action, list);
  };
  for (const slug of slugsInSet()) {
    const data = workingData(slug);
    const unit = data.profile.unit;
    for (const [position, spec] of Object.entries(data.positions)) {
      for (const slot of SLOTS) {
        const value = spec[slot];
        if (typeof value !== "string") continue;
        const suffix = slot === "tap" ? "" : ` (${SLOT_NAMES[slot].toLowerCase()})`;
        add(value, `${whereLabel(unit, position)}${suffix}`);
      }
      for (const [direction, value] of Object.entries(spec.directions ?? {})) {
        if (typeof value === "string") add(value, whereLabel(unit, position, direction));
      }
    }
  }
  return bound;
}

function stickModesFor(): StickModeSet | null {
  const genre = currentGame().rel.split("/")[1];
  const found = state.payload.genres.find((entry) => entry.name === genre);
  return found?.stickModes ?? null;
}

/**
 * Set both sticks at once.
 *
 * Which stick flies and which selects is the decision that changes a layout most and is
 * most tedious to make by hand -- eight directions across two profiles. A mode is that
 * decision as one click, and it touches nothing but the directions.
 */
function renderStickModes(): HTMLElement | null {
  // Said, rather than the panel vanishing: a missing feature and an absent one look the
  // same otherwise.
  const unavailable = (reason: string): HTMLElement =>
    el("div", { class: "panel" }, [
      el("h2", {}, ["Stick modes"]),
      el("div", { class: "note" }, [reason]),
    ]);

  const set = stickModesFor();
  if (set === null) {
    return unavailable(`No stick modes are defined for this game's genre yet.`);
  }

  const slugs = slugsInSet();
  const left = slugs.find((slug) => workingData(slug).profile.unit === "left");
  const right = slugs.find((slug) => workingData(slug).profile.unit === "right");
  if (left === undefined || right === undefined) {
    return unavailable(
      "A stick mode sets both sticks at once, so it needs a left and a right unit.",
    );
  }

  const current = detectMode(
    set,
    workingData(left).positions.stick,
    workingData(right).positions.stick,
  );

  const panel = el("div", { class: "panel" });
  panel.append(el("h2", {}, ["Stick mode"]));
  panel.append(
    el("div", { class: "note" }, [
      "Sets both sticks at once, the way an RC transmitter names its modes. Nothing but " +
        "the eight directions changes.",
    ]),
  );

  for (const [id, mode] of Object.entries(set.modes)) {
    const active = id === current;
    const row = el("button", { class: `mode-row${active ? " active" : ""}`, type: "button" });
    row.append(
      el("div", { class: "who" }, [
        el("b", {}, [mode.label + (active ? "  ·  in use" : "")]),
        el("small", {}, [mode.note ?? ""]),
      ]),
    );
    row.addEventListener("click", () => {
      for (const [slug, hand] of [
        [left, "left"],
        [right, "right"],
      ] as const) {
        const data = workingData(slug);
        data.positions.stick = applyMode(data.positions.stick, set, mode, hand);
      }
      saveNote = `${mode.label} applied to both sticks. Save changes to keep it.`;
      render();
    });
    panel.append(row);
  }
  return panel;
}

function renderPalette(): HTMLElement {
  const game = currentGame();
  const actions = actionSetFor(game);
  const bound = boundActions();
  const panel = el("div", { class: "panel" });

  const required = Object.entries(actions.actions).filter(
    ([, spec]) => (spec.tags ?? []).includes("required") && !spec.provided_by,
  );
  const missing = required.filter(([id]) => !bound.has(id));
  panel.append(
    el("h2", {}, ["Actions"]),
    el("div", { class: "field" }, [
      el("span", { class: `pill ${missing.length === 0 ? "ok" : "bad"}` }, [
        `${String(required.length - missing.length)}/${String(required.length)} required bound`,
      ]),
    ]),
  );

  // A stick holds four directions, not one action, so the palette has nowhere to write.
  // It used to accept the click and silently discard it.
  const selection = state.selected;
  const onStick =
    selection !== null && profileFor(selection.slug).device.isStick(selection.position);
  if (onStick) {
    panel.append(
      el("div", { class: "note palette-note" }, [
        "A stick is selected. Pick a direction on the dial to bind one of its four ways, " +
          "or a key to bind an action.",
      ]),
    );
  }

  const list = el("div", { class: `action-list${onStick ? " inert" : ""}` });
  const byRole = new Map<string, [string, ActionSpec][]>();
  for (const entry of Object.entries(actions.actions)) {
    const tags = new Set(entry[1].tags ?? []);
    const role = ROLE_TAGS.find((tag) => tags.has(tag)) ?? "other";
    const group = byRole.get(role) ?? [];
    group.push(entry);
    byRole.set(role, group);
  }

  for (const role of [...ROLE_TAGS, "other"]) {
    const group = byRole.get(role);
    if (!group) continue;
    list.append(el("div", { class: "head muted" }, [role]));
    for (const [id, spec] of group) {
      const where = bound.get(id);
      const button = el("button", {
        class: `action${where ? " bound" : ""}`,
        type: "button",
        title: where ? where.join(", ") : "not bound",
      });
      button.append(el("span", { class: `dot ${role}` }));
      const text = el("span", { class: "txt" });
      text.append(el("b", {}, [spec.label ?? id]));
      const detail = spec.provided_by
        ? `${spec.provided_by} · not a keypad key`
        : (where?.join(", ") ?? "unbound");
      text.append(el("small", {}, [detail]));
      button.append(text);
      if (!where && (spec.tags ?? []).includes("required") && !spec.provided_by) {
        button.append(el("span", { class: "req" }, ["req"]));
      }
      button.addEventListener("click", () => {
        assignToSelection(id);
      });
      list.append(button);
    }
  }
  panel.append(list);
  return panel;
}

/**
 * Whether there are edits that only exist in the page.
 *
 * A working copy is made the first time a profile is read, and every render reads, so
 * having one says nothing -- the page would call itself dirty the moment it drew. Each
 * copy is compared with what the page loaded instead.
 */
function isDirty(): boolean {
  const game = currentGame();
  for (const [slug, data] of state.working) {
    const source = game.profiles.find((profile) => profile.slug === slug);
    if (!source || JSON.stringify(source.data) !== JSON.stringify(data)) return true;
  }
  return (
    state.workingActions !== null &&
    JSON.stringify(state.workingActions) !== JSON.stringify(game.actions.actions ?? {})
  );
}

/** Ask before throwing edits away. Returns false when the user would rather not. */
function confirmDiscard(what: string): boolean {
  if (!isDirty()) return true;
  return window.confirm(`${what} discards edits that have not been saved. Continue?`);
}

function assignToSelection(actionId: string): void {
  const selection = state.selected;
  if (!selection) return;
  const data = workingData(selection.slug);
  const spec = (data.positions[selection.position] ??= {});
  const device = profileFor(selection.slug).device;
  if (device.isStick(selection.position)) return;
  const actions = actionSetFor(currentGame());
  spec[state.slot] = actionId;
  // The label is what the cheatsheet teaches and what is compiled onto the unit, so it
  // must not go on naming the action that used to be here -- and whatever it said, it said
  // it about that action. Rebinding the tap renames the key; a long press or a double tap
  // leaves it, because the label is the tap's. `??=` never fired at all, since every
  // shipped profile already has a label on every position.
  if (state.slot === "tap") spec.label = actions.label(actionId);
  render();
}

/** The DPI steps a unit's template offers, or none when its template is not embedded. */
function sensitivitySteps(game: EditorGame, slug: string): number[] {
  try {
    const settings = templateFor(game, profileFor(slug)).profiles[0]?.profileSettings;
    return settings?.profileSensitivitySettings?.sensitivityValues ?? [];
  } catch {
    return [];
  }
}

/**
 * Per-unit settings that are not on any key: the sensor and its DPI.
 *
 * Both units have a sensor, and two sensors on at once drive the same pointer against
 * each other -- so which one aims is a decision about the pair, made here.
 */
function renderUnitSettings(): HTMLElement {
  const box = el("div", { class: "unit-settings" });
  const game = currentGame();
  const slugs = slugsInSet();
  const on = slugs.filter((slug) => workingData(slug).profile.sensor === true).length;

  for (const slug of slugs) {
    const data = workingData(slug);
    const unit = data.profile.unit ?? slug;
    const sensor = el("input", { type: "checkbox" });
    if (data.profile.sensor === true) sensor.setAttribute("checked", "checked");
    sensor.addEventListener("change", () => {
      data.profile.sensor = sensor.checked;
      render();
    });

    const row = el("div", { class: "row2" }, [
      el("div", { class: "field" }, [el("label", {}, [`${unit} unit's sensor aims`]), sensor]),
    ]);

    const steps = sensitivitySteps(game, slug);
    if (steps.length > 0) {
      const dpi = el("select", {});
      dpi.append(el("option", { value: "" }, ["as the template has it"]));
      for (const step of steps) {
        const option = el("option", { value: String(step) }, [`${String(step)} DPI`]);
        if (data.profile.dpi === step) option.setAttribute("selected", "selected");
        dpi.append(option);
      }
      dpi.addEventListener("change", () => {
        if (dpi.value === "") removeKey(data.profile, "dpi");
        else data.profile.dpi = Number(dpi.value);
        render();
      });
      row.append(el("div", { class: "field" }, [el("label", {}, ["Sensitivity"]), dpi]));
    }
    box.append(row);
  }
  if (on > 1) {
    box.append(
      el("div", { class: "finding warning" }, [
        "Both sensors are on. They drive the same pointer, so moving either hand aims.",
      ]),
    );
  }
  return box;
}

function renderInspector(): HTMLElement {
  const panel = el("div", { class: "panel" });
  panel.append(el("h2", {}, ["Key"]));
  const selection = state.selected;
  if (!selection) {
    panel.append(el("div", { class: "empty-state" }, ["Pick a key to edit it."]));
    panel.append(renderUnitSettings());
    return panel;
  }

  const game = currentGame();
  const actions = actionSetFor(game);
  const data = workingData(selection.slug);
  const device = profileFor(selection.slug).device;
  const spec = (data.positions[selection.position] ??= {});
  const isStick = device.isStick(selection.position);

  panel.append(
    el("div", { class: "field" }, [
      el("label", {}, ["Position"]),
      el("div", {}, [
        `${unitLabel(data.profile.unit)} unit · ${positionLabel(selection.position)}`,
      ]),
    ]),
  );

  const labelInput = el("input", { type: "text", value: spec.label ?? "" });
  labelInput.addEventListener("change", () => {
    const value = labelInput.value.trim();
    if (value) spec.label = value;
    else delete spec.label;
    render();
  });
  panel.append(el("div", { class: "field" }, [el("label", {}, ["Label"]), labelInput]));

  if (isStick) {
    const modeSelect = el("select", {});
    const current = spec.mode ?? "keyboard";
    for (const mode of new Set([current, ...Object.keys(STICK_MODE_CODES)])) {
      const encodable = mode in STICK_MODE_CODES;
      const option = el("option", { value: mode }, [
        encodable ? mode : `${mode} -- not allowed, pick keyboard`,
      ]);
      if (mode === current) option.setAttribute("selected", "selected");
      if (!encodable) option.setAttribute("disabled", "disabled");
      modeSelect.append(option);
    }
    modeSelect.addEventListener("change", () => {
      spec.mode = modeSelect.value;
      render();
    });
    panel.append(
      el("div", { class: "field" }, [el("label", {}, ["Stick sends"]), modeSelect]),
      el("div", { class: "note" }, [
        "Keyboard only: gamepad mode made Everspace 2 flip between input devices and stutter.",
      ]),
    );
    for (const direction of STICK_DIRECTIONS) {
      const select = el("select", {});
      select.append(el("option", { value: "" }, ["— none —"]));
      for (const [id, action] of Object.entries(actions.actions)) {
        if (action.provided_by) continue;
        const option = el("option", { value: id }, [action.label ?? id]);
        if (spec.directions?.[direction] === id) option.setAttribute("selected", "selected");
        select.append(option);
      }
      select.addEventListener("change", () => {
        spec.directions ??= {};
        if (select.value) spec.directions[direction] = select.value;
        else removeKey(spec.directions, direction);
        render();
      });
      panel.append(
        el("div", { class: "field" }, [el("label", {}, [`Stick ${direction}`]), select]),
      );
    }
  } else {
    for (const slot of SLOTS) {
      const select = el("select", {});
      select.append(el("option", { value: "" }, ["— none —"]));
      for (const [id, action] of Object.entries(actions.actions)) {
        if (action.provided_by) continue;
        const option = el("option", { value: id }, [action.label ?? id]);
        if (spec[slot] === id) option.setAttribute("selected", "selected");
        select.append(option);
      }
      select.addEventListener("change", () => {
        if (select.value) spec[slot] = select.value;
        else removeKey(spec, slot);
        render();
      });
      const wrap = el("div", { class: "field" }, [el("label", {}, [SLOT_NAMES[slot]]), select]);
      if (slot === state.slot) wrap.setAttribute("data-active", "true");
      select.addEventListener("focus", () => {
        state.slot = slot;
        for (const field of panel.querySelectorAll(".field[data-active]")) {
          field.removeAttribute("data-active");
        }
        wrap.setAttribute("data-active", "true");
      });
      panel.append(wrap);
    }

    const delays = el("div", { class: "row2" });
    const delayFields = [
      ["feature_delay", "Long-press wait (ms)", DEFAULT_FEATURE_DELAY],
      ["double_delay", "Double-tap wait (ms)", DEFAULT_DOUBLE_DELAY],
    ] as const;
    for (const [field, name, fallback] of delayFields) {
      const input = el("input", {
        type: "number",
        value: String(spec[field] ?? ""),
        placeholder: String(fallback),
      });
      input.addEventListener("change", () => {
        const value = Number(input.value);
        if (input.value === "" || Number.isNaN(value)) removeKey(spec, field);
        else spec[field] = value;
        render();
      });
      delays.append(el("div", { class: "field" }, [el("label", {}, [name]), input]));
    }
    panel.append(delays);

    const hold = el("input", { type: "checkbox" });
    if (spec.hold) hold.setAttribute("checked", "checked");
    hold.addEventListener("change", () => {
      if (hold.checked) spec.hold = true;
      else removeKey(spec, "hold");
      render();
    });
    panel.append(
      el("div", { class: "field" }, [el("label", {}, ["Latch until pressed again"]), hold]),
    );

    // Repeat while held. A repeated key is down part of the time, so for an action the game
    // reads as on or off it averages to part power -- the pulsed-thrust experiment.
    const turbo = el("input", { type: "checkbox" });
    if (spec.turbo) turbo.setAttribute("checked", "checked");
    turbo.addEventListener("change", () => {
      if (turbo.checked) spec.turbo = true;
      else {
        removeKey(spec, "turbo");
        removeKey(spec, "turbo_interval");
      }
      render();
    });
    const repeat = el("div", { class: "row2" }, [
      el("div", { class: "field" }, [el("label", {}, ["Repeat the tap while held"]), turbo]),
    ]);
    if (spec.turbo) {
      const interval = el("input", {
        type: "number",
        value: String(spec.turbo_interval ?? ""),
        placeholder: "app default",
      });
      interval.addEventListener("change", () => {
        const value = Number(interval.value);
        if (interval.value === "" || Number.isNaN(value)) removeKey(spec, "turbo_interval");
        else spec.turbo_interval = value;
        render();
      });
      repeat.append(el("div", { class: "field" }, [el("label", {}, ["Every (ms)"]), interval]));
    }
    panel.append(repeat);
    if (spec.turbo_long || spec.turbo_double) {
      panel.append(
        el("div", { class: "note" }, [
          "The long press or double tap also repeats; that is kept, and only editable in the YAML.",
        ]),
      );
    }
  }

  const clear = el("button", { class: "btn", type: "button" }, ["Clear this key"]);
  clear.addEventListener("click", () => {
    removeKey(data.positions, selection.position);
    render();
  });
  panel.append(clear);
  return panel;
}

function renderChecks(): HTMLElement {
  const game = currentGame();
  const panel = el("div", { class: "panel" });
  panel.append(el("h2", {}, ["Checks"]));

  const profiles = slugsInSet().map((slug) => profileFor(slug));
  let result;
  try {
    result = lintProfiles(actionSetFor(game), profiles, game.lintConfig);
  } catch (error) {
    panel.append(el("div", { class: "finding error" }, [messageOf(error)]));
    return panel;
  }

  // Stale acknowledgements are notes, not problems -- but `lint --strict` fails on them,
  // so hiding them let the page read "Clean" on a tree the gate would reject.
  const stale = result.live.filter((finding: Finding) => finding.rule === "stale-acknowledgement");
  const live = result.live.filter((finding: Finding) => finding.rule !== "stale-acknowledgement");
  const box = el("div", { class: "checks" });
  if (live.length === 0) {
    box.append(
      el("div", { class: "finding" }, [
        `Clean. ${String(result.acknowledged.length)} acknowledged finding(s) in game.yaml.`,
      ]),
    );
  }
  for (const finding of [...live, ...stale]) {
    const item = el("div", { class: `finding ${finding.level}` });
    item.append(
      el("b", {}, [findingWhere(finding)]),
      el("small", { class: "rule" }, [finding.rule]),
    );
    item.append(document.createTextNode(finding.message));
    box.append(item);
  }
  panel.append(box);
  panel.append(
    el("div", { class: "field muted" }, [
      el("small", {}, [
        canSave()
          ? "Same rules as `azeron lint`. Saving runs them and rebuilds."
          : "Same rules as `azeron lint`. Run it after copying the YAML back into the repo.",
      ]),
    ]),
  );
  return panel;
}

/**
 * Whether this page can write back into the repo.
 *
 * Set by `azeron serve`, which is what actually backs the save API. Sniffing the
 * protocol would claim the same of a static file served by any web server, and the
 * buttons would then silently do nothing.
 */
function canSave(): boolean {
  return (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED === true;
}

let saveNote: string | null = null;

/** The press test's own element, kept across renders so its progress survives them. */
let probeHost: HTMLElement | null = null;

/** What the server said about a save, beyond the headline. Cleared by the next save. */
let saveReport: HTMLElement | null = null;

interface SaveResponse {
  ok: boolean;
  error?: string;
  check?:
    | {
        game: string | null;
        built: { output: string; importPath: string; mirroredTo?: string; changed: boolean }[];
        findings: Finding[];
        buildErrors: string[];
      }
    | { error: string };
}

/**
 * The verdict, laid out so the first thing read is whether the file landed.
 *
 * A save is written before it is checked, so a lint error never means the file is not
 * there -- it used to arrive as one line of every game's errors joined together, which
 * said neither.
 */
function reportSave(path: string, result: SaveResponse, also: readonly string[] = []): HTMLElement {
  const box = el("div", { class: "save-report" });
  const check = result.check;
  const saved = [...also, path].join(" and ");
  if (!check || "error" in check) {
    box.append(
      el("div", {}, [`Saved ${saved}, but checking it failed: ${check?.error ?? "no reply"}`]),
    );
    return box;
  }
  const changed = check.built.filter((entry) => entry.changed);
  box.append(el("div", {}, [`Saved ${saved}.`]));
  if (changed.length > 0) {
    box.append(el("div", {}, ["Import in the Azeron app, then write it to the unit:"]));
    for (const entry of changed) {
      const row = el("div", { class: "import-path" }, [el("code", {}, [entry.importPath])]);
      if (entry.mirroredTo) row.append(el("small", {}, [` also copied to ${entry.mirroredTo}`]));
      box.append(row);
    }
  } else {
    box.append(
      el("div", { class: "muted" }, ["Nothing to re-import: the compiled file is unchanged."]),
    );
  }
  for (const message of check.buildErrors) {
    box.append(el("div", { class: "finding error" }, [`build: ${message}`]));
  }
  if (check.findings.length === 0) {
    box.append(el("div", { class: "finding" }, ["Lint clean."]));
  }
  for (const finding of check.findings) {
    const item = el("div", { class: `finding ${finding.level}` });
    item.append(
      el("b", {}, [findingWhere(finding)]),
      el("small", { class: "rule" }, [finding.rule]),
    );
    item.append(document.createTextNode(finding.message));
    box.append(item);
  }
  return box;
}

async function saveToRepo(
  path: string,
  content: string,
  onSaved: () => void = () => undefined,
): Promise<void> {
  saveNote = `saving ${path}...`;
  saveReport = null;
  render();
  try {
    const response = await fetch("/api/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
    const result = (await response.json()) as SaveResponse;
    if (result.ok) {
      saveNote = null;
      saveReport = reportSave(path, result);
      onSaved();
    } else {
      saveNote = `not saved: ${result.error ?? "the server refused it"}`;
    }
  } catch (error) {
    saveNote = `not saved -- could not reach the server: ${messageOf(error)}`;
  }
  render();
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

/**
 * Save the in-game keys that changed, and only those.
 *
 * The server patches each action's line in place, so actions.yaml keeps its `extends:`,
 * its allowlist and its comments. Regenerating it lost all three.
 */
async function saveActionKeys(game: EditorGame): Promise<void> {
  const loaded = game.actions.actions ?? {};
  const edited = state.workingActions ?? {};
  const changes: Record<string, BindingChange> = {};
  for (const [id, spec] of Object.entries(edited)) {
    const before = loaded[id] ?? {};
    const change: BindingChange = {};
    for (const field of ["key", "meta", "mouse"] as const) {
      if ((spec[field] ?? null) !== (before[field] ?? null)) change[field] = spec[field] ?? null;
    }
    if (Object.keys(change).length > 0) changes[id] = change;
  }
  if (Object.keys(changes).length === 0) {
    saveNote = "Nothing to save: no in-game key has changed.";
    saveReport = null;
    render();
    return;
  }
  const path = `${game.rel}/actions.yaml`;
  saveNote = `saving ${path}...`;
  saveReport = null;
  render();
  try {
    const result = await post<SaveResponse>("/api/actions", { game: game.slug, changes });
    if (result.ok) {
      saveNote = null;
      saveReport = reportSave(path, result);
      saveReport.append(
        el("div", {}, [
          "The game does not know yet. Apply it from the Repo tab with the game closed.",
        ]),
      );
      game.actions.actions = structuredClone(edited);
    } else {
      saveNote = `not saved: ${result.error ?? "the server refused it"}`;
    }
  } catch (error) {
    saveNote = `not saved -- could not reach the server: ${messageOf(error)}`;
  }
  render();
}

function exportYaml(slug: string): void {
  // No header: the server keeps whatever the file already had.
  const yaml = dumpProfile(workingData(slug), "");
  const source = currentGame().profiles.find((profile) => profile.slug === slug);
  if (canSave() && source) {
    const saved = structuredClone(workingData(slug));
    void saveToRepo(source.path, yaml, () => {
      source.data = saved;
    });
    return;
  }
  download(`${slug}.yaml`, yaml, "text/yaml");
}

/** Whether one unit has edits the page has not saved. */
function unitIsDirty(slug: string): boolean {
  const working = state.working.get(slug);
  if (!working) return false;
  const source = currentGame().profiles.find((profile) => profile.slug === slug);
  return !source || JSON.stringify(source.data) !== JSON.stringify(working);
}

/**
 * Save every unit that has changed, as one save.
 *
 * The header had a Save and a Download per unit -- four buttons for a pair -- and the
 * Download was the one drawn as the main action. One Save now covers the pair. Each file
 * is written and checked in turn; the report names them together, and the import paths
 * are every file that changed. The check is per game, so the last one speaks for both.
 */
async function saveChanged(): Promise<void> {
  const changed = slugsInSet().filter(unitIsDirty);
  if (changed.length === 0) return;
  saveNote = "saving...";
  saveReport = null;
  render();
  const saved: string[] = [];
  const built = new Map<
    string,
    { output: string; importPath: string; mirroredTo?: string; changed: boolean }
  >();
  let last: SaveResponse | null = null;
  try {
    for (const slug of changed) {
      const source = currentGame().profiles.find((profile) => profile.slug === slug);
      if (!source) continue;
      const data = structuredClone(workingData(slug));
      const result = await post<SaveResponse>("/api/save", {
        path: source.path,
        content: dumpProfile(data, ""),
      });
      if (!result.ok) {
        saveNote = `not saved: ${source.path} -- ${result.error ?? "the server refused it"}`;
        render();
        return;
      }
      source.data = data;
      saved.push(source.path);
      last = result;
      const check = result.check;
      if (check && !("error" in check)) {
        for (const entry of check.built) if (entry.changed) built.set(entry.output, entry);
      }
    }
  } catch (error) {
    saveNote = `not saved -- could not reach the server: ${messageOf(error)}`;
    render();
    return;
  }
  const path = saved.pop();
  if (last === null || path === undefined) return;
  const check = last.check;
  // Every file that changed across the saves, not only the last one's.
  const merged: SaveResponse =
    check && !("error" in check)
      ? { ...last, check: { ...check, built: [...built.values()] } }
      : last;
  saveNote = null;
  saveReport = reportSave(path, merged, saved);
  render();
}

/** Every unit's import file, for the Azeron app -- the main output when nothing can save. */
function downloadAll(): void {
  for (const slug of slugsInSet()) exportJson(slug);
}

function exportJson(slug: string): void {
  const game = currentGame();
  const profile = profileFor(slug);
  const templatePath = profile.template ?? game.template;
  const template = state.payload.templates[templatePath];
  if (!template) {
    window.alert(`No template embedded for ${templatePath}. Re-run \`azeron editor\`.`);
    return;
  }
  const doc = compileProfile(profile, { template, actions: actionSetFor(game).actions });
  download(profile.outputName, dumps(doc), "application/json");
}

function renderHeader(): HTMLElement {
  const header = el("header");
  header.append(el("h1", {}, ["Azeron profile editor"]));

  const gameSelect = el("select", {});
  state.payload.games.forEach((game, index) => {
    const option = el("option", { value: String(index) }, [game.name]);
    if (index === state.gameIndex) option.setAttribute("selected", "selected");
    gameSelect.append(option);
  });
  gameSelect.addEventListener("change", () => {
    if (!confirmDiscard("Switching game")) {
      gameSelect.value = String(state.gameIndex);
      return;
    }
    state.gameIndex = Number(gameSelect.value);
    state.working.clear();
    state.selected = null;
    state.setName = [...setsOf(currentGame()).keys()][0] ?? "";
    render();
  });
  const tabs = el("div", { class: "tabs" });
  for (const mode of ["edit", "in-game", "press-test", "sheet", "repo"] as Mode[]) {
    const names: Record<Mode, string> = {
      edit: "Edit",
      "in-game": "In-game",
      "press-test": "Press test",
      sheet: "Sheet",
      repo: "Repo",
    };
    const tab = el(
      "button",
      { class: `btn ${state.mode === mode ? "primary" : ""}`, type: "button" },
      [names[mode]],
    );
    tab.addEventListener("click", () => {
      if (state.mode === "press-test" && mode !== "press-test") {
        stopProbe();
        probeHost = null;
      }
      state.mode = mode;
      render();
    });
    tabs.append(tab);
  }
  header.append(tabs);

  // Labelled: a bare "Everspace 2" beside a bare "akimbo-v10" said nothing about which
  // was which, and "set" is this repo's word, not the user's.
  header.append(el("label", { class: "picker" }, [el("span", {}, ["Game"]), gameSelect]));

  const setSelect = el("select", {});
  for (const name of setsOf(currentGame()).keys()) {
    const option = el("option", { value: name }, [name]);
    if (name === state.setName) option.setAttribute("selected", "selected");
    setSelect.append(option);
  }
  setSelect.addEventListener("change", () => {
    state.setName = setSelect.value;
    state.selected = null;
    render();
  });
  header.append(
    el("label", { class: "picker" }, [el("span", {}, ["Layout (both hands)"]), setSelect]),
  );
  header.append(el("span", { class: "spacer" }));

  header.append(
    el("span", { class: `pill ${canSave() ? "ok" : ""}` }, [
      canSave() ? "saves to repo" : "downloads only",
    ]),
  );

  // One main action. Served, that is saving -- it rebuilds and says what to import, and it
  // reads Saved when there is nothing to save, which is the page's unsaved marker. Opened
  // as a file there is nowhere to save to, so the main action is the import files.
  if (canSave()) {
    const dirty = slugsInSet().some(unitIsDirty);
    const save = el("button", { class: `btn primary${dirty ? " dirty" : ""}`, type: "button" }, [
      dirty ? "Save changes" : "Saved",
    ]);
    if (!dirty) save.setAttribute("disabled", "disabled");
    save.addEventListener("click", () => {
      void saveChanged();
    });
    header.append(save);
  } else {
    const get = el("button", { class: "btn primary", type: "button" }, ["Download for the app"]);
    get.addEventListener("click", downloadAll);
    header.append(get);
  }

  // Everything else is occasional, and lives behind one button.
  const items = el("div", { class: "menu-items" });
  const item = (label: string, action: () => void): void => {
    const button = el("button", { class: "menu-item", type: "button" }, [label]);
    button.addEventListener("click", () => {
      menu.removeAttribute("open");
      action();
    });
    items.append(button);
  };
  for (const slug of slugsInSet()) {
    const unit = unitLabel(workingData(slug).profile.unit);
    item(`Download ${unit.toLowerCase()} unit's import file`, () => {
      exportJson(slug);
    });
    if (!canSave()) {
      item(`Download ${unit.toLowerCase()} unit's YAML`, () => {
        exportYaml(slug);
      });
    }
  }
  item("Undo all unsaved edits", () => {
    if (!confirmDiscard("Undoing them")) return;
    state.working.clear();
    state.selected = null;
    render();
  });

  const picker = el("input", { type: "file", accept: "application/json,.json" });
  picker.style.display = "none";
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        const text = typeof reader.result === "string" ? reader.result : "";
        const next = JSON.parse(text) as EditorPayload;
        if (!Array.isArray(next.games)) throw new Error("not an editor payload");
        start(next);
      } catch (error) {
        window.alert(`Could not read that file: ${messageOf(error)}`);
      }
    });
    reader.readAsText(file);
  });
  item("Open a data file…", () => {
    picker.click();
  });
  item("Switch light / dark", () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  });

  const menu = el("details", { class: "menu" }, [
    el("summary", { class: "btn", title: "More" }, ["⋯"]),
    items,
  ]);
  header.append(menu, picker);
  return header;
}

/** The action whose key is being captured, if any. One at a time, page-wide. */
let capturing: string | null = null;

/** Why the last capture was refused, shown on that action's row until the next one. */
let captureProblem: { id: string; message: string } | null = null;

const MOUSE_BY_BUTTON: Record<number, string> = { 0: "left", 1: "middle", 2: "right" };

/**
 * Set an action's in-game binding from what was pressed.
 *
 * A modifier on its own is stored as `meta` -- the way boost is on Left Shift -- and
 * anything else as `key`; a mouse button replaces both. The game cannot be told about
 * every key, so one it has no name for is refused here rather than written into a file
 * the game would then ignore.
 */
function bindCaptured(id: string, input: { key: string } | { mouse: string }): void {
  const spec = (editableActions()[id] ??= {});
  if ("mouse" in input) {
    removeKey(spec, "key");
    removeKey(spec, "meta");
    spec.mouse = input.mouse;
  } else {
    if (ueKeyFor({ key: input.key }) === null) {
      captureProblem = {
        id,
        message: `${keyLabel(input.key)} cannot be bound in the game -- pick another key.`,
      };
      capturing = null;
      render();
      return;
    }
    removeKey(spec, "mouse");
    if (isModifier(input.key)) {
      removeKey(spec, "key");
      spec.meta = input.key;
    } else {
      removeKey(spec, "meta");
      spec.key = input.key;
    }
  }
  captureProblem = null;
  capturing = null;
  render();
}

/** Every other action sending the same thing -- shown beside the key, as it happens. */
function sharedWith(id: string): string[] {
  const actions = actionSetFor(currentGame());
  const mine = actions.actions[id];
  if (!mine) return [];
  const text = bindingLabel(mine);
  if (text === null) return [];
  return Object.entries(actions.actions)
    .filter(([other, spec]) => other !== id && bindingLabel(spec) === text)
    .map(([, spec]) => spec.label ?? "");
}

/**
 * The key an action is on in the game, as a chip: click it, then press the key.
 *
 * It used to be two text boxes that took the browser's own code names -- `KeyW`,
 * `ShiftLeft` -- with a placeholder of `KeyF` that read like a value, and a modifier box
 * for a split that only exists in the file format.
 */
function actionKeyField(id: string): HTMLElement {
  const spec = actionSetFor(currentGame()).actions[id] ?? {};
  const row = el("div", { class: "keybind" });
  const isCapturing = capturing === id;
  const current = bindingLabel(spec);

  const chip = el(
    "button",
    {
      class: `key-chip${isCapturing ? " capturing" : ""}${current === null ? " unset" : ""}`,
      type: "button",
      title: isCapturing ? "Press a key, or click here with a mouse button" : "Click to change",
    },
    [isCapturing ? "Press a key…" : (current ?? "Not bound")],
  );
  chip.addEventListener("click", () => {
    if (capturing === id) return;
    capturing = id;
    captureProblem = null;
    render();
  });
  // During capture, a mouse button pressed on the chip binds that button.
  chip.addEventListener("mousedown", (event) => {
    if (capturing !== id) return;
    const mouse = MOUSE_BY_BUTTON[event.button];
    if (mouse === undefined) return;
    event.preventDefault();
    bindCaptured(id, { mouse });
  });
  chip.addEventListener("contextmenu", (event) => {
    if (capturing === id) event.preventDefault();
  });
  row.append(chip);

  if (isCapturing) {
    const cancel = el("button", { class: "btn small", type: "button" }, ["Cancel"]);
    cancel.addEventListener("click", () => {
      capturing = null;
      render();
    });
    row.append(cancel);
  } else if (current !== null) {
    const clear = el("button", { class: "btn small", type: "button", title: "Unbind" }, ["×"]);
    clear.addEventListener("click", () => {
      const editable = (editableActions()[id] ??= {});
      removeKey(editable, "key");
      removeKey(editable, "meta");
      removeKey(editable, "mouse");
      render();
    });
    row.append(clear);
  }

  const shared = sharedWith(id);
  if (captureProblem?.id === id) {
    row.append(el("div", { class: "keybind-note bad" }, [captureProblem.message]));
  } else if (shared.length > 0) {
    row.append(el("div", { class: "keybind-note" }, [`Also on ${shared.join(", ")}`]));
  }
  return row;
}

function renderInGame(): HTMLElement {
  const game = currentGame();
  const actions = actionSetFor(game);
  const bound = boundActions();
  const panel = el("div", { class: "panel" });
  panel.append(el("h2", {}, [`${game.name} — in-game bindings`]));
  panel.append(
    el("div", { class: "note" }, [
      "The key each action is on inside the game. Click a key and press the new one; a " +
        "clash shows up straight away. " +
        (canSave()
          ? "Save keeps it, then Repo → Write the game's bindings tells the game."
          : "Export actions.yaml and copy the keys you changed into the game's file."),
    ]),
  );

  const table = el("div", { class: "ingame-list" });
  for (const [id, spec] of Object.entries(actions.actions)) {
    const where = bound.get(id);
    const item = el("div", { class: `ingame-row${where ? "" : " unbound"}` });
    item.append(
      el("div", { class: "who" }, [
        el("b", {}, [spec.label ?? id]),
        el("small", {}, [
          spec.provided_by
            ? `${spec.provided_by} — not a keypad key`
            : (where?.join(", ") ?? "not sent by any unit"),
        ]),
      ]),
    );
    if (spec.provided_by) {
      item.append(el("div", { class: "muted" }, [spec.provided_by]));
    } else {
      item.append(actionKeyField(id));
    }
    table.append(item);
  }
  panel.append(table);

  const save = el("button", { class: "btn primary", type: "button" }, [
    canSave() ? "Save actions.yaml" : "Export actions.yaml",
  ]);
  save.addEventListener("click", () => {
    if (canSave()) {
      void saveActionKeys(game);
      return;
    }
    // Offline there is no file to patch, so this is the whole vocabulary, flattened. It says
    // so, because pasting it over the real file would lose `extends:` and the allowlist.
    const header =
      `# ${game.name} -- every action and the in-game key it is bound to, flattened.\n` +
      "# Copy the keys you changed into the game's actions.yaml; do not replace the file.\n";
    download(
      "actions.yaml",
      dumpYaml({ game: game.name, actions: actionSetFor(game).actions }, header),
      "text/yaml",
    );
  });
  panel.append(save);
  return panel;
}

let detection: DetectionState | null = null;
let detectionChecked = false;

function hidApi(): HidLike | undefined {
  return (navigator as unknown as { hid?: HidLike }).hid;
}

/** What is plugged in, as the browser sees it. */
function renderDetection(): HTMLElement {
  const panel = el("div", { class: "panel inset" });
  panel.append(el("h2", {}, ["Units connected"]));

  // Devices already granted can be listed without prompting; only the picker needs a
  // click. Checked once, so rendering does not loop.
  if (!detectionChecked) {
    detectionChecked = true;
    void alreadyGranted(hidApi()).then((result) => {
      if (result.status === "found") {
        detection = result;
        render();
      }
    });
  }

  const body = el("div", { class: "note" });
  if (detection === null) {
    body.append(
      document.createTextNode(
        "Not checked yet. The browser will only list devices you have granted it, so " +
          "this needs a click and a pick from the dialog.",
      ),
    );
  } else if (detection.status === "unsupported") {
    body.append(document.createTextNode(detection.reason));
  } else if (detection.status === "none") {
    body.append(
      document.createTextNode(
        "Nothing granted. Either the dialog was dismissed, or nothing is plugged in -- " +
          "the browser does not say which.",
      ),
    );
  } else {
    for (const found of detection.units) {
      body.append(
        el("div", { class: found.isAzeron ? "" : "muted" }, [
          `${found.productName || "(unnamed)"} — vid ${hex4(found.vendorId)} ` +
            `pid ${hex4(found.productId)}, ${String(found.collections)} interface(s)` +
            (found.isAzeron ? "  ← Cyborg II" : ""),
        ]),
      );
    }
    const azerons = detection.units.filter((found) => found.isAzeron);
    if (azerons.length === 1) {
      body.append(
        el("div", { class: "muted" }, [
          "Both units report the same product id, so one connection cannot be told apart " +
            "from the other by USB alone.",
        ]),
      );
    }
    if (azerons.length === 0) {
      body.append(
        el("div", { class: "muted" }, [
          `Nothing here reports product id ${hex4(AZERON_PRODUCT_ID)}.`,
        ]),
      );
    }
  }
  panel.append(body);

  if (window.location.protocol === "file:") {
    panel.append(
      el("div", { class: "note" }, [
        "Opened as a file. WebHID needs a secure context, so this usually only works " +
          "from `azeron serve`.",
      ]),
    );
  }

  const check = el("button", { class: "btn", type: "button" }, ["Detect units"]);
  check.addEventListener("click", () => {
    void requestUnits(hidApi()).then((result) => {
      detection = result;
      render();
    });
  });
  panel.append(check);
  panel.append(
    el("div", { class: "muted" }, [
      el("small", {}, [
        "Detection only reports what is connected. Writing profiles still goes through " +
          "the Azeron software, which speaks its own protocol on one of these interfaces.",
      ]),
    ]),
  );
  return panel;
}

interface IngameRow {
  label: string;
  ours: string | null;
  theirs: { display: string; scale: number }[];
  status: string;
}

let repoNote: string | null = null;
let ingameRows: IngameRow[] | null = null;
let ingameCollisions: { key: string; actions: string[] }[] = [];

/**
 * Replace the page's data with the server's current payload, keeping the tab and game.
 *
 * Returns false when there is no server or it did not answer, so the caller can fall back
 * to asking for a reload. Only used when nothing is unsaved -- a fresh payload replaces
 * the working copies.
 */
async function refreshPayload(): Promise<boolean> {
  if (!canSave() || isDirty()) return false;
  try {
    const response = await fetch("/api/payload");
    if (!response.ok) return false;
    const payload = (await response.json()) as EditorPayload;
    const mode = state.mode;
    const gameSlug = currentGame().slug;
    start(payload);
    state.mode = mode;
    const index = payload.games.findIndex((game) => game.slug === gameSlug);
    if (index >= 0) {
      state.gameIndex = index;
      state.setName = [...setsOf(currentGame()).keys()][0] ?? "";
    }
    return true;
  } catch {
    return false;
  }
}

async function post<T extends object = Record<string, unknown>>(
  path: string,
  body: unknown,
): Promise<T & { status: number }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json()) as T;
  // The status carries meaning the body does not: 409 is a name already in use, which the
  // user can resolve, as against a request that was simply wrong.
  return { ...parsed, status: response.status };
}

/**
 * The operations that otherwise need a terminal.
 *
 * Only reachable when served: opened as a file there is nothing on the other end, and
 * the tab says so rather than offering buttons that cannot work.
 */
function renderRepo(): HTMLElement {
  const panel = el("div", { class: "panel" });
  panel.append(el("h2", {}, ["Repo"]));

  // Detection is the browser talking to USB, so it works either way.
  panel.append(renderDetection());

  if (!canSave()) {
    panel.append(
      el("div", { class: "empty-state" }, [
        "Building, importing and reading the game's config need a server. Run " +
          "`azeron serve` and open the address it prints.",
      ]),
    );
    return panel;
  }

  if (repoNote !== null) panel.append(el("div", { class: "note repo-note" }, [repoNote]));

  const buildRow = el("div", { class: "field" });
  const build = el("button", { class: "btn primary", type: "button" }, ["Build profiles"]);
  build.addEventListener("click", () => {
    repoNote = "building...";
    render();
    void post("/api/build", {}).then((result) => {
      const built = (result.built ?? []) as { output: string; changed: boolean }[];
      const errors = (result.errors ?? []) as string[];
      const changed = built.filter((entry) => entry.changed);
      repoNote =
        errors.length > 0
          ? `build failed: ${errors.join(" | ")}`
          : `${String(changed.length)} of ${String(built.length)} profile(s) changed` +
            (changed.length > 0 ? `: ${changed.map((e) => e.output).join(", ")}` : "");
      render();
    });
  });
  buildRow.append(build);
  buildRow.append(
    el("div", { class: "muted" }, [
      el("small", {}, [
        "Compiles every profile into dist/, and copies to a game's export_to if it sets one.",
      ]),
    ]),
  );
  panel.append(buildRow);

  // Importing an export: the round trip back from the Azeron app.
  const importRow = el("div", { class: "field" });
  importRow.append(el("label", {}, ["Upload an Azeron export"]));

  const setName = el("input", { type: "text", value: "v1", placeholder: "set name" });
  const deviceSelect = el("select", {});
  for (const device of Object.values(state.payload.devices)) {
    deviceSelect.append(el("option", { value: device.device }, [device.device]));
  }

  const file = el("input", { type: "file", accept: "application/json,.json" });
  file.style.display = "none";

  const accept = (chosen: File | undefined): void => {
    if (!chosen) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      let exported: unknown;
      try {
        exported = JSON.parse(text);
      } catch (error) {
        repoNote = `${chosen.name} is not JSON: ${messageOf(error)}`;
        render();
        return;
      }
      const profiles = (exported as { profiles?: unknown[] }).profiles;
      if (!Array.isArray(profiles) || profiles.length === 0) {
        repoNote = `${chosen.name} has no profiles in it -- is it an Azeron export?`;
        render();
        return;
      }
      repoNote = `importing ${chosen.name}...`;
      render();
      const send = (overwrite: boolean): void => {
        void post("/api/import", {
          game: currentGame().slug,
          device: deviceSelect.value,
          set: setName.value.trim() || "v1",
          exported,
          ...(overwrite ? { overwrite: true } : {}),
        }).then((result) => {
          // A set already in use destroys a profile and its committed template, which is
          // the only record of what the unit held. Asked, not assumed.
          if (result.ok !== true && result.status === 409) {
            if (window.confirm(`${String(result.error)}\n\nOverwrite it?`)) {
              send(true);
              return;
            }
            repoNote = "import cancelled -- nothing was written.";
            render();
            return;
          }
          if (result.ok !== true) {
            repoNote = `import refused: ${String(result.error)}`;
            render();
            return;
          }
          const done =
            `wrote ${String(result.profilePath)} (${String(result.positions)} positions) ` +
            `and kept the export at ${String(result.templatePath)}.`;
          void refreshPayload().then((refreshed) => {
            repoNote = refreshed
              ? `${done} It is in the Layout selector now.`
              : `${done} Reload the page to open it.`;
            render();
          });
        });
      };
      send(false);
    });
    reader.readAsText(chosen);
  };

  file.addEventListener("change", () => {
    accept(file.files?.[0]);
  });

  const upload = el("button", { class: "btn primary", type: "button" }, ["Upload export"]);
  upload.addEventListener("click", () => {
    file.click();
  });

  // Dropping the file on the zone does the same thing, since that is how a file usually
  // arrives from the Azeron app's export dialog.
  const drop = el("div", { class: "dropzone" }, [
    "Drop an exported .json here, or use the button.",
  ]);
  for (const name of ["dragenter", "dragover"]) {
    drop.addEventListener(name, (event) => {
      event.preventDefault();
      drop.classList.add("over");
    });
  }
  for (const name of ["dragleave", "drop"]) {
    drop.addEventListener(name, (event) => {
      event.preventDefault();
      drop.classList.remove("over");
    });
  }
  drop.addEventListener("drop", (event) => {
    accept(event.dataTransfer?.files[0]);
  });

  importRow.append(
    el("div", { class: "row2" }, [
      el("div", { class: "field" }, [el("label", {}, ["set name"]), setName]),
      el("div", { class: "field" }, [el("label", {}, ["unit"]), deviceSelect]),
    ]),
    el("div", { class: "row2" }, [upload]),
    drop,
    file,
  );
  panel.append(importRow);

  // The game's own bindings, read from its config file.
  const ingameRow = el("div", { class: "field" });
  const check = el("button", { class: "btn", type: "button" }, ["Read the game's bindings"]);
  check.addEventListener("click", () => {
    repoNote = "reading...";
    render();
    void fetch(`/api/ingame?game=${encodeURIComponent(currentGame().slug)}`)
      .then((response) => response.json())
      .then((result: Record<string, unknown>) => {
        if (!result.ok) {
          repoNote = `could not read it: ${String(result.error)}`;
          ingameRows = null;
        } else {
          const report = result.report as {
            path: string;
            rows: IngameRow[];
            collisions: { key: string; actions: string[] }[];
          };
          ingameRows = report.rows.filter((row) => row.status !== "unsendable");
          ingameCollisions = report.collisions;
          repoNote = `read ${report.path}`;
        }
        render();
      });
  });
  // Writing is the other half: actions.yaml says which key each action is on, and the
  // game is made to agree. The game has to be closed -- it rewrites the file on exit.
  const apply = el("button", { class: "btn primary", type: "button" }, [
    "Write the game's bindings",
  ]);
  apply.addEventListener("click", () => {
    if (
      !window.confirm(
        `Rewrite ${currentGame().name}'s key bindings from actions.yaml? Close the game first: ` +
          "it rewrites the file when it exits. The current file is kept beside it.",
      )
    ) {
      return;
    }
    repoNote = "writing the game's bindings...";
    render();
    void post("/api/ingame/apply", { game: currentGame().slug }).then((reply) => {
      if (reply.ok !== true) {
        repoNote = `not written: ${String(reply.error)}`;
      } else {
        const result = reply.result as {
          changes: { display: string; from: string; to: string }[];
          backup: string | null;
        };
        const changed = result.changes
          .map((change) => `${change.display} ${change.from} -> ${change.to}`)
          .join("; ");
        repoNote =
          result.changes.length === 0
            ? "The game already agrees with actions.yaml -- nothing written."
            : `Wrote ${String(result.changes.length)} binding(s): ${changed}.` +
              (result.backup === null ? "" : ` The previous file is at ${result.backup}.`);
      }
      render();
    });
  });
  ingameRow.append(check, apply);
  panel.append(ingameRow);

  if (ingameRows !== null) {
    const list = el("div", { class: "ingame-list" });
    for (const row of ingameRows) {
      const item = el("div", { class: `ingame-row${row.theirs.length === 0 ? " unbound" : ""}` });
      item.append(
        el("div", { class: "who" }, [
          el("b", {}, [row.label]),
          el("small", {}, [row.ours ?? "sends nothing"]),
        ]),
      );
      item.append(
        el("div", { class: "muted" }, [
          row.theirs.length === 0
            ? "the game has nothing on this key"
            : row.theirs.map((entry) => entry.display).join(" + "),
        ]),
      );
      list.append(item);
    }
    panel.append(list);

    if (ingameCollisions.length > 0) {
      panel.append(el("h2", {}, ["Keys the game binds twice"]));
      for (const entry of ingameCollisions) {
        panel.append(el("div", { class: "note" }, [`${entry.key}: ${entry.actions.join(" + ")}`]));
      }
    }
  }

  return panel;
}

function renderPressTest(): HTMLElement {
  const panel = el("div", { class: "panel" });
  const controls = el("div", { class: "field" });
  for (const [label, which] of [
    ["Download pins profile", "pins"],
    ["Download stick-zero profile", "stick"],
  ] as const) {
    const button = el("button", { class: "btn", type: "button" }, [label]);
    button.addEventListener("click", () => {
      const built = probeProfiles();
      const doc = which === "pins" ? built.pins.doc : built.stick.doc;
      const name = which === "pins" ? "probe-1-pins.json" : "probe-2-stick-zero.json";
      download(name, `${JSON.stringify(doc, null, 2)}\n`, "application/json");
    });
    controls.append(button);
  }
  panel.append(
    el("div", { class: "muted" }, [
      "Import the pins profile onto a unit, press what the diagram asks for, then export " +
        "the device map. The stick-zero profile measures the stick's rotation.",
    ]),
    controls,
  );

  // Mounted once and re-attached after that. Starting it on every render put it back at
  // step one whenever anything else on the page redrew -- the Wide toggle, a selector,
  // the tab itself -- and threw away where the user was in the stick-zero pass.
  if (probeHost === null) {
    probeHost = el("div", {});
    startProbe(probePayload(), probeHost, {
      ...(canSave()
        ? {
            save: (path: string, content: string) => {
              void saveToRepo(path, content);
            },
          }
        : {}),
    });
  }
  panel.append(probeHost);

  return panel;
}

function renderSheet(): HTMLElement {
  const game = currentGame();
  const profiles = slugsInSet().map((slug) => profileFor(slug));
  const html = renderCheatsheet(profiles, actionSetFor(game));
  const frame = el("iframe", { class: "sheet-frame", title: "cheatsheet" });
  frame.srcdoc = html;

  // The sheet is for learning a layout away from the screen, so it has to leave the page.
  // The browser's own Print would print the editor around it.
  const print = el("button", { class: "btn primary", type: "button" }, ["Print"]);
  print.addEventListener("click", () => {
    frame.contentWindow?.print();
  });
  const save = el("button", { class: "btn", type: "button" }, ["Download"]);
  save.addEventListener("click", () => {
    download(`${game.slug}-${state.setName}.html`, html, "text/html");
  });
  return el("div", {}, [el("div", { class: "sheet-tools" }, [print, save]), frame]);
}

/**
 * Fit both units into the stage width.
 *
 * Two Cyborg IIs side by side are wider than most windows, and wrapping puts one hand
 * under the other, which defeats the point of drawing the pair. The stage is scaled down
 * instead, and the wrapper takes the scaled height so nothing overlaps below it.
 */
function fitStage(wrap: HTMLElement, stage: HTMLElement): void {
  const available = wrap.clientWidth;
  const needed = stage.scrollWidth;
  if (available <= 0 || needed <= 0) return;
  const scale = Math.min(1, available / needed);
  stage.style.transform = scale < 1 ? `scale(${String(scale)})` : "";
  wrap.style.height = `${String(Math.ceil(stage.scrollHeight * scale))}px`;
}

let resizeBound = false;
let unloadBound = false;
let captureBound = false;

function render(): void {
  const root = document.getElementById("app");
  if (!root) return;
  root.replaceChildren();
  root.append(renderHeader());
  if (saveNote !== null) {
    root.append(el("div", { class: "save-note" }, [saveNote]));
  }
  if (saveReport !== null) {
    const dismiss = el("button", { class: "btn dismiss", type: "button" }, ["Dismiss"]);
    dismiss.addEventListener("click", () => {
      saveReport = null;
      render();
    });
    root.append(el("div", { class: "save-note" }, [saveReport, dismiss]));
  }

  if (state.mode === "in-game") {
    const workspace = el("div", { class: "workspace board" });
    const stage = el("div", { class: "stage" });
    for (const slug of slugsInSet()) stage.append(renderHand(slug));
    const stageWrap = el("div", { class: "stage-wrap" }, [stage]);
    // The tab's whole claim is that changing a key here shows a collision before it costs
    // a fight. It said so in the panel and did not render the findings.
    workspace.append(
      stageWrap,
      el("div", { class: "dock ingame" }, [renderInGame(), renderChecks()]),
    );
    root.append(workspace);
    requestAnimationFrame(() => {
      fitStage(stageWrap, stage);
    });
    return;
  }

  if (state.mode === "repo") {
    root.append(el("div", { class: "workspace single" }, [renderRepo()]));
    return;
  }

  if (state.mode === "press-test") {
    root.append(el("div", { class: "workspace single" }, [renderPressTest()]));
    return;
  }
  if (state.mode === "sheet") {
    root.append(el("div", { class: "workspace single" }, [renderSheet()]));
    return;
  }

  // The board takes the full width and the panels dock under it, in what was empty
  // space. With a rail either side, the pair was scaled to under half size.
  const workspace = el("div", { class: "workspace board" });
  const stage = el("div", { class: "stage" });
  const slugs = slugsInSet();
  for (const slug of slugs) stage.append(renderHand(slug));
  if (slugs.length === 1) {
    stage.append(
      el("div", { class: "empty-state" }, [
        "No second unit in this set. Add a profile with `unit: right` to edit both hands together.",
      ]),
    );
  }
  const stageWrap = el("div", { class: "stage-wrap" }, [stage]);
  workspace.append(stageWrap);

  const side = el("div", { class: "dock-col" }, [renderChecks()]);
  const modes = renderStickModes();
  if (modes) side.append(modes);
  workspace.append(el("div", { class: "dock" }, [renderInspector(), renderPalette(), side]));
  root.append(workspace);

  requestAnimationFrame(() => {
    fitStage(stageWrap, stage);
  });
  if (!captureBound) {
    captureBound = true;
    document.addEventListener(
      "keydown",
      (event) => {
        if (capturing === null) return;
        // Every key is a candidate, Escape and Tab included -- Cancel is a button -- and
        // none of them should also do what the browser would do with it.
        event.preventDefault();
        event.stopPropagation();
        bindCaptured(capturing, { key: event.code });
      },
      true,
    );
  }
  if (!unloadBound) {
    unloadBound = true;
    // Edits live in the page until they are saved, and a reload used to take them with it
    // without asking. The browser shows its own wording; what matters is that it asks.
    window.addEventListener("beforeunload", (event) => {
      if (!isDirty()) return;
      // preventDefault is the current way to ask; some browsers still want a truthy
      // returnValue, which is deprecated and set through the index signature.
      event.preventDefault();
      (event as unknown as Record<string, unknown>).returnValue = "";
    });
  }
  if (!resizeBound) {
    resizeBound = true;
    window.addEventListener("resize", () => {
      const wrap = document.querySelector<HTMLElement>(".stage-wrap");
      const inner = wrap?.querySelector<HTMLElement>(".stage");
      if (wrap && inner) fitStage(wrap, inner);
    });
  }
}

/** Mount the editor into #app. Exported so tests can drive it against a real DOM. */
export function start(payload = window.AZERON_PAYLOAD): void {
  if (!payload) throw new Error("no payload embedded in the page");
  // Once: start() runs again whenever the page takes a fresh payload.
  if (!document.getElementById("azeron-editor-styles")) {
    const style = document.createElement("style");
    style.id = "azeron-editor-styles";
    style.textContent = CSS;
    document.head.append(style);
  }

  const firstGame = payload.games[0];
  probeHost = null;
  state = {
    payload,
    mode: "edit",
    workingActions: null,
    gameIndex: 0,
    setName: firstGame ? ([...setsOf(firstGame).keys()][0] ?? "") : "",
    working: new Map(),
    selected: null,
    slot: "tap",
  };
  render();
}

export { formatFinding };
