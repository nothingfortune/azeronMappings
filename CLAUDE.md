# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Azeron Cyborg II keypad profiles as code: profiles authored in YAML that maps a physical
position to a game action, compiled into the Azeron app's import JSON, linted against
constraints learned from real play sessions, and versioned so any past version is
importable straight from git history.

`docs/plans/azeron-profiles-repo-prompt.md` is the original brief — hardware facts, the
reverse-engineered export format, the full left-unit pin map, and the questions it
leaves open.

## Commands

`npm run check` is the gate. It must pass before you claim work is done.

| Command                                   | Purpose                                            |
| ----------------------------------------- | -------------------------------------------------- |
| `npm run check`                           | build + typecheck + lint + format check + tests    |
| `npm start`                               | build, then serve the editor — the owner's command |
| `npm run build`                           | `tsc` to `build/`, then bundle the editor          |
| `npm run typecheck`                       | `tsc --noEmit`                                     |
| `npm run lint` / `npm run lint:fix`       | ESLint                                             |
| `npm run format` / `npm run format:check` | Prettier                                           |
| `npm test` / `npm run test:watch`         | Vitest                                             |
| `npm run test:quick`                      | every unit test; what the pre-commit hook runs     |
| `npm run test:bin`                        | Bash smoke tests for `bin/azeron`                  |

Run one test: `npx vitest run tests/unit/lib/compile.test.ts -t "byte for byte"`.

`node_modules` is platform-specific: npm writes `.cmd` shims only on Windows and esbuild
ships a per-platform binary, so installing in WSL and running from PowerShell (or the
reverse) fails with `'tsc' is not recognized`. `scripts/check-env.mjs` runs first in
`build` and explains it. Fix by deleting `node_modules` and reinstalling in the shell you
mean to work in.

The CLI is `bin/azeron` (also `npm run azeron -- <command>`), and it runs the built
output, so `npm run build` first:

| Command                                             | Purpose                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `azeron build [game] [--check]`                     | compile profile YAML into `dist/`                                               |
| `azeron lint [game] [--strict]`                     | the constraint rules; `--show-acknowledged` too                                 |
| `azeron roundtrip [game]`                           | golden profiles must rebuild their template exactly                             |
| `azeron bindings [game]`                            | the in-game key list, to check against the game                                 |
| `azeron ingame [game] [--apply]`                    | compare the game's `Input.ini`; `--apply` rewrites it                           |
| `azeron ingame [game] --capture-pedals`             | record the pedals' game names from a file they were bound in                    |
| `azeron ingame [game] --candidate axis=NAME`        | write a hand-written pedal name (a candidate)                                   |
| `azeron serve [--port N] [--host H]`                | the editor, able to save back into the repo; this computer only unless `--host` |
| `azeron editor`                                     | the side-by-side editor, one self-contained HTML                                |
| `azeron probe [--device D]`                         | press-test profile + capture page for the real pin map                          |
| `azeron import <export.json> --genre G --game SLUG` | start a game folder from an export                                              |
| `azeron decompile <export.json> [-o ...]`           | an app export back into profile YAML                                            |
| `azeron install [game] --device-id ID`              | write straight into the Azeron app's profile store                              |

## Layout

| Path                    | Contents                                                                     |
| ----------------------- | ---------------------------------------------------------------------------- |
| `src/lib/`              | The toolchain. Pure modules; `io.ts` holds every filesystem touch.           |
| `src/editor/`           | Browser editor. `main.ts` is the bundle entry, `app.ts` the code.            |
| `src/types/`            | Shared types: the export format, the YAML schemas, the payload.              |
| `src/config/paths.ts`   | Repo root and the data directory names.                                      |
| `tests/unit/`           | Vitest specs mirroring `src/`.                                               |
| `tests/bin/run.sh`      | CLI smoke tests.                                                             |
| `devices/`              | Pin map per unit; and `kind: pedals` devices (axes, no pins).                |
| `genres/<Genre>/`       | Shared action vocabulary and default layout for a kind of game.              |
| `games/<Genre>/<game>/` | `game.yaml`, `actions.yaml`, `sets.yaml`, `profiles/*.yaml`, `playtests.md`. |
| `templates/`            | Real Azeron exports, committed untouched.                                    |
| `dist/`                 | Compiled import JSON and the game's bindings. **Committed.**                 |
| `build/`                | TypeScript output. Gitignored. Not to be confused with `dist/`.              |

