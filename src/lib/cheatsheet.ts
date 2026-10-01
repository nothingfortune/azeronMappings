/**
 * Per-profile learning aid: a layout diagram shaped like the Azeron app, plus the
 * checklist of in-game bindings the profile assumes.
 */

import { SLOTS, STICK_DIRECTIONS } from "../types/azeron.js";
import type { Slot } from "../types/azeron.js";
import type { KeySlotSpec, PositionSpec, SlotSpec } from "../types/profile.js";
import { handLayout } from "./layout.js";
import { ROLE_TAGS } from "./lint.js";
import type { ActionSet, Profile } from "./model-core.js";
import { bindingLabel } from "./keys.js";

const CSS = `
:root {
  --bg: #f6f7f9; --fg: #16181d; --muted: #5c6370; --card: #fff; --line: #d8dce3;
  --combat: #b8433a; --movement: #2f7d4f; --menu: #6a4fb3; --travel: #b1701c; --utility: #4a5568;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #14161a; --fg: #e7e9ee; --muted: #99a0ad; --card: #1d2026; --line: #333944;
    --combat: #e2786d; --movement: #6fc38f; --menu: #a98fe0; --travel: #d9a05b; --utility: #9aa5b5;
  }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 28px; background: var(--bg); color: var(--fg);
       font: 14px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif; }
h1 { font-size: 20px; margin: 0 0 2px; }
h2 { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted);
     margin: 26px 0 10px; }
.sub { color: var(--muted); margin-bottom: 4px; }
.layout { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.unit { margin-bottom: 26px; }
.unit h2 { text-transform: capitalize; color: var(--fg); font-size: 15px; letter-spacing: 0;
           margin: 0 0 10px; }
.unit h2 .sub { color: var(--muted); font-size: 12px; font-weight: 400; display: inline; }
.hand { display: flex; gap: 8px; align-items: flex-start; }
.col { display: flex; flex-direction: column; gap: 8px; }
.col > .head { font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
               color: var(--muted); text-align: center; }
.key { background: var(--card); border: 1px solid var(--line); border-left-width: 3px;
       border-radius: 8px; padding: 7px 9px; width: 132px; min-height: 58px; }
.key.empty { opacity: .38; }
.key .pos { font-size: 10px; color: var(--muted); }
.key .tap { font-weight: 600; }
.key .row { font-size: 11.5px; color: var(--muted); }
.key .k { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.combat { border-left-color: var(--combat); }
.movement { border-left-color: var(--movement); }
.menu { border-left-color: var(--menu); }
.travel { border-left-color: var(--travel); }
.utility { border-left-color: var(--utility); }
.thumb { display: grid; grid-template-columns: repeat(3, 132px); gap: 8px; }
.thumb .stickwrap { grid-column: 1 / span 3; }
.stick-dial { grid-column: 1 / span 3; display: grid; gap: 4px; margin-bottom: 6px;
              grid-template-columns: repeat(3, 132px); grid-template-rows: repeat(3, auto); }
.stick-dial .dir { border: 1px solid var(--line); border-radius: 8px; background: var(--card);
                   padding: 6px; min-height: 48px; display: flex; flex-direction: column;
                   align-items: center; justify-content: center; gap: 1px; text-align: center; }
.stick-dial .dir.empty { opacity: .35; border-style: dashed; }
.stick-dial .glyph { font-size: 15px; line-height: 1; color: var(--movement); }
.stick-dial .dir .name { font-size: 11px; font-weight: 600; line-height: 1.2; }
.stick-dial .dir .k { font-size: 10px; color: var(--muted);
                      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.stick-dial .dir .pos { font-size: 10px; color: var(--muted); }
.stick-dial .up { grid-area: 1 / 2; }
.stick-dial .left { grid-area: 2 / 1; }
.stick-dial .hub { grid-area: 2 / 2; }
.stick-dial .right { grid-area: 2 / 3; }
.stick-dial .down { grid-area: 3 / 2; }
.thumb .up { grid-column: 2; } .thumb .left { grid-column: 1; }
.thumb .center { grid-column: 2; } .thumb .right { grid-column: 3; }
.thumb .down { grid-column: 2; }
.warn { color: var(--combat); font-size: 11.5px; }
table { border-collapse: collapse; width: 100%; max-width: 760px; }
th, td { text-align: left; padding: 5px 10px; border-bottom: 1px solid var(--line); font-size: 13px; }
th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase;
     letter-spacing: .06em; }
td.k { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.box { color: var(--muted); }
`;

