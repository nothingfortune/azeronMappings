/* Tokens first, so the dark set is written once and used by both ways into it: the user's
   choice (data-theme) and the OS (prefers-color-scheme) when the user has not chosen. */
/* Every role and state colour is at least 4.7:1 against --bg, --panel and --raised in its
   theme, and --panel text on it (a role switch that is on) at least 5.3:1. See
   docs/plans/reskin-spec.md before changing one. */
const LIGHT = `
  --bg: #eef1f5; --panel: #ffffff; --raised: #ffffff; --sunken: #e7ebf0; --hover: #f1f4f8;
  --fg: #12161c; --muted: #566070; --line: #d6dce4; --line-strong: #b6c0cc;
  --accent: #0b74b8; --accent-fg: #ffffff; --focus: #0b74b8;
  --accent-soft: color-mix(in srgb, var(--accent) 12%, transparent);
  --combat: #c23a2b; --movement: #0d7656; --menu: #6a4bd0; --travel: #985700; --utility: #4b596e;
  --error: #c0153c; --warn: #7f5c00; --ok: #2c7a1e;
  --key-top: #ffffff; --key-bottom: #f0f3f7; --key-lip: rgb(20 30 45 / .16);
  --key-glint: rgb(255 255 255 / .9); --plate: #f6f8fb;
  --shadow-1: 0 1px 2px rgb(20 30 45 / .06), 0 1px 3px rgb(20 30 45 / .06);
  --shadow-2: 0 6px 16px rgb(20 30 45 / .10), 0 2px 4px rgb(20 30 45 / .06);
  --shadow-3: 0 24px 60px rgb(20 30 45 / .24), 0 4px 12px rgb(20 30 45 / .10);
  --scrim: rgb(20 26 36 / .42);
`;
const DARK = `
  --bg: #0d1015; --panel: #151920; --raised: #1c212a; --sunken: #0f1218; --hover: #232a35;
  --fg: #e9edf3; --muted: #98a2b3; --line: #272e39; --line-strong: #3a4352;
  --accent: #4fb3ff; --accent-fg: #061320; --focus: #4fb3ff;
  --accent-soft: color-mix(in srgb, var(--accent) 16%, transparent);
  --combat: #ff7b6b; --movement: #4fd1a5; --menu: #b39dff; --travel: #f5b14c; --utility: #a2b0c6;
  --error: #ff5a73; --warn: #ffd25e; --ok: #8bdc6e;
  --key-top: #262c37; --key-bottom: #1d222b; --key-lip: rgb(0 0 0 / .55);
  --key-glint: rgb(255 255 255 / .06); --plate: #12161c;
  --shadow-1: 0 1px 2px rgb(0 0 0 / .35);
  --shadow-2: 0 8px 20px rgb(0 0 0 / .40), 0 2px 4px rgb(0 0 0 / .30);
  --shadow-3: 0 28px 70px rgb(0 0 0 / .60), 0 4px 14px rgb(0 0 0 / .35);
  --scrim: rgb(0 0 0 / .62);
`;

/* Not themed: the scales. Type 12 / 13 / 15 / 18 / 24, spacing on 4, three radii. */
const SCALES = `
  --fs-1: 12px; --fs-2: 13px; --fs-3: 15px; --fs-4: 18px; --fs-5: 24px;
  --r-sm: 6px; --r-md: 10px; --r-lg: 14px;
  --ease: 150ms cubic-bezier(.2, .7, .3, 1);
  --header-h: 56px;
  --font: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", sans-serif;
  --mono: ui-monospace, "Cascadia Code", Consolas, SFMono-Regular, Menlo, monospace;
`;