## Architecture

Three inputs meet in the compiler, and are kept separate:

1. **`devices/*.yaml`** — position name to physical pin, established by press test, not
   inferred. Press-tested 2026-09-28: the two units agree on 26 of 30 pressable
   positions. The four that differ are the thumb pad, rotated 180° on the right unit
   (`thumb_up` 34↔36, `thumb_left` 35↔33), and its stick is rotated the same way.
2. **`actions.yaml`** — action id to the in-game key, plus role tags (`combat`,
   `movement`, `travel`, `menu`, `utility`, `required`). The in-game bindings are part of
   the source of truth, so rebinding something in game is a one-line edit. A game
   inherits its vocabulary from its genre with `extends:` and supplies only the keys.
   `azeron import` starts a game from an export: it stores the export in `templates/`,
   seeds an action per distinct key it sends (named after the key, since an export
   cannot say what a key does in game), and decompiles the profile. `export_to` in
   `game.yaml` names a directory outside the repo that builds are copied to as well;
   `dist/` stays the committed copy.
3. **`templates/*.json`** — a real export. The compiler deep-clones it and writes only the
   fields the YAML speaks about, so unknown and unverified fields (macros, turbo,
   `subType`, analog tuning, the records for unidentified pins) survive untouched.

Profiles map position to action id, never position to raw key.

**A layout and its wiring.** What the owner edits is the _layout_: which control does which
action. The key an action is sent on is the _wiring_, and it is the tooling's to choose:
`src/lib/wiring.ts` gives an action with no key the first free one from a pool chosen to
stay out of a game's way (`WIRE_POOL`: navigation keys, numpad operators, punctuation — no
letters, digits, function keys, modifiers or anything a menu uses), narrowed to keys the
game's file can name. The editor does this the moment an action is first put on a control
(`wire()` in `app.ts`), saves it into the game's `actions.yaml` with the rest of the
layout, and `Update the game's keys…` writes it into the game. A key, once given, is never
re-dealt: the compiled layouts, the golden fixture and the game's file all depend on an
action keeping the key it has. `action-sends-nothing` is the lint error for a control whose
action has no key, which is what a hand edit runs into. The In-game tab hides the keys
while there is a game file to write them into, and shows them when there is not, because
then they have to be set in the game by hand.

- `compile.ts` neutralizes every _mapped_ pin in the template, then applies the YAML.
  Pins in the device's `unknown_pins` and unused `pinOne: 255` slots are never touched,
  and neither is a record whose type is not a key, an empty slot, a mouse button or a
  stick — `isRebindableRecord` decides, shared with the probe. Binding such a position
  is refused rather than written over.
  `label` is overwritten in place rather than deleted and re-added, so key order — and
  therefore the `dist/` diff — stays stable.
- `decompile.ts` goes the other way, for edits made in the Azeron app. Anything
  that will not round-trip canonically is kept as `*_raw` or `raw: {types: [...]}`.
  There are two ways to open the editor, and they differ in one thing: whether an edit can
  get back into the repo.

- `azeron editor` writes a self-contained file. It works offline with no server, and the
  only way out is a download you then copy in by hand.
- `azeron serve` serves the same page over HTTP, where it can POST an edit straight into
  the repo and get the linter's verdict back. The header says which mode the page is in.

