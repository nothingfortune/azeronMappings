# Changelog

Every profile change, and why. `playtests.md` records what each layout felt like.

## Unreleased

### Added

- **Usual keyboard and controller bindings to start from.** Every genre (shooters, space
  sims, flight) says which keyboard key or mouse button each action is usually on
  (`keyboard:`), as it already said which pad control (`xbox:`). A new game starts with both
  as its own bindings -- WASD, Space, R to reload, the mouse to fire; the left stick, A, RT
  -- and the Azeron layout from the genre as before. A game that has them already gets
  them from the In-game tab's Fill in the usual bindings, which leaves any binding set by
  hand alone and skips one that would put two actions on a key, a key the units send
  included. The keyboard field shows the usual key beside it, as the controller one does.
- **Choosing a game is the first step, from a gallery.** A first visit opens on every
  game as a card -- its genre, layouts, units and actions -- and one to add a game; the
  header's game drop-down is now a button naming the open game, which goes back to them.
- **A key that is empty asks what goes on it.** Clicking it opens a chooser: the game's
  actions, the needed ones still on no key first, with a search; or a whole keyboard, to
  send one key exactly (the arrow keys for Helldivers' stratagems, say) -- the action
  already on that key, or a new one named after it. A key in use has Choose action… in
  the Key panel.
- **A controller binding is picked from a pad**, drawn as it is held -- triggers and
  bumpers, both sticks with their clicks, the d-pad and A B X Y -- in place of a list of
  names that was cut off. The genre's usual control shows beside it as a hint.
- **Start over** on the Setup tab empties every key on the units in the layout and keeps
  every action, to lay the units out again.

### Changed

- **The press test is a utility, at the far right of the header**, out of the tabs used day
  to day.

- **A game's controls typed in as a list.** Most games keep no readable controls file --
  Helldivers 2, Darktide and Space Marine 2 hold their bindings in save data, and an
  Unreal game writes its input file only once something is rebound -- so the In-game tab
  has Add several controls at once: one control per line, with its key and controller
  button after a colon where known (`Reload: R / X button`, `Fire: Left click / RT`,
  `Stratagem menu`). Keys are read from the words people write (Ctrl + R, F5, Numpad 4,
  Scroll up, Right click) and pad controls likewise (RT, R2, D-pad up, Left stick up);
  anything not read is said, and set later on the action's row (`controlFromLine`,
  `bindingFromWords`).

- **A game's controls read from its own file, and drawn on the devices.** The Setup tab
  reads a game's input file (an Unreal game's `Input.ini` or `DefaultInput.ini`, or
  Everspace 2's own) from a location pasted in: every control it lists that the game does
  not have becomes an action, with its keyboard-and-mouse and controller keys
  (`discoverControls`, `addDiscoveredControls`, `/api/discover`). Nothing the game has is
  touched. The In-game tab can show the bindings drawn on a keyboard, a mouse and a
  controller; a bound key names its action, a control two actions share is marked, and
  clicking one goes to that action's row.

- **The game is told the keyboard and controller bindings too.** Update the game's keys…
  now writes them for the two games whose files the editor understands:
  - Everspace 2: an action's keyboard-and-mouse binding goes in its row's second key when
    it is another than the keypad's, and its controller binding in the row's Gamepad
    entry. Rows of actions with neither are left exactly as they were, so the committed
    file is unchanged.
  - Elite Dangerous: the keyboard-and-mouse binding goes in the control's other free slot.
  - What cannot be written yet is said after the update instead of being forced: a chord
    on the keyboard (Everspace has not been seen to honour Key2Mod), a stick direction on
    the controller (those are axis rows), the mouse wheel in Elite (an axis there), and any
    controller binding in Elite (the name it gives a pad differs between computers).