function esc(text: string | number | null | undefined): string {
  return String(text ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );
}

interface Described {
  label: string | null;
  key: string | null;
  role: string | null;
}

function describe(actions: ActionSet, value: SlotSpec | undefined): Described {
  if (value === null || value === undefined) return { label: null, key: null, role: null };
  if (typeof value === "string") {
    const spec = actions.actions[value] ?? {};
    const key = bindingLabel(spec);
    const tags = new Set(spec.tags ?? []);
    return {
      label: spec.label ?? value,
      key: key ?? null,
      role: ROLE_TAGS.find((tag) => tags.has(tag)) ?? null,
    };
  }
  const inline = value as KeySlotSpec & { key_raw?: string; meta_raw?: string };
  const key = bindingLabel(inline) ?? inline.key_raw ?? inline.meta_raw ?? null;
  return { label: "(raw)", key: key ?? null, role: null };
}

const DIR_GLYPH: Record<string, string> = {
  up: "&#8593;",
  right: "&#8594;",
  down: "&#8595;",
  left: "&#8592;",
};

/** The stick drawn as a compass, so each direction sits where it points. */
function stickDial(
  profile: Profile,
  actions: ActionSet,
  position: string,
  spec: PositionSpec,
): string {
  const cells = STICK_DIRECTIONS.map((direction) => {
    const value = spec.directions?.[direction];
    const described = describe(actions, typeof value === "string" ? value : (value ?? null));
    const empty = described.label === null ? " empty" : "";
    return (
      `<div class="dir ${direction}${empty}">` +
      `<span class="glyph">${DIR_GLYPH[direction] ?? ""}</span>` +
      `<span class="name">${esc(described.label ?? "")}</span>` +
      `<span class="k">${esc(described.key ?? "")}</span></div>`
    );
  }).join("");

  return (
    `<div class="stick-dial">${cells}` +
    `<div class="dir hub"><span class="pos">${esc(position)}</span>` +
    `<span class="name">${esc(spec.mode ?? "unbound")}</span></div></div>`
  );
}

function keyCard(profile: Profile, actions: ActionSet, position: string, extraClass = ""): string {
  const spec: PositionSpec | undefined = profile.positions[position];
  if (!spec) {
    return `<div class="key empty ${extraClass}"><div class="pos">${esc(position)}</div></div>`;
  }

  if (profile.device.isStick(position)) {
    return stickDial(profile, actions, position, spec);
  }

  const tap = describe(actions, spec.tap);
  const parts = [`<div class="pos">${esc(position)}</div>`];
  parts.push(`<div class="tap">${esc(spec.label ?? tap.label ?? "")}</div>`);
  if (tap.label) {
    parts.push(
      `<div class="row">tap ${esc(tap.label)} <span class="k">${esc(tap.key ?? "")}</span></div>`,
    );
  }
  for (const slot of ["long", "double"] as const) {
    const described = describe(actions, spec[slot]);
    if (!described.label) continue;
    parts.push(
      `<div class="row">${slot} ${esc(described.label)} <span class="k">${esc(described.key ?? "")}</span></div>`,
    );
  }
  if (spec.hold) parts.push('<div class="warn">latches until pressed again</div>');
  if (spec.feature_delay && (spec.long ?? spec.double)) {
    parts.push(`<div class="warn">tap waits ${esc(spec.feature_delay)} ms</div>`);
  }
  return `<div class="key ${tap.role ?? ""} ${extraClass}">${parts.join("")}</div>`;
}