`genres/<Genre>/stick-modes.yaml` defines stick modes, after the convention RC
transmitters use (DJI Mode 1/2/3): a mode assigns four action pairs to the four axes a
pair of units has, and the editor applies one to both sticks in a click. A mode owns the
eight directions and nothing else on the position. The DJI modes translate faithfully —
RC throttle is vertical, pitch is thrust, roll is strafe, and yaw is yaw — and
`mode2_roll` and `twin_stick` cover roll on a stick and the game's own gamepad layout. A
ship has six axes and two thumbs (the d-pad is under the same thumb as the stick), so
which four go on the sticks is a choice; roll is not a stand-in for yaw.

**Pedals are a modifier on the stick mode, and part of the layout.** Rudder pedals carry
yaw, so a stick that still sends it duplicates them. `stick-modes.yaml` says which axes
pedals take (`pedals.takes`) and each mode's `with_pedals` which slots to replace — in
every mode, the freed slot goes to roll. `directionsFor` / `applyMode` / `detectMode` take
a `withPedals` flag and always agree; without it every mode is exactly what it was.
`detectStickModes` lists every reading, because Mode 2 with pedals is also Mode 2, roll
for yaw: the sticks cannot say which they are, the layout can, by whether it has pedals.

What a layout's pedals do lives in the game's `sets.yaml`, keyed by set name, beside the
profiles that carry `set:` — one name selects the keypads and the pedals together, and a
layout is saved as one control scheme. (A profile is one unit's file and the pedals belong
to neither; the device file is hardware shared by every game.) Each entry is
`pedal axis: {drives: yaw, invert, dead_zone, scale, sensitivity, exponent, shared}`.
`drives` is a game axis in the genre's vocabulary; it reaches the game's row (`Yaw`) through
the `ingame` row of the action at the axis's `up` end, so nothing names a game row twice.
One game axis driven by two pedal axes is an error unless every one says `shared: true`.
The device, `devices/<pedals>.yaml` with `kind: pedals`, has three axes with `rest: centre`
or `end`, and per game a `names` entry — `{name, status}` — saying what the game calls the
axis and how far to trust it (`confirmed` flown; `inferred`; `unconfirmed`; `bound` by
`--capture-pedals`; `candidate` by hand), plus `inputs`, the names the game registers for
the device, which no axis may step outside of. The editor payload carries it under `pedals`, apart from `devices`, so everything that expects
a pin map keeps getting only keypads; each game carries its `sets` and `ingameSet`.

In the editor the pedals are one more entry in `schemeParts()` (`pedalsPart()`), so the
one Save, the unsaved marker and the report cover them. `src/lib/setsfile.ts`
(`patchSetPedals`) is the node-free line patcher for `sets.yaml`; the page gets the
file's text from `payload.games[].setsText` and sends the patched file through
`/api/save`, and `checkAfterSave` answers a `sets.yaml` save with a `pedals` summary. The
stick-mode panel uses a mode's with-pedals variant when `pedalsCarry(modes, pedals)` is
true — every axis in `pedals.takes` is driven by some pedal — not merely when a layout has
pedals. A pedal edit that changes how the sticks read shows a note and never rewrites the
sticks.

`src/lib/tasks.ts` holds the operations — build, lint, import an export, read the game's
config — as functions rather than commands. The CLI and the served editor both call
them, so what the UI can do is what the CLI can do rather than a subset that drifts. The
editor reaches them over `/api/build`, `/api/import`, `/api/ingame`, `/api/ingame/apply`
and `/api/actions` (which patches keys, labels and tags in actions.yaml line by line); saving a
profile rebuilds `dist/` and lints in the same round trip.

`patchActionBindings` needs every action on one line, so `createGame` writes a seeded
`actions.yaml` in flow style. Never regenerate `actions.yaml` with a generic YAML dump: it
loses the comments, the `extends:` line and the duplicate-key allowlist.

Per-session editor state — a key capture, a rename in progress, the press test — is reset
by `resetSession()` on a change of game or tab; new state of that kind goes there. The
inspector must not write to the working profile while drawing, or looking at an empty key
marks the page unsaved.

Whether the page can save is decided by `window.AZERON_SERVED`, which only `azeron serve`
sets. Sniffing the protocol would claim as much of a static file served by any web
server, and the buttons would then silently do nothing.