- **Keyboard, mouse and controller bindings for every action.** Each row on the In-game tab
  now has a Keyboard field (click, then press a key with any modifiers, or click or scroll
  on it for a mouse button or the wheel) and a Controller field (pick a control, or Press
  on pad to read it from a connected controller through the browser's Gamepad API; the
  genre's usual control is shown as a hint). They are saved as `kbm:` and `pad:` on the
  action, checked for clashes (`kbm-collision`, `pad-collision`), and never sent to the
  units: the compiler does not read them, so every compiled layout is unchanged. The New
  action box is on the In-game tab too.

- **One test for the units.** Test keys counts as it goes: every control pressed stays
  marked green, in any order and on both units at once, and the tray says "18 of 63
  controls seen" and how many presses the layout does not send. The step-by-step check,
  which also catches two keys swapped with each other, moved from a button on each unit
  into the same tray ("Check the left unit step by step").

- **The page speaks to a player, not to the repo.** About thirty messages are rewritten,
  among them "RC transmitter", "with-pedals variant", "wiring" (now "game keys"),
  "PROBE 1 pins", "developer work", "Run `azeron serve`" and every check message that said
  to edit a file. The save report opens "Saved." with the files under Files written, and
  says plainly whether the units need a write. A game the editor cannot tell its keys
  says what to do, with the reasons under "Why not this game?".
- **Fewer controls.** Gone: Detect units (Write to units and the press test find the units
  themselves) and `src/lib/hid.ts` with it, Rebuild every import file (saving rebuilds),
  the "saves to repo" pill, the Stick sends picker on a stick that already sends keys,
  and the "It will live in games/…" line. Undo all unsaved edits shows only when there
  is something unsaved, and Open a data file… only on a page opened as a file.

- **The last hand edits go.** Each of these pointed at a file before:
  - A check that is fine in this layout has an Accept button: say why, and it goes into
    game.yaml's `lint.acknowledged` with the reason (`acknowledgeFinding`,
    `/api/acknowledge`), comments kept.
  - A game whose settings file is not where it is expected takes the file's location in
    a box on the page; it is checked to exist and written to `local.yaml`
    (`/api/local/game-file`).
  - The long press and double tap each have a "repeat while held" switch in the Key panel.
  - The press test's stick result says to save the map, which applies it, rather than to
    set `stick_angle` by hand.

- **Actions, layouts and games are added, renamed and deleted from the page.** No file
  needs editing for any of them:
  - A New action box under the action list: type a name, press Enter, drag it onto a key.
    The In-game tab's Delete takes out an action the game added that no key sends
    (`removeActions`); one the genre supplies cannot be, as it would come back.
  - The Setup tab renames the layout on screen, deletes it, or deletes the game
    (`renameLayout`, `deleteLayout`, `deleteGame`). A rename keeps each profile's id and
    keys and carries its `sets.yaml` entry and game.yaml's acknowledgements and
    `ingame_set` with it (`renameSetEntry`, through the YAML document so comments stay);
    a delete takes them out (`removeSetEntry`) along with the compiled files. A game's only
    layout and the reference layout the checks compare against are refused.

### Fixed

- **The board stays still while a unit is tested.** Test keys, Check this unit, Write to
  units and the save notes were drawn above the board, which jumped 150 to 400 pixels down
  as they grew with each press. They now share a tray over the foot of the window that
  scrolls in itself, and the Test keys button keeps its label, which had re-wrapped the
  header at 1280 wide. Each unit's card also holds all its keys again at 1280x720.

- **A one-unit layout can be given its other unit.** In place of "Add a profile with
  `unit: right`", the board offers Add the right unit (or left), which adds that unit
  empty to the same layout (`addUnitToLayout`, `/api/layout/unit`).

- **Saving a press test asks first.** It reads every key in the window, the computer's
  keyboard included, so a stray key could overwrite a checked unit map. Save its map now
  lists what would change and asks, and says so when nothing would. Clear all keys says
  that autosave keeps the change and Ctrl+Z brings it back.

- **The right unit's stick sends left for left.** The press test of 2026-11-11 found its
  left and right swapped (up and down were right), so `devices/cyborg2-right.yaml` now
  carries `stick_directions` swapping them back, and every right-hand layout is rebuilt
  with it. The same run recorded D-pad press on D-pad left's pin, from the centre tipping
  as it was clicked; it stays on pin 37.

- **The press test draws the stick as a cross.** The d-pad's placement rules reached the
  stick's cells and drew Stick press where stick up should be. A stick tilting as it is
  clicked is now passed over during a button step, and a pin already recorded for another
  position is refused, naming that position. Its status lines are reworded.