/** Injected by the editor at runtime so the whole page ships in one bundle. */
export const CSS = `
:root { ${LIGHT} ${SCALES} --key-w: 94px; --key-h: 50px; color-scheme: light; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { ${DARK} color-scheme: dark; }
}
:root[data-theme="dark"] { ${DARK} color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 400 var(--fs-2)/1.5 var(--font);
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
}
button, select, input, textarea { font: inherit; color: inherit; }
h1, h2, h3 { font-weight: 700; }
::selection { background: color-mix(in srgb, var(--accent) 35%, transparent); }
/* One focus ring everywhere a keyboard user lands. */
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
/* Hover and selection ease; nothing else moves. */
.btn, select, input, textarea, .key, .stick-dial .dir, .action, .game-card, .picker-item,
.tag-chip, .dock-tab, .menu-item, .mode-row, .slot-pick, .key-chip, .bind-chip, .device-key,
.link-btn, .pill {
  transition: background-color var(--ease), border-color var(--ease), color var(--ease),
              box-shadow var(--ease), opacity var(--ease);
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: var(--line-strong); border-radius: 99px;
                            border: 2px solid transparent; background-clip: padding-box; }
::-webkit-scrollbar-track { background: transparent; }
header {
  display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
  padding: 7px 16px; border-bottom: 1px solid var(--line); background: var(--panel);
  position: sticky; top: 0; z-index: 5;
}
header h1 { font-size: 15px; margin: 0 8px 0 0; letter-spacing: .01em; }
header .spacer { flex: 1; }
header { gap: 8px; }
/* The tabs read as one control rather than five loose buttons. */
header .tabs { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
header .tabs .btn { border: 0; border-radius: 0; }
header .tabs .btn + .btn { border-left: 1px solid var(--line); }
.btn.dirty::before { content: "● "; font-size: 9px; vertical-align: middle; }
.btn[disabled] { opacity: .45; cursor: not-allowed; box-shadow: none; }
.pill.lint { cursor: pointer; font: inherit; font-size: 11px; }
.pill.lint.warn { border-color: var(--warn); color: var(--warn); }
.pill.lint.bad { border-color: var(--error); color: var(--error); }
.panel.fold > summary { display: flex; align-items: baseline; justify-content: space-between;
                        gap: 8px; cursor: pointer; list-style: none; }
.panel.fold > summary::-webkit-details-marker { display: none; }
.panel.fold > summary h2 { margin: 0; }
.panel.fold > summary h2::before { content: "▸ "; }
.panel.fold[open] > summary h2::before { content: "▾ "; }
.panel.fold[open] > summary { margin-bottom: 9px; }
.palette-target { font-weight: 600; font-size: 12.5px; margin-bottom: 8px; color: var(--accent); }
.panel .filter { width: 100%; margin-bottom: 8px; padding: 5px 9px; border: 1px solid var(--line);
                 border-radius: 7px; background: var(--bg); color: var(--fg); font: inherit; }
.field.slot { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
.field.slot > label { flex: 0 0 76px; margin: 0; }
.key-where { font-weight: 600; font-size: 12.5px; margin-bottom: 8px; }
.field.check { display: flex; flex-direction: row-reverse; justify-content: flex-end;
               align-items: center; gap: 8px; }
.field.check label { margin: 0; text-transform: none; letter-spacing: 0; font-size: 12px;
                     color: var(--fg); }
.field.check input { width: auto; }
.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px; }
.palette-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.palette-bar h2 { margin: 0; }
.palette-bar .filter { flex: 1; width: auto; margin: 0; min-width: 0; }
.slot-pick { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
             text-align: left; padding: 6px 9px; border: 1px solid var(--line);
             border-radius: 7px; background: var(--bg); color: var(--fg); cursor: pointer;
             font: inherit; font-weight: 600; }
.slot-pick.unset { color: var(--muted); font-weight: 400; font-style: italic; }
.field.slot[data-active] .slot-pick { border-color: var(--accent);
                                      box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent); }
.row-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.setup-section { margin: 18px 0 8px; padding-top: 12px; border-top: 1px solid var(--line); }
.setup-section h3 { margin: 0 0 2px; font-size: 13px; }
.menu { position: relative; }
.menu > summary { list-style: none; }
.menu > summary::-webkit-details-marker { display: none; }
.menu-items { position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; min-width: 250px;
              display: grid; padding: 4px; background: var(--panel); border: 1px solid var(--line);
              border-radius: 8px; box-shadow: 0 8px 24px rgb(0 0 0 / .18); }
.menu-item { text-align: left; background: none; border: 0; padding: 7px 10px; border-radius: 6px;
             color: var(--fg); cursor: pointer; font: inherit; }
.menu-item:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
/* Text boxes take the theme too; the browser's own are white in a dark page. They are wells:
   sunken, where buttons are raised. */
input:not([type="checkbox"]):not([type="file"]):not([type="radio"]), textarea {
  background: var(--sunken); border: 1px solid var(--line); border-radius: var(--r-sm);
  padding: 6px 10px;
}
input:not([type="checkbox"]):not([type="file"]):not([type="radio"]):hover, textarea:hover {
  border-color: var(--line-strong); }
input:not([type="checkbox"]):not([type="file"]):not([type="radio"]):focus-visible, textarea:focus-visible {
  outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
input::placeholder, textarea::placeholder { color: var(--muted); }
input[type="checkbox"], input[type="radio"] { accent-color: var(--accent); }
select, .btn {
  background: var(--raised); border: 1px solid var(--line); border-radius: var(--r-md);
  padding: 6px 12px; cursor: pointer; font-weight: 500; line-height: 1.35;
  box-shadow: var(--shadow-1);
}
select { padding-right: 8px; }
.btn:hover, select:hover { background: var(--hover); border-color: var(--line-strong); }
.btn:active:not([disabled]) { background: var(--sunken); box-shadow: none; }
.btn.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent);
               font-weight: 600; }
.btn.primary:hover { background: color-mix(in srgb, var(--accent) 86%, var(--fg));
                     border-color: color-mix(in srgb, var(--accent) 86%, var(--fg)); }
.btn.primary:active:not([disabled]) { background: color-mix(in srgb, var(--accent) 80%, var(--bg)); }
.btn[disabled]:hover { background: var(--raised); border-color: var(--line); }
.btn.primary[disabled]:hover { background: var(--accent); border-color: var(--accent); }
/* What the last thing done on this tab came to. It stays in view while the tab scrolls: the
   tab is taller than the window, and a message at its top was missed from a form below. */
.repo-note { color: var(--fg); border-left: 3px solid var(--accent); padding: 6px 8px;
             position: sticky; top: 52px; z-index: 2; background: var(--panel);
             border-radius: 0 6px 6px 0; box-shadow: 0 1px 4px rgba(0, 0, 0, .18); }
.unit-exports { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
                gap: 10px; margin: 6px 0; }
.unit-export .dropzone { padding: 10px; margin-bottom: 6px; }
.unit-export .dropzone.chosen { border-style: solid; color: var(--fg); }
.mode-row { display: block; width: 100%; text-align: left; background: var(--bg);
            border: 1px solid var(--line); border-radius: 7px; padding: 6px 8px;
            margin-bottom: 4px; cursor: pointer; color: inherit; }
.mode-row:hover { border-color: var(--accent); }
.mode-row.active { border-color: var(--accent); background: var(--panel); }
.mode-row b { display: block; font-size: 12px; }
.mode-row small { display: block; color: var(--muted); font-size: 10.5px; line-height: 1.3; }
.dropzone { border: 1px dashed var(--line); border-radius: 8px; padding: 14px; text-align: center;
            color: var(--muted); font-size: 11.5px; margin-top: 6px; }
.dropzone.over { border-color: var(--accent); color: var(--fg); background: var(--bg); }
.save-note { padding: 6px 16px; background: var(--panel); border-bottom: 1px solid var(--line);
             font-size: 12px; color: var(--muted); display: flex; gap: 12px; align-items: flex-start; }
.save-report { flex: 1; display: grid; gap: 4px; min-width: 0; }
.finding .rule { display: block; font-size: 10px; color: var(--muted); }
.finding { overflow-wrap: anywhere; }
.save-report .import-path code { user-select: all; overflow-wrap: anywhere; color: var(--fg); }
.save-note .dismiss { flex: none; }
.workspace.single { display: block; }
/* A chooser over the page: what goes on a key, a controller button. */
.picker-overlay { position: fixed; inset: 0; z-index: 20; background: rgba(0, 0, 0, .45);
                  display: flex; align-items: flex-start; justify-content: center; padding: 6vh 16px; }
.picker-dialog { background: var(--panel); color: var(--fg); border: 1px solid var(--line);
                 border-radius: 12px; width: min(760px, 100%); max-height: 86vh; display: flex;
                 flex-direction: column; box-shadow: 0 18px 50px rgba(0, 0, 0, .35); }
.picker-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px 6px; }
.picker-tabs { display: flex; gap: 6px; padding: 0 14px 8px; }
.picker-body { overflow: auto; padding: 0 14px 14px; }
.picker-search { width: 100%; margin-bottom: 8px; }
.picker-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px; }
.picker-item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left;
               padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg);
               color: var(--fg); cursor: pointer; }
.picker-item:hover { border-color: var(--accent); }
.picker-item[hidden] { display: none; }
.picker-item small { color: var(--muted); font-size: 11px; }
.device-key.choosable { cursor: pointer; color: var(--fg); }
.device-key.choosable:hover { border-color: var(--accent); }
/* The games, as a gallery: the first step. */
.game-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
                gap: 12px; margin-top: 12px; }
.game-card { display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
             padding: 14px; min-height: 110px; text-align: left; cursor: pointer;
             border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); }
.game-card:hover { border-color: var(--accent); }
.game-card.current { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent); }
.game-card.add { border-style: dashed; color: var(--muted); }
.game-card .game-name { font-size: 15px; }
.game-card .game-genre { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
.game-card .game-facts { font-size: 12px; color: var(--muted); }
header .game-switch { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Unit runs and save notes: over the foot of the window, scrolling in themselves, so
   nothing above them moves. The page is padded by the tray's height while it shows. */
.run-tray { position: fixed; left: 0; right: 0; bottom: 0; z-index: 6; max-height: 45vh;
            overflow-y: auto; background: var(--panel); border-top: 1px solid var(--line);
            box-shadow: 0 -6px 18px rgba(0, 0, 0, .18); }
.run-tray[hidden] { display: none; }
.run-tray.entering { animation: tray-in .16s ease-out; }
@keyframes tray-in { from { transform: translateY(100%); } to { transform: none; } }
.run-tray > * + * { border-top: 1px solid var(--line); }
.run-tray .save-note, .run-tray .check-bar { border-bottom: 0; }
/* A tab that is one column of forms or a list reads better at a column's width, centred. */
.workspace.single > .panel { max-width: 1280px; margin-inline: auto; }
.panel.inset { background: var(--bg); margin-bottom: 12px; }
/* Boards on the left, the in-game half on the right, so the two can be read together. */
.ingame-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
               gap: 2px 14px; margin-bottom: 10px; }
.ingame-row { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 8px;
              align-items: center; padding: 3px 4px; border-radius: 6px; }
.ingame-row:nth-child(odd) { background: var(--bg); }
.ingame-row.unbound { opacity: .55; }
.ingame-row .who { min-width: 0; }
.ingame-row .who b { display: block; font-size: 12px; font-weight: 600; }
.ingame-row .who small { display: block; color: var(--muted); font-size: 10px;
                         overflow-wrap: anywhere; }
.ingame-row .who b.rename { cursor: text; border-radius: 4px; }
.ingame-row .who b.rename:hover, .ingame-row .who b.rename:focus-visible {
  outline: 1px dashed var(--accent); outline-offset: 1px; }
.rename-input { width: 100%; padding: 2px 5px; font-size: 12px; font-weight: 600;
                border: 1px solid var(--accent); border-radius: 4px; background: var(--panel); }
.tag-row { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 3px; }
.tag-chip { padding: 0 6px; font-size: 10px; line-height: 16px; border-radius: 9px; cursor: pointer;
            border: 1px solid var(--line); background: transparent; color: var(--muted); }
.tag-chip:hover { border-color: var(--accent); }
.tag-chip.on { color: var(--panel); border-color: transparent; background: var(--utility); }
.tag-chip.on.combat { background: var(--combat); }
.tag-chip.on.movement { background: var(--movement); }
.tag-chip.on.menu { background: var(--menu); }
.tag-chip.on.travel { background: var(--travel); }
.tag-chip.on.required { background: var(--accent); }
.ingame-row .field { margin-bottom: 0; }
.ingame-row .field label { font-size: 10px; }
.ingame-row .field input { padding: 2px 5px; font-size: 11px; }
.ingame-row .row2 { gap: 5px; }
header .picker { display: inline-flex; align-items: center; gap: 6px; }
header .picker span { font-size: 9.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.unit-settings { margin-top: 10px; display: grid; gap: 4px; }
.unit-settings .row2 { flex-wrap: wrap; align-items: center; }
.keybind { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.key-chip, .bind-chip { min-width: 96px; padding: 5px 12px; border-radius: 7px; border: 1px solid var(--line);
            border-bottom-width: 3px; background: var(--panel); color: var(--fg);
            font: 600 13px/1.2 ui-sans-serif, system-ui, sans-serif; cursor: pointer; text-align: center; }
.key-chip:hover, .bind-chip:hover { border-color: var(--accent); }
.key-chip.unset, .bind-chip.unset { color: var(--muted); font-weight: 400; font-style: italic; }
.key-chip.capturing, .bind-chip.capturing { border-color: var(--accent); color: var(--accent);
                      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent); }
.btn.small { padding: 3px 8px; font-size: 12px; }
.keybind-note { flex-basis: 100%; font-size: 11px; color: var(--warn); }
.keybind-note.bad { color: var(--error); }
/* Not dimmed and not dead when nothing is selected: an action can still be dragged. */
.note { font-size: 11.5px; color: var(--muted); margin-bottom: 10px; }
.workspace { padding: 12px 14px; max-width: 2400px; margin-inline: auto; }
/* The board on top at full width; the panels dock beneath it. */
.dock { display: grid; grid-template-columns: 280px minmax(0, 1fr) 250px; gap: 12px;
        margin-top: 12px; align-items: start; }
.dock.ingame { grid-template-columns: minmax(0, 1fr) 300px; }
.dock-col { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }
/* The third column is tabs: one of checks, pedals and stick modes at a time. */
.dock-col.tabbed { align-content: start; }
.dock-col.tabbed > * { grid-column: 1 / -1 !important; grid-row: auto !important; }
.dock-tabs { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid var(--line); }
.dock-tab { background: none; border: 1px solid transparent; border-bottom: none;
            border-radius: 6px 6px 0 0; padding: 5px 10px; color: var(--muted); cursor: pointer;
            font: inherit; font-size: 13px; }
.dock-tab.active { background: var(--panel); border-color: var(--line); color: var(--fg); font-weight: 600; }
.dock-tab.bad { color: var(--error); }
.dock-tab.warn { color: var(--warn, var(--muted)); }
.dock-tab.ok { color: var(--ok); }
/* Narrow, or tall and narrow: the checks drop to a row of their own under the other two. */
@media (max-width: 1150px), (orientation: portrait) {
  .dock { grid-template-columns: 300px minmax(0, 1fr); }
  .dock > .dock-col { grid-column: 1 / -1; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
                      align-items: start; }
  /* The pedals take the wide column, their three axes side by side, beside the checks. */
  .dock-col > .pedals { grid-column: 2; grid-row: 1 / span 2; }
}
@media (max-width: 760px) { .dock > .dock-col { grid-template-columns: minmax(0, 1fr); }
                            .dock-col > .pedals { grid-column: 1; grid-row: auto; } }
@media (max-width: 1150px), (orientation: portrait) { .dock.ingame { grid-template-columns: 1fr; } }
@media (max-width: 760px) { .dock, .dock.ingame { grid-template-columns: 1fr; } }
/* A wide landscape window has room for a column beside the board: the key inspector rises
   beside it and the checks sit beside the actions, so the whole workflow is on one screen.
   The dock dissolves into the workspace grid for this; narrower, it is a row under the board. */
@media (min-width: 1700px) and (orientation: landscape) {
  .workspace.board.edit { display: grid; grid-template-columns: minmax(0, 1fr) 340px;
                          gap: 12px; align-items: start; }
  .workspace.board.edit > .stage-wrap { grid-column: 1; grid-row: 1; }
  .workspace.board.edit > .dock { display: contents; }
  .workspace.board.edit .dock > .inspector { grid-column: 2; grid-row: 1; }
  .workspace.board.edit .dock > .palette { grid-column: 1; grid-row: 2; }
  .workspace.board.edit .dock > .dock-col { grid-column: 2; grid-row: 2; }
}
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-lg);
         padding: 14px; box-shadow: var(--shadow-1); }
.panel h2 {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em;
  color: var(--muted); margin: 0 0 10px;
}
/* Both units stay on one row on a landscape window, because a pair is read as a pair; the
   keys narrow to fit (see fitStage) rather than the type shrinking. On a portrait window the
   pair stacks, each hand at a readable size, instead of two hands squeezed into the width. */
/* Centred in whatever room there is. "safe" keeps a board wider than its room at the left
   edge, where the scale that then fits it starts from. */
.workspace.board .stage-wrap { overflow: hidden; display: flex; justify-content: safe center; }
.workspace.board .stage { display: flex; gap: 14px; align-items: stretch; flex-wrap: nowrap;
         transform-origin: top left; width: max-content; flex: none;
         /* Its own height: stretched to the scaled wrap, the hands came out shorter than their keys. */
         align-self: flex-start; }
@media (orientation: portrait) {
  .workspace.board .stage { flex-direction: column; width: 100%; }
  .workspace.board .stage > .hand { align-self: stretch; }
  /* A stacked hand is as wide as the window; its keys sit in the middle of it. */
  .workspace.board .hand-body { align-items: center; }
  .workspace.board .hand-body.thumb-right .thumb-row,
  .workspace.board .hand-body.thumb-left .thumb-row { align-items: center; }
}
.hand { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
        padding: 8px 10px 10px; }
.hand > .title { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.hand > .title b { font-size: 13px; }
.hand > .title span { color: var(--muted); font-size: 11.5px; }
/* Scoped to the board: the press test draws a hand too, with its own .hand-body, and an
   unscoped rule here stacked its columns into one. */
.workspace.board .hand-body { display: flex; flex-direction: column; gap: 8px; }
.fingers { display: flex; gap: 6px; align-items: flex-start; }
.thumb-row { display: flex; flex-direction: column; }
.workspace.board .hand-body.thumb-right .thumb-row { align-items: flex-end; }
.workspace.board .hand-body.thumb-left .thumb-row { align-items: flex-start; }
.col { display: flex; flex-direction: column; gap: 4px; }
.col.side { margin-top: 22px; }
.col .head, .hand .head {
  font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted);
  text-align: center; height: 13px; white-space: nowrap;
}
/* Every key is one size, whatever is on it: the board is a picture of the unit, and a key
   that grew with its label pushed the ones under it out of line. */
.key {
  width: var(--key-w); height: var(--key-h); border: 1px solid var(--line); border-radius: 7px;
  background: var(--bg); padding: 3px 6px; cursor: pointer; text-align: left; display: flex;
  flex-direction: column; gap: 1px; border-left-width: 3px; border-left-color: var(--line);
  overflow: hidden;
}
.key:hover { border-color: var(--accent); }
.key.selected { outline: 2px solid var(--accent); outline-offset: 1px; }
.key.empty { opacity: .3; border-style: dashed; border-left-style: dashed;
             justify-content: center; }
.key.empty .name { display: none; }
/* Each line is its own block; as inline spans they ran together into one string. */
.key .pos { display: block; font-size: 10px; color: var(--muted); line-height: 1.2; }
/* The name narrows with the key, so a word like "Consumable" still fits on a line at the
   narrowest key rather than breaking in the middle. */
.key .name { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
             overflow: hidden; font-weight: 600; line-height: 1.2;
             font-size: clamp(11px, calc(var(--key-w) * .13), 12px);
             overflow-wrap: anywhere; }
/* A key with more on it than its name gives the name one line and the rest another. */
.key.has-extra .name { -webkit-line-clamp: 1; }
.key .sub { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            font-size: 10px; line-height: 1.25; color: var(--muted); }
.key .sub.flag { color: var(--warn); }
/* A key the unit does something else on until the layout is imported. */
.key.unit-stale { box-shadow: inset 0 0 0 2px var(--warn); position: relative; }
.key.unit-stale::after { content: "≠ unit"; position: absolute; top: 3px; right: 6px;
                         font-size: 9px; line-height: 1.2; color: var(--warn); }
.units-report > .btn { justify-self: start; }
/* Checking a unit by pressing it: the key to press next, and what each one sent. */
.check-bar { display: grid; gap: 6px; padding: 8px 16px; background: var(--panel);
             border-bottom: 1px solid var(--line); }
.check-bar .check-ask { font-size: 14px; }
.check-bar .check-count, .check-bar .check-note { color: var(--muted); font-size: 12px; }
.check-bar .check-buttons { display: flex; gap: 6px; flex-wrap: wrap; }
.check-bar .check-verdict { font-weight: 600; }
.check-bar .check-verdict.ok { color: var(--ok); }
.check-bar .check-verdict.bad { color: var(--error); }
.check-bar .check-differing { margin: 0 0 0 18px; padding: 0; }
.write-bar .write-slots { display: grid; gap: 4px; }
.write-bar .write-slots label { display: flex; gap: 8px; align-items: center; font-size: 13px; }
.write-bar .field { max-width: 320px; }
.write-bar .write-others { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 12px; }
.probe-units-actions, .check-note .naming-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.check-note .naming-row { margin-top: 6px; }
.key.check-next, .dir.check-next { outline: 3px solid var(--accent); outline-offset: 1px;
                                   animation: check-pulse 1s ease-in-out infinite; }
.key.check-ok, .dir.check-ok { box-shadow: inset 0 0 0 2px var(--ok); }
/* The key tester: what a unit just sent, lit on the board while it is held. */
.key.live-hit, .dir.live-hit { outline: 3px solid var(--accent); outline-offset: 1px;
                               background: color-mix(in srgb, var(--accent) 22%, var(--panel)); }
.tester-bar .tester-recent { margin: 0 0 0 18px; padding: 0; font-size: 13px; }
.tester-bar .tester-recent li.unmatched { color: var(--warn); }
/* A control pressed during a test: stays marked, so what is left is what is unmarked. */
.hand .key.tested, .stick-dial .dir.tested { box-shadow: inset 0 0 0 2px var(--ok); }
.test-keys.primary { outline: 2px solid var(--accent); }
.key.check-bad, .dir.check-bad { box-shadow: inset 0 0 0 2px var(--error); }
@keyframes check-pulse { 50% { outline-color: color-mix(in srgb, var(--accent) 35%, transparent); } }
@media (prefers-reduced-motion: reduce) {
  .key.check-next, .dir.check-next { animation: none; }
}
.hand > .title .check-unit { margin-left: auto; align-self: center; }
.hand > .title .write-unit { align-self: center; }
.units-report .unit-behind { margin-top: 8px; }
.units-report .unit-differences { margin: 4px 0 6px 18px; padding: 0; }
.units-report .unit-differences li { margin: 2px 0; }
/* Drag and drop: what is being carried, and where it may be put down. */
.key[draggable="true"], .action[draggable="true"] { cursor: grab; }
.drop-over { outline: 2px dashed var(--accent); outline-offset: 1px; }
.manage-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 6px; }
.btn.danger { color: var(--error); border-color: var(--error); }
.new-action-row { margin-top: 8px; }
.new-action-row input { width: 100%; }
.ingame-row .delete-action { align-self: center; }
/* What the action is on for a keyboard and mouse, and for a controller. */
.player-binds { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; grid-column: 1 / -1; min-width: 0; }
.player-bind { display: inline-flex; gap: 4px; align-items: center; flex-wrap: wrap; min-width: 0; }
.player-bind .bind-kind { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.player-bind select { width: auto; max-width: 100%; min-width: 0; }
.player-bind .bind-hint { font-size: 11px; color: var(--muted); }
/* The bindings drawn on a keyboard, a mouse and a controller. */
.device-boards { margin: 6px 0 10px; }
.device-boards summary { cursor: pointer; color: var(--muted); font-size: 12px; }
.device-boards-body { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 8px; }
.device-board { display: grid; gap: 3px; min-width: 0; max-width: 100%; overflow-x: auto; }
.control-list { margin: 6px 0 10px; }
.control-list summary { cursor: pointer; color: var(--muted); font-size: 12px; }
.control-list textarea { width: 100%; margin-top: 6px; font: 12.5px/1.4 ui-monospace, monospace; }
.device-row { display: flex; gap: 3px; }
.pad-board { display: flex; gap: 22px; align-items: flex-start; flex-wrap: wrap; }
.pad-side { display: grid; gap: 4px; justify-items: center; }
.pad-cross { display: grid; grid-template-columns: repeat(3, 64px); grid-auto-rows: 38px; gap: 3px; }
.pad-cross .device-key { width: 64px; }
.device-row.other-keys { flex-wrap: wrap; }
.device-key { width: calc(var(--w, 1) * 40px); min-height: 38px; padding: 2px; border-radius: 5px;
              border: 1px solid var(--line); background: var(--bg); color: var(--muted);
              display: flex; flex-direction: column; align-items: center; justify-content: center;
              font: 10px/1.15 ui-sans-serif, system-ui, sans-serif; flex: none; overflow: hidden; }
.device-key.bound { background: var(--panel); color: var(--fg); border-color: var(--accent); cursor: pointer; }
.device-key.shared { border-color: var(--warn); }
.device-key-name { font-weight: 600; }
.device-key-action { font-size: 9px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.device-caption { font-size: 10.5px; color: var(--muted); text-transform: uppercase; margin-top: 4px; }
.ingame-row.picked { outline: 2px solid var(--accent); }
.clear-hint { display: none; margin-top: 6px; padding: 6px; border: 1px dashed var(--line);
              border-radius: 6px; text-align: center; font-size: 11.5px; color: var(--muted); }
body.dragging-key .clear-hint { display: block; }
body.dragging-key .palette.drop-over .clear-hint { border-color: var(--accent); color: var(--fg); }
body.dragging-key .palette.drop-over { outline: none; }
.key.combat { border-left-color: var(--combat); }
.key.movement { border-left-color: var(--movement); }
.key.menu { border-left-color: var(--menu); }
.key.travel { border-left-color: var(--travel); }
.key.utility { border-left-color: var(--utility); }
/* The thumb cluster is two devices and some spare keys. Each gets its own labelled
   group, and the stick is drawn as a dial so it never reads as another d-pad. */
.thumb-cluster { display: flex; gap: 8px; align-items: flex-start; }
.thumb-group { border: 1px solid var(--line); border-radius: 9px; padding: 6px;
               background: color-mix(in srgb, var(--bg) 60%, transparent); }
.thumb-group > .head { margin-bottom: 4px; }
.dpad { display: grid; grid-template-columns: repeat(3, var(--key-w)); gap: 4px; }
.dpad .up { grid-area: 1 / 2; }
.dpad .left { grid-area: 2 / 1; }
.dpad .center { grid-area: 2 / 2; }
.dpad .right { grid-area: 2 / 3; }
.dpad .down { grid-area: 3 / 2; }
.aux { display: flex; flex-direction: column; gap: 4px; }

.stick-dial {
  display: grid; gap: 3px;
  grid-template-columns: repeat(3, var(--key-w)); grid-template-rows: repeat(3, var(--key-h));
}
.stick-dial.selected { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 8px; }
.stick-dial .dir {
  border: 1px solid var(--line); border-radius: 7px; background: var(--bg); color: inherit;
  padding: 4px 5px; cursor: pointer; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 1px; height: var(--key-h); text-align: center; overflow: hidden;
}
.stick-dial .dir:hover { border-color: var(--accent); }
.stick-dial .dir.empty { opacity: .35; border-style: dashed; }
.stick-dial .glyph { font-size: 13px; line-height: 1; color: var(--movement); }
.stick-dial .dir .name { font-size: 11px; font-weight: 600; line-height: 1.15;
                         overflow-wrap: anywhere; }
.stick-dial .up { grid-area: 1 / 2; }
.stick-dial .left { grid-area: 2 / 1; }
.stick-dial .right { grid-area: 2 / 3; }
.stick-dial .down { grid-area: 3 / 2; }
/* The hub is the stick pressed in, drawn as the wheel the Azeron software shows. */
/* The stick pressed in. Its wheel sits beside its name: every cell is one key high, and a
   wheel above two lines of text does not fit in that. */
.stick-dial .hub { grid-area: 2 / 2; border: none; background: none; gap: 5px;
                   flex-direction: row; padding: 2px 3px; }
.stick-dial .hub .name { text-align: left; }
.stick-dial .hub .wheel {
  width: 24px; height: 24px; flex: none; border-radius: 50%; border: 2px solid var(--line);
  background:
    radial-gradient(circle at center, var(--panel) 0 26%, transparent 27%),
    conic-gradient(from -22.5deg,
      var(--line) 0 45deg, transparent 45deg 90deg,
      var(--line) 90deg 135deg, transparent 135deg 180deg,
      var(--line) 180deg 225deg, transparent 225deg 270deg,
      var(--line) 270deg 315deg, transparent 315deg 360deg);
}
.stick-dial .hub:hover .wheel { border-color: var(--accent); }
.stick-dial .hub.empty .wheel { opacity: .5; }

/* Columns, so the groups pack with no empty cells and the list is as tall as it needs to be
   rather than a scroll region of its own. */
.action-list { columns: 132px; column-gap: 8px; }
.action-list > .head { break-after: avoid; margin: 8px 0 3px; text-align: left; }
.action-list > .head:first-child { margin-top: 0; }
.action {
  display: flex; align-items: center; gap: 6px; padding: 2px 6px; border-radius: 6px;
  border: 1px solid var(--line); cursor: pointer; text-align: left; background: var(--bg);
  width: 100%; break-inside: avoid; margin-bottom: 3px;
}
.action:hover { border-color: var(--accent); }
/* Already on a key somewhere in this layout: stepped back, so what is still to place stands
   out. It can still be picked up -- the same action may sit on more than one key. */
.action.bound { opacity: .5; }
.action.bound:hover { opacity: 1; }
.action .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--muted); }
.action .dot.combat { background: var(--combat); }
.action .dot.movement { background: var(--movement); }
.action .dot.menu { background: var(--menu); }
.action .dot.travel { background: var(--travel); }
.action .dot.utility { background: var(--utility); }
.action .txt { flex: 1; min-width: 0; }
.action .txt b { font-weight: 600; display: block; font-size: 11.5px; white-space: nowrap;
                 overflow: hidden; text-overflow: ellipsis; }
/* Where an action is bound is in the tooltip and on the board; a second line per action made
   the list twice as tall. It stays in the markup, so the filter still finds it. */
.action .txt small { display: none; }
/* Hollow when nothing sends it. */
.action:not(.bound) .dot { background: transparent; box-shadow: inset 0 0 0 1.5px var(--muted); }
/* A bound action is still a good choice, so it is drawn at full strength; "unbound" in
   its second line and the dot say the rest. Faded, it looked disabled. */
.action-list [hidden] { display: none; }
.action .req { font-size: 10px; color: var(--error); }
.field { margin-bottom: 10px; }
.field label { display: block; font-size: 10.5px; font-weight: 600; color: var(--muted);
               text-transform: uppercase; letter-spacing: .07em; margin-bottom: 4px; }
/* Which slot the action palette will write to. The attribute was set and never styled,
   so clicking an action could land on a long press with nothing on screen saying so. */
.field[data-active] { position: relative; padding-left: 8px; }
.field[data-active]::before { content: ""; position: absolute; left: 0; top: 2px; bottom: 2px;
                              width: 2px; border-radius: 1px; background: var(--accent); }
.field[data-active] label { color: var(--accent); font-weight: 600; }
.field select, .field input { width: 100%; }
.row2 { display: flex; gap: 8px; }
.checks { display: flex; flex-direction: column; gap: 5px; }
.finding { font-size: 11.5px; padding: 5px 7px; border-radius: 6px; border-left: 3px solid var(--line); background: var(--bg); }
.finding.error { border-left-color: var(--error); }
.finding.warning { border-left-color: var(--warn); }
.finding.grouped summary { cursor: pointer; list-style-position: inside; }
.finding.grouped summary b { display: inline; font-size: 11.5px; letter-spacing: 0; }
.finding.grouped .muted { margin: 4px 0; }
.missing-list { margin: 0; padding-left: 18px; font-size: 11px; }
.finding.note { border-left-color: var(--muted); }
.finding b { display: block; font-size: 10.5px; letter-spacing: .03em; }
.pill { font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 99px;
        border: 1px solid var(--line); line-height: 1.5; }
.save-status { font-size: var(--fs-1); color: var(--muted); white-space: nowrap; }
.save-status.pending { font-style: italic; }
.pill.ok { color: var(--ok); border-color: var(--ok); }
/* Something saving has left for the owner to do. A button, so it is dressed as one. */
.pill.todo { background: none; color: var(--accent); border-color: var(--accent); cursor: pointer;
             font: inherit; font-size: 10.5px; white-space: nowrap; }
.pill.todo:hover { background: var(--accent); color: var(--bg); }
.pill.bad { color: var(--error); border-color: var(--error); }
.muted { color: var(--muted); }
.empty-state { color: var(--muted); font-size: 12px; padding: 14px; text-align: center; border: 1px dashed var(--line); border-radius: 10px; }
code { font-family: var(--mono); font-size: 11.5px; background: var(--sunken);
       border-radius: 4px; padding: 0 4px; }
.new-game-where, .new-game-file { font-size: 11.5px; margin: 4px 0 8px; }
.new-game .row2 { margin-top: 6px; }
.new-game-styles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; }
.field label.new-game-style { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; margin: 0; border: 1px solid var(--line); border-radius: 6px; cursor: pointer; font-size: 12.5px; color: var(--fg); text-transform: none; letter-spacing: normal; }
.field .new-game-style input { width: auto; margin-top: 2px; flex: none; }
.new-game-style b { display: block; margin-bottom: 2px; }
.new-game-style .muted { font-size: 11.5px; }
/* Pedals: the third part of the control scheme, docked beside the checks. Three axes, each a
   short card -- what it drives and whether it is inverted on top, how far the game's name for
   it is trusted underneath -- with the tuning folded away. */
.pedals-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 7px; }
.pedals-head h2 { margin: 0; }
.pedals-head .muted { flex: 1; min-width: 0; font-size: 10.5px; overflow: hidden;
                      text-overflow: ellipsis; white-space: nowrap; }
.pedal-axes { display: grid; gap: 5px; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
.pedal-axis { border: 1px solid var(--line); border-left: 3px solid var(--movement);
              border-radius: 7px; padding: 3px 7px 4px; background: var(--bg); display: grid; gap: 2px;
              grid-template-columns: minmax(0, 1fr);
              align-content: start; }
.pedal-axis.idle { border-left-color: var(--line); }
.pedal-line { display: flex; align-items: center; gap: 6px; }
.pedal-line b { flex: none; font-size: 12px; min-width: 52px; }
.pedal-line select { flex: 1; min-width: 0; padding: 1px 4px; font-size: 12px; }
.inv { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; flex: none;
       cursor: pointer; }
.inv input { width: auto; margin: 0; }
.pedal-trust { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 10.5px; }
.chip { font-size: 10px; line-height: 1.5; padding: 0 7px; border-radius: 99px;
        border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.chip.trust-confirmed { color: var(--ok); border-color: var(--ok); }
.chip.trust-unconfirmed, .chip.trust-bound, .chip.trust-candidate, .chip.trust-none {
  color: var(--warn); border-color: var(--warn); }
.pedal-warn { font-size: 10.5px; color: var(--warn); line-height: 1.3; }
.link-btn { background: none; border: 0; padding: 0; font-size: 10.5px; color: var(--accent);
            cursor: pointer; margin-left: auto; }
.link-btn:hover { text-decoration: underline; }
.tune-body { display: grid; gap: 4px; font-size: 10.5px; }
.tune-body .field { margin-bottom: 3px; }
.tune-body .field input { padding: 2px 5px; font-size: 11px; }
.tune-body code { overflow-wrap: anywhere; }
.pedals-note { margin: 6px 0 0; color: var(--fg); border-left: 3px solid var(--accent);
               padding-left: 7px; }
.pedals-verdict { display: grid; gap: 1px; font-size: 11.5px; }
/* Print: the board and nothing else, in the light palette whatever the screen is on. */
.print-title { display: none; }
@media print {
  :root:root:root { ${LIGHT} color-scheme: light; }
  @page { size: landscape; margin: 10mm; }
  header, .save-note, .dock, .menu, .check-bar, .check-unit, .write-unit, .tester-bar { display: none !important; }
  body { background: #fff; }
  .workspace { padding: 0; }
  .print-title { display: block; font-size: 16px; font-weight: 600; margin-bottom: 8px; }
  .workspace.board .stage-wrap { overflow: visible; height: auto !important; }
  .workspace.board .stage { transform: none !important; zoom: .62; }
  .key.selected { outline: none; }
}
`;
