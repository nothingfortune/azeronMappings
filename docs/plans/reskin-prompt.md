# Prompt: reskin the editor

Paste everything below the line into Claude Code, started in this repo.

---

Reskin the browser editor in this repo. It works, but it looks like a developer tool:
flat grey panels, small type, everything at the same weight, no clear place for the eye to
go. Make it look like a polished piece of gaming-hardware software: the confidence of
Logitech G Hub, Razer Synapse or the Azeron app's own configurator, but calmer and easier
to read than those. Change how it looks, not what it does.

## Who uses it and what they do

One person setting up Azeron Cyborg II keypads (one per hand), plus keyboard, mouse and
Xbox controller bindings, for their PC games. They are not a programmer and must never need
to read code. They open a game, then spend most of their time on the **Edit** tab, putting
actions on keys. Every screen should make the next click obvious and need as few clicks as
possible. Nothing in the UI should read as an "AI assistant": no chatty tone, no sparkles.

## Read first

- `CLAUDE.md`, especially the paragraphs on the Edit board, `fitStage`, light and dark
  (`theme.ts`), and Testing. They are constraints, not suggestions.
- `src/editor/styles.ts`: all of the CSS, injected at runtime. The colour tokens are
  defined once for light (`LIGHT`) and once for dark (`DARK`) at the top.
- `src/editor/theme.ts`, which switches light and dark.
- `src/editor/app.ts` (large) and `src/editor/device-boards.ts`, `picker.ts`, which build
  the DOM. Read them to see each screen's structure; change them only where CSS cannot do
  the job.

## The screens, all of which need the new look

1. **Games gallery** (the first screen): a card per game, plus one to add a game.
2. **Header**: the game switch, layout select, tabs, the lint chip, Undo, the save status
   ("Saving…" / "Saved"), Write to units, the menu, and Press test at the far right as a
   utility.
3. **Edit**: two hands of keys (`.hand`, `.key`; the stick as a dial with four directions)
   side by side, the key inspector, the action chips in CSS columns, and the dock with two
   tabs, **Checks** and **Sticks & pedals**.
4. **In-game**: the keyboard, mouse and controller drawn as boards, then the list of
   actions with their key, keyboard and controller bindings and role switches.
5. **Setup**: add a game or layout, rename, delete, Start over.
6. **Press test**, the **write bar** (writing to the units), and the **picker** modal (what
   goes on a key: Actions / Keyboard key tabs, and the controller pad picker).

## Direction

- **One accent, used sparingly** for the primary action and the selection. The role
  colours (`--combat`, `--movement`, `--menu`, `--travel`, `--utility`) carry meaning on keys
  and chips: keep them distinguishable from each other and from error/warn/ok, and make
  them pass WCAG AA against what they sit on in both themes.
- **Dark is the main theme** (most people game in the dark); light must look as finished.
  Redefine the tokens rather than adding colours inline. Add tokens for surfaces (raised,
  sunken, hover), for focus, and for a few shadow levels if the design needs them.
- **Hierarchy**: a type scale (say 12 / 13 / 15 / 18 / 24), a spacing scale on 4px, two or
  three radii, and clear weight differences between titles, labels and secondary text.
- **The keys are the product.** Make the board look like hardware: keys with depth, the
  stick as a real dial, a clear selected state, empty keys quiet but obviously droppable,
  drag-over and drop targets unmistakable.
- **States**: hover, focus-visible (keyboard users), active, disabled, selected, drag-over
  and error each look different and consistent across the app.
- **Motion**: short (120–180ms) transitions on hover and selection only, and none under
  `prefers-reduced-motion`.
- **Fonts**: the page must work offline and from `file://` (`azeron editor` writes one
  self-contained HTML), so no web fonts from a CDN. Use a good system stack, or embed one
  font file in the bundle if it earns it.

## Hard constraints

- Do not rename or remove class names, ids or `data-*` attributes: the unit tests and the
  Playwright specs find elements by them. Add classes freely.
- Keep `fitStage`'s contract: it narrows `--key-w` (84 to 100px, up to 124 on a portrait
  window) before it scales anything, and nothing renders below 9px.
- Keep the layout breakpoints described in `CLAUDE.md`: from 1700px wide in landscape the
  inspector rises beside the board and the checks sit beside the actions, so the whole Edit
  workflow fits a 1080p screen with no page scroll; narrower, the dock is a row under the
  board; a portrait window stacks the hands.
- `.workspace.board` scopes the board's layout and `.probe` the press test's; keep it so.
- Light and dark both come from the tokens; the dark set is written once.
- No horizontal page scroll at any of the sizes below.

## How to work

1. Build and start the editor (`npm start`), and screenshot every screen above at
   1920x1080, 1440x900, 1280x720 and a portrait window, in both themes, **before** changing
   anything. Keep those for comparison.
2. Write a short design spec first (tokens, type and spacing scales, the key's anatomy,
   component states) and check it against the screenshots before touching code.
3. Restyle in passes: tokens and base, then header and tabs, then the board, then the
   dock, In-game, Setup, the picker and the write bar.
4. After each pass, look at the page in the browser at every size and in both themes. Fix
   what you see; tests cannot see CSS.
5. Run `npm run check` (it must pass) and the layout specs:
   `E2E_PORT=4181 npx playwright test` (WSL) or
   `$env:E2E_PORT = 4181; npx playwright test` (PowerShell), after
   `npx playwright install chromium` once.
6. Finish with before and after screenshots of each screen, side by side, so the owner can
   judge it.

Work on a branch, one commit per pass, and no attribution trailers in commit messages.
