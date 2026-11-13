/**
 * The press test's own styles, all under `.probe`.
 *
 * It used to be a page of its own, and these still restyled `:root`, `body`, `header`,
 * `select` and `.btn` -- which, once it became a tab of the editor, changed the editor's
 * header and colours for the rest of the session after visiting it. And the two sheets
 * share class names (`.stage`, `.hand`, `.panel`, `.workspace`), so whichever loaded last
 * won wherever the other was silent: twice that broke a layout. Scoped, neither can
 * reach the other. Colours come from the editor's tokens.
 */
export const PROBE_CSS = `
.probe { --bad: var(--error); --cell-w: 96px; }
.probe .probe-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 4px 0 12px; }
.probe .probe-bar h2 { font-size: var(--fs-4); font-weight: 700; margin: 0 8px 0 0; text-transform: none;
                       letter-spacing: -.005em; color: var(--fg); }
.probe .probe-bar .spacer { flex: 1; }
.probe .btn.on { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.probe .prompt { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; border-radius: var(--r-lg);
                 padding: 16px 20px; color: var(--accent-fg); box-shadow: var(--shadow-2);
                 background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 82%, var(--fg))); }
.probe .prompt b { font-size: var(--fs-5); font-weight: 700; letter-spacing: -.01em; }
.probe .prompt .muted { color: inherit; opacity: .8; }
.probe .prompt .bad { background: var(--bad); color: #fff; padding: 2px 8px; border-radius: 6px; }
.probe .workspace { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 14px;
                    padding: 14px 0 0; align-items: start; }
@media (max-width: 1100px) { .probe .workspace { grid-template-columns: 1fr; } }
.probe .panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-lg);
                padding: 14px; box-shadow: var(--shadow-1); }
.probe .panel h2 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em;
                   color: var(--muted); margin: 0 0 10px; }
/* Units wrap one under the other when they do not fit side by side; the stage never runs
   off the edge of the window. */
.probe .stage { display: flex; gap: 18px; flex-wrap: wrap; align-items: flex-start; min-width: 0; }
.probe .hand { background: linear-gradient(180deg, var(--panel), var(--plate)); border: 1px solid var(--line);
               border-radius: 16px; padding: 12px; opacity: .55; cursor: pointer; box-shadow: var(--shadow-1); }
.probe .hand:hover { opacity: .8; }
.probe .hand.active-hand { opacity: 1; cursor: default; border-color: var(--accent);
                           box-shadow: 0 0 0 1px var(--accent), var(--shadow-2); }
.probe .hand-title { display: flex; gap: 8px; align-items: baseline; margin-bottom: 8px; }
.probe .hand-title b { font-size: 13px; }
.probe .hand-title span { color: var(--muted); font-size: 11.5px; }
.probe .hand-title .badge, .probe .badge { background: var(--accent); color: var(--accent-fg); border-radius: 99px;
                padding: 1px 8px; font-size: 10px; }
.probe .col.side { margin-top: 26px; }
.probe .hand-body { display: flex; flex-direction: row; gap: 7px; align-items: flex-start; }
.probe .col { display: flex; flex-direction: column; gap: 6px; }
.probe .head { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: var(--muted);
               text-align: center; margin-top: 6px; }
.probe .cell { width: var(--cell-w); min-height: 46px; border: 1px solid var(--line); border-radius: 8px;
               background: linear-gradient(180deg, var(--key-top), var(--key-bottom));
               box-shadow: inset 0 1px 0 var(--key-glint), inset 0 -2px 0 var(--key-lip), var(--shadow-1);
               padding: 5px 7px; display: flex; flex-direction: column; gap: 2px; }
.probe .cell .pos { font-size: 10.5px; color: var(--muted); }
.probe .cell .pin { font-size: 11.5px; font-weight: 600; font-family: var(--mono); }
.probe .cell.done { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 10%, var(--key-bottom)); }
.probe .cell.done .pin { color: var(--ok); }
.probe .cell.active { outline: 3px solid var(--accent); outline-offset: 2px;
                      background: color-mix(in srgb, var(--accent) 20%, var(--key-top)); }
.probe .thumb { display: grid; grid-template-columns: repeat(3, var(--cell-w)); gap: 6px; }
.probe .thumb .stickwrap { grid-column: 1 / span 3; }
.probe .stick-dial { grid-column: 1 / span 3; display: grid; gap: 4px; margin-bottom: 5px;
                     grid-template-columns: repeat(3, var(--cell-w)); grid-template-rows: repeat(3, auto); }
.probe .stick-dial .dir { border: 1px solid var(--line); border-radius: 8px;
                          padding: 5px; min-height: 40px; display: flex; flex-direction: column;
                          align-items: center; justify-content: center; gap: 1px; }
.probe .stick-dial .dir.done { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 10%, var(--key-bottom)); }
.probe .stick-dial .dir.done .pin { color: var(--ok); }
.probe .stick-dial .dir.active { outline: 3px solid var(--accent); outline-offset: 1px; }
.probe .stick-dial .glyph { font-size: 14px; line-height: 1; color: var(--muted); }
.probe .stick-dial .up { grid-area: 1 / 2; }
.probe .stick-dial .left { grid-area: 2 / 1; }
.probe .stick-dial .hub { grid-area: 2 / 2; }
.probe .stick-dial .right { grid-area: 2 / 3; }
.probe .stick-dial .down { grid-area: 3 / 2; }
/* The d-pad's own cells, which are the thumb's children. The stick dial's cells share
   the direction class names, and a rule reaching into the dial moves them out of its cross. */
.probe .thumb > .up { grid-column: 2; grid-row: 2; }
.probe .thumb > .left { grid-column: 1; grid-row: 3; }
.probe .thumb > .center { grid-column: 2; grid-row: 3; }
.probe .thumb > .right { grid-column: 3; grid-row: 3; }
.probe .thumb > .down { grid-column: 2; grid-row: 4; }
.probe .thumb .aux { grid-column: 1 / span 3; display: flex; gap: 6px; }
.probe .zero-grid { display: grid; grid-template-columns: repeat(4, var(--cell-w)); gap: 6px;
                    margin-bottom: 10px; }
.probe .summary-row { display: flex; gap: 8px; align-items: center; justify-content: space-between;
                      margin-bottom: 8px; }
.probe .note { font-size: var(--fs-1); color: var(--muted); padding: 5px 0; border-bottom: 1px solid var(--line); }
`;
