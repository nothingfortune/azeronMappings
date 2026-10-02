/**
 * The side-by-side profile editor.
 *
 * Imports the same compiler, linter and YAML writer as the CLI, so the page and
 * `azeron build` produce identical output from identical input.
 */

import { compileProfile, dumps } from "../lib/compile.js";
import { dumpProfile } from "../lib/decompile.js";
import { formatFinding, lintProfiles, ROLE_TAGS } from "../lib/lint.js";
import type { Finding } from "../lib/lint.js";
import { handLayout, positionLabel, unitLabel, whereLabel } from "../lib/layout.js";
import { applyMode } from "../lib/stickmodes.js";
import type { StickModeSet } from "../lib/stickmodes.js";
import { patchSetPedals } from "../lib/setsfile.js";
import {
  changedSets,
  defaultPedals,
  gameAxisHint,
  gameAxisLabel,
  layoutContext,
  pedalAxisLabel,
  pedalsCarry,
  readSticks,
  restSentence,
  restsOnCentred,
  statusWords,
  takenAxesCarried,
} from "./pedals-model.js";
import { describeDirection } from "../lib/binding.js";
import type { BindingChange } from "../lib/actionfile.js";
import { ueKeyFor } from "../lib/ingame.js";
import { needsWire, wireAction } from "../lib/wiring.js";
import { bindingLabel, isModifier, keyLabel } from "../lib/keys.js";
import { ActionSet, Device, Profile } from "../lib/model-core.js";
import { isFileName, slugFromName } from "../lib/scaffold.js";
import {
  DEFAULT_DOUBLE_DELAY,
  DEFAULT_FEATURE_DELAY,
  SLOTS,
  STICK_DIRECTIONS,
  STICK_MODE_CODES,
} from "../types/azeron.js";
import type { Slot, StickDirection } from "../types/azeron.js";
import type { EditorGame, EditorPayload } from "../types/editor.js";
import type {
  NameStatus,
  PedalAssignment,
  PedalsDeviceData,
  SetPedals,
  SetsData,
} from "../types/pedals.js";
import type { ActionSpec, PositionSpec, ProfileData } from "../types/profile.js";
import { messageOf, removeKey } from "../lib/object.js";
import { dumpYaml } from "../lib/yaml.js";
import { AZERON_PRODUCT_ID, alreadyGranted, hex4, requestUnits } from "../lib/hid.js";
import type { DetectionState, HidLike } from "../lib/hid.js";
import { buildProbeProfile, buildStickCalibrationProfile } from "../lib/probe.js";
import type { ProbePayload } from "../types/probe.js";
import { start as startProbe, stop as stopProbe } from "./probe.js";
import { CSS } from "./styles.js";
import { applyStoredTheme, currentTheme, toggleTheme } from "./theme.js";

declare global {
  interface Window {
    AZERON_PAYLOAD?: EditorPayload;
  }
}

type Mode = "edit" | "in-game" | "press-test" | "repo";

interface State {
  payload: EditorPayload;
  mode: Mode;
  /**
   * Working copy of the game's action vocabulary -- the in-game half of the mapping.
   * Editing a key here re-runs the linter, so a collision shows up immediately.
   */
  workingActions: Record<string, ActionSpec> | null;
  /**
   * Working copy of the game's `sets.yaml` -- each layout's pedals. Kept apart from the
   * profiles, as the file is, but saved with them: one control scheme.
   */
  workingSets: SetsData | null;
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

/** What each layout's pedals do now, with edits, or as the page loaded them. */
function currentSets(game: EditorGame = currentGame()): SetsData {
  return state.workingSets ?? game.sets;
}

/** Clone on first edit, so the embedded payload stays pristine. */
function editableSets(): SetsData {
  state.workingSets ??= structuredClone(currentGame().sets);
  return state.workingSets;
}

/** The pedals of the layout on screen, or undefined when it has none. */
function pedalsOfLayout(): SetPedals | undefined {
  return currentSets().sets[state.setName]?.pedals;
}

function pedalDevices(): Record<string, PedalsDeviceData> {
  return state.payload.pedals;
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

/**
 * What is being dragged across the Edit tab: an action from the list, or a key off the
 * board. Kept here rather than read back from the drop event, because the browser only
 * hands a drop the text it was given and the page already knows what was picked up.
 */
type Drag = { kind: "action"; id: string } | { kind: "key"; slug: string; position: string };
let dragging: Drag | null = null;

function endDrag(): void {
  dragging = null;
  document.body.classList.remove("dragging-action", "dragging-key");
  for (const node of document.querySelectorAll(".drop-over")) node.classList.remove("drop-over");
}

/** Let `node` be picked up. `text` is what another program is given if it is dropped there. */
function draggable(node: HTMLElement, what: Drag, text: string): void {
  node.setAttribute("draggable", "true");
  node.addEventListener("dragstart", (event) => {
    dragging = what;
    document.body.classList.add(`dragging-${what.kind}`);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", text);
    }
  });
  node.addEventListener("dragend", endDrag);
}

/** Let `node` take a drop of whatever `accepts` allows. */
function dropTarget(
  node: HTMLElement,
  accepts: (drag: Drag) => boolean,
  drop: (drag: Drag) => void,
): void {
  node.addEventListener("dragover", (event) => {
    if (dragging === null || !accepts(dragging)) return;
    // Without this the browser refuses the drop.
    event.preventDefault();
    node.classList.add("drop-over");
  });
  node.addEventListener("dragleave", () => {
    node.classList.remove("drop-over");
  });
  node.addEventListener("drop", (event) => {
    const drag = dragging;
    endDrag();
    if (drag === null || !accepts(drag)) return;
    event.preventDefault();
    drop(drag);
  });
}

/**
 * Give an action something to be sent on, if it has nothing. A control carries an action
 * to the game on a key; which key is not the owner's concern, so one that nothing else is
 * on is picked here, the moment the action is first put on a control. It is saved with the
 * layout, in the game's actions.yaml, and an action keeps the key it was given.
 */
function wire(actionId: string): void {
  const game = currentGame();
  const spec = actionSetFor(game).actions[actionId];
  if (!needsWire(spec)) return;
  // With a game file to write, only keys that file has a name for: one it cannot name
  // would be sent and never heard.
  const connected = gameFileGaps(game).length === 0;
  const key = wireAction(
    editableActions(),
    actionId,
    connected ? (name) => ueKeyFor({ key: name }) !== null : undefined,
  );
  if (key === null) {
    saveNote =
      `There is no key left to send "${spec?.label ?? actionId}" on, so that control does ` +
      "nothing. Free one on the In-game tab.";
  }
}

/** Wire every action a position carries: its slots, and a stick's directions. */
function wireSpec(spec: PositionSpec | undefined): void {
  if (spec === undefined) return;
  for (const slot of SLOTS) {
    const value = spec[slot];
    if (typeof value === "string") wire(value);
  }
  for (const value of Object.values(spec.directions ?? {})) {
    if (typeof value === "string") wire(value);
  }
}

/** Put an action on one slot of a key, and name the key after it when the slot is the tap. */
function assignAction(slug: string, position: string, slot: Slot, actionId: string): void {
  if (profileFor(slug).device.isStick(position)) return;
  const spec = (workingData(slug).positions[position] ??= {});
  spec[slot] = actionId;
  // The label is what the board shows and what is compiled onto the unit, so it
  // must not go on naming the action that used to be here -- and whatever it said, it said
  // it about that action. Rebinding the tap renames the key; a long press or a double tap
  // leaves it, because the label is the tap's. `??=` never fired at all, since every
  // shipped profile already has a label on every position.
  if (slot === "tap") spec.label = actionSetFor(currentGame()).label(actionId);
  wire(actionId);
}

/** An action dropped on a key goes on its tap, and the key becomes the selected one. */
function dropActionOnKey(slug: string, position: string, actionId: string): void {
  assignAction(slug, position, "tap", actionId);
  state.selected = { slug, position };
  state.slot = "tap";
  render();
}

/**
 * A key dropped on another key: everything on it moves, and what was there comes back the
 * other way, so nothing is lost by dropping on a key that was in use.
 */
function dropKeyOnKey(
  from: { slug: string; position: string },
  to: { slug: string; position: string },
): void {
  if (from.slug === to.slug && from.position === to.position) return;
  const source = workingData(from.slug).positions;
  const target = workingData(to.slug).positions;
  const moved = source[from.position];
  const displaced = target[to.position];
  if (moved === undefined) return;
  target[to.position] = moved;
  if (displaced === undefined) removeKey(source, from.position);
  else source[from.position] = displaced;
  state.selected = to;
  state.slot = "tap";
  render();
}

/** An action dropped on one of a stick's four directions. */
function dropActionOnDirection(
  slug: string,
  position: string,
  direction: StickDirection,
  actionId: string,
): void {
  const spec = (workingData(slug).positions[position] ??= { mode: "keyboard" });
  spec.directions ??= {};
  spec.directions[direction] = actionId;
  wire(actionId);
  state.selected = { slug, position };
  render();
}

/** A key dragged off the board and dropped on the action list is cleared. */
function clearKey(slug: string, position: string): void {
  removeKey(workingData(slug).positions, position);
  render();
}

/** Make a board key take an action or another key, and be picked up when it holds something. */
function wireKey(node: HTMLElement, slug: string, position: string, holds: boolean): void {
  if (holds) draggable(node, { kind: "key", slug, position }, positionLabel(position));
  dropTarget(
    node,
    (drag) => drag.kind === "action" || drag.slug !== slug || drag.position !== position,
    (drag) => {
      if (drag.kind === "action") dropActionOnKey(slug, position, drag.id);
      else dropKeyOnKey(drag, { slug, position });
    },
  );
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
    const name = spec.label ?? tap ?? "—";
    card.append(el("span", { class: "name" }, [name]));
    // Every key is the same size, so what is on it besides its name shares one line and the
    // whole of it is in the tooltip. The inspector spells each part out.
    const extras: { text: string; flag: boolean }[] = [];
    for (const slot of SLOTS) {
      const text = describeSlotValue(actions, spec[slot]);
      if (!text) continue;
      // The label usually repeats the tap action; only the extra slots need spelling out.
      if (slot === "tap" && spec.label === undefined) continue;
      if (slot === "tap" && text === spec.label) continue;
      extras.push({ text: `${slot === "tap" ? "" : `${slot} `}${text}`, flag: false });
    }
    if (spec.feature_delay && (spec.long ?? spec.double)) {
      extras.push({ text: `waits ${String(spec.feature_delay)} ms`, flag: true });
    }
    if (spec.hold) extras.push({ text: "latches", flag: true });
    if (extras.length > 0) {
      card.classList.add("has-extra");
      // One leaf of text, like the lines above it: nested spans read as one run-on word.
      const flagged = extras.some((extra) => extra.flag);
      card.append(
        el("span", { class: `sub${flagged ? " flag" : ""}` }, [
          extras.map((extra) => extra.text).join(" · "),
        ]),
      );
    }
    card.title = [name, ...extras.map((extra) => extra.text)].join("\n");
  }
  if (!isStick) wireKey(card, slug, position, spec !== undefined);

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
    dropTarget(
      cell,
      (drag) => drag.kind === "action",
      (drag) => {
        if (drag.kind === "action") dropActionOnDirection(slug, position, direction, drag.id);
      },
    );
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
  if (press !== null) wireKey(hub, slug, press, pressSpec !== undefined);
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
  // A pedal rule's position is a pedal axis, which `positionLabel` would not know.
  if (finding.rule.startsWith("pedal") && finding.position !== undefined) {
    const axis = finding.position;
    const spec = Object.values(state.payload.pedals)
      .map((device) => device.axes[axis])
      .find((entry) => entry !== undefined);
    return `Pedals: ${pedalAxisLabel(axis, spec)}`;
  }
  const unit = /-(left|right)$/.exec(finding.profile ?? "")?.[1];
  if (finding.position !== undefined) {
    return unit === undefined
      ? positionLabel(finding.position)
      : whereLabel(unit, finding.position);
  }
  if (finding.key !== undefined) return keyLabel(finding.key);
  return "the whole layout";
}