- **The unit maps' headers are one line.** They held one owner's dated test notes, which a
  person with their own units would take as being about theirs.

- **A unit named from the page stays named.** The page's data now carries the id
  `local.yaml` gives each unit, as the CLI's does, so a unit named from Write to units or
  the press test is not unknown again on the next refresh. A press test saved from the
  page keeps the id the device map already has, so one person's unit never reaches the
  committed file.

- **One thing talks to the units at a time.** Write to units ends the press test and waits
  for it to let go of the units before opening them, and the press test waits for a
  finished write to let go too. A pass chosen while the probes are going on is followed
  once they are on, and pass switches no longer overlap.

- **`npm audit` is clean.** happy-dom, the editor tests' browser, goes to 21.0.4 (a high
  advisory on untrusted HTML). minimatch, inside ESLint, had a moderate one fixed only in
  11.0.1, while every ESLint 10 still asks for 10.x. npm's own fix was to go back to
  ESLint 9, so `overrides` in `package.json` gives ESLint minimatch 11 instead. Drop the
  override once ESLint depends on 11 itself. Neither ships with the app, and the gate
  passes on both.

- **The repo works from PowerShell again, and still from WSL.** The gate failed four unit
  tests on Windows. A game folder outside the data root was named by a `..` path from the
  data root and then looked up from the repo root, three folders higher; on Linux the extra
  steps stop at `/` and hid it, on Windows they land elsewhere. Such a folder is now named
  by its absolute path (`dataRelativePath`). The other three were the tests' own Unix
  spellings: a fixture path built with `path.join`, and save paths expected as `/repo/...`.
  `bin/azeron.cmd` lets `.\bin\azeron` run in PowerShell. `.gitattributes` pins LF, so
  Git for Windows' `autocrlf` cannot check out CRLF scripts that bash under WSL would choke on.
- **The repo runs on anyone's computer without editing it.** `game.yaml` named the games'
  files by the owner's own folders (`/mnt/c/Users/there/...`, `/mnt/d/SteamLibrary/...`),
  in WSL's spelling. From PowerShell that meant `azeron ingame` quietly compared against
  the committed copy instead of the game's `Input.ini`, and `--apply` refused. On anyone
  else's computer it pointed at nothing. It now names them by where every install puts
  them. `${LOCALAPPDATA}` is found from PowerShell or WSL, and `${steam:Elite Dangerous}`
  in every Steam library Steam lists, so Elite's preset was found on `D:` with nothing
  configured (`src/lib/machine.ts`).
- **`local.yaml`**, gitignored, holds what is one computer's own: a game installed
  somewhere unusual, an export folder (`azeron import --export-to` now writes it there
  rather than into the committed `game.yaml`), and the ids of that person's units. Their
  ids are not the owner's, so Write to units used to refuse them with no way round. It now
  lists units it does not know, with their ids and the lines to add. A file not found
  says where it was looked for and which line to set. `local.example.yaml` documents it.
- **Setup docs cover both shells**: the README's first run, reinstalling `node_modules`,
  the hooks and smoke tests' bash, Playwright, refreshing the test fixture, and the
  environment guard's own advice, which gave cmd's `rmdir /s /q` as the PowerShell command.

### Added

- **A new game starts on both units, like a controller or like a keyboard.** Add a new game
  used to put the genre's one-unit layout on the left unit and leave the right one empty,
  and with the pool of keys spent on the left, the first action put on the right sent
  nothing. Each genre now has two styles (`genres/<Genre>/layouts.yaml`). **Like a
  controller**, the default, holds the pair like an Xbox pad: each genre action records
  the pad control a game usually puts it on (`xbox:` in actions.yaml, shown on the action's
  tooltip), and goes where that control sits on the pair (`src/lib/xbox.ts`): sticks to
  sticks, A B X Y under the right thumb, the d-pad under the left, bumpers and triggers
  under the index fingers. **Like a keyboard** puts the genre's one-unit layout on the left
  and the rest on the right. Both fly the genre's stick mode. A shooter with no mouse fires
  and aims on mouse buttons sent from the triggers, and looks with keys on the right stick
  (`look_up` and the rest, new in the FPS vocabulary). **Pedals** can be added to either
  where the genre's stick modes say what they take (space sims: the rudder takes yaw, and
  the sticks fly the with-pedals variant); a game whose file the repo does not write binds
  them in its own controls screen, so `pedal-unknown-game-axis` no longer asks it for a row.
  Every style starts with nothing for the checks to say; the pad's two thumbs doing
  different jobs is acknowledged with its reason. `azeron new --style --pedals`.