Writes go through `resolveSavePath`, which accepts profile YAML, a game's `actions.yaml`
and `sets.yaml`, and device maps (pedals included), and nothing else — checked on the
resolved path, so no spelling of `..` escapes. `validateSaveContent` then parses the
content as the kind of file its path names before anything is written, so a malformed
save is refused and the file on disk is untouched.

The server writes into the repo and into the game's config, so it answers only the page
it served. It listens on `127.0.0.1` (`--host` opts out), and `checkRequest` in
`lib/serve.ts` refuses a request whose `Host` is not a loopback name on the listening
port, and a state-changing request that is not `application/json` or that carries another
site's `Origin`. One `guardedListener` wraps every route with that check and turns a
handler's exception into a JSON 500. The page's data is read from disk for every request,
never cached, so a file edited by hand shows on reload.

`azeron editor` writes one page for every game: games and sets are data, chosen from the
two selectors. The payload is embedded because a page opened from `file://` cannot fetch
a sibling JSON, and `editor-data.json` is written beside it so an open page can be
pointed at newer data with the Data button instead of being regenerated.

Saving is one thing, because a layout is one control scheme: both keypads and the in-game
keys. `schemeParts()` in `app.ts` is the list of what belongs to it -- each part says
whether it is dirty and how to write itself -- and the header's Save, the unsaved marker,
the single report and the unload guard all follow from that list. Adding a part (pedals)
is adding an entry there. Telling the game stays outside Save on purpose: it writes
outside the repo and needs the game closed, so the report and the menu offer it and it asks.

The Edit board is laid out by CSS and one function. `fitStage` narrows the keys (`--key-w`,
84 to 100px, up to 124 on a portrait window) before it scales anything, so type stays at
the size it was written at; only a window too narrow for 84px keys scales the stage, and
then only by the shortfall. A portrait window stacks the hands. From 1700px wide in
landscape the key inspector rises beside the board and the checks sit beside the actions,
so the whole Edit workflow fits a 1080p screen; narrower, the dock is a row under the
board. The action list is CSS columns of one-line chips: no scroll region of its own.
Nothing renders below 9px. Light and dark are `theme.ts`: it flips from what is on screen,
keeps the choice, and the tokens are defined once in `styles.ts` for both ways in.
`.workspace.board` scopes the board's layout and `.probe` the press test's; keep it so.

- `lint.ts` and `model-core.ts` are free of node imports on purpose: **the browser editor
  imports the same compiler, linter and YAML writer the CLI uses.** There is one
  implementation of each rule, not one per surface. Keep it that way — if you need
  filesystem access in a module the editor imports, put it in `io.ts` instead.

## TypeScript

This repo follows the `nothingfortune/base` conventions.

- Strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Do not
  weaken `tsconfig.json` to make code compile.
- No `any`. Use `unknown` and narrow. Parsed YAML is `unknown`; `normalizeProfileData`
  is where it becomes a `ProfileData`, and it fails loudly on a malformed file.
- No non-null assertions (`!`). Handle the null case.
- Named exports, not default exports. `import type` for type-only imports.
- `delete obj[computed]` is banned by the lint config; use `removeKey` from `lib/object.ts`.
- Everything is TypeScript except three files, and `allowJs`/`checkJs` type-check two of
  them anyway: `scripts/check-env.mjs` stays JavaScript because it runs before anything
  is compiled (a guard that needs a build is no guard), `eslint.config.js` is ESLint's own
  config, and `bin/azeron` is the npm bin shim, which has to run the environment guard
  and check for a build before it can load anything compiled. Build tooling under `scripts/` is
  TypeScript, compiled by `tsconfig.scripts.json` into `build/scripts/`.

## Hard-won constraints — do not relearn these

These came from real play sessions; each one is a lint rule now.

