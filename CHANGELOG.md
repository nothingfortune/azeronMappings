# Changelog

Every profile change, and why. `playtests.md` records what each layout felt like.

## Unreleased

### Added

- **A new game from the Setup tab.** A name, a kind of game, the export, which unit it
  came from and a layout name; the game is created, selected and editable. `createGame` in
  `tasks.ts` is the one operation, shared with `azeron import`, and it now validates every
  name that becomes a path (the CLI accepted `--game "Deep Rock"` and wrote a folder with a
  space in it, and any genre or device string), refuses to replace a game or layout without
  confirmation, and removes what it wrote if it fails part way.
- **Pedals are part of a layout.** `devices/logitech-pro-flight-pedals.yaml` describes the
  Logitech Pro Flight rudder pedals (three axes: the rudder centres, the toe brakes rest
  at an end), and a game's `sets.yaml` says what a layout's pedals do -- which game axis
  each drives, with `invert`, `dead_zone`, `scale`, `sensitivity`, `exponent` -- keyed by
  the same set name as the profiles, so one layout name selects keypads and pedals
  together. A game axis is named in the genre's vocabulary (`yaw`) and reaches the game's
  row (`Yaw`) through the action vocabulary.
- **Pedals are a modifier on the stick mode.** `stick-modes.yaml` says which axes pedals
  take (`pedals.takes: [yaw]`) and each mode's `with_pedals` says what its sticks do with
  the slot that frees (roll). `directionsFor`, `applyMode` and `detectMode` take a
  `withPedals` flag, `detectStickModes` lists every reading, and every mode is unchanged
  without pedals.