- **Seventeen more keys to hand out**, at the end of the pool so no key already given
  moves: `=`, the arrows and then F13 to F24, 48 in all, enough for a pair. F13 to F24 are
  on no keyboard sold today, so no game default is on them, but they come last because some
  games cannot bind them at all: Unreal has no name for them, nor do Everspace 2's and
  Elite's files, so the wiring skips them for those games. A new shooter laid out like a
  controller wires 37 actions, one of them onto F13; Show the wiring on the In-game tab moves
  a key by hand.
- **`npm start` opens the editor** in Chrome or Edge (`serve --open`), and a
  `node_modules` installed from the other shell (WSL or Windows) is reinstalled for this
  one instead of stopping with instructions.
- **The README is a new user's**, start to finish, and each game already here has a case
  study in its own folder (`games/<Genre>/<game>/README.md`) instead of a section of it.
- **The press test runs without the Azeron app.** The Press test tab used to offer two
  files to import in the app, and to delete from the units there afterwards. **Put the
  press test on the units** now writes both profiles into each unit over USB, each on that
  unit's own export, and reads them back; the pass on screen decides which one a unit runs,
  and **Take the press test off** deletes them again.
- **A new unit is named in one click.** A unit no device map knows used to need its id
  typed into `local.yaml`. The write bar and the press test now offer "This is the left
  unit" / "This is the right unit", which write it there.

- **A new game, or a new layout, with no Azeron app.** Starting a game used to need an
  export from the app, and so did every new layout, the next version of one included.
  - **Add a new game** (`azeron new`) takes a name, a genre and the units. Each unit's
    profile is built on that unit's own real export, now named in its device map
    (`template:`), so the right unit keeps its rotated stick. The genre's default layout
    goes on its unit, and every action it places is given a key. The pool of keys kept out
    of a game's way (31) is smaller than a whole space-sim layout (38), so required actions
    are served first and what is left is reported and left empty, never placed sending
    nothing.
  - **Add a layout** (`azeron layout`) starts from a copy of one of the game's layouts,
    with its pedals and the modes it plays, or empty.
  - The export is still taken by both, folded away as an option. The Setup tab no longer
    says that writing to the units goes through the Azeron software.

- **Helldivers 2 and Ace Combat 7, with a default layout each; and a Flight genre.** Neither
  has been played on the units yet.
  - `genres/Flight/`: the four axes of a plane, weapons, view and menus, a single-unit
    default, and DJI Modes 1–3 as stick modes, which translate one for one for a plane.
  - `games/FPS/hellDivers/`: one left unit and a mouse. Aiming needs the mouse: the Cyborg
    II has no sensor and a stick can only be written in keyboard mode, so a right-hand unit
    would have nothing to aim with. Keys are the game's defaults, from Arrowhead's list; the
    owner's settings file has not changed any. The stratagem input is held on the pinky
    and the code entered on the movement stick, which sends the same W A S D the game
    reads for both.
  - `games/Flight/aceCombat7/`: a pair in Mode 2, throttle and yaw on the left stick and
    pitch and roll on the right. Keys are the game's published defaults, not checked
    against an installed copy. A second decelerate key makes the high-G turn (both throttle
    keys held) reachable.

- **Deleting a unit's slots from the write bar.** Each unit's other slots are listed with a
  Delete beside each, which sends `DELETE_PROFILE` -- seen on 2026-10-17 when a slot was
  deleted in the app -- and reads the slots back to see it gone. It will not delete the slot
  the unit is running, one it does not have, or the last one. The other slots keep their
  numbers, so a deletion leaves a gap; the unit adds a new slot only at the lowest free
  number, so a new slot now goes there instead of after the last, which the unit ignored.
