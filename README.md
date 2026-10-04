# azeronMappings

Azeron Cyborg II profiles as code. A profile says which **game action** each **physical
position** on a keypad sends; this repo compiles it into the Azeron app's import JSON,
checks it against what has already gone wrong in play, and generates the game's own key
bindings to match — so a layout is changed on the keypads alone.

Everything below is done from one page, the editor. The terminal is only for starting it.

## First run

```sh
npm install
npm start          # builds, then serves the editor at http://localhost:4173
```

> **Pick one shell and stay in it.** The repo sits on a Windows drive that WSL also
> mounts, and one `node_modules` cannot serve both. If you switch between WSL and
> PowerShell, delete `node_modules` and run `npm install` again in the one you mean to
> use. Every command checks for this and says so.

The editor answers only this computer: it listens on `localhost` and refuses requests
from other devices and from other web pages. `npm run azeron -- serve --host <address>`
opens it to a network you trust.

The CLI is `npm run azeron -- <command>`, which works in either shell (`./bin/azeron`
works in bash only). `npm run azeron -- help` lists everything.

## Getting a pair onto the units

1. **Give the game its bindings.** Close Everspace 2, then in the editor's **Setup** tab,
   **Update the game's keys…** (or `npm run azeron -- ingame --apply`). This writes the
   game's `Input.ini` from `games/SpaceSims/everspace/actions.yaml`, keeping the previous
   file beside it. You do this once, and again only when an in-game key changes — never
   from the game's own controls screen.
2. **Import both files** in the Azeron app (2.0.2), each onto its own unit:
   - `dist/SpaceSims/everspace/everspace_akimbo_v10_left.json` → the unit on your left hand
   - `dist/SpaceSims/everspace/everspace_akimbo_v10_right.json` → the unit on your right
3. **Write each profile to its unit, then close the app before playing.** Profiles run
   onboard, and the app rewrites its own files while it is open.

**Is what is on the units the layout?** The editor reads the Azeron app's own copy of each
profile and compares it with the layout, key by key. While the app has an older one, the
header shows **Re-import N**: it lists each unit's file to import and every key the unit
does something else on — "Ring 4: the unit has Inventory (I); the layout has Ultimate
(G)" — and those keys are marked _not on unit_ on the board. Coming back to the page from
the app checks again. `npm run azeron -- units` says the same in the terminal.

Both units report the same USB product id, so nothing on the computer can tell them
apart for you — the app lists them separately, and the press test (below) will confirm
which is which if you are unsure.

### Elite Dangerous

Elite is played in modes, and has a layout for each: **ship**, **srv** (the buggy) and
**on-foot**, each a pair of files in `dist/SpaceSims/eliteDangerous/`. Import all six, one
profile per mode on each unit, and switch between them with the unit's profile button as
you get out of the ship. The same button is a different thing in each.

Update the game's keys… writes Elite's `Custom.4.1.binds` and tells the game to use it
(`StartPreset.4.start`), keeping copies of both. Close Elite first. Anything you had bound
to a joystick in the game is not in the new file: it starts from the game's keyboard
preset, not your old one.

## Changing a binding

A layout says which control does which action: this key is thrust, that one is boost. It
is both keypads and the pedals, changed on the **Edit** tab. **Changes save themselves**
about a second after the last one; **Undo** (or Ctrl+Z) takes one back, and the ⋯ menu
turns autosave off if you would rather press Save.

- The actions are listed under the two units: drag one onto a key, or onto one of a
  stick's four directions. Drag a key onto another to swap them, or back onto the list to
  clear it. Clicking a key and then an action does the same, and reaches the long press and
  double tap. The label follows the action.
- **The wiring is not yours to manage.** A control reaches the game on a key: the keypad
  sends it and the game listens for it. The editor picks that key when an action is first
  put on a control, keeps it in the game's `actions.yaml`, and writes it into the game with
  **Update the game's keys…**. The **In-game** tab is where actions are named and given
  their roles; **Show the wiring** there shows the keys, and lets one be moved by hand.

What a save leaves for you to do shows in the header: **Re-import N** lists the files to
import into the Azeron app, as paths its dialog takes, and **Update the game's keys…**
appears when the wiring or the pedals changed. That one asks whether the game is closed and
then writes its `Input.ini`; it is the one thing saving never does on its own, because it
writes outside the repo. **Clear all keys**, on the Actions bar, empties the board to lay a
layout out again; Undo brings it back.

