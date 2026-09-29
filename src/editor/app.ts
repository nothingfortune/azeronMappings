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
import { handLayout } from "../lib/layout.js";
import { ActionSet, Device, Profile } from "../lib/model-core.js";
import { SLOTS, STICK_DIRECTIONS } from "../types/azeron.js";
import type { Slot } from "../types/azeron.js";
import type { EditorGame, EditorPayload } from "../types/editor.js";
import type { ActionSpec, PositionSpec, ProfileData } from "../types/profile.js";
import { removeKey } from "../lib/object.js";
import { dumpYaml } from "../lib/yaml.js";
import { buildProbeProfile, buildStickCalibrationProfile } from "../lib/probe.js";
import type { ProbePayload } from "../types/probe.js";
import { start as startProbe, stop as stopProbe } from "./probe.js";
import { CSS } from "./styles.js";

declare global {
  interface Window {
    AZERON_PAYLOAD?: EditorPayload;
  }
}

type Mode = "edit" | "in-game" | "press-test" | "sheet";

interface State {
  payload: EditorPayload;
  mode: Mode;
  /** Hide the side rails so the pair gets the full width. */
  wide: boolean;
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
  const card = el("button", { class: classes, type: "button" });
  card.append(el("span", { class: "pos" }, [position]));

  if (!spec) {
    card.classList.add("empty");
  } else if (isStick) {
    card.append(el("span", { class: "name" }, [`Stick (${spec.mode ?? "?"})`]));
    for (const direction of STICK_DIRECTIONS) {
      const value = spec.directions?.[direction];
      if (value === undefined) continue;
      const label = typeof value === "string" ? actions.label(value) : (value.key ?? "raw");
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
function stickDial(slug: string, position: string): HTMLElement {
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
    const label =
      value === undefined
        ? null
        : typeof value === "string"
          ? actions.label(value)
          : (value.key ?? "raw");
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

  const hub = el("button", { class: "dir hub", type: "button", title: "stick" });
  hub.append(el("span", { class: "pos" }, ["stick"]));
  hub.append(el("span", { class: "name" }, [spec?.mode ?? "unbound"]));
  hub.addEventListener("click", select);
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
      el("span", {}, [`${device.name} · ${data.profile.unit ?? "?"} hand`]),
    ]),
  );

  const layout = handLayout(device);
  const columns = layout.columns.map((entry) =>
    el("div", { class: `col ${entry.kind}` }, [
      el("div", { class: "head" }, [entry.name]),
      ...entry.positions.map((position) => keyCard(slug, position)),
    ]),
  );

  const thumb = el("div", { class: "thumb" });
  if (layout.stick) thumb.append(stickDial(slug, layout.stick));
  for (const [position, cell] of layout.pad) thumb.append(keyCard(slug, position, cell));
  thumb.append(
    el(
      "div",
      { class: "aux" },
      layout.aux.map((position) => keyCard(slug, position)),
    ),
  );

  const body = el("div", { class: "hand-body" });
  const thumbBlock = el("div", {}, [el("div", { class: "head" }, ["thumb"]), thumb]);
  if (layout.thumbSide === "left") body.append(thumbBlock, ...columns);
  else body.append(...columns, thumbBlock);
  wrap.append(body);
  return wrap;
}