- **Writing to the units, hardened after a review:**
  - A write checks the layout is still the one it planned for when Write is pressed, and
    plans again if it changed. Before, an edit while the bar waited could have put an old
    copy on the units and called it read back as written. Choosing another layout ends a
    write that has not started.
  - When the page cannot tell whether the Azeron app is running, it asks instead of
    taking that for closed.
  - Cancel while the units are being found lets go of them once they answer.
  - A unit's answer to an input record is matched by the sequence number it echoes, so a
    late answer is not taken for the next one.
  - A report the page cannot read is passed over rather than ending the write.
  - A slot added and then left empty by a write that stopped no longer makes the unit
    unreadable.
  - The stick's hold type and hold keys are part of the read-back.
  - A read-back that fails after every input went in says so.
  - Two overlapping waits for the unit can no longer lose a report.
  - The key tester's Stop answers Enter, and a key let go of while the window was
    elsewhere is forgotten.

- **The write bar says what it leaves alone.** Each unit's row says the sensor state and DPI
  step the layout wants, which are not written yet, and -- read from the slot's own
  settings, now decoded as far as the evidence goes -- the DPI steps the slot holds when
  they are not the layout's. The slot's current step and sensor state are not decoded: every
  slot seen holds the same values in bytes that cannot be told apart.
- **A layout written straight to the units counts as on the units.** After Write to units,
  the header's Re-import and `azeron units` went on asking for an import the units no
  longer needed, because they judged by the Azeron app's copy. A write that reads back
  clean is now recorded with a fingerprint of what went onto the unit
  (`logs/units-written.json`), and a unit whose last such write is the layout as it is now
  is reported as written directly, on that date, into that slot.

- **Test keys**, in the header: press anything on a unit and the control that sends it
  lights up on the board while it is held, with a strip of what arrived and which action it
  is. Free-form, unlike Check this unit; the page's own shortcuts are off while it runs.
- **The Edit screen's checks have a tab of their own**, beside one for the sticks and
  pedals, so the page is not one long scroll. The tab says how many checks there are.
- **Writing to the units says more and gives up less.** A lost answer to a read, a rename or
  an input record is asked again once; adding a slot never is. A failure says the step it
  was on and how many inputs had gone in, a unit pulled out mid-run is said at once, and the
  page asks before it is closed during a write. Each unit is left running the slot it was
  just given. Every step and, on a failure, the reports that led to it go into
  `logs/units.log`, with page errors.

- **Write to units**, in the header: the editor writes the layout straight into the units'
  onboard slots over WebHID, then reads each slot back and says whether it holds what was
  written. No Azeron app, no export, no import. It finds the units the page has been given,
  knows which is which from the id each one reports, puts each hand into the slot that
  already has the layout's name, and says beforehand how many controls each slot will
  change -- warning when a stick's inversion does. It saves first, can close the Azeron app
  when that is in the way, and says in plain words what went wrong. The protocol was
  recovered on 2026-10-14 by watching the app write a profile
  (`docs/guides/unit-protocol.md`) and checked on both units on 2026-10-15; the repo sends
  only what the app was seen to send. Sensor, DPI and lights are not written yet. The first
  version stalled on every overwrite, before writing anything: it asked the unit to add a
  slot that was already there.
- The right unit's akimbo slot, as the Azeron app wrote it on 5 October, inverts the stick's
  Y axis where the layout inverts X. Writing the layout from the editor changes that, and
  the editor says so before it does.

- **`azeron hidcap`**, for reading what the Azeron app says to a unit. It reads a USBPcap
  capture (pcap or pcapng) and prints the HID conversation -- reports set and asked for,
  reports the unit sent, the descriptors it was asked for -- and `diff` names the byte
  offsets that moved between two captures made with one setting changed. The units'
  configuration protocol is in the app's compiled main process, so a capture is the only
  way to read it without sending a unit a guess. It only reads files; nothing in it can
  talk to a device. `docs/guides/hid-capture.md` is the procedure. The reader is tested
  against files built to USBPcap's documented layout, not yet against a real capture.