Stick modes (DJI Mode 1/2/3, the game's own twin-stick layout, and a roll variant) are
applied to both sticks in one click from the editor's side panel.

Rudder pedals are part of a layout. They sit beside the checks on the Edit tab — what each
axis drives, and how far the game's name for it is trusted — and save with the keypads and
the in-game keys. While the pedals carry yaw, a stick mode is applied in its with-pedals
form, which gives the stick's freed direction to roll. A toe brake is half an axis, so it
is offered directions: hover up on one toe and hover down on the other. An action dragged
from the list onto a pedal does the same. A layout with no pedals offers
**Add pedals**.

## Learning a layout

- **The Edit tab is the reference**: both hands with every binding on them. For paper,
  the header's menu has **Print layout**, which prints the board itself and nothing
  around it.
- `npm run azeron -- bindings` writes `dist/.../<game>-ingame-bindings.md` and `.csv`:
  every action the units send, its key, and where it is sent from.
- `npm run azeron -- ingame` compares the game's `Input.ini` with `actions.yaml` and
  lists any row the game has put on another key.

## Where things are

| Path                    | What it is                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `games/<Genre>/<game>/` | `actions.yaml` (the in-game keys), `profiles/` (the layouts), `game.yaml`, `playtests.md` |
| `devices/`              | Which physical pin each position is, per unit — measured, not guessed                     |
| `genres/<Genre>/`       | The action vocabulary and stick modes a kind of game shares                               |
| `templates/`            | Real exports from the app, which the compiler builds on                                   |
| `dist/`                 | **What you import.** Compiled JSON and the game's bindings. Committed.                    |
| `build/`                | Compiled TypeScript. Throwaway, not committed — nothing here is for you.                  |

## When it refuses

The linter's rules came from real play sessions. Each finding names its rule:

| Rule                                  | Level   | What it catches                                                   |
| ------------------------------------- | ------- | ----------------------------------------------------------------- |
| `missing-required`                    | error   | An action you need that no unit sends — the reach for the gamepad |
| `key-collision`                       | error   | Two different actions claiming one key                            |
| `unbound-key`                         | error   | A key no action declares, usually an edit made in the app         |
| `action-sends-nothing`                | error   | A control whose action has no key to be sent on                   |
| `unknown-position` / `unknown-action` | error   | A typo in a profile                                               |
| `stick-not-keyboard`                  | error   | A stick in gamepad mode, which made the game stutter              |
| `stick-double-correction`             | error   | Two corrections for one stick rotation                            |
| `combat-tap-delayed`                  | warning | A long or double press delaying a fight or flight key             |
| `menu-with-combat`                    | warning | A menu on a key you mash or hold in a fight                       |
| `hold-on-movement`                    | warning | A latching flight key — boost must not latch                      |
| `duplicate-output-key`                | warning | The same key sent from two positions                              |
| `akimbo-role-mismatch`                | warning | The same finger doing unrelated jobs on each hand                 |
| `label-names-other-action`            | warning | A key labelled with another action's name, which the unit shows   |
| `unverified-device`                   | warning | A device map nobody has press-tested                              |
| `stale-acknowledgement`               | note    | An acceptance for a finding that no longer exists                 |

A finding that is real but accepted goes in `game.yaml` under `lint.acknowledged`, with a
reason. [CLAUDE.md](CLAUDE.md) has the constraint behind each rule.

## Less often

**Press-testing a unit.** The right unit is not a mirror of the left — its thumb cluster
is rotated half a turn — so each map is measured. `npm run azeron -- probe` writes
`dist/probe/probe-1-pins.json`, a profile where every pin sends a different key, and
`probe-2-stick-zero.json` for the stick. Import one onto a unit, open the editor's
**Press test** tab, and press what it highlights; it records which pin fired and exports
a corrected `devices/<unit>.yaml`.

**Bringing a layout from the Azeron app.** In the Setup tab, **Add a layout**: a name, the
export for the left unit and the export for the right (either alone will do), then **Add
layout**. The pair opens on the board under that name. Anything that will not round-trip
is kept raw rather than guessed at. (`npm run azeron -- decompile` does one file from the
terminal.)

**Starting a new game.** In the Setup tab, **Add a new game**: its name, the kind of game,
an export from the Azeron app and which unit it came from. Each distinct key the export
sends becomes an action named after the key — an export says which keys are pressed, not
what they do — so the first job is the **In-game** tab: click a name to rename it, and
switch on the roles it plays. The Checks panel lists the genre's required actions that are
on no key yet as one entry. Writing keys into the game itself is built for Everspace 2's
settings file only; for another game, set the keys in its own controls screen to match.

**Writing into the app's library directly.** `npm run azeron -- install everspace --yes`
drops each profile into the app's store under its own unit (`--dry-run` first). It
refuses while the app is open and backs up what it replaces. Importing through the app
stays the supported path.

## Contributing

`npm run check` is the gate: build, typecheck, lint, format, unit tests and CLI smoke
tests. The pre-commit hook runs every unit test; pre-push runs the whole gate.
`npm run test:e2e` drives the served editor in a browser. Every test runs against a frozen
copy of the data (`tests/fixtures/repo`), never the layouts you are editing, so a layout
half way through a change fails nothing. See [CLAUDE.md](CLAUDE.md).