1. **No thumbstick in gamepad/analog mode for Everspace 2.** It caused frame-rate stutter
   (the game flip-flopped between gamepad and KB/M input). Keyboard mode fixed it. Stick
   _mouse_ mode was tried 2026-09-30 and **spins**: the game steers by where the pointer
   is, a stick moves it at a rate, and letting go leaves it off centre, so the ship keeps
   turning with no way back. Keyboard mode with the game's `Yaw`/`Pitch` keys is the
   stick's rate control. → `stick-not-keyboard` (error)
2. Everspace 2 in KB/M mode reads **only two analog axes** (mouse X/Y). Everything else is
   digital, and no remapper can add axes without a virtual gamepad — which re-triggers
   constraint 1.
3. In-game bindings are fully rebindable and are **part of the source of truth**, kept in
   `actions.yaml`.
   3b. `turbo` / `turbo_interval` repeat a key while it is held. A repeated key is down
   part of the time, so for an action the game reads as on/off it averages to part
   power — the only way to get a part-power press out of a digital key. See
   `docs/guides/analog-input.md`.
4. **Long-press and double-tap delay the tap** (by `featureDelay` / `doubleDelay`). Never
   on combat-critical keys: consumables, targeting, fire, boost. → `combat-tap-delayed`
5. **Never put Escape or any menu action on a mashable combat key.** v3 had Escape as
   double-tap on a consumable; mashing a heal opened the menu. → `menu-with-combat`
6. **`isHold: true` latches** the key until pressed again. Boost must not latch. →
   `hold-on-movement`
7. The 2026-09-28 akimbo attempt failed because the right hand had too few bindings and
   the two hands used the same finger positions for unrelated jobs. → `missing-required`
   and `akimbo-role-mismatch`
8. **The Azeron software is built for a left-handed unit; the right unit is not a 1:1
   mirror of it.** Measured 2026-09-28: the thumb cluster — pad and stick — is rotated
   180° on the right unit, while the finger columns and side keys match. Never infer one
   unit's map from the other. A device carries `verified: true` only once it has been
   press-tested with `azeron probe`; anything else raises `unverified-device`.
   The rotation is absorbed by `analogSettings.angle`, which the right unit's own export
   carries as 176 against the left unit's -1 — a half turn, in degrees, written by the app
   itself. `stick_angle` and `stick_directions` exist as corrections for a unit whose
   template does not already carry one; neither is in use, they are alternatives, and
   `stick-double-correction` errors if both are set.
   The right unit also reads a **different direction block**: see the export format rules.

See `docs/guides/analog-input.md` for the standing question of how to get real analog axes
into Everspace 2 without the gamepad-mode stutter.

A finding that is real but accepted goes in `game.yaml` under `lint.acknowledged` with a
reason, matched per profile + rule + position. Stale acknowledgements are reported. Do not
suppress a rule any other way, and do not drop a rule to make a layout pass.

## Export format rules

Top level is `{ "version": "2.0.2", "profiles": [ … ] }`; each profile has an `inputs`
array of per-key records.

- `types` codes: `"1"` keyboard, `"11"` none, `"15"` mouse button, `"4"` keyboard-mode
  stick. `"2"` is the profile switch, on pin 0 — identified when a probe that rebound it
  produced a profile the software repaired on import. Codes `"6"`, `"0"`, `"29"`, `"30"`
  and `subType: "29"`/`"31"` are still **unknown — preserved via `raw.types` and template
  passthrough, never invented.** Only records whose type is a plain key, mouse button or
  stick are ever rewritten.
- Key values mix `KeyboardEvent.code` strings (`KeyF`, `Digit1`, `Escape`) with legacy
  numeric JS keyCodes (arrows as `"37"`–`"40"`, Shift as `"16"`). `keys.ts` records which
  encoding the app actually uses per key; a token that does not survive name→token→name
  is kept raw rather than rewritten.
- Mouse buttons: `"1"` left, `"2"` middle, `"3"` right. Middle was confirmed in the app
  UI; left and right on 2026-09-29, from a profile labelled "Fire Primary" / "Fire
  Secondary" sending 1 and 3 against the game binding those to the left and right
  buttons. The compiler refuses to emit a button outside that table.