- **Check this unit**, on each unit on the board: the page lights up one control at a time,
  reads the key or mouse button the unit sends when it is pressed, marks each key, and says
  whether the unit is running the layout, which controls are not, and what to do. What a
  unit runs is in its own memory, which only the Azeron app can read, so pressing it is how
  the unit answers for itself -- whichever of its three onboard profiles it is on. Two of
  those still hold the press-test probe, and a run on one says so.
- The press test says, when it is done, to delete the probe profiles from the unit's
  on-board memory, as does `azeron probe`. Both units carried two of them in their three
  on-board slots from 28 September to 4 October, one press of the profile button away.
- **The editor knows what is on the units.** It reads the Azeron app's own copy of each
  profile and compares it with the layout control by control. The header's **Re-import N**
  now comes from that rather than from the saves this page made, which a reload forgot:
  the right unit was still on the 2 October import while the board had moved on, so Ring
  4, labelled Ultimate, sent I and opened the inventory. The report names each key the unit
  does otherwise and the file to import; those keys are marked on the board; coming back
  to the page checks again. `azeron units` is the same from the terminal. It only reads.
- **Renaming an action renames the keys named after it.** A key's label is what the unit
  shows, and it is compiled as written, so a rename on the In-game tab left the keys and
  the unit showing the old name. A key given its own name keeps it.
  `label-names-other-action` warns on a key labelled with another action's name.

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

- **Pedals in the editor.** The Edit tab shows a layout's pedals beside the checks: what
  each axis drives, invert, the tuning behind Details, and how far the game's name for
  the axis is trusted. They save with the one Save, which patches `sets.yaml` line by line
  so its comments and the other layouts survive. The stick-mode panel reads and applies a
  mode's with-pedals variant while the pedals carry yaw, and says when a pedal edit has
  changed how the sticks read; it never rewrites the sticks on its own. The pedal lint
  rules run on unsaved edits.

- **Name a new game's actions in the editor.** On the In-game tab an action's name is
  edited in place and its roles are switches, saved by the one Save; `/api/actions`
  carries `label` and `tags` and patches them line by line like keys. A game started from
  an export seeds an action per mouse button as well as per key, and names its layout
  after the game, layout and unit rather than after the export it came from.
- The Checks panel shows the required actions that are on no key as one entry that opens
  to the list, and counts it once. The linter and the CLI report them as before.
- The In-game and Setup tabs say what is missing when a game's own key settings are not
  connected, and withhold the buttons that could not work.

- **The toe brakes can drive a game axis.** A Windows calibration makes a toe read zero at
  rest and full when pressed, and `calibrated_rest: centre` on the axis in the pedals'
  device file records that it is set, which stops `pedal-rest-on-centred` from warning.
  Both toes are calibrated on the owner's machine and recorded.
  An axis assigned in the Pedals panel now has `invert` written outright, because the
  game's thrust row is inverted as it ships and an unticked box over it would not mean
  what it shows. Which pedal is which game axis was recorded rather than reasoned: the
  rudder is `Axis2`, the left toe `Axis0`, the right `Axis1`; none is flown.

- **Drag and drop on the Edit tab.** An action is dragged from the list under the units
  onto a key, or onto one of a stick's four directions; a key is dragged onto another to
  swap them, across units too, or back onto the list to clear it. The list is no longer
  switched off when no key is selected. Clicking a key and then an action still works.
- **Every key on the board is one size.** A key grew with its label and pushed the ones
  under it out of line. The name takes up to two lines; a key with more on it than its
  name shows the rest on one line, and the whole of it in its tooltip.

- **The editor does the wiring.** A control reaches the game on a key, and which key is no
  longer the owner's to pick. An action with no key is given one when it is first put on a
  control, from a pool that stays out of a game's way; it is saved in `actions.yaml` with
  the layout and written into the game by Update the game's keys…. A key once given is
  kept. The In-game tab hides the keys while there is a game file to write them into
  ("Show the wiring" brings them back) and shows them for a game that has none, where they
  have to be set by hand. `action-sends-nothing` is a new lint error for a control whose
  action has no key. The unsaved marker calls the in-game half "Wiring".