/** What the page shows for a finding: itself, or one line standing for many alike. */
type Shown = { finding: Finding } | { missing: Finding[] };

/**
 * Findings as the page lays them out. The linter reports one `missing-required` error per
 * required action with no key, and a game just started from an export has twenty or thirty
 * of them -- one fact ("nothing is on a key yet") said thirty times, which buried every
 * other finding. They are shown as one entry that opens to the list. The linter, the CLI
 * and `lint --strict` still see each one; nothing is dropped or acknowledged here.
 */
function shownFindings(findings: readonly Finding[]): Shown[] {
  const shown: Shown[] = [];
  let group: Finding[] | null = null;
  for (const finding of findings) {
    if (finding.rule !== "missing-required") {
      shown.push({ finding });
      continue;
    }
    if (group === null) {
      group = [];
      shown.push({ missing: group });
    }
    group.push(finding);
  }
  return shown;
}

let missingOpen = false;

/** The actions a `missing-required` finding names, as a person reads them. */
function missingActionNames(missing: readonly Finding[]): string[] {
  const actions = actionSetFor(currentGame()).actions;
  return missing.map((finding) => {
    const id = /required action '([^']+)'/.exec(finding.message)?.[1];
    return id === undefined ? finding.message : (actions[id]?.label ?? id);
  });
}

function findingItem(finding: Finding): HTMLElement {
  const item = el("div", { class: `finding ${finding.level}` });
  item.append(el("b", {}, [findingWhere(finding)]), el("small", { class: "rule" }, [finding.rule]));
  item.append(document.createTextNode(finding.message));
  return item;
}

/** One entry for every required action that is on no key, opening to the list. */
function missingGroup(missing: readonly Finding[]): HTMLElement {
  const count = missing.length;
  const set = missing[0]?.profile;
  const details = el("details", { class: "finding error grouped" });
  if (missingOpen) details.setAttribute("open", "open");
  details.addEventListener("toggle", () => {
    missingOpen = details.open;
  });
  details.append(
    el("summary", {}, [
      el("b", {}, [
        count === 1
          ? "1 required action is not on any key yet"
          : `${String(count)} required actions are not on any key yet`,
      ]),
      el("small", { class: "rule" }, ["missing-required"]),
    ]),
  );
  details.append(
    el("div", { class: "muted" }, [
      `Neither unit sends ${count === 1 ? "it" : "them"}${set === undefined ? "" : ` in '${set}'`}, ` +
        "so they cannot be reached without another input device. Put each on a key in the " +
        "Edit tab, or, if this game does not need one, switch its required role off in " +
        "the In-game tab.",
    ]),
  );
  const list = el("ul", { class: "missing-list" });
  for (const name of missingActionNames(missing)) list.append(el("li", {}, [name]));
  details.append(list);
  return details;
}

/** The findings, laid out; used by the Checks panel and by the report after a save. */
function appendFindings(box: HTMLElement, findings: readonly Finding[]): void {
  for (const entry of shownFindings(findings)) {
    box.append("missing" in entry ? missingGroup(entry.missing) : findingItem(entry.finding));
  }
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

  const pedals = pedalsOfLayout();
  const carry = pedalsCarry(set, pedals);
  const reading = readSticks(
    set,
    workingData(left).positions.stick,
    workingData(right).positions.stick,
    carry,
  );
  const current = reading.mode;
  const { takes, missing } = takenAxesCarried(set, pedals);
  const words = (axes: readonly string[]): string =>
    axes.map((axis) => gameAxisLabel(axis).toLowerCase()).join(", ");

  // Folded by default: it is chosen once in a while, and open it pushed the checks off
  // the bottom of the window. The summary says what is in use, so folded still informs.
  const panel = el("details", { class: "panel fold" });
  if (stickModesOpen) panel.setAttribute("open", "");
  panel.addEventListener("toggle", () => {
    stickModesOpen = panel.hasAttribute("open");
  });
  panel.append(
    el("summary", {}, [
      el("h2", {}, ["Stick mode"]),
      el("span", { class: "muted", "data-reading": "" }, [reading.text]),
    ]),
  );
  panel.append(
    el("div", { class: "note" }, [
      "Sets both sticks at once, the way an RC transmitter names its modes. Nothing but " +
        "the eight directions changes.",
    ]),
  );
  // Pedals are a modifier on the mode, so the panel says which variant a click applies.
  panel.append(
    el("div", { class: "note mode-pedals", "data-with-pedals": String(carry) }, [
      carry
        ? `This layout's pedals carry ${words(takes)}, so a mode is applied in its with-pedals ` +
          "variant, which hands that stick axis to something else."
        : pedals === undefined
          ? "This layout has no pedals, so a mode is applied as written."
          : `This layout has pedals, but none drives ${words(missing)}, so a mode is applied as ` +
            "written and the sticks keep it.",
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
        data.positions.stick = applyMode(data.positions.stick, set, mode, hand, carry);
        wireSpec(data.positions.stick);
      }
      saveNote =
        `${mode.label}${carry && mode.with_pedals !== undefined ? ", with pedals," : ""} ` +
        "applied to both sticks. Save to keep it.";
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
  const panel = el("div", { class: "panel palette" });

  const required = Object.entries(actions.actions).filter(
    ([, spec]) => (spec.tags ?? []).includes("required") && !spec.provided_by,
  );
  const missing = required.filter(([id]) => !bound.has(id));
  // The title, the count and the filter share a row: they were three lines above the list.
  const filter = el("input", { type: "search", placeholder: "Filter actions", class: "filter" });
  panel.append(
    el("div", { class: "palette-bar" }, [
      el("h2", {}, ["Actions"]),
      el("span", { class: `pill ${missing.length === 0 ? "ok" : "bad"}` }, [
        `${String(required.length - missing.length)}/${String(required.length)} required bound`,
      ]),
      filter,
    ]),
  );

  // Say what a click here will do. It used to look like a list to read, and a click with
  // nothing selected did nothing at all.
  const selection = state.selected;
  const onStick =
    selection !== null && profileFor(selection.slug).device.isStick(selection.position);
  if (selection === null) {
    panel.append(
      el("div", { class: "note palette-note" }, [
        "Drag an action onto a key. Or pick a key on the board, then click an action here.",
      ]),
    );
  } else if (!onStick) {
    const unit = workingData(selection.slug).profile.unit;
    const slot = state.slot === "tap" ? "" : ` — ${SLOT_NAMES[state.slot].toLowerCase()}`;
    panel.append(
      el("div", { class: "palette-target" }, [
        `Put on ${whereLabel(unit, selection.position)}${slot}:`,
      ]),
    );
  }
  if (onStick) {
    panel.append(
      el("div", { class: "note palette-note" }, [
        "A stick is selected. Drag an action onto one of its four directions, or choose " +
          "them in the Key panel.",
      ]),
    );
  }

  const inert = onStick || selection === null;
  const list = el("div", { class: `action-list${inert ? " inert" : ""}` });

  // About seventy actions; finding one by eye is slow. Filtering hides rather than
  // re-renders, so the box keeps focus while typing.
  filter.value = paletteFilter;
  const applyFilter = (): void => {
    const query = filter.value.trim().toLowerCase();
    for (const item of list.querySelectorAll<HTMLElement>(".action")) {
      item.hidden = query !== "" && !item.textContent.toLowerCase().includes(query);
    }
    for (const head of list.querySelectorAll<HTMLElement>(".head")) {
      let next = head.nextElementSibling;
      let any = false;
      while (next && !next.classList.contains("head")) {
        if (!(next as HTMLElement).hidden) any = true;
        next = next.nextElementSibling;
      }
      head.hidden = !any;
    }
  };
  filter.addEventListener("input", () => {
    paletteFilter = filter.value;
    applyFilter();
  });
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
      // The sensor supplies these; they are not something a key can send.
      if (!spec.provided_by) draggable(button, { kind: "action", id }, spec.label ?? id);
      list.append(button);
    }
  }
  panel.append(list);
  // The way back: a key dragged off the board and let go here is cleared.
  panel.append(el("div", { class: "clear-hint" }, ["Drop a key here to clear it."]));
  dropTarget(
    panel,
    (drag) => drag.kind === "key",
    (drag) => {
      if (drag.kind === "key") clearKey(drag.slug, drag.position);
    },
  );
  applyFilter();
  return panel;
}

/**
 * Whether there are edits that only exist in the page.
 *
 * A working copy is made the first time a profile is read, and every render reads, so
 * having one says nothing -- the page would call itself dirty the moment it drew. Each
 * part of the control scheme compares its copy with what the page loaded instead.
 */