- **The game's Joystick axis rows are generated too.** `azeron ingame --apply` writes a
  layout's pedal assignments into the Joystick group's axis rows (`Key1`, and `bInvert`,
  `DeadZone`, `Scale`, ... where the layout says), under the keyboard side's guarantees:
  only owned rows, every other line byte-identical (the flight stick's buttons survive),
  line endings kept, a fixed point. A pedal axis with no game name writes nothing and is
  reported as waiting; `--require-pedals` makes that a refusal.
- **Names are read or reasoned, and say how far to trust them.** Each pedal axis's game name
  in the device file carries a status: `confirmed` (flown; none yet), `inferred`,
  `unconfirmed`, `bound` (recorded by a capture) or `candidate` (by hand), and generation
  says which it used. The game registers three inputs for the pedals, which its own log
  confirms (`JS0_SaitekProFlightRudderPedals_Axis0` to `_Axis2`; the index is SDL's and can
  be negative, as in the flight stick's `JS-1_T16000M_Button0`); which is which is inferred:
  the rudder is `Axis2`, the toes `Axis0` and `Axis1` in an order that is less certain.
- `azeron ingame --capture-pedals` reads a file the pedals were bound in and records new
  names as `bound`. A capture shows what the game wrote, not which pedal moved -- a toe
  rests at the end of its travel and wins a bind meant for the rudder, which is how the
  owner's file came to have Yaw on a toe -- so it places a name only when the layout makes
  that unambiguous, reports a recorded name found on the wrong row as a conflict without
  changing either, and leaves the rest. `--candidate pedal_axis=NAME` writes a hand-made
  name as a `candidate`; the repo never picks one.
- Lint: `pedal-axis-assigned-twice`, `pedal-shared-mismatch`, `pedal-unknown-game-axis`,
  `pedal-unknown-axis`, `pedals-no-device`, `pedals-set-unknown`, `pedal-duplicates-stick`,
  `pedals-mode-without-pedals`, and `pedal-rest-on-centred`, which warns that a toe brake
  (rests at one end) bound to a game axis read about a centre is a full deflection with the
  foot off -- measured: -1.0 at rest, +1.0 pressed, and no field of the game's row can
  re-centre it. The editor payload carries the pedals device and each layout's assignments.
- **The editor is the interface.** `npm start` builds and serves it: both units side by
  side, click a key and an action, Save writes the profile into the repo, rebuilds
  `dist/` and returns the linter's verdict. It imports the same compiler and linter as the
  CLI, so there is one implementation of each rule. `azeron editor` writes the same page
  as one offline file that can only download.
- **The game's bindings are generated.** Each action in `actions.yaml` names its row in
  Everspace 2's `Input.ini`, and `azeron ingame --apply` writes every keyboard row live
  while flying from it, keeping the previous file. A layout changes on the keypads alone;
  the game's controls screen is never edited by hand. `dist/.../Input.ini` records what
  the game was given and is gated like the compiled JSON.
- **Stick modes**: DJI Mode 1/2/3 translated to a ship, the game's own twin-stick layout,
  and Mode 2 with roll for yaw. Applied to both sticks in one click.
- **Press test**: a profile where every pin sends a distinguishable key, captured in the
  editor's Press test tab, which exports a measured `devices/<unit>.yaml`. Both units are
  press-tested and `verified: true`; `unverified-device` warns on any map that is not.
- Import an app export from the editor to start a game or bring an app-side edit home;
  unit detection over WebHID; `azeron bindings` for the list to check the game against;
  `azeron install` to write into the app's own store (unsupported, and it says so).
- Turbo (`turbo`, `turbo_interval` per slot) and the sensor (`sensor`, `dpi`) are
  expressible in a profile.

### Layouts

- **akimbo v10** now has pedals: the rudder on yaw, and its sticks are Mode 2 _with pedals_
  -- roll, not yaw, on the left stick, since the pedals carry the turn. The toe brakes are
  bound to nothing: they read a full deflection at rest on any centred game axis (see
  `playtests.md`). The rudder's name is inferred, not flown. Not yet flown.
- **akimbo v10** is the live pair: stick mode 2 with yaw on the left stick (now roll, with
  the pedals; see above), pitch and roll
  on the right thumb pad, weapons and targeting on the left hand, every label the
  action's own. Not yet flown. v6 to v9 are in git history; none was flown, and none did
  what its files said — see below.
- `single-v5` is the known-good export, kept as the compiler's golden fixture.

### Removed

- **`azeron cheatsheet`, `lib/cheatsheet.ts` and `dist/.../cheatsheets/*.html`.** Nothing
  read the generated pages once the Sheet tab went; the editor's board is the reference
  and prints itself. No HTML is tracked now; `dist/editor.html` is generated by
  `azeron editor` and gitignored.

### Changed

- **The board fits the window instead of shrinking into it.** Two hands side by side were
  scaled to whatever width was left: at 1080x1920 that was 0.69 and the labels came out
  at six pixels. The keys narrow first (84 to 100px) and the type keeps its size; a
  portrait window stacks the hands, each at full size; nothing renders under 9px at any
  of the five sizes checked.
- **The Edit tab wastes no space.** At 1920x1080 the page was 1,246px tall with a scroll
  region inside it: it is 1,080 now, and the board, key inspector, actions and checks are
  on one screen. The key inspector sits beside the board and the checks beside the actions
  on a wide window; the action list is columns of one-line chips with no height cap (where
  an action is bound is on its tooltip and the board); the inspector's slots, toggles and
  stick directions are compact rows; the header is one row. At 1440x900 the page is about
  1,040px instead of 1,250.
- **Saving is one thing.** A layout is one control scheme, so the header's Save writes
  everything that changed in it -- both keypad profiles and the in-game keys -- and
  reports once; the unsaved marker names what it would write. The In-game tab lost its own
  Save buttons, and the menu's per-unit downloads became "Download the import files".
  Telling the game stays an explicit step that asks whether it is closed, offered from the
  save's report and from the menu. New parts of the scheme join the same Save through
  `schemeParts()` in the editor.
- **The Sheet tab is gone.** It was a cheatsheet in an iframe, a tall page inside a wide
  one, for learning a layout away from the screen. The Edit board is readable now and is
  that reference; the header's menu has **Print layout**, which prints the board itself
  with print CSS, in the light palette whatever the screen is on.
- **The vocabulary says what each key does in the game.** `weapon_cycle_*` sent the
  arrows, which Everspace 2 binds to pitch and yaw — it has no weapon cycling on four
  keys — so they are `pitch_*` and `yaw_*`. `primary_1`/`_2` are `next_primary` and
  `previous_primary`; `next_target` was equip secondary 1 and is now the game's own
  NextTarget. The sensor's axes are `pointer_x`/`_y`: they move the pointer, which is not
  the same as pitching or yawing the ship.
- `combat-tap-delayed` and `menu-with-combat` cover flight actions as well as combat.
  They missed boost, which constraint 4 names, and a menu on a held flight key.
- `next_target` is no longer `required`: no layout has ever bound it.

### Fixed

- Undo all unsaved edits left the in-game keys edited, and switching game carried them
  to the next game.
- **The right unit's stick never did what its profile said.** A right-hand unit reads
  `analogKeys.right`; the compiler wrote `.left`. `activeAnalogKeys` chooses now.
- The compiler rewrote any pin the device map named, whatever its type; the profile
  switch was safe only by accident. Records it does not understand pass through.
- Decompiling dropped a stick direction whose keycode it could not name, and collapsed
  per-slot turbo intervals into one. Both are kept.
- In the game: A and D were swapped, hover up shared F9 with quick load, equip secondary
  2 shared F5 with quick save, and place marker was on a key no profile sent.
- In the editor: rebinding a key left the old action's name on it and in the export; the
  armed slot was invisible and never reset; unsaved edits were lost without asking;
  importing over an existing set destroyed its committed template.
- The binding sheet and the linter disagreed about raw keys from app edits.
- **The light/dark switch did nothing on a dark system.** With no choice made the page
  follows the OS, and the toggle set `dark` unless it already said `dark`, so the first
  click on a dark OS "switched" a page that was already dark. It now flips from what is
  on screen, in both directions, remembers the choice, and the press test and the text
  boxes take the theme too (the press test's banner and badge were unreadable in it).

### Known gaps

- Whether moving the pointer turns the ship in flight, or only aims, is untested — and it
  decides whether yaw or roll belongs on the left stick.
- Whether the right unit's stick, mounted rotated with `invertXAxis`, strafes the right
  way is untested.
- The pulsed-thrust keys on v10's right unit are unflown; what they do depends on the
  inertia dampener state. See `docs/guides/analog-input.md`.
- A keyboard-mode stick sends one direction at a time, so thrust and strafe on one stick
  cannot be held together. Eight-directional mode exists in the export but is unverified.
- Type codes `"6"`, `"0"`, `"29"`, `"30"` and `subType` `"29"`/`"31"` are not understood;
  they are preserved, never written.