- **Changes save themselves.** On the served page an edit is saved about a second after
  the last one; the header shows what is left to do (files to re-import, the game to
  update) in place of a report after every save. **Undo**, a header button and Ctrl+Z,
  takes one change back at a time. The menu turns autosave off.
- **Clear all keys** empties every key and stick direction on both units, after asking.
- **A toe brake drives one direction of an axis**: hover up on one toe, hover down on the
  other. It is written onto the game's own row for that direction. Not flown: whether the
  game reads a pedal in proportion there, or as a button, is to be seen. An action dragged
  onto a pedal sets what it drives.
- The page is centred in a wide window.
- **Elite Dangerous**, with every control the game has. `src/lib/elite.ts` reads its
  bindings files and names, groups and gives a mode of play to each control; the action
  list is every button control in every installed preset and in the owner's old file, 358
  in all, each starting on the key the game's KeyboardMouseOnly preset gives it where the
  keypad can send that key.
- **Modes of play.** An action can carry a mode and a layout can list the modes it plays.
  Actions in modes no layout plays together may share a key; the editor shows a layout only
  its modes' actions, and `missing-required` asks only for theirs. Elite has three
  layouts -- the ship, the buggy, on foot -- each also playing the maps, menus, camera and
  general controls.
- **Elite's keys are written too.** Update the game's keys… (and `azeron ingame --apply`)
  for a game with `ingame_format: elite-binds` starts from the installed preset
  (`ingame_preset`), takes over the keyboard and mouse slots of every control an action
  names, adds the controls the preset lacks, and writes `Custom.4.1.binds` -- the committed
  copy, and with `--apply` the game's, after pointing `StartPreset.4.start` at `Custom`
  and copying both files aside. Bindings the keypad cannot send (Ctrl+Alt+Space for the
  camera suite, the mouse wheel for weapons on foot) are cleared with the rest. Not yet
  flown. The bindings reader skips XML comments.

### Layouts

- Actions already on a key somewhere in the layout are greyed in the list on the Edit tab,
  so what is still to place stands out. They can still be dragged: one action may sit on
  more than one key.

- **akimbo v10** now has pedals: the rudder on yaw, and its sticks are Mode 2 _with pedals_
  -- roll, not yaw, on the left stick, since the pedals carry the turn. The right toe is on
  thrust, as an analog throttle, now that a calibration makes it rest at zero; the stick's
  thrust keys stay for full thrust and reverse. The left toe is on nothing. The names are
  inferred, not flown. Not yet flown.
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

- **A reload opens where the page was.** The game, the layout and the tab are kept in the
  browser and restored, instead of the page opening on the first game every time. A game
  or layout that has gone since falls back to the first; a reload on the press test opens
  Edit. Unit tests start each with empty storage, so none opens where another left off.
- **No sensor on the Cyborg II.** It has no optical sensor, so its device maps say
  `sensor: false`, the editor's Key panel no longer offers a sensor checkbox, a DPI step or
  the "both sensors are on" warning for it, and the write bar says nothing of a sensor or
  DPI. The pointer actions (`pointer_x`/`_y`, FPS `look`) are `provided_by: mouse` now. The
  compiled layouts are unchanged: the app's own exports carry `isSensorOn` either way.
- **`required` means you cannot play without it.** It had come to mean whatever one layout
  happened to have: every device and consumable slot, both weapon cycles and roll were
  required, in space sims; 25 actions in a shooter. It is now moving, boost, the two drives
  and interact, and their like in a shooter. A pedal that drives an axis carries its
  actions, so they are not called missing for want of a key.
- **No test reads the real layouts.** The unit tests, the CLI smoke tests and the browser
  specs run against a frozen copy of the data. A layout half way through a change used to
  fail 19 tests and block every commit, and the browser specs wrote into the layout files
  while the editor might have them open.

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

- **The units are asked which slot they run, not remembered.** The profile button moves a
  unit without telling the page, so a slot remembered from connecting could be wrong:
  Delete could reach the slot the unit was running, and a write into the slot remembered
  as running reported it running without asking. Both now ask the unit first, and a write
  switches only when the unit is on another slot.
