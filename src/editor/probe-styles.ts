/** Injected by the press test at runtime so the page ships in one bundle. */
export const PROBE_CSS = `
:root {
  --bg: #f4f6f8; --panel: #fff; --fg: #15181d; --muted: #5d6673; --line: #dae0e7;
  --accent: #2f6f8f; --accent-fg: #fff; --ok: #2f7d4f; --bad: #b8433a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #101317; --panel: #1a1e25; --fg: #e8ebf0; --muted: #98a1af; --line: #2e3540;
    --accent: #6fb6d8; --accent-fg: #0d1014; --ok: #6fc38f; --bad: #e2786d;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
       font: 13px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif; }
button, select { font: inherit; color: inherit; }
header { display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
         padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--panel); }
header h1 { font-size: 15px; margin: 0 8px 0 0; }
header .spacer { flex: 1; }
select, .btn { background: var(--panel); border: 1px solid var(--line); border-radius: 7px;
               padding: 5px 10px; cursor: pointer; }
.btn:hover { border-color: var(--accent); }
.btn[disabled] { opacity: .45; cursor: default; }
.prompt { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap;
          padding: 14px 16px; background: var(--accent); color: var(--accent-fg); }
.prompt b { font-size: 19px; text-transform: uppercase; letter-spacing: .04em; }
.prompt .muted { opacity: .8; }
.prompt .bad { background: var(--bad); color: #fff; padding: 2px 8px; border-radius: 6px; }
.workspace { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 14px; padding: 14px 16px;
             align-items: start; }
@media (max-width: 1100px) { .workspace { grid-template-columns: 1fr; } }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
.panel h2 { font-size: 10.5px; text-transform: uppercase; letter-spacing: .09em;
            color: var(--muted); margin: 0 0 9px; }
.stage { display: flex; gap: 18px; flex-wrap: wrap; align-items: flex-start; }
.hand { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
        padding: 12px; opacity: .55; cursor: pointer; }
.hand.active-hand { opacity: 1; cursor: default; border-color: var(--accent); }
.hand-title { display: flex; gap: 8px; align-items: baseline; margin-bottom: 8px; }
.hand-title b { font-size: 13px; text-transform: capitalize; }
.hand-title span { color: var(--muted); font-size: 11.5px; }
.badge { background: var(--accent); color: var(--accent-fg); border-radius: 99px;
         padding: 1px 8px; font-size: 10px; }
.col.side { margin-top: 26px; }
.hand-body { display: flex; gap: 7px; align-items: flex-start; }
.col { display: flex; flex-direction: column; gap: 6px; }
.head { font-size: 9.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted);
        text-align: center; margin-top: 6px; }
.cell { width: 116px; min-height: 46px; border: 1px solid var(--line); border-radius: 8px;
        background: var(--bg); padding: 5px 7px; display: flex; flex-direction: column; gap: 2px; }
.cell .pos { font-size: 10px; color: var(--muted); }
.cell .pin { font-size: 11.5px; font-weight: 600;
             font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.cell.done { border-color: var(--ok); }
.cell.done .pin { color: var(--ok); }
.cell.active { outline: 3px solid var(--accent); outline-offset: 1px; background: var(--panel); }
.thumb { display: grid; grid-template-columns: repeat(3, 116px); gap: 6px; }
.thumb .stickwrap { grid-column: 1 / span 3; }
.stick-dial { grid-column: 1 / span 3; display: grid; gap: 4px; margin-bottom: 5px;
              grid-template-columns: repeat(3, 116px); grid-template-rows: repeat(3, auto); }
.stick-dial .dir { border: 1px solid var(--line); border-radius: 8px; background: var(--bg);
                   padding: 5px; min-height: 40px; display: flex; flex-direction: column;
                   align-items: center; justify-content: center; gap: 1px; }
.stick-dial .dir.done { border-color: var(--ok); }
.stick-dial .dir.done .pin { color: var(--ok); }
.stick-dial .dir.active { outline: 3px solid var(--accent); outline-offset: 1px; }
.stick-dial .glyph { font-size: 14px; line-height: 1; color: var(--muted); }
.stick-dial .up { grid-area: 1 / 2; }
.stick-dial .left { grid-area: 2 / 1; }
.stick-dial .hub { grid-area: 2 / 2; }
.stick-dial .right { grid-area: 2 / 3; }
.stick-dial .down { grid-area: 3 / 2; }
.thumb .up { grid-column: 2; grid-row: 2; }
.thumb .left { grid-column: 1; grid-row: 3; }
.thumb .center { grid-column: 2; grid-row: 3; }
.thumb .right { grid-column: 3; grid-row: 3; }
.thumb .down { grid-column: 2; grid-row: 4; }
.thumb .aux { grid-column: 1 / span 3; display: flex; gap: 6px; }
.btn.on { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.zero-grid { display: grid; grid-template-columns: repeat(4, 116px); gap: 6px; margin-bottom: 10px; }
.summary-row { display: flex; gap: 8px; align-items: center; justify-content: space-between;
               margin-bottom: 8px; }
.note { font-size: 11.5px; color: var(--muted); padding: 3px 0; border-bottom: 1px solid var(--line); }
`;