/** One unit: its title line and its key grid. */
function renderHand(profile: Profile, actions: ActionSet): string {
  const device = profile.device;
  const layout = handLayout(device);

  const columnHtml = layout.columns.map((entry) => {
    const cells = [`<div class="head">${esc(entry.name)}</div>`];
    for (const position of entry.positions) cells.push(keyCard(profile, actions, position));
    return `<div class="col">${cells.join("")}</div>`;
  });

  const thumb: string[] = [];
  if (layout.stick) thumb.push(keyCard(profile, actions, layout.stick));
  for (const [position, cell] of layout.dpad) thumb.push(keyCard(profile, actions, position, cell));
  const aux = layout.aux.map((position) => keyCard(profile, actions, position)).join("");
  const thumbBlock =
    `<div><div class="thumb">${thumb.join("")}</div>` +
    `<div class="col" style="margin-top:8px">${aux}</div></div>`;

  const body =
    layout.thumbSide === "left"
      ? `${thumbBlock}<div class="hand">${columnHtml.join("")}</div>`
      : `<div class="hand">${columnHtml.join("")}</div>${thumbBlock}`;

  return (
    `<section class="unit"><h2>${esc(profile.unit ?? profile.slug)} unit` +
    `<span class="sub"> ${esc(device.name)}${device.verified ? "" : " (not press-tested)"}` +
    `</span></h2><div class="layout">${body}</div></section>`
  );
}

/** Every action the given profiles use, and the key each assumes in game. */
function bindingRows(profiles: readonly Profile[], actions: ActionSet): string {
  const used = new Map<string, string[]>();
  for (const profile of profiles) {
    const unit = profile.unit ?? profile.slug;
    for (const [position, spec] of Object.entries(profile.positions)) {
      const values: (SlotSpec | string | undefined)[] = [
        ...SLOTS.map((slot: Slot) => spec[slot]),
        ...Object.values(spec.directions ?? {}),
      ];
      for (const value of values) {
        if (typeof value !== "string") continue;
        const where = used.get(value) ?? [];
        const label = `${unit}:${position}`;
        if (!where.includes(label)) where.push(label);
        used.set(value, where);
      }
    }
  }

  return [...used.keys()]
    .sort((a, b) => actions.label(a).localeCompare(actions.label(b)))
    .map((id) => {
      const spec = actions.actions[id] ?? {};
      const key = bindingLabel(spec) ?? "";
      return (
        `<tr><td class="box">&#9744;</td><td>${esc(spec.label ?? id)}</td>` +
        `<td class="k">${esc(key)}</td><td class="k">${esc((used.get(id) ?? []).join(", "))}</td>` +
        `<td>${esc((spec.tags ?? []).join(", "))}</td></tr>`
      );
    })
    .join("");
}

/**
 * One page per set, with every unit in it.
 *
 * A pair is learned as a pair: the hands are drawn side by side in the orientation they
 * rest in, and the in-game binding checklist covers both.
 */
export function renderCheatsheet(profiles: readonly Profile[], actions: ActionSet): string {
  const first = profiles[0];
  if (!first) throw new Error("renderCheatsheet needs at least one profile");
  const title = first.set ?? first.name ?? first.slug;
  const units = profiles.map((profile) => renderHand(profile, actions)).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body>
<h1>${esc(title)}</h1>
<div class="sub">${profiles.map((p) => esc(p.name ?? p.slug)).join(" &middot; ")}</div>
${units}
<h2>In-game bindings to set</h2>
<table><tr><th></th><th>Action</th><th>Key</th><th>Sent from</th><th>Tags</th></tr>${bindingRows(profiles, actions)}</table>
</body></html>
`;
}
