/** Injected by the editor at runtime so the whole page ships in one bundle. */
export const CSS = `
:root {
  --bg: #f4f6f8; --panel: #ffffff; --fg: #15181d; --muted: #5d6673; --line: #dae0e7;
  --accent: #2f6f8f; --accent-fg: #ffffff;
  --combat: #b8433a; --movement: #2f7d4f; --menu: #6a4fb3; --travel: #b1701c; --utility: #4a5568;
  --error: #b8433a; --warn: #b1701c; --ok: #2f7d4f;
  --key-w: 104px;
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
             font-size: 12px; color: var(--muted); }
.workspace.single { display: block; }
.panel.inset { background: var(--bg); margin-bottom: 12px; }
.workspace.wide { grid-template-columns: minmax(0, 1fr); }
/* Boards on the left, the in-game half on the right, so the two can be read together. */
.workspace.ingame { grid-template-columns: minmax(0, 1fr) 420px; }
@media (max-width: 1200px) { .workspace.ingame { grid-template-columns: 1fr; } }
.ingame-list { display: flex; flex-direction: column; gap: 2px; max-height: 70vh;
               overflow: auto; margin-bottom: 10px; }
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
.note { font-size: 11.5px; color: var(--muted); margin-bottom: 10px; }
.sheet-frame { width: 100%; min-height: 78vh; border: 1px solid var(--line); border-radius: 10px;
               background: var(--panel); }
.workspace { display: grid; grid-template-columns: 200px minmax(0, 1fr) 250px; gap: 12px;
             padding: 12px 14px; align-items: start; }
@media (max-width: 1200px) { .workspace { grid-template-columns: 1fr; } }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
.panel h2 {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: .09em; color: var(--muted);
  margin: 0 0 9px;
}
/* Both units stay on one row; the stage scales down rather than wrapping one under the
   other, because a pair is read as a pair. */
.stage-wrap { overflow: hidden; }
.stage { display: flex; gap: 14px; align-items: flex-start; flex-wrap: nowrap;
         transform-origin: top left; width: max-content; }
.hand { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
        padding: 10px; }
.hand > .title { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
.hand > .title b { font-size: 13px; }
.hand > .title span { color: var(--muted); font-size: 11.5px; }
.hand-body { display: flex; gap: 7px; align-items: flex-start; }
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
.key .pos { display: block; font-size: 8.5px; color: var(--muted); letter-spacing: .04em;
            text-transform: uppercase; line-height: 1.2; }
.key .name { display: block; font-weight: 600; font-size: 11px; line-height: 1.2;
             overflow-wrap: anywhere; }
.key .sub { display: block; font-size: 9.5px; color: var(--muted); line-height: 1.25;
            overflow-wrap: anywhere; }
.key .flag { display: block; font-size: 9px; color: var(--warn); line-height: 1.2; }
.key.combat { border-left-color: var(--combat); }
.key.movement { border-left-color: var(--movement); }
.key.menu { border-left-color: var(--menu); }
.key.travel { border-left-color: var(--travel); }
.key.utility { border-left-color: var(--utility); }
/* The thumb cluster is two devices and some spare keys. Each gets its own labelled
   group, and the stick is drawn as a dial so it never reads as another d-pad. */
.thumb-cluster { display: flex; flex-direction: column; gap: 8px; }
.thumb-group { border: 1px solid var(--line); border-radius: 9px; padding: 6px;
               background: color-mix(in srgb, var(--bg) 60%, transparent); }
.thumb-group > .head { margin-bottom: 4px; }
.dpad { display: grid; grid-template-columns: repeat(3, var(--key-w)); gap: 4px; }
.dpad .up { grid-area: 1 / 2; }
.dpad .left { grid-area: 2 / 1; }
.dpad .center { grid-area: 2 / 2; }
.dpad .right { grid-area: 2 / 3; }
.dpad .down { grid-area: 3 / 2; }
.aux { display: flex; gap: 4px; }

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
.stick-dial .dir .name { font-size: 9.5px; font-weight: 600; line-height: 1.15;
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

.action-list { display: flex; flex-direction: column; gap: 3px; max-height: 62vh; overflow: auto; }
.action {
  display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 6px;
  border: 1px solid transparent; cursor: pointer; text-align: left; background: none; width: 100%;
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
.action.bound { opacity: .5; }
.action .req { font-size: 9px; color: var(--error); }
.field { margin-bottom: 9px; }
.field label { display: block; font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 3px; }
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