- **A deleted slot no longer counts as holding its layout.** Deleting a slot left its
  record in `logs/units-written.json`, so the header went on calling the layout on the
  unit. The page now tells the server (`POST /api/units/deleted`), which drops it.
- **The editor writes where it is to storage only when that changes**, not on every
  render, which the key tester and the check run do on every key.
- **Stale notes.** The Everspace `sets.yaml` header still said the sticks use the
  with-pedals mode (the rudder is on roll, so they do not); the Flight default said pitch
  and roll were left to a mouse, though it puts them on keys; CLAUDE.md's `install` row
  had lost `--device-id` and `--store`. Helldivers 2 and Ace Combat 7 now say which
  Windows shortcuts their default modifier keys can make (Alt+Shift, Alt+Tab, Ctrl+Shift,
  Ctrl+Space), and why Ace Combat's second S key is not for braking.
- **Deleting a slot after the unit was switched.** A session went on taking the slot the
  unit ran when it was first asked for the running one, so after a write switched the unit
  it refused to delete the slot left behind and would have deleted the one now running.
  Switching now updates it. Found while clearing the left unit's probe slots.
- **The stick's hold key is encoded as the app encodes it.** The app writes the export's
  `"16"` as `0xE002` (left Shift) and `"17"` as `0x0011`; the page wrote `0x0010`, so a
  slot the app had written read back as different and one the page wrote held another key.
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

- **The editor's server answered anyone.** It listened on every interface and its routes
  write into the repo and the game's config, so another device on the network, or any web
  page open in the browser, could call them. It now listens on 127.0.0.1 only (`--host`
  opts out), answers only a loopback `Host` on its own port, and takes a state-changing
  request only as `application/json` from its own origin.
- A malformed save could be written and then break every command; saves are parsed as the
  file their path names first. A handler that throws returns an error instead of ending
  the server. A request body split in the middle of a character is no longer corrupted.
- The server showed a file as it was when it last wrote something, not as it is on disk.
- An import that failed to decompile left its template behind. Writing the game's bindings
  reported success when the game's file was missing, and silently unbound a row whose key
  the game has no name for; both are refusals now.
- Lint: a stick sent in another mode through `raw.types` passed `stick-not-keyboard`; a
  sensor-provided action could be put on a key (`provided-action-bound`); `--strict` did
  not fail on a stale acknowledgement.
- A half-made game folder broke every command; it is skipped and named once. Paths built
  on Windows used backslashes and failed comparisons.
- Exporting a partial press test deleted every key it had not reached and marked the map
  verified.

- A game started from an export could not have a key changed from the page at all: its
  `actions.yaml` was written four lines to an action, which the line patcher refuses. It
  is written one action to a line.
- `/api/actions` answered "not saved" for a file it had written when the check after the
  write failed, and accepted a key that was not a string.
- In the editor: looking at an empty key marked the page unsaved; opening a data file
  discarded unsaved edits without asking; a key capture or the press test could outlive
  the game or tab it was started on.

- **Adding a layout from the Azeron app's exports did nothing.** Choosing a file imported
  on the spot, was refused when the name was still empty, and said so at the top of the
  tab, out of sight of the form. The form now keeps its name, takes an export for each
  unit, imports when **Add layout** is pressed, and opens the result on the board. The
  Setup tab's message stays in view while the tab scrolls.
- Writing the game's keys had two names, "Write the game's bindings" on the Setup tab and
  "Update the game's keys" everywhere else, and two code paths. It is one of each, and its
  report now lists what the pedals changed as well as the keys.

- A stick that was cleared and given a direction again was saved without its mode, and
  compiled as no stick at all. A stick with directions and no mode is read as the keyboard
  stick it can only be, and the editor writes the mode.

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
- A game started from an export with the genre's vocabulary has about 80 actions, and its
  Edit tab does not fit one screen at 1920x1080.
- Lint findings name keys and positions by their ids (`KeyF`, `middle_3.tap`), not the
  way the rest of the page says them.
- Writing keys into a game's own settings is built for Everspace 2's `Input.ini` only.