function isDirty(): boolean {
  return unsavedParts().length > 0;
}

/** Ask before throwing edits away. Returns false when the user would rather not. */
function confirmDiscard(what: string): boolean {
  if (!isDirty()) return true;
  return window.confirm(`${what} discards edits that have not been saved. Continue?`);
}

function assignToSelection(actionId: string): void {
  const selection = state.selected;
  if (!selection) return;
  if (profileFor(selection.slug).device.isStick(selection.position)) return;
  assignAction(selection.slug, selection.position, state.slot, actionId);
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
    const unit = unitLabel(data.profile.unit ?? slug);
    const sensor = el("input", { type: "checkbox" });
    if (data.profile.sensor === true) sensor.setAttribute("checked", "checked");
    sensor.addEventListener("change", () => {
      data.profile.sensor = sensor.checked;
      render();
    });

    const row = el("div", { class: "row2" }, [
      el("div", { class: "field check" }, [
        el("label", {}, [`${unit} unit's sensor aims`]),
        sensor,
      ]),
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
  const panel = el("div", { class: "panel inspector" });
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
  // Drawing a key is not an edit. A position the profile has no entry for gets one only once
  // something is put on it: until then `spec` is a spare, which the next render adopts if a
  // handler filled it in.
  const existing = data.positions[selection.position];
  const spec: PositionSpec = existing ?? {};
  pendingSpec =
    existing === undefined ? { slug: selection.slug, position: selection.position, spec } : null;
  const isStick = device.isStick(selection.position);

  panel.append(
    el("div", { class: "key-where" }, [
      `${unitLabel(data.profile.unit)} unit · ${positionLabel(selection.position)}`,
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
    const directionFields = el("div", { class: "field-grid" });
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
        if (select.value) {
          spec.directions[direction] = select.value;
          wire(select.value);
        } else removeKey(spec.directions, direction);
        render();
      });
      directionFields.append(
        el("div", { class: "field" }, [el("label", {}, [`Stick ${direction}`]), select]),
      );
    }
    panel.append(directionFields);
  } else {
    for (const slot of SLOTS) {
      const value = spec[slot];
      const armed = slot === state.slot;
      const current =
        typeof value === "string"
          ? actions.label(value)
          : (describeSlotValue(actions, value) ?? null);
      const pick = el(
        "button",
        { class: `slot-pick${current === null ? " unset" : ""}`, type: "button" },
        [current ?? (armed ? "Pick an action →" : "Click, then pick an action")],
      );
      pick.addEventListener("click", () => {
        state.slot = slot;
        render();
      });
      const wrap = el("div", { class: "field slot" }, [el("label", {}, [SLOT_NAMES[slot]]), pick]);
      if (armed) wrap.setAttribute("data-active", "true");
      if (current !== null) {
        const clear = el("button", { class: "btn small", type: "button", title: "Clear" }, ["×"]);
        clear.addEventListener("click", () => {
          removeKey(spec, slot);
          if (slot === "tap") removeKey(spec, "label");
          // Nothing left on any slot means nothing on the key: drop it, so it reads as
          // unbound and the compiler blanks it, rather than keeping an empty entry.
          const anything = SLOTS.some((each) => spec[each] !== undefined && spec[each] !== null);
          if (!anything) {
            removeKey(data.positions, selection.position);
            state.slot = "tap";
          }
          render();
        });
        wrap.append(clear);
      }
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
      el("div", { class: "field check" }, [el("label", {}, ["Latch until pressed again"]), hold]),
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
      el("div", { class: "field check" }, [el("label", {}, ["Repeat the tap while held"]), turbo]),
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

/** The linter's verdict on the layout on screen, or why it could not run. */
function currentLint(): ReturnType<typeof lintProfiles> | { error: string } {
  const game = currentGame();
  try {
    const profiles = slugsInSet().map((slug) => profileFor(slug));
    // The pedal rules run only with the layouts' context, so the page passes the working
    // pedals: the same rules `azeron lint` runs, on what is on screen.
    return lintProfiles(
      actionSetFor(game),
      profiles,
      game.lintConfig,
      layoutContext(game.slug, currentSets(game), pedalDevices(), stickModesFor() ?? undefined),
    );
  } catch (error) {
    return { error: messageOf(error) };
  }
}

/**
 * The verdict where it is always visible: in the header, on every tab.
 *
 * The Checks panel sat below the stick modes, off the bottom of the window, so the
 * feedback an edit exists to get was out of sight while making it.
 */
function renderLintChip(): HTMLElement {
  const result = currentLint();
  let text: string;
  let tone: string;
  let detail = "";
  if ("error" in result) {
    text = "Checks failed to run";
    tone = "bad";
  } else {
    const problems = result.live.filter(
      (finding) => finding.level === "error" || finding.level === "warning",
    );
    const errors = problems.filter((finding) => finding.level === "error").length;
    // The required actions on no key are one entry, as in the panel below.
    const entries = shownFindings(problems);
    text = problems.length === 0 ? "✓ Clean" : `${String(entries.length)} to look at`;
    const missing = entries.find((entry) => "missing" in entry);
    if (missing && "missing" in missing) {
      detail = `${String(missing.missing.length)} required action(s) are not on any key yet`;
    }
    tone = errors > 0 ? "bad" : problems.length > 0 ? "warn" : "ok";
  }
  const chip = el(
    "button",
    {
      class: `pill lint ${tone}`,
      type: "button",
      title: detail === "" ? "Show the checks" : `Show the checks: ${detail}`,
    },
    [text],
  );
  chip.addEventListener("click", () => {
    if (state.mode !== "edit" && state.mode !== "in-game") {
      state.mode = "edit";
      render();
    }
    document.querySelector(".checks")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  return chip;
}

/** Whose tuning is unfolded, by pedal axis; kept across renders. */
const tuningOpen = new Set<string>();

/** What an edit to the pedals did to how the sticks read, until the next edit. */
let pedalsNote: string | null = null;

/** How the sticks read now, or null when there is nothing to read them against. */
function sticksReadingNow(): string | null {
  const set = stickModesFor();
  if (set === null) return null;
  const slugs = slugsInSet();
  const left = slugs.find((slug) => workingData(slug).profile.unit === "left");
  const right = slugs.find((slug) => workingData(slug).profile.unit === "right");
  if (left === undefined || right === undefined) return null;
  return readSticks(
    set,
    workingData(left).positions.stick,
    workingData(right).positions.stick,
    pedalsCarry(set, pedalsOfLayout()),
  ).text;
}

/**
 * Change the layout's pedals. The sticks are read against them (a pedal on yaw makes the
 * sticks' with-pedals variant the one in play), so an edit can change what the sticks are
 * called without touching them. It says so, rather than rewriting them.
 */
function editPedals(change: (pedals: SetPedals | undefined) => SetPedals | undefined): void {
  const before = sticksReadingNow();
  const layout = (editableSets().sets[state.setName] ??= {});
  const next = change(layout.pedals);
  if (next === undefined) Reflect.deleteProperty(layout, "pedals");
  else layout.pedals = next;
  const after = sticksReadingNow();
  pedalsNote =
    before !== null && after !== null && before !== after
      ? `The sticks now read as ${after}; before this edit they read as ${before}. ` +
        "Nothing on the sticks was changed. Open Stick mode to switch them."
      : null;
  render();
}

function changeAxis(
  axis: string,
  change: (assignment: PedalAssignment | undefined) => PedalAssignment | undefined,
): void {
  editPedals((pedals) => {
    if (pedals === undefined) return pedals;
    const assign = { ...pedals.assign };
    const next = change(assign[axis]);
    if (next === undefined) removeKey(assign, axis);
    else assign[axis] = next;
    return { ...pedals, assign };
  });
}

const TUNING_FIELDS = [
  ["dead_zone", "Dead zone", "DeadZone: how far the axis must move before the game notices."],
  ["scale", "Scale", "Scale: multiplies the axis."],
  ["sensitivity", "Sensitivity", "Sensitivity: the game's own response setting."],
  ["exponent", "Exponent", "Exponent: bends the response curve."],
] as const;

/** One pedal axis: what it drives, whether it is inverted, and how far its name is trusted. */
function renderPedalAxis(
  axis: string,
  device: PedalsDeviceData,
  pedals: SetPedals,
  modes: StickModeSet,
): HTMLElement {
  const game = currentGame();
  const spec = device.axes[axis];
  const assignment = pedals.assign[axis];
  const entry = spec?.names?.[game.slug];
  const trust = statusWords(entry?.status ?? null);
  const cell = el("div", {
    class: `pedal-axis${assignment === undefined ? " idle" : ""}`,
    "data-axis": axis,
  });

  const drives = el("select", { "aria-label": `${pedalAxisLabel(axis, spec)} drives` });
  drives.append(el("option", { value: "" }, ["Nothing"]));
  const known = Object.keys(modes.axes);
  if (assignment !== undefined && !known.includes(assignment.drives)) {
    drives.append(
      el("option", { value: assignment.drives }, [`${assignment.drives} (not a game axis)`]),
    );
  }
  for (const id of known) {
    const hint = gameAxisHint(id);
    drives.append(el("option", { value: id, title: hint }, [gameAxisLabel(id)]));
  }
  drives.value = assignment?.drives ?? "";
  drives.addEventListener("change", () => {
    const value = drives.value;
    changeAxis(axis, (current) =>
      value === ""
        ? undefined
        : current === undefined
          ? // Said outright, so the box below shows what the game will be given: its thrust
            // row is inverted as it ships, and an axis put there in silence would run backwards.
            { drives: value, invert: false }
          : { ...current, drives: value },
    );
  });

  const line = el("div", { class: "pedal-line" }, [
    el("b", { title: restSentence(spec) }, [pedalAxisLabel(axis, spec)]),
    drives,
  ]);
  if (assignment !== undefined) {
    const invert = el("input", { type: "checkbox", "data-field": "invert" });
    invert.checked = assignment.invert === true;
    invert.addEventListener("change", () => {
      changeAxis(axis, (current) => {
        if (current === undefined) return current;
        // Written either way. Removing it would leave the game's own setting in place, and
        // an unticked box over a row the game inverts would not mean what it shows.
        return { ...current, invert: invert.checked };
      });
    });
    line.append(
      el(
        "label",
        { class: "inv", title: "Reverse the direction. The game's row is set to match the box." },
        [invert, "Invert"],
      ),
    );
  }
  cell.append(line);

  const trustRow = el("div", { class: "pedal-trust" }, [
    el("span", { class: `chip trust-${entry?.status ?? "none"}`, title: trust.long }, [
      trust.short,
    ]),
  ]);
  cell.append(trustRow);

  if (assignment !== undefined && restsOnCentred(spec, modes, assignment.drives)) {
    cell.append(
      el("div", { class: "pedal-warn" }, [
        "Rests at one end, so with the foot off the game reads a full deflection.",
      ]),
    );
  }

  const set =
    TUNING_FIELDS.filter(([field]) => assignment?.[field] !== undefined).length +
    (assignment?.shared === true ? 1 : 0);
  // A button on the trust line rather than a row of its own: three rows of "Details" were
  // enough to push the page past a screen.
  const open = tuningOpen.has(axis);
  const toggle = el(
    "button",
    { class: "link-btn tune-toggle", type: "button", "aria-expanded": String(open) },
    [`${open ? "\u25be" : "\u25b8"} Details${set > 0 ? ` \u00b7 ${String(set)} tuned` : ""}`],
  );
  toggle.addEventListener("click", () => {
    if (open) tuningOpen.delete(axis);
    else tuningOpen.add(axis);
    render();
  });
  trustRow.append(toggle);
  const body = el("div", { class: "tune-body" });
  body.append(
    el("div", { class: "muted" }, [restSentence(spec)]),
    el("div", { class: "muted" }, [
      entry === undefined
        ? "The game has no name recorded for this axis."
        : `The game calls it ${entry.name}${entry.note === undefined ? "" : ` (${entry.note})`}.`,
    ]),
  );
  if (assignment !== undefined) {
    const grid = el("div", { class: "field-grid" });
    for (const [field, label, tip] of TUNING_FIELDS) {
      const input = el("input", {
        type: "number",
        step: "any",
        "data-field": field,
        title: `${tip} Blank leaves the game's value.`,
        placeholder: "game's own",
      });
      const value = assignment[field];
      if (value !== undefined) input.value = String(value);
      input.addEventListener("change", () => {
        const parsed = input.value.trim() === "" ? undefined : Number(input.value);
        changeAxis(axis, (current) => {
          if (current === undefined) return current;
          const next = { ...current };
          if (parsed === undefined || !Number.isFinite(parsed)) Reflect.deleteProperty(next, field);
          else next[field] = parsed;
          return next;
        });
      });
      grid.append(el("div", { class: "field" }, [el("label", {}, [label]), input]));
    }
    const shared = el("input", { type: "checkbox", "data-field": "shared" });
    shared.checked = assignment.shared === true;
    shared.addEventListener("change", () => {
      changeAxis(axis, (current) => {
        if (current === undefined) return current;
        const next = { ...current };
        if (shared.checked) next.shared = true;
        else Reflect.deleteProperty(next, "shared");
        return next;
      });
    });
    body.append(
      grid,
      el(
        "label",
        {
          class: "inv",
          title: "Two pedal axes may drive one game axis only when each says so.",
        },
        [shared, "Shared with another pedal axis"],
      ),
    );
  }
  if (open) cell.append(body);
  return cell;
}

/**
 * The layout's pedals, drawn with the keypads as one control scheme.
 *
 * The three pedal axes, what each drives, and how far the game's name for each is trusted.
 * Saved with everything else: there is no pedals button.
 */
function renderPedals(): HTMLElement {
  const modes = stickModesFor();
  const pedals = pedalsOfLayout();
  const devices = Object.values(pedalDevices());
  const panel = el("div", { class: "panel pedals" });
  const head = el("div", { class: "pedals-head" }, [el("h2", {}, ["Pedals"])]);
  panel.append(head);

  if (modes === null) {
    panel.append(
      el("div", { class: "note" }, [
        "This game's genre defines no game axes, so there is nothing for a pedal to drive.",
      ]),
    );
    return panel;
  }

  if (pedals === undefined) {
    const first = devices[0];
    if (first === undefined) {
      panel.append(el("div", { class: "note" }, ["No pedals device is defined in devices/."]));
      return panel;
    }
    panel.append(
      el("div", { class: "note" }, [
        "This layout has no pedals. Adding them puts the rudder on yaw; the toes are left " +
          "unassigned.",
      ]),
    );
    const chosen = el("select", { "aria-label": "Pedals device" });
    for (const device of devices) {
      chosen.append(el("option", { value: device.device }, [device.name ?? device.device]));
    }
    const add = el("button", { class: "btn small add-pedals", type: "button" }, ["Add pedals"]);
    add.addEventListener("click", () => {
      const device = pedalDevices()[chosen.value] ?? first;
      editPedals(() => defaultPedals(device.device, device, modes));
    });
    const row = el("div", { class: "row2" }, [add]);
    if (devices.length > 1) row.prepend(chosen);
    panel.append(row);
    if (pedalsNote !== null) panel.append(el("div", { class: "note pedals-note" }, [pedalsNote]));
    return panel;
  }

  const device = pedalDevices()[pedals.device];
  const remove = el("button", { class: "btn small remove-pedals", type: "button" }, ["Remove"]);
  remove.title = "Take the pedals out of this layout";
  remove.addEventListener("click", () => {
    editPedals(() => undefined);
  });
  head.append(el("span", { class: "muted" }, [device?.name ?? pedals.device]), remove);
  if (device === undefined) {
    panel.append(
      el("div", { class: "finding error" }, [
        `This layout names '${pedals.device}', which is not a pedals device.`,
      ]),
    );
    return panel;
  }
  const list = el("div", { class: "pedal-axes" });
  for (const axis of Object.keys(device.axes)) {
    list.append(renderPedalAxis(axis, device, pedals, modes));
  }
  panel.append(list);
  if (pedalsNote !== null) panel.append(el("div", { class: "note pedals-note" }, [pedalsNote]));
  return panel;
}

function renderChecks(): HTMLElement {
  const panel = el("div", { class: "panel" });
  panel.append(el("h2", {}, ["Checks"]));

  const result = currentLint();
  if ("error" in result) {
    panel.append(el("div", { class: "finding error" }, [result.error]));
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
  appendFindings(box, [...live, ...stale]);
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
/** Whether the In-game tab shows the keys. Null until asked: shown only when there is no
 *  game file for the editor to write them into. */
let wiringShown: boolean | null = null;

/** Whether the stick-mode panel is unfolded; kept across renders. */
let stickModesOpen = false;

/** What the action list is filtered by; kept across renders. */
let paletteFilter = "";

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
        /** Present when the saved file was a game's sets.yaml. */
        pedals?: {
          set: string;
          problem?: string;
          axes: {
            pedalAxis: string;
            label: string;
            drives: string;
            row: string | null;
            name: string | null;
            status: NameStatus | null;
          }[];
        };
      }
    | { error: string };
}

/**
 * What the game's pedals came to after a save of sets.yaml: for each axis the row it lands
 * on, the name the game would be given, and how far that name is trusted. Said in words,
 * because "saved" is not the same as "will work", and the page can only report the first.
 */
function renderPedalsVerdict(
  pedals: NonNullable<Extract<SaveResponse["check"], { built: unknown }>["pedals"]>,
): HTMLElement {
  const box = el("div", { class: "pedals-verdict" });
  if (pedals.axes.length === 0) {
    box.append(el("div", {}, [`${pedals.set} has no pedals, so the game's file gets none.`]));
  } else {
    box.append(el("div", {}, [`Pedals in ${pedals.set}, as the game's file would get them:`]));
    for (const axis of pedals.axes) {
      const trust = statusWords(axis.status).short.toLowerCase();
      box.append(
        el("div", { class: "muted" }, [
          `${axis.label} drives ${gameAxisLabel(axis.drives).toLowerCase()}` +
            (axis.row === null ? ", which reaches no game row" : ` (the game's ${axis.row} row)`) +
            (axis.name === null ? ", with no game name recorded yet" : ` as ${axis.name}`) +
            ` -- ${trust}.`,
        ]),
      );
    }
  }
  if (pedals.problem !== undefined) {
    box.append(
      el("div", { class: "finding error" }, [
        `The game's file cannot be written from this layout: ${pedals.problem}`,
      ]),
    );
  }
  return box;
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
  if (check.pedals !== undefined) box.append(renderPedalsVerdict(check.pedals));
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
  appendFindings(box, check.findings);
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

/**
 * Print the board: both hands, laid out as on screen, and nothing else.
 *
 * There is no separate sheet to keep in step with the editor -- the board is the reference,
 * and print CSS (see styles.ts) drops everything around it.
 */
function printLayout(): void {
  if (state.mode !== "edit") {
    state.mode = "edit";
    render();
  }
  window.print();
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
 * Tell the game: write its binding file from actions.yaml, and say what changed.
 *
 * Appends to the save report when there is one, so a save and an update read as one
 * step. The game rewrites the file when it exits, which is why the caller asks first.
 */
/**
 * The one name for writing this layout's keys and pedals into the game's own settings. It
 * is offered from the menu, after a save and on the Setup tab, and was called something
 * different on the last of those.
 */
const UPDATE_GAME = "Update the game's keys…";

interface GameUpdate {
  changes: { display: string; from: string; to: string }[];
  backup: string | null;
  pedals?: {
    changes: { display: string; field: string; from: string; to: string }[];
    waiting: { label: string; display: string }[];
  } | null;
}

/** What an update changed in the game's file: its keys, and the rows its pedals drive. */
function describeGameUpdate(result: GameUpdate): string {
  const keys = result.changes.map((change) => `${change.display} ${change.from} → ${change.to}`);
  const pedals = (result.pedals?.changes ?? []).map(
    (change) =>
      `${change.display} (${change.field === "Key1" || change.field === "Key2" ? "pedal" : change.field}) ` +
      `${change.from} → ${change.to}`,
  );
  const waiting = (result.pedals?.waiting ?? []).map((axis) => axis.label);
  const changed = [...keys, ...pedals];
  return (
    (changed.length === 0
      ? "The game already had these keys -- nothing to write."
      : `Updated the game: ${changed.join("; ")}.`) +
    (waiting.length === 0
      ? ""
      : ` Not written, because the game's name for it is not known: ${waiting.join(", ")}.`) +
    (result.backup === null ? "" : ` Its previous file is kept at ${result.backup}.`)
  );
}

/** Tell the game, and say what came of it. */
async function updateGame(game: EditorGame): Promise<{ ok: boolean; text: string }> {
  try {
    const reply = await post("/api/ingame/apply", { game: game.slug });
    if (reply.ok !== true) {
      return { ok: false, text: `The game was not updated: ${String(reply.error)}` };
    }
    return { ok: true, text: describeGameUpdate(reply.result as GameUpdate) };
  } catch (error) {
    return { ok: false, text: `Could not reach the server: ${messageOf(error)}` };
  }
}

/** Why the game cannot be updated just now, or null when it can. */
function gameUpdateBlocked(): string | null {
  const game = currentGame();
  const gaps = gameFileGaps(game);
  if (gaps.length > 0) {
    return `${game.name}'s keys cannot be written into the game yet: ${gaps[0] ?? ""}`;
  }
  // The game is updated from what is saved, so an unsaved key would be left out.
  if (inGameKeysPart().isDirty() || pedalsPart().isDirty()) {
    return "Save first: the game is updated from the saved in-game keys and pedals.";
  }
  return null;
}

/**
 * Ask whether the game is closed, then tell it. The one step of a save that writes outside
 * the repo -- into the game's own config -- so it is never implied by Save. `report` is
 * handed what came of it, so each place that offers the step shows the answer where it is.
 */
function confirmUpdateGame(report: (outcome: { ok: boolean; text: string }) => void): void {
  const game = currentGame();
  if (
    !window.confirm(
      `Is ${game.name} closed? It rewrites its key bindings when it exits, which would ` +
        "undo this. Its current file is kept beside the new one.",
    )
  ) {
    return;
  }
  void updateGame(game).then((outcome) => {
    report(outcome);
    render();
  });
}

/** Put what came of an update in the report under the header, where a save's verdict goes. */
function reportUpdateInSaveReport(outcome: { ok: boolean; text: string }): void {
  const target = saveReport ?? el("div", { class: "save-report" });
  saveReport = target;
  target.querySelector(".game-step")?.remove();
  target.append(el("div", outcome.ok ? {} : { class: "finding error" }, [outcome.text]));
}

/** The role tags an action can carry, in the order they are shown, and what each one does. */
const ACTION_TAGS: readonly { tag: string; means: string }[] = [
  { tag: "combat", means: "Used in a fight: never delayed by a long press or double tap." },
  { tag: "movement", means: "Moves you: must not latch on." },
  { tag: "travel", means: "Used for getting around: warping, docking, autopilot." },
  { tag: "menu", means: "Opens a menu or the pause screen: kept off combat keys." },
  { tag: "utility", means: "Anything else useful: interact, light, talk." },
  { tag: "required", means: "The layout must have this on a key; the checks complain if not." },
];

/** What changed in the in-game vocabulary since the page loaded, as the patch the server takes. */
function inGameKeyChanges(game: EditorGame): Record<string, BindingChange> {
  const loaded = game.actions.actions ?? {};
  const changes: Record<string, BindingChange> = {};
  for (const [id, spec] of Object.entries(state.workingActions ?? {})) {
    const before = loaded[id] ?? {};
    const change: BindingChange = {};
    for (const field of ["key", "meta", "mouse"] as const) {
      if ((spec[field] ?? null) !== (before[field] ?? null)) change[field] = spec[field] ?? null;
    }
    if (spec.label !== undefined && spec.label !== before.label) change.label = spec.label;
    // A list with nothing in it is a change when the loaded one had something: it is how a
    // tag the genre supplies is taken away.
    const tags = spec.tags ?? [];
    if (JSON.stringify(tags) !== JSON.stringify(before.tags ?? [])) change.tags = [...tags];
    if (Object.keys(change).length > 0) changes[id] = change;
  }
  return changes;
}

/** Whether a patch moves an action to another key, which is what the game has to be told. */
function changesAKey(changes: Record<string, BindingChange>): boolean {
  return Object.values(changes).some(
    (change) => "key" in change || "meta" in change || "mouse" in change,
  );
}

/** What one part's save wrote, and what the server made of it. */
interface PartSaved {
  path: string;
  result: SaveResponse;
  /** True when the in-game keys were written, which is what leaves the game behind. */
  inGameKeys?: boolean;
  /** True when the pedals of the layout the game's file is written for were saved. */
  inGamePedals?: boolean;
}

/**
 * One piece of the control scheme.
 *
 * A layout is one control scheme -- both keypads, the in-game keys, and whatever else is
 * played with -- saved together, so Save is one button over a list of these rather than a
 * button per thing. Anything with edits the page holds and a way to write them joins the
 * scheme by being one more entry in `schemeParts`; the header, the unsaved marker, the
 * report and the unload guard all follow from the list.
 */
interface SchemePart {
  /** What the unsaved marker and an error call it: "Left unit", "Wiring". */
  readonly name: string;
  isDirty(): boolean;
  /** Write it into the repo. Rejects with the reason, in words, when it cannot. */
  save(): Promise<PartSaved>;
}

async function saveResponse(path: string, body: unknown): Promise<SaveResponse> {
  const result = await post<SaveResponse>(path, body);
  if (!result.ok) throw new Error(result.error ?? "the server refused it");
  return result;
}

/** A keypad profile: its YAML, written over the file it came from. */
function keypadPart(slug: string): SchemePart {
  const sourceOf = () => currentGame().profiles.find((profile) => profile.slug === slug);
  return {
    get name() {
      const unit = state.working.get(slug)?.profile.unit ?? sourceOf()?.data.profile.unit;
      return `${unit === undefined ? slug : unitLabel(unit)} unit`;
    },
    isDirty() {
      const working = state.working.get(slug);
      if (!working) return false;
      const source = sourceOf();
      return !source || JSON.stringify(source.data) !== JSON.stringify(working);
    },
    async save() {
      const source = sourceOf();
      if (!source) throw new Error(`no profile ${slug}`);
      const data = structuredClone(workingData(slug));
      // No header: the server keeps whatever the file already had.
      const result = await saveResponse("/api/save", {
        path: source.path,
        content: dumpProfile(data, ""),
      });
      source.data = data;
      return { path: source.path, result };
    },
  };
}

/**
 * The keys inside the game. The server patches each action's line in place, so actions.yaml
 * keeps its `extends:`, its allowlist and its comments; regenerating it lost all three.
 */
function inGameKeysPart(): SchemePart {
  return {
    // Named for what is in it, so the unsaved marker does not call a rename a key.
    get name() {
      const changes = inGameKeyChanges(currentGame());
      const keys = changesAKey(changes);
      const names = Object.values(changes).some((change) => "label" in change || "tags" in change);
      if (keys && names) return "Wiring and action names";
      return names ? "Action names" : "Wiring";
    },
    isDirty: () => Object.keys(inGameKeyChanges(currentGame())).length > 0,
    async save() {
      const game = currentGame();
      const path = `${game.rel}/actions.yaml`;
      const changes = inGameKeyChanges(game);
      const result = await saveResponse("/api/actions", { game: game.slug, changes });
      game.actions.actions = structuredClone(state.workingActions ?? {});
      // The game is only offered the keys when there is a file of its own to write them to.
      return { path, result, inGameKeys: changesAKey(changes) && gameFileGaps(game).length === 0 };
    },
  };
}

/**
 * The layouts' pedals: sets.yaml, patched line by line so its comments and the other
 * layouts come through. One part for the whole file, because it is one file.
 */
function patchedSetsFile(game: EditorGame): { text: string; changed: string[] } {
  const working = currentSets(game);
  const changed = changedSets(game.sets, working);
  let text = game.setsText;
  for (const name of changed) text = patchSetPedals(text, name, working.sets[name]?.pedals ?? null);
  return { text, changed };
}

function pedalsPart(): SchemePart {
  return {
    name: "Pedals",
    isDirty: () =>
      state.workingSets !== null && changedSets(currentGame().sets, state.workingSets).length > 0,
    async save() {
      const game = currentGame();
      const working = structuredClone(currentSets(game));
      const { text, changed } = patchedSetsFile(game);
      const path = `${game.rel}/sets.yaml`;
      const result = await saveResponse("/api/save", { path, content: text });
      game.sets = working;
      game.setsText = text;
      return {
        path,
        result,
        inGamePedals: game.ingameSet !== undefined && changed.includes(game.ingameSet),
      };
    },
  };
}

/**
 * Everything that belongs to the control scheme: both keypads, the in-game keys and the
 * pedals. The header's Save, the unsaved marker, the unload guard and the report all follow
 * from this list, so a thing joins the scheme by being an entry here.
 */
function schemeParts(): SchemePart[] {
  return [
    ...currentGame().profiles.map((profile) => keypadPart(profile.slug)),
    inGameKeysPart(),
    pedalsPart(),
  ];
}

/** The parts of the scheme with edits that are not saved yet. */
function unsavedParts(): SchemePart[] {
  return schemeParts().filter((part) => part.isDirty());
}

/**
 * Save the whole control scheme as one: every part that changed, one report.
 *
 * Each part is written and checked in turn, and the report names them together; the check
 * is per game, so the last one speaks for all, and the import files are every one that
 * changed along the way. Changing the game's own file is not part of this -- it writes
 * outside the repo and needs the game closed -- but the report offers it when in-game keys
 * were saved.
 */
async function saveScheme(): Promise<void> {
  const parts = unsavedParts();
  if (parts.length === 0) return;
  saveNote = "saving...";
  saveReport = null;
  render();

  const saved: string[] = [];
  const built = new Map<
    string,
    { output: string; importPath: string; mirroredTo?: string; changed: boolean }
  >();
  let last: SaveResponse | null = null;
  let inGameKeys = false;
  let inGamePedals = false;
  for (const part of parts) {
    try {
      const done = await part.save();
      saved.push(done.path);
      last = done.result;
      inGameKeys ||= done.inGameKeys === true;
      inGamePedals ||= done.inGamePedals === true;
      const check = done.result.check;
      if (check && !("error" in check)) {
        for (const entry of check.built) if (entry.changed) built.set(entry.output, entry);
      }
    } catch (error) {
      saveNote =
        `not saved: ${part.name} -- ${messageOf(error)}` +
        (saved.length > 0 ? `. Already saved: ${saved.join(" and ")}.` : "");
      render();
      return;
    }
  }
  const path = saved.pop();
  if (last === null || path === undefined) return;
  const check = last.check;
  const merged: SaveResponse =
    check && !("error" in check)
      ? { ...last, check: { ...check, built: [...built.values()] } }
      : last;
  saveNote = null;
  const report = reportSave(path, merged, saved);
  if (inGameKeys || inGamePedals) {
    const what = inGameKeys && inGamePedals ? "keys and pedals" : inGamePedals ? "pedals" : "keys";
    const step = el("div", { class: "game-step" }, [
      el("div", {}, [`The game does not know about the new ${what} yet.`]),
    ]);
    const update = el("button", { class: "btn small", type: "button" }, [UPDATE_GAME]);
    update.addEventListener("click", () => {
      confirmUpdateGame(reportUpdateInSaveReport);
    });
    step.append(update);
    report.append(step);
  }
  saveReport = report;
  render();
}

/** Every unit's import file, for the Azeron app -- the main output when nothing can save. */
function downloadAll(): void {
  for (const slug of slugsInSet()) exportJson(slug);
}

/**
 * The layout as YAML, for pasting back into the repo when the page cannot save: each
 * unit's profile, the in-game keys, and the pedals when they were edited.
 */
function downloadLayoutYaml(): void {
  const game = currentGame();
  for (const slug of slugsInSet()) {
    // No header: the server keeps whatever the file already had.
    download(`${slug}.yaml`, dumpProfile(workingData(slug), ""), "text/yaml");
  }
  // The pedals are patched into the file's own text, so this one can replace the file: its
  // comments and the other layouts are in it.
  if (pedalsPart().isDirty()) {
    download("sets.yaml", patchedSetsFile(game).text, "text/yaml");
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
    resetSession();
    state.gameIndex = Number(gameSelect.value);
    state.working.clear();
    state.workingActions = null;
    state.workingSets = null;
    state.selected = null;
    state.setName = [...setsOf(currentGame()).keys()][0] ?? "";
    render();
  });
  const tabs = el("div", { class: "tabs" });
  for (const mode of ["edit", "in-game", "press-test", "repo"] as Mode[]) {
    const names: Record<Mode, string> = {
      edit: "Edit",
      "in-game": "In-game",
      "press-test": "Press test",
      repo: "Setup",
    };
    const tab = el(
      "button",
      { class: `btn ${state.mode === mode ? "primary" : ""}`, type: "button" },
      [names[mode]],
    );
    tab.addEventListener("click", () => {
      // Clicking the tab already open changes nothing; any other tab ends what the one
      // being left was in the middle of.
      if (mode !== state.mode) resetSession();
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
    pedalsNote = null;
    state.setName = setSelect.value;
    state.selected = null;
    render();
  });
  header.append(
    el("label", { class: "picker", title: "A layout is both keypads and the in-game keys" }, [
      el("span", {}, ["Layout"]),
      setSelect,
    ]),
  );
  header.append(el("span", { class: "spacer" }));

  header.append(renderLintChip());
  header.append(
    el("span", { class: `pill mode ${canSave() ? "ok" : ""}` }, [
      canSave() ? "saves to repo" : "downloads only",
    ]),
  );

  // One main action. Served, that is saving -- it rebuilds and says what to import, and it
  // reads Saved when there is nothing to save, which is the page's unsaved marker. Opened
  // as a file there is nowhere to save to, so the main action is the import files.
  if (canSave()) {
    // One Save for the whole control scheme -- both keypads and the in-game keys -- and the
    // unsaved marker says which parts it would write.
    const unsaved = unsavedParts();
    const dirty = unsaved.length > 0;
    const save = el("button", { class: `btn primary${dirty ? " dirty" : ""}`, type: "button" }, [
      dirty ? "Save" : "Saved",
    ]);
    if (dirty) save.title = `Unsaved: ${unsaved.map((part) => part.name).join(", ")}`;
    else save.setAttribute("disabled", "disabled");
    save.addEventListener("click", () => {
      void saveScheme();
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
  if (canSave()) {
    item("Download the import files", downloadAll);
    item(UPDATE_GAME, () => {
      const blocked = gameUpdateBlocked();
      if (blocked !== null) {
        saveNote = blocked;
        render();
        return;
      }
      confirmUpdateGame(reportUpdateInSaveReport);
    });
  } else {
    item("Download the layout as YAML", downloadLayoutYaml);
  }
  item("Print layout", printLayout);
  item("Undo all unsaved edits", () => {
    if (!confirmDiscard("Undoing them")) return;
    state.working.clear();
    state.workingActions = null;
    state.workingSets = null;
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
        // Asked once the file is known to be good, and not before: a wrong file should
        // not cost a question. The new data replaces every working copy.
        if (!confirmDiscard("Opening another data file")) return;
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
  item(`Use the ${currentTheme() === "dark" ? "light" : "dark"} theme`, () => {
    toggleTheme();
    render();
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

/**
 * What stands between this game and having its own key bindings written for it, in the
 * words of what is missing rather than of the file that would hold it. Empty when the game
 * is set up for it.
 *
 * Writing keys into a game means knowing where the game keeps its settings file, which part
 * of that file this layout controls, and which row of it each action is. Everspace 2 has
 * all three. A game started from an export has none, and the page used to say only that
 * `ingame_config` was missing from game.yaml.
 */
function gameFileGaps(game: EditorGame): string[] {
  const gaps: string[] = [];
  if (game.ingameFile?.configured !== true) {
    gaps.push(
      "the page has not been told where the game keeps its key settings, so it cannot read " +
        "or change them.",
    );
  }
  if ((game.ingameFile?.ownedCategories ?? 0) === 0) {
    gaps.push(
      "it does not know which parts of that file the layout controls, so it cannot tell its " +
        "own keys from the game's menu keys.",
    );
  }
  if (!Object.values(game.actions.actions ?? {}).some((spec) => spec.ingame !== undefined)) {
    gaps.push(
      "none of the actions names the row it is in the game's settings, so the page cannot " +
        "tell which setting each one changes.",
    );
  }
  return gaps;
}

/**
 * Says plainly why a game's own settings cannot be written yet, and what to do instead.
 * Null for a game that is set up for it.
 */
function gameFileStatus(game: EditorGame): HTMLElement | null {
  const gaps = gameFileGaps(game);
  if (gaps.length === 0) return null;
  const box = el("div", { class: "note game-file" }, [
    el("b", {}, [`${game.name}'s own key settings are not connected`]),
    el("div", {}, [
      "The keys below record what each action is bound to inside the game, and the checks " +
        "use them. Writing them into the game for you is not set up for this game: " +
        (gaps.length === 1
          ? (gaps[0] ?? "")
          : `${gaps.length === 2 ? "two" : "three"} things are missing:`),
    ]),
  ]);
  if (gaps.length > 1) {
    const list = el("ul", {});
    for (const gap of gaps) list.append(el("li", {}, [gap]));
    box.append(list);
  }
  box.append(
    el("div", {}, [
      "Until it is, set each key in the game's own controls screen to match this list. " +
        "Only Everspace 2's settings file is understood so far; connecting another game's " +
        "file is developer work, not something this page can do.",
    ]),
  );
  return box;
}

/** The action whose name is being typed, if any. */
let renaming: string | null = null;

/** Change an action's label. Empty is not a name: it puts the old one back. */
function renameAction(id: string, text: string): void {
  const label = text.trim();
  renaming = null;
  if (label !== "" && label !== actionSetFor(currentGame()).actions[id]?.label) {
    (editableActions()[id] ??= {}).label = label;
  }
  render();
}

/**
 * An action's name. Click it to type a new one; Enter keeps it and Escape leaves the old
 * one. Shown as plain bold text the rest of the time, so a list of forty reads as a list.
 */
function actionNameField(id: string, spec: ActionSpec): HTMLElement {
  if (renaming !== id) {
    const name = el(
      "b",
      { class: "rename", tabindex: "0", role: "button", title: "Click to rename" },
      [spec.label ?? id],
    );
    const edit = (): void => {
      renaming = id;
      render();
    };
    name.addEventListener("click", edit);
    name.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        edit();
      }
    });
    return name;
  }
  const input = el("input", {
    type: "text",
    class: "rename-input",
    value: spec.label ?? id,
    maxlength: "120",
    "aria-label": `Name of ${spec.label ?? id}`,
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
    else if (event.key === "Escape") {
      input.value = spec.label ?? id;
      input.blur();
    }
  });
  input.addEventListener("blur", () => {
    if (renaming === id) renameAction(id, input.value);
  });
  // The input is in the page once this render has finished.
  queueMicrotask(() => {
    input.focus();
    input.select();
  });
  return input;
}

/** The role tags as a row of toggles. What a tag does is in its tooltip. */
function actionTagField(id: string, spec: ActionSpec): HTMLElement {
  const row = el("div", {
    class: "tag-row",
    role: "group",
    "aria-label": `Roles of ${spec.label ?? id}`,
  });
  const have = new Set(spec.tags ?? []);
  for (const { tag, means } of ACTION_TAGS) {
    const on = have.has(tag);
    const chip = el(
      "button",
      { class: `tag-chip ${tag}${on ? " on" : ""}`, type: "button", title: means },
      [tag],
    );
    chip.setAttribute("aria-pressed", on ? "true" : "false");
    chip.addEventListener("click", () => {
      const editable = (editableActions()[id] ??= {});
      const current = editable.tags ?? spec.tags ?? [];
      // Keep the order the tags were in, with a new one at the end, so a toggle does not
      // reshuffle the line it is saved to.
      editable.tags = current.includes(tag)
        ? current.filter((existing) => existing !== tag)
        : [...current, tag];
      render();
    });
    row.append(chip);
  }
  return row;
}

function renderInGame(): HTMLElement {
  const game = currentGame();
  const actions = actionSetFor(game);
  const bound = boundActions();
  const panel = el("div", { class: "panel" });
  // The wiring is the editor's business when there is a game file to write it into, and
  // the owner's when there is not: then these are the keys to set in the game by hand.
  const connected = gameFileGaps(game).length === 0;
  const wiring = wiringShown ?? !connected;
  panel.append(el("h2", {}, [`${game.name} — actions`]));
  panel.append(
    el("div", { class: "note" }, [
      "Click a name to rename the action, and switch its roles on or off: the checks use " +
        "the roles, for instance to keep a menu off a combat key. " +
        (canSave()
          ? "Save, top right, writes these with both keypads."
          : "The menu's Download the layout as YAML includes actions.yaml."),
    ]),
  );
  const toggle = el("button", { class: "btn small", type: "button", "data-wiring": "toggle" }, [
    wiring ? "Hide the wiring" : "Show the wiring",
  ]);
  toggle.addEventListener("click", () => {
    wiringShown = !wiring;
    render();
  });
  panel.append(
    el("div", { class: "note wiring-note" }, [
      wiring
        ? "The wiring: the key each action is sent on. Click a key and press another to " +
          "move it; a clash shows up straight away. " +
          (connected
            ? "Saving offers to update the game's own file to match. "
            : "Set these same keys in the game's own controls screen. ")
        : "Each action is sent to the game on a key. The editor picks the key when an " +
          "action is first put on a control, and Update the game's keys… tells the game, so " +
          "there is nothing to set here. ",
      toggle,
    ]),
  );
  const gameFile = gameFileStatus(game);
  if (gameFile !== null) panel.append(gameFile);
  const unnamed = Object.values(actions.actions).filter((spec) =>
    (spec.label ?? "").endsWith("(unnamed)"),
  ).length;
  if (unnamed > 0) {
    panel.append(
      el("div", { class: "note" }, [
        `${String(unnamed)} action(s) are still named after their key. Rename each one for ` +
          "what it does in the game, and give it its roles.",
      ]),
    );
  }

  const table = el("div", { class: "ingame-list" });
  for (const [id, spec] of Object.entries(actions.actions)) {
    const where = bound.get(id);
    const item = el("div", { class: `ingame-row${where ? "" : " unbound"}` });
    item.append(
      el("div", { class: "who" }, [
        actionNameField(id, spec),
        el("small", {}, [
          spec.provided_by
            ? `${spec.provided_by} — not a keypad key`
            : (where?.join(", ") ?? "not sent by any unit"),
        ]),
      ]),
    );
    if (wiring) {
      if (spec.provided_by) item.append(el("div", { class: "muted" }, [spec.provided_by]));
      else item.append(actionKeyField(id));
    }
    item.append(actionTagField(id, spec));
    table.append(item);
  }
  panel.append(table);

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
async function refreshPayload(select?: string): Promise<boolean> {
  if (!canSave() || isDirty()) return false;
  try {
    const response = await fetch("/api/payload");
    if (!response.ok) return false;
    const payload = (await response.json()) as EditorPayload;
    const mode = state.mode;
    // A game that did not exist before is the one just made, so it is named; otherwise
    // the page stays on the game it was on.
    const gameSlug = select ?? currentGame().slug;
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

/** A heading and a sentence saying what a section of the Setup tab is for. */
function section(title: string, purpose: string): HTMLElement {
  return el("div", { class: "setup-section" }, [
    el("h3", {}, [title]),
    el("div", { class: "muted" }, [purpose]),
  ]);
}

/** One option per unit the repo has a pin map for, worded as the unit is. */
function unitSelect(selected: string): HTMLSelectElement {
  const select = el("select", {});
  for (const device of Object.values(state.payload.devices)) {
    const hand = device.hand ?? "";
    const option = el("option", { value: device.device }, [
      hand === "" ? device.device : `${unitLabel(hand)} unit`,
    ]);
    if (device.device === selected) option.setAttribute("selected", "selected");
    select.append(option);
  }
  return select;
}

/**
 * A button and a drop zone that both hand over a parsed Azeron export.
 *
 * Dropping the file does the same thing as the button, since that is how a file usually
 * arrives from the app's export dialog. A file that is not JSON, or has no profiles in it,
 * is reported here and never reaches the caller.
 */
function exportPicker(onChosen: (fileName: string, exported: unknown) => void): {
  upload: HTMLButtonElement;
  drop: HTMLElement;
  file: HTMLInputElement;
} {
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
      const profiles = (exported as { profiles?: unknown[] } | null)?.profiles;
      if (!Array.isArray(profiles) || profiles.length === 0) {
        repoNote = `${chosen.name} has no profiles in it -- is it an Azeron export?`;
        render();
        return;
      }
      onChosen(chosen.name, exported);
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
  return { upload, drop, file };
}

/** What the add-a-layout form holds: its name, and the export chosen for each unit. */
const addLayout: {
  name: string;
  files: Record<string, { name: string; exported: unknown }>;
} = { name: "", files: {} };

/** Turn the chosen exports into a layout of the current game, one profile per unit. */
async function addLayoutFromExports(): Promise<void> {
  const name = addLayout.name.trim();
  const chosen = Object.entries(addLayout.files);
  const say = (text: string): void => {
    repoNote = text;
    render();
  };
  if (!isFileName(name)) {
    say(
      name === ""
        ? "Give the layout a name first."
        : `"${name}" cannot be a layout name: letters, digits, dots and dashes only.`,
    );
    return;
  }
  if (chosen.length === 0) {
    say("Choose the export for at least one unit first.");
    return;
  }
  say(`adding ${name}...`);

  const game = currentGame().slug;
  const written: string[] = [];
  const sofar = (): string =>
    written.length === 0 ? "nothing was written." : `${written.join(" and ")} was written.`;
  let overwrite = false;
  for (const [device, file] of chosen) {
    const send = (): Promise<Record<string, unknown>> =>
      post("/api/import", {
        game,
        device,
        set: name,
        exported: file.exported,
        ...(overwrite ? { overwrite: true } : {}),
      });
    let result = await send();
    // A layout already in use would lose a profile and its committed template, which is
    // the only record of what the unit held. Asked, not assumed.
    if (result.ok !== true && result.status === 409 && !overwrite) {
      if (!window.confirm(`${String(result.error)}\n\nOverwrite it?`)) {
        say(`cancelled -- ${sofar()}`);
        return;
      }
      overwrite = true;
      result = await send();
    }
    if (result.ok !== true) {
      say(`not added: ${String(result.error)} -- ${sofar()}`);
      return;
    }
    written.push(String(result.profilePath));
  }

  addLayout.name = "";
  addLayout.files = {};
  const done = `Added ${name}: wrote ${written.join(" and ")}.`;
  if (await refreshPayload()) {
    // Straight to the board with the new layout on it, which is the proof it worked.
    state.setName = name;
    state.selected = null;
    state.mode = "edit";
    repoNote = `${done} It is the selected layout now.`;
    saveNote = repoNote;
  } else {
    repoNote = `${done} Save or discard your unsaved edits and reload the page to open it.`;
  }
  render();
}

/** What the new-game form holds. Module state, because every render rebuilds the page. */
const newGame: {
  name: string;
  genre: string;
  device: string;
  set: string;
  file: { name: string; exported: unknown } | null;
} = { name: "", genre: "", device: "", set: "v1", file: null };

/**
 * Starting a game that is not in the repo: a name, its genre, the export, which unit it
 * came from and what to call the layout. The server makes the folder, seeds the actions
 * from the keys the export sends, and the page selects the result.
 */
function renderNewGame(): HTMLElement {
  const box = el("div", { class: "field new-game" });
  box.append(
    section(
      "Add a new game",
      "For a game that is not in the Game selector. Export a profile for it from the Azeron " +
        "app, choose it below, and the editor starts the game from it. Every key the export " +
        "sends becomes an action named after the key -- rename them as you learn what they do.",
    ),
  );

  const genres = state.payload.genres.map((genre) => genre.name);
  if (newGame.genre === "" || !genres.includes(newGame.genre)) newGame.genre = genres[0] ?? "";
  const firstDevice = Object.values(state.payload.devices)[0]?.device ?? "";
  if (newGame.device === "") newGame.device = firstDevice;

  const name = el("input", {
    type: "text",
    value: newGame.name,
    placeholder: "e.g. Deep Rock Galactic",
    "data-new-game": "name",
  });
  const where = el("div", { class: "muted new-game-where" });
  const showWhere = (): void => {
    const slug = slugFromName(newGame.name.trim());
    where.textContent = isFileName(slug) ? `It will live in games/${newGame.genre}/${slug}/` : "";
  };
  name.addEventListener("input", () => {
    newGame.name = name.value;
    showWhere();
  });

  const genre = el("select", { "data-new-game": "genre" });
  for (const entry of genres) {
    const option = el("option", { value: entry }, [entry]);
    if (entry === newGame.genre) option.setAttribute("selected", "selected");
    genre.append(option);
  }
  genre.addEventListener("change", () => {
    newGame.genre = genre.value;
    showWhere();
  });

  const unit = unitSelect(newGame.device);
  unit.setAttribute("data-new-game", "unit");
  unit.addEventListener("change", () => {
    newGame.device = unit.value;
  });

  const layout = el("input", {
    type: "text",
    value: newGame.set,
    placeholder: "e.g. v1",
    "data-new-game": "layout",
  });
  layout.addEventListener("input", () => {
    newGame.set = layout.value;
  });
  showWhere();

  const picker = exportPicker((chosen, exported) => {
    newGame.file = { name: chosen, exported };
    repoNote = `${chosen} chosen. Press "Create game" when the rest is filled in.`;
    render();
  });
  const chosen = el("div", { class: "muted new-game-file" }, [
    newGame.file === null ? "No export chosen yet." : `Export: ${newGame.file.name}`,
  ]);

  const create = el("button", { class: "btn primary", type: "button" }, ["Create game"]);
  create.addEventListener("click", () => {
    const gameName = newGame.name.trim();
    const layoutName = newGame.set.trim();
    const problem =
      gameName === ""
        ? "Give the game a name first."
        : !isFileName(slugFromName(gameName))
          ? `"${gameName}" has no letters or digits to name a folder after.`
          : !isFileName(layoutName)
            ? `"${layoutName}" cannot be a layout name: letters, digits, dots and dashes only.`
            : newGame.file === null
              ? "Choose the export file for the game first."
              : null;
    if (problem !== null || newGame.file === null) {
      repoNote = problem ?? "Choose the export file for the game first.";
      render();
      return;
    }
    const exported = newGame.file.exported;
    repoNote = `creating ${gameName}...`;
    render();
    const send = (overwrite: boolean): void => {
      void post("/api/game", {
        name: gameName,
        genre: newGame.genre,
        device: newGame.device,
        set: layoutName,
        exported,
        ...(overwrite ? { overwrite: true } : {}),
      }).then((result) => {
        // The game is already there. Starting it again discards its actions.yaml, so it
        // is asked about rather than assumed.
        if (result.ok !== true && result.status === 409) {
          if (window.confirm(`${String(result.error)}\n\nReplace it?`)) {
            send(true);
            return;
          }
          repoNote = "cancelled -- nothing was written.";
          render();
          return;
        }
        if (result.ok !== true) {
          repoNote = `not created: ${String(result.error)}`;
          render();
          return;
        }
        const unnamed = result.unnamed as string[];
        const done =
          `Created ${String(result.name)} from ${newGame.file?.name ?? "the export"}: ` +
          `${String(result.actions)} action(s) named after the keys they send` +
          (unnamed.length > 0
            ? `, ${String(unnamed.length)} position(s) left raw (${unnamed.join(", ")})`
            : "") +
          ". Rename the actions as you learn what they do.";
        newGame.name = "";
        newGame.file = null;
        void refreshPayload(String(result.slug)).then((refreshed) => {
          if (refreshed) {
            state.mode = "edit";
            repoNote = `${done} It is selected in the Game selector now.`;
          } else {
            repoNote = `${done} Save or discard your unsaved edits and reload the page to open it.`;
          }
          render();
        });
      });
    };
    send(false);
  });

  box.append(
    el("div", { class: "row2" }, [
      el("div", { class: "field" }, [el("label", {}, ["Name of the game"]), name]),
      el("div", { class: "field" }, [el("label", {}, ["Kind of game"]), genre]),
    ]),
    where,
    el("div", { class: "row2" }, [
      el("div", { class: "field" }, [el("label", {}, ["Exported from"]), unit]),
      el("div", { class: "field" }, [el("label", {}, ["Name for the first layout"]), layout]),
    ]),
    el("div", { class: "row2" }, [picker.upload, create]),
    chosen,
    picker.drop,
    picker.file,
  );
  return box;
}

/**
 * The jobs done once in a while: units, bringing a profile in, the game's bindings, a
 * full rebuild. It was called Repo -- a git word -- and listed them without saying what
 * each was for.
 *
 * Only reachable when served: opened as a file there is nothing on the other end, and
 * the tab says so rather than offering buttons that cannot work.
 */
function renderRepo(): HTMLElement {
  const panel = el("div", { class: "panel" });
  panel.append(el("h2", {}, ["Setup"]));

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

  // A game that is not here yet comes first: it is what a new owner needs before anything
  // else on the tab means anything.
  panel.append(renderNewGame());

  // Importing an export: the round trip back from the Azeron app.
  const importRow = el("div", { class: "field" });
  importRow.append(
    section(
      `Add a layout to ${currentGame().name}`,
      `Export it in the Azeron app, then drop it here. It becomes another layout of ` +
        `${currentGame().name} that you can edit, and the export is kept as what the ` +
        "compiler builds on. For a game that is not in the Game selector, add the game above.",
    ),
  );

  // A name and an export per unit -- a layout is a pair, and either half alone is one too.
  // The name and the chosen files are kept across redraws: the form used to import the
  // moment a file was picked, refused if the name was still empty, and said so at the top
  // of the tab where nobody looking at the form would see it.
  const setName = el("input", {
    type: "text",
    value: addLayout.name,
    placeholder: "e.g. akimbo-v11",
    "data-add-layout": "name",
  });
  setName.addEventListener("input", () => {
    addLayout.name = setName.value;
  });

  const exports = el("div", { class: "unit-exports" });
  for (const device of Object.values(state.payload.devices)) {
    const unit = device.hand === undefined ? device.device : `${unitLabel(device.hand)} unit`;
    const picked = addLayout.files[device.device];
    const picker = exportPicker((chosen, exported) => {
      addLayout.files[device.device] = { name: chosen, exported };
      repoNote = `${chosen} chosen for the ${unit.toLowerCase()}. Press "Add layout" when ready.`;
      render();
    });
    picker.upload.textContent = picked === undefined ? "Choose file…" : "Choose another…";
    picker.upload.classList.remove("primary");
    picker.drop.textContent =
      picked === undefined ? `Drop the ${unit.toLowerCase()}'s export here.` : picked.name;
    if (picked !== undefined) picker.drop.classList.add("chosen");
    picker.drop.setAttribute("data-add-layout", device.device);
    exports.append(
      el("div", { class: "field unit-export" }, [
        el("label", {}, [`${unit}'s export`]),
        picker.drop,
        picker.upload,
        picker.file,
      ]),
    );
  }

  const add = el("button", { class: "btn primary", type: "button" }, ["Add layout"]);
  add.addEventListener("click", () => {
    void addLayoutFromExports();
  });

  importRow.append(
    el("div", { class: "row2" }, [
      el("div", { class: "field" }, [el("label", {}, ["Name for this layout"]), setName]),
    ]),
    exports,
    el("div", { class: "row2" }, [add]),
  );
  panel.append(importRow);

  // The game's own bindings, read from its config file.
  const fileStatus = gameFileStatus(currentGame());
  panel.append(
    section(
      "The game's keys",
      fileStatus === null
        ? "The keys and pedals inside the game come from this layout. Compare shows where the " +
            "game disagrees; Update makes it agree. Close the game first."
        : "Reading the game's own key settings, and writing this layout's keys into them.",
    ),
  );
  if (fileStatus !== null) panel.append(fileStatus);
  const ingameRow = el("div", { class: "field" });
  const check = el("button", { class: "btn", type: "button" }, ["Compare with the game's keys"]);
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
  // Writing is the other half, and the same step the menu and a save offer.
  const apply = el("button", { class: "btn primary", type: "button" }, [UPDATE_GAME]);
  apply.addEventListener("click", () => {
    const blocked = gameUpdateBlocked();
    if (blocked !== null) {
      repoNote = blocked;
      render();
      return;
    }
    confirmUpdateGame((outcome) => {
      repoNote = outcome.text;
    });
  });
  if (fileStatus === null) {
    ingameRow.append(check, apply);
    panel.append(ingameRow);
  }

  panel.append(section("Rebuild", "Every layout's import file, from scratch."));
  const buildRow = el("div", { class: "field" });
  const build = el("button", { class: "btn", type: "button" }, ["Rebuild every import file"]);
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
        "Saving already rebuilds what changed. This rebuilds every layout, for when a template or the vocabulary changed underneath them.",
      ]),
    ]),
  );
  panel.append(buildRow);

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

/** Key width, in pixels, the board may be drawn at. Below the floor the stage is scaled. */
const KEY_WIDTH = { min: 84, landscapeMax: 100, portraitMax: 124 } as const;

/**
 * Fit both units into the stage width, by narrowing the keys before shrinking anything.
 *
 * Scaling the whole stage shrinks the type with it: at a laptop width the pair was drawn at
 * 0.8 and the labels came out at seven pixels. The hands are built from the key width, so
 * the width they need is a straight line in it -- measured at two widths, solved for the
 * one that fits -- and the type stays the size it was written at. Only when even the
 * narrowest key does not fit is the stage scaled, and then only by the shortfall.
 *
 * On a portrait window the hands stack (see the stylesheet), so what has to fit is one
 * hand, and the keys may be wider than on a landscape one.
 */
function fitStage(wrap: HTMLElement, stage: HTMLElement): void {
  const available = wrap.clientWidth;
  if (available <= 0) return;
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  const max = portrait ? KEY_WIDTH.portraitMax : KEY_WIDTH.landscapeMax;
  stage.style.transform = "";
  const widthAt = (keyWidth: number): number => {
    stage.style.setProperty("--key-w", `${String(keyWidth)}px`);
    return stage.scrollWidth;
  };
  const narrow = widthAt(60);
  const wide = widthAt(100);
  if (narrow <= 0) return;
  const perPixel = (wide - narrow) / 40;
  const fixed = narrow - 60 * perPixel;
  const fits = perPixel > 0 ? Math.floor((available - fixed) / perPixel) : KEY_WIDTH.landscapeMax;
  const keyWidth = Math.max(KEY_WIDTH.min, Math.min(max, fits));
  const needed = widthAt(keyWidth);
  const scale = Math.min(1, available / needed);
  stage.style.transform = scale < 1 ? `scale(${String(scale)})` : "";
  wrap.style.height = `${String(Math.ceil(stage.scrollHeight * scale))}px`;
}

let resizeBound = false;
let unloadBound = false;
let captureBound = false;

/** The spare entry the inspector is showing for a position the profile has none for. */
let pendingSpec: { slug: string; position: string; spec: PositionSpec } | null = null;

/** Put the inspector's spare entry into the profile if it has been filled in. */
function adoptPendingSpec(): void {
  const pending = pendingSpec;
  pendingSpec = null;
  if (pending === null || Object.keys(pending.spec).length === 0) return;
  const data = state.working.get(pending.slug);
  if (data && data.positions[pending.position] === undefined) {
    data.positions[pending.position] = pending.spec;
  }
}

/**
 * Forget what belongs to one stretch of work on one game: a key being captured, a name being
 * typed, the press test. Called whenever the game, the tab or the data changes. It was
 * assigned in some of those places and not others, so a key captured on one game could land
 * on the next, and a press test went on with the game it was started for.
 */
function resetSession(): void {
  capturing = null;
  captureProblem = null;
  renaming = null;
  pendingSpec = null;
  if (probeHost !== null) {
    stopProbe();
    probeHost = null;
  }
}

function render(): void {
  adoptPendingSpec();
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

  // The board takes the full width and the panels dock under it, in what was empty
  // space. With a rail either side, the pair was scaled to under half size.
  const workspace = el("div", { class: "workspace board edit" });
  root.append(
    el("div", { class: "print-title" }, [`${currentGame().name} \u2014 ${state.setName}`]),
  );
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

  const side = el("div", { class: "dock-col" }, [renderChecks(), renderPedals()]);
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

  applyStoredTheme();
  // Page-wide leftovers of the last payload: a note about edits that no longer exist, and
  // which axes had their details open.
  pedalsNote = null;
  tuningOpen.clear();
  // The exports chosen for a layout were chosen against the data being replaced.
  addLayout.name = "";
  addLayout.files = {};
  dragging = null;
  wiringShown = null;
  const firstGame = payload.games[0];
  resetSession();
  state = {
    payload,
    mode: "edit",
    workingActions: null,
    workingSets: null,
    gameIndex: 0,
    setName: firstGame ? ([...setsOf(firstGame).keys()][0] ?? "") : "",
    working: new Map(),
    selected: null,
    slot: "tap",
  };
  render();
}

export { formatFinding };