function boundActions(): Map<string, string[]> {
  const bound = new Map<string, string[]>();
  for (const slug of slugsInSet()) {
    const data = workingData(slug);
    const unit = data.profile.unit ?? slug;
    for (const [position, spec] of Object.entries(data.positions)) {
      const values: (string | undefined)[] = [
        ...SLOTS.map((slot) => (typeof spec[slot] === "string" ? spec[slot] : undefined)),
        ...Object.values(spec.directions ?? {}).map((value) =>
          typeof value === "string" ? value : undefined,
        ),
      ];
      for (const value of values) {
        if (!value) continue;
        const list = bound.get(value) ?? [];
        list.push(`${unit}:${position}`);
        bound.set(value, list);
      }
    }
  }
  return bound;
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

  const list = el("div", { class: "action-list" });
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

function assignToSelection(actionId: string): void {
  const selection = state.selected;
  if (!selection) return;
  const data = workingData(selection.slug);
  const spec = (data.positions[selection.position] ??= {});
  const device = profileFor(selection.slug).device;
  if (device.isStick(selection.position)) return;
  spec[state.slot] = actionId;
  const actions = actionSetFor(currentGame());
  spec.label ??= actions.label(actionId);
  render();
}

function renderInspector(): HTMLElement {
  const panel = el("div", { class: "panel" });
  panel.append(el("h2", {}, ["Key"]));
  const selection = state.selected;
  if (!selection) {
    panel.append(el("div", { class: "empty-state" }, ["Pick a key to edit it."]));
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
      el("div", {}, [`${selection.position} · ${data.profile.unit ?? "?"} hand`]),
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
      const wrap = el("div", { class: "field" }, [el("label", {}, [slot]), select]);
      if (slot === state.slot) wrap.setAttribute("data-active", "true");
      select.addEventListener("focus", () => {
        state.slot = slot;
      });
      panel.append(wrap);
    }

    const delays = el("div", { class: "row2" });
    for (const field of ["feature_delay", "double_delay"] as const) {
      const input = el("input", { type: "number", value: String(spec[field] ?? "") });
      input.addEventListener("change", () => {
        const value = Number(input.value);
        if (input.value === "" || Number.isNaN(value)) removeKey(spec, field);
        else spec[field] = value;
        render();
      });
      delays.append(el("div", { class: "field" }, [el("label", {}, [field]), input]));
    }
    panel.append(delays);

    const hold = el("input", { type: "checkbox" });
    if (spec.hold) hold.setAttribute("checked", "checked");
    hold.addEventListener("change", () => {
      if (hold.checked) spec.hold = true;
      else delete spec.hold;
      render();
    });
    panel.append(el("div", { class: "field" }, [el("label", {}, ["latch (isHold)"]), hold]));
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
    panel.append(el("div", { class: "finding error" }, [(error as Error).message]));
    return panel;
  }

  const live = result.live.filter((finding: Finding) => finding.rule !== "stale-acknowledgement");
  const box = el("div", { class: "checks" });
  if (live.length === 0) {
    box.append(
      el("div", { class: "finding" }, [
        `Clean. ${String(result.acknowledged.length)} acknowledged finding(s) in game.yaml.`,
      ]),
    );
  }
  for (const finding of live) {
    const item = el("div", { class: `finding ${finding.level}` });
    item.append(el("b", {}, [`${finding.rule} · ${finding.position ?? finding.key ?? "-"}`]));
    item.append(document.createTextNode(finding.message));
    box.append(item);
  }
  panel.append(box);
  panel.append(
    el("div", { class: "field muted" }, [
      el("small", {}, ["Same rules as `azeron lint`. Run it after pasting the YAML back."]),
    ]),
  );
  return panel;
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

function exportYaml(slug: string): void {
  download(`${slug}.yaml`, dumpProfile(workingData(slug)), "text/yaml");
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
    state.gameIndex = Number(gameSelect.value);
    state.working.clear();
    state.selected = null;
    state.setName = [...setsOf(currentGame()).keys()][0] ?? "";
    render();
  });
  for (const mode of ["edit", "in-game", "press-test", "sheet"] as Mode[]) {
    const names: Record<Mode, string> = {
      edit: "Edit",
      "in-game": "In-game",
      "press-test": "Press test",
      sheet: "Sheet",
    };
    const tab = el(
      "button",
      { class: `btn ${state.mode === mode ? "primary" : ""}`, type: "button" },
      [names[mode]],
    );
    tab.addEventListener("click", () => {
      if (state.mode === "press-test" && mode !== "press-test") stopProbe();
      state.mode = mode;
      render();
    });
    header.append(tab);
  }

  header.append(gameSelect);

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
  header.append(setSelect);
  header.append(el("span", { class: "spacer" }));

  for (const slug of slugsInSet()) {
    const unit = workingData(slug).profile.unit ?? slug;
    const yaml = el("button", { class: "btn", type: "button" }, [`YAML ${unit}`]);
    yaml.addEventListener("click", () => {
      exportYaml(slug);
    });
    const json = el("button", { class: "btn primary", type: "button" }, [`Import JSON ${unit}`]);
    json.addEventListener("click", () => {
      exportJson(slug);
    });
    header.append(yaml, json);
  }

  const wide = el("button", { class: `btn ${state.wide ? "primary" : ""}`, type: "button" }, [
    state.wide ? "Show panels" : "Wide",
  ]);
  wide.addEventListener("click", () => {
    state.wide = !state.wide;
    render();
  });
  header.append(wide);

  const reset = el("button", { class: "btn", type: "button" }, ["Reset"]);
  reset.addEventListener("click", () => {
    state.working.clear();
    state.selected = null;
    render();
  });
  header.append(reset);

  const theme = el("button", { class: "btn", type: "button" }, ["Theme"]);
  theme.addEventListener("click", () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  });
  header.append(theme);
  return header;
}

