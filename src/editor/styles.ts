/** Injected by the editor at runtime so the whole page ships in one bundle. */
export const CSS = `
:root {
  --bg: #f4f6f8; --panel: #ffffff; --fg: #15181d; --muted: #5d6673; --line: #dae0e7;
  --accent: #2f6f8f; --accent-fg: #ffffff;
  --combat: #b8433a; --movement: #2f7d4f; --menu: #6a4fb3; --travel: #b1701c; --utility: #4a5568;
  --error: #b8433a; --warn: #b1701c; --ok: #2f7d4f;
  --key-w: 94px;
}
:root[data-theme="dark"], :root:not([data-theme="light"]) {
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #101317; --panel: #1a1e25; --fg: #e8ebf0; --muted: #98a1af; --line: #2e3540;
    --accent: #6fb6d8; --accent-fg: #0d1014;
    --combat: #e2786d; --movement: #6fc38f; --menu: #a98fe0; --travel: #d9a05b; --utility: #9aa5b5;
    --error: #e2786d; --warn: #d9a05b; --ok: #6fc38f;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #101317; --panel: #1a1e25; --fg: #e8ebf0; --muted: #98a1af; --line: #2e3540;
  --accent: #6fb6d8; --accent-fg: #0d1014;
  --combat: #e2786d; --movement: #6fc38f; --menu: #a98fe0; --travel: #d9a05b; --utility: #9aa5b5;
  --error: #e2786d; --warn: #d9a05b; --ok: #6fc38f;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 13px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif;
}
button, select, input { font: inherit; color: inherit; }
header {
  display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
  padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--panel);
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
.btn[disabled] { opacity: .55; cursor: default; }
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
.field.slot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.field.slot > label { flex-basis: 100%; }
.slot-pick { flex: 1; text-align: left; padding: 6px 9px; border: 1px solid var(--line);
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
select, .btn {
  background: var(--panel); border: 1px solid var(--line); border-radius: 7px;
  padding: 5px 10px; cursor: pointer;
}
.btn:hover, select:hover { border-color: var(--accent); }
.btn.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.repo-note { color: var(--fg); border-left: 3px solid var(--accent); padding-left: 8px; }
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
.panel.inset { background: var(--bg); margin-bottom: 12px; }
/* Boards on the left, the in-game half on the right, so the two can be read together. */
.ingame-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
               gap: 2px 14px; max-height: 60vh; overflow: auto; margin-bottom: 10px; }
.ingame-row { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 8px;
              align-items: center; padding: 3px 4px; border-radius: 6px; }
.ingame-row:nth-child(odd) { background: var(--bg); }
.ingame-row.unbound { opacity: .55; }
.ingame-row .who { min-width: 0; }
.ingame-row .who b { display: block; font-size: 12px; font-weight: 600; }
.ingame-row .who small { display: block; color: var(--muted); font-size: 10px;
                         overflow-wrap: anywhere; }
.ingame-row .field { margin-bottom: 0; }
.ingame-row .field label { font-size: 8.5px; }
.ingame-row .field input { padding: 2px 5px; font-size: 11px; }
.ingame-row .row2 { gap: 5px; }
header .picker { display: inline-flex; flex-direction: column; gap: 1px; }
header .picker span { font-size: 9.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.sheet-tools { display: flex; gap: 8px; margin-bottom: 8px; }
.unit-settings { margin-top: 12px; display: grid; gap: 6px; }
.keybind { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.key-chip { min-width: 96px; padding: 5px 12px; border-radius: 7px; border: 1px solid var(--line);
            border-bottom-width: 3px; background: var(--panel); color: var(--fg);
            font: 600 13px/1.2 ui-sans-serif, system-ui, sans-serif; cursor: pointer; text-align: center; }
.key-chip:hover { border-color: var(--accent); }
.key-chip.unset { color: var(--muted); font-weight: 400; font-style: italic; }
.key-chip.capturing { border-color: var(--accent); color: var(--accent);
                      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent); }
.btn.small { padding: 3px 8px; font-size: 12px; }
.keybind-note { flex-basis: 100%; font-size: 11px; color: var(--warn, #a86b00); }
.keybind-note.bad { color: var(--bad, #b3261e); }
.action-list.inert { opacity: .45; pointer-events: none; }
.note { font-size: 11.5px; color: var(--muted); margin-bottom: 10px; }
.sheet-frame { width: 100%; min-height: 78vh; border: 1px solid var(--line); border-radius: 10px;
               background: var(--panel); }
.workspace { padding: 12px 14px; }
/* The board on top at full width; the panels dock beneath it. */
.dock { display: grid; grid-template-columns: 320px minmax(0, 1fr) 360px; gap: 12px;
        margin-top: 12px; align-items: start; }
.dock.ingame { grid-template-columns: minmax(0, 1fr) 360px; }
.dock-col { display: grid; gap: 12px; }
@media (max-width: 1150px) {
  .dock { grid-template-columns: 300px minmax(0, 1fr); }
  .dock > .dock-col { grid-column: 1 / -1; }
}
@media (max-width: 760px) { .dock, .dock.ingame { grid-template-columns: 1fr; } }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
.panel h2 {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: .09em; color: var(--muted);
  margin: 0 0 9px;
}
/* Both units stay on one row; the stage scales down rather than wrapping one under the
   other, because a pair is read as a pair. */
.workspace.board .stage-wrap { overflow: hidden; }
.workspace.board .stage { display: flex; gap: 14px; align-items: flex-start; flex-wrap: nowrap;
         transform-origin: top left; width: max-content; }
.hand { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
        padding: 10px; }
.hand > .title { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
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
  font-size: 8.5px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted);
  text-align: center; height: 12px; white-space: nowrap;
}
.key {
  width: var(--key-w); min-height: 46px; border: 1px solid var(--line); border-radius: 7px;
  background: var(--bg); padding: 4px 6px; cursor: pointer; text-align: left; display: flex;
  flex-direction: column; gap: 1px; border-left-width: 3px; border-left-color: var(--line);
  overflow: hidden;
}
.key:hover { border-color: var(--accent); }
.key.selected { outline: 2px solid var(--accent); outline-offset: 1px; }
.key.empty { opacity: .3; border-style: dashed; border-left-style: dashed; min-height: 30px;
             justify-content: center; }
.key.empty .name { display: none; }
/* Each line is its own block; as inline spans they ran together into one string. */
.key .pos { display: block; font-size: 9.5px; color: var(--muted); line-height: 1.2; }
.key .name { display: block; font-weight: 600; font-size: 12px; line-height: 1.2;
             overflow-wrap: anywhere; }
.key .sub { display: block; font-size: 10px; color: var(--muted); line-height: 1.25;
            overflow-wrap: anywhere; }
.key .flag { display: block; font-size: 9px; color: var(--warn); line-height: 1.2; }
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
  grid-template-columns: repeat(3, var(--key-w)); grid-template-rows: repeat(3, auto);
}
.stick-dial.selected { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 8px; }
.stick-dial .dir {
  border: 1px solid var(--line); border-radius: 7px; background: var(--bg); color: inherit;
  padding: 4px 5px; cursor: pointer; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 1px; min-height: 40px; text-align: center; overflow: hidden;
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
.stick-dial .hub { grid-area: 2 / 2; border: none; background: none; gap: 3px; }
.stick-dial .hub .wheel {
  width: 46px; height: 46px; border-radius: 50%; border: 2px solid var(--line);
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

.action-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
               gap: 2px 8px; max-height: 420px; overflow: auto; align-content: start; }
.action-list > .head { grid-column: 1 / -1; margin-top: 6px; text-align: left; }
.action {
  display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 6px;
  border: 1px solid var(--line); cursor: pointer; text-align: left; background: var(--bg);
  width: 100%;
}
.action:hover { border-color: var(--accent); }
.action .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--muted); }
.action .dot.combat { background: var(--combat); }
.action .dot.movement { background: var(--movement); }
.action .dot.menu { background: var(--menu); }
.action .dot.travel { background: var(--travel); }
.action .dot.utility { background: var(--utility); }
.action .txt { flex: 1; min-width: 0; }
.action .txt b { font-weight: 600; display: block; font-size: 12px; }
.action .txt small { color: var(--muted); font-size: 10px; }
/* A bound action is still a good choice, so it is drawn at full strength; "unbound" in
   its second line and the dot say the rest. Faded, it looked disabled. */
.action-list [hidden] { display: none; }
.action .req { font-size: 9px; color: var(--error); }
.field { margin-bottom: 9px; }
.field label { display: block; font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 3px; }
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
.finding.note { border-left-color: var(--muted); }
.finding b { display: block; font-size: 10.5px; letter-spacing: .03em; }
.pill { font-size: 10.5px; padding: 2px 7px; border-radius: 99px; border: 1px solid var(--line); }
.pill.ok { color: var(--ok); border-color: var(--ok); }
.pill.bad { color: var(--error); border-color: var(--error); }
.muted { color: var(--muted); }
.empty-state { color: var(--muted); font-size: 12px; padding: 24px; text-align: center; border: 1px dashed var(--line); border-radius: 10px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
`;