- Keyboard-mode stick directions live in `analogSettings.analogKeys.<block>.<direction>[0]`
  as **integer** JS keyCodes in the v5 export, and as `KeyboardEvent.code` strings in a
  profile edited by 2.0.2; both are read, and integers are emitted.
  **Which block is `<block>` is decided by `isRightAnalog`.** A right-hand unit exports
  `true` and reads `analogKeys.right`; the left-handed software the format was designed
  around reads `analogKeys.left`. `activeAnalogKeys` in `types/azeron.ts` is the one place
  that chooses, and every reader and writer goes through it — writing the wrong block
  compiles, lints clean and does nothing on the hardware, which is exactly what happened
  to the akimbo right unit's stick. The other block is left as the template had it: it is
  inert, and the left unit's template holds string zeros there that the byte-for-byte
  contract depends on.
  `analogSettings.angle` is in **degrees**, absolute: the right unit's export carries 176
  and the left unit's -1, which is the 180° mount rotation plus a small trim. It is only
  overwritten when a device sets `stick_angle`, which no device currently does — the
  templates already carry the right value.
- `profileSettings` passes through from the template, except `isSensorOn` and the
  sensitivity step, which a profile sets with `sensor:` and `dpi:`. Two units both
  running their sensors drive the same pointer, so a pair wants one of them on.
- Keep profile `id` (UUID) **stable in YAML**. Note that the app assigns a fresh UUID on
  import, so an id only survives when a profile is written into the store by
  `azeron install`.
- Emit 2-space-indented JSON; the template's key order is preserved by mutating a deep
  clone in place.

## The game's own binding file

Everspace 2 keeps its bindings in `Input.ini` under `[/Script/ES2.CustomPlayerInput]`,
one `KeybindingsConfig=(...)` line per action per input group (Keyboard, Gamepad,
**Joystick** — the game does support joysticks natively). `ingame_config` in `game.yaml`
points at it.

**The direction of truth is one way: `actions.yaml` → the game.** Each action names its
game row with `ingame:` (the `Action=` field) and, for one half of a two-row axis,
`ingame_scale:`. `azeron ingame --apply` writes every keyboard row in the categories
`game.yaml` owns (`ingame_owned_categories` — for Everspace 2, 0–3: everything live while
flying) from those references, clears `Key2` on them, and leaves every other line alone.
A layout then changes on the keypads alone; the in-game half is never edited by hand.

- Every owned row must be named by an action, or applying refuses — the vocabulary covers
  the whole flying layer, so nothing sits on a key the repo does not know about. An action
  with no key leaves its row unbound.
- Rows in other categories (menu navigation, menu actions, photo-mode camera) reuse
  flight keys on purpose and are never touched.
- `dist/<game>/Input.ini` is the committed copy of what the game was given, gated like the
  compiled JSON: it must be a fixed point of `actions.yaml`. Generating starts from the
  game's own file when it is installed, and from that copy when it is not.
- The game's file is copied aside before being replaced, and the game must be closed —
  it rewrites the file on exit.

`azeron ingame` without `--apply` reports rows that **differ** — the game has the row on
another key — which is what key matching alone could not see: it found _a_ binding for A
and called it agreement, while the game had A on "Strafe right".

### The Joystick group, for the pedals

