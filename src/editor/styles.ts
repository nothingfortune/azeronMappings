/** Injected by the editor at runtime so the whole page ships in one bundle. */
export const CSS = `
:root {
  --bg: #f4f6f8; --panel: #ffffff; --fg: #15181d; --muted: #5d6673; --line: #dae0e7;
  --accent: #2f6f8f; --accent-fg: #ffffff;
  --combat: #b8433a; --movement: #2f7d4f; --menu: #6a4fb3; --travel: #b1701c; --utility: #4a5568;
  --error: #b8433a; --warn: #b1701c; --ok: #2f7d4f;
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
.workspace.single { display: block; }
.sheet-frame { width: 100%; min-height: 78vh; border: 1px solid var(--line); border-radius: 10px;
               background: var(--panel); }
.workspace { display: grid; grid-template-columns: 250px minmax(0, 1fr) 290px; gap: 14px; padding: 14px 16px; align-items: start; }
@media (max-width: 1200px) { .workspace { grid-template-columns: 1fr; } }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
.panel h2 {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: .09em; color: var(--muted);
  margin: 0 0 9px;
}
.stage { display: flex; gap: 26px; justify-content: center; flex-wrap: wrap; align-items: flex-start; }
.hand { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px; }
.hand > .title { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
.hand > .title b { font-size: 13px; }
.hand > .title span { color: var(--muted); font-size: 11.5px; }
.hand-body { display: flex; gap: 7px; align-items: flex-start; }
.col { display: flex; flex-direction: column; gap: 6px; }
.col .head {
  font-size: 9.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted);
  text-align: center; height: 13px;
}
.key {
  width: 118px; min-height: 52px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--bg); padding: 5px 7px; cursor: pointer; text-align: left; display: block;
  border-left-width: 3px; border-left-color: var(--line);
}
.key:hover { border-color: var(--accent); }
.key.selected { outline: 2px solid var(--accent); outline-offset: 1px; }
.key.empty { opacity: .45; }
.key .pos { font-size: 9px; color: var(--muted); letter-spacing: .03em; }
.key .name { font-weight: 600; font-size: 12px; line-height: 1.25; }
.key .sub { font-size: 10.5px; color: var(--muted); }
.key .flag { font-size: 10px; color: var(--warn); }
.key.combat { border-left-color: var(--combat); }
.key.movement { border-left-color: var(--movement); }
.key.menu { border-left-color: var(--menu); }
.key.travel { border-left-color: var(--travel); }
.key.utility { border-left-color: var(--utility); }
.thumb { display: grid; grid-template-columns: repeat(3, 118px); gap: 6px; }
.thumb .stickwrap { grid-column: 1 / span 3; }
.thumb .up { grid-column: 2; grid-row: 2; }
.thumb .left { grid-column: 1; grid-row: 3; }
.thumb .center { grid-column: 2; grid-row: 3; }
.thumb .right { grid-column: 3; grid-row: 3; }
.thumb .down { grid-column: 2; grid-row: 4; }
.thumb .aux { grid-column: 1 / span 3; display: flex; gap: 6px; }
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