function actionKeyField(id: string): HTMLElement {
  const actions = editableActions();
  const spec = (actions[id] ??= {});
  const row = el("div", { class: "row2" });

  const key = el("input", { type: "text", value: spec.key ?? "", placeholder: "KeyF" });
  key.addEventListener("change", () => {
    const value = key.value.trim();
    if (value) spec.key = value;
    else removeKey(spec, "key");
    render();
  });
  const meta = el("input", { type: "text", value: spec.meta ?? "", placeholder: "modifier" });
  meta.addEventListener("change", () => {
    const value = meta.value.trim();
    if (value) spec.meta = value;
    else removeKey(spec, "meta");
    render();
  });
  row.append(
    el("div", { class: "field" }, [el("label", {}, ["key in game"]), key]),
    el("div", { class: "field" }, [el("label", {}, ["modifier"]), meta]),
  );
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
      "What each action is bound to inside the game. Changing a key here re-runs the " +
        "checks, so a collision shows up before it costs a fight. Export actions.yaml " +
        "and rebuild to keep it.",
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
    if (spec.mouse) {
      item.append(el("div", { class: "muted" }, [`mouse ${spec.mouse}`]));
    } else if (spec.provided_by) {
      item.append(el("div", { class: "muted" }, [spec.provided_by]));
    } else {
      item.append(actionKeyField(id));
    }
    table.append(item);
  }
  panel.append(table);

  const save = el("button", { class: "btn primary", type: "button" }, ["Export actions.yaml"]);
  save.addEventListener("click", () => {
    const header =
      `# ${game.name} -- every action and the in-game key it is bound to.\n` +
      "# Edited in the editor; save this over the game's actions.yaml and rebuild.\n";
    download(
      "actions.yaml",
      dumpYaml({ game: game.name, actions: actionSetFor(game).actions }, header),
      "text/yaml",
    );
  });
  panel.append(save);
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

  // The probe renders into the element directly, so it does not need to be attached yet.
  const host = el("div", {});
  panel.append(host);
  startProbe(probePayload(), host);
  return panel;
}

function renderSheet(): HTMLElement {
  const game = currentGame();
  const profiles = slugsInSet().map((slug) => profileFor(slug));
  const frame = el("iframe", { class: "sheet-frame", title: "cheatsheet" });
  frame.srcdoc = renderCheatsheet(profiles, actionSetFor(game));
  return frame;
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

function render(): void {
  const root = document.getElementById("app");
  if (!root) return;
  root.replaceChildren();
  root.append(renderHeader());

  if (state.mode === "in-game") {
    const workspace = el("div", { class: "workspace ingame" });
    const stage = el("div", { class: "stage" });
    for (const slug of slugsInSet()) stage.append(renderHand(slug));
    const stageWrap = el("div", { class: "stage-wrap" }, [stage]);
    workspace.append(stageWrap, renderInGame());
    root.append(workspace);
    requestAnimationFrame(() => {
      fitStage(stageWrap, stage);
    });
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

  const workspace = el("div", { class: `workspace ${state.wide ? "wide" : ""}` });
  if (!state.wide) workspace.append(renderPalette());

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

  if (!state.wide) {
    const right = el("div", {});
    right.append(renderInspector(), el("div", { style: "height:14px" }), renderChecks());
    workspace.append(right);
  }

  root.append(workspace);

  requestAnimationFrame(() => {
    fitStage(stageWrap, stage);
  });
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
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);

  const firstGame = payload.games[0];
  state = {
    payload,
    mode: "edit",
    wide: false,
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