The Joystick group's flight rows are axes (`bIsAxis=True`, `Key1=None`) waiting for a
device. `game.yaml`'s `ingame_set` names the layout whose pedals `--apply` writes into them
(the game has one file, so one layout's control scheme at a time). The guarantees are the
keyboard side's:

- **Owned rows only**: the six flight axis rows (every axis in `stick-modes.yaml`). `Key1`
  (and `Key2` for a `shared` pair) gets the pedal's game name; `bInvert` / `DeadZone` /
  `Scale` / `Sensitivity` / `Exponent` are written only where the layout says. Every other
  line — the T.16000M button bindings above all — is byte-identical, CRLF is kept, and
  generating twice is generating once. A known pedal name left on an owned row the layout
  no longer uses is cleared; a binding that is not a pedal's is never overwritten, it is a
  refusal that names the axis.
- **Names are read or reasoned, never invented, and say how far to trust them.** The game
  reads joysticks through SDL and names an input `JS<index>_<Device>_<Input>` —
  `JS0_SaitekProFlightRudderPedals_Axis2`. The index is SDL's joystick index and **can be
  negative** (`JS-1_T16000M_Button0` is a stick that is not plugged in), so compare the
  device part, never the index; the device is the product string with its spaces removed
  and axes are numbered from zero. The game's own log lists the three inputs it registers
  for the pedals — those names are confirmed (`inputs`). Which is which was recorded
  through SDL's DirectInput backend while each pedal was moved: the rudder is `Axis2`, the
  left toe `Axis0` and the right `Axis1`. That is the backend the game uses and not the game,
  so all three stay `inferred` until flown. Generation writes any
  status and says which it used; a pedal axis with no name writes nothing and is reported
  as waiting; `--require-pedals` turns that into a refusal. The rest of the layout generates
  regardless.
- **`azeron ingame --capture-pedals`** reads a file the user has bound the pedals in, finds
  the Joystick axis rows bound to a device that has no buttons in the file (so not the
  flight stick), and records each new name as `bound`. What a capture proves is what the
  _game_ wrote, not which pedal moved: **a toe brake rests at the end of its travel, so
  touching it wins a capture meant for the rudder** — the owner's own file has Yaw on
  `Axis1`, a toe, for exactly that reason. So it places a name by the row the layout says
  that pedal drives only when that is unambiguous, checks a name already recorded against
  where the file has it and reports a disagreement as a conflict without changing either,
  and reports anything else unplaced (`--assign NAME=axis` says which, and can move a
  name). Partly named is ordinary and reported as such.
- **Candidates.** The game's own controls screen would not take the toes, so a name can be
  written by hand (`--candidate axis=NAME`, or the file). It is a `candidate`, generated
  like any other name and flagged by status wherever it is reported. The repo never
  chooses one.
- **A toe brake rests at the end of its travel, and a Windows calibration is what makes it
  usable.** Uncalibrated, a toe reads -1.0 at rest and +1.0 fully pressed, so on any game
  axis read about a centre (all six flight axes) it is a **full deflection with the foot
  off**, and `invert`, `scale`, `dead_zone`, `sensitivity` and `exponent` — the fields the
  game's row offers — cannot re-centre it. `pedal-rest-on-centred` warns on that. A
  DirectInput calibration with the minimum _below_ the rest position, the centre at it and
  the maximum at full press makes rest read 0.0 and a press +1.0 (measured 2026-10-01; a
  minimum _equal_ to the rest position reads -1.0 at rest). `calibrated_rest: centre` on
  the axis in the device file records that it is set and was seen to work, and stops the
  warning. The calibration lives in the machine's registry, not the repo; the values are
  in `docs/guides/analog-input.md`.
- **A toe drives one direction of an axis** (`end: up|down` on its assignment in
  `sets.yaml`), and is then written onto the game's own row for that direction — the
  Joystick group keeps a `Scale=1` and a `Scale=-1` row beside each axis row, called
  `MoveUp+` and `MoveUp-` here — so two toes can be hover up and hover down. An assignment
  with an `end` has no `invert` or `scale`: the end is the direction. Whether the game reads
  a pedal in proportion on those rows, or as a button, is not yet flown. A pedal that
  drives an axis carries its actions as far as `missing-required` is concerned.
- The game's `MoveForward` Joystick row ships with `bInvert=True`. The editor writes
  `invert` outright for an axis assigned in the Pedals panel, so its box shows what the
  game is given; an assignment with no `invert` leaves the row as the game has it.
- **Never send the pedals a HID `GET_REPORT`** (`HidD_GetInputReport`). It hung them until
  they were replugged. Listening to the reports they send is safe.

## Detecting the units

The editor's press test reports what is connected over WebHID (Chrome and Edge only).
Both Cyborg II units report product id `0x12f7` — 4855 in decimal, which is the
`DevicesStorage` folder holding the profiles filed before the units were told apart — so
a single connection cannot be attributed to one unit from USB alone, and the UI says so
rather than guessing. Detection reports only; writing profiles still goes through the
Azeron software.

## The Azeron app's own profile store

The app is Electron and keeps one JSON file per profile at
`<appdata>/Azeron Software/Storage/DevicesStorage/<deviceId>/ProfileStorage/profile_<uuid>.json`,
where the file is exactly the object our export puts in `profiles[0]`.

Two things make `azeron install` unsupported rather than merely undocumented, and it
refuses to run rather than guess:

- the **stored schema is a strict subset of the export schema** (the app expands defaults
  on export), so `install` projects our object onto the shape of a profile the app itself
  wrote, when there is one to copy the shape from;
- the app rewrites that directory as it pleases, so it must be closed first.

Importing through the app stays the supported path.

## Testing

- Every behavior change ships with a test in the same commit.
- `tests/unit/lib/compile.test.ts` is the contract: `build(single-v5.yaml)` must equal
  `templates/everspace2-v5.json` **byte for byte**, decompiling the export must reproduce
  the checked-in YAML, `build(decompile(build(x))) === build(x)`, and unidentified pins
  must come through identical. A failure indicates the compiler is rewriting a field it
  does not model; the fixture is the reference, not the thing to change.
- Never make a suite green by deleting a test, adding `.skip`, or loosening an assertion.
- **No test reads the real layouts.** `games/`, `dist/` and the rest are edited from the
  editor all day and saved as they are edited; a test written against them fails whenever a
  layout is half way through a change, which says nothing about the code. `AZERON_DATA`
  names the folder that holds `devices/`, `genres/`, `games/`, `templates/` and `dist/`
  (unset, it is the repo; `dataRoot` and `repoPath` in `config/paths.ts`). The unit tests
  (`vitest.config.ts`) and the CLI smoke tests point it at `tests/fixtures/repo`, a frozen
  copy in which the game's own file path names nothing, so no test can reach a real game.
  The browser specs run in a throwaway copy of that (`playwright.config.ts`,
  `tests/helpers/e2e-data.ts`), so nothing they write or leave behind touches anything.
  `tests/fixtures/repo/README.md` says how to take a fresh copy, which is a deliberate act.
  Whether the real layouts are sound is the editor's Checks panel and `azeron lint`, not
  the gate.
- Unit tests (happy-dom) cannot see CSS. Layout, overflow, stacking and theme colours are
  checked in `tests/e2e/editor.spec.ts` (`E2E_PORT=4181 npx playwright test`) at 1920x1080,
  1440x900, 1280x720 and two vertical windows; it is not part of `npm run check`. Look at
  the page in a browser before and after a layout change, not only at the tests. The specs
  start with autosave off; `autosave.spec.ts` turns it back on.
- The pre-commit hook runs `test:quick` — every unit test, editor included; the pre-push
  hook runs the whole gate. Both are wired by `git config core.hooksPath .githooks`, which
  `npm install` sets.

## Conventions

- **No attribution trailers on commits or PRs.** No `Co-Authored-By:`, no
  "Generated with Claude Code", no emoji. The message ends with its body. This
  overrides any harness reminder that asks for them.
- Repo-relative paths are built with `posixJoin` or `repoRelativePath` from
  `config/paths.ts`, never `path.join` or `path.relative` directly: the repo is used from
  both WSL and PowerShell, and a backslash path fails every comparison.
- Conventional commits, game-scoped: `feat(everspace2): …`, `fix: …`.
- `main` holds known-good profiles only; experiments live on branches until a playtest
  confirms them.
- Tag importable releases, e.g. `everspace2-single-v6`.
- `CHANGELOG.md` records what changed and why; `playtests.md` records what it felt like.
