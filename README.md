# azeronMappings

Azeron Cyborg II profiles as code. A profile says which **game action** each **physical
position** on a keypad sends; this repo compiles it into the Azeron app's import JSON,
checks it against what has already gone wrong in play, and generates the game's own key
bindings to match — so a layout is changed on the keypads alone.

Everything below is done from one page, the editor. The terminal is only for starting it.

## First run

You need Node 22 or newer and Git. The repo works from PowerShell or from WSL; the
commands are the same in both:

```sh
npm install
npm start          # builds, then serves the editor at http://localhost:4173
```

Open the editor in Chrome or Edge on Windows. Write to units and the press test talk to the
units over WebHID, which only those browsers have. From WSL, Windows reaches the editor on
`localhost` as usual.

> **Pick one shell and stay in it.** The repo sits on a Windows drive that WSL also
> mounts, and one `node_modules` cannot serve both. If you switch shells, reinstall in
> the one you mean to use. Every command checks for this and says so.
>
> ```powershell
> Remove-Item -Recurse -Force node_modules; npm install   # PowerShell
> ```
>
> ```sh
> rm -rf node_modules && npm install                      # WSL
> ```

Nothing in the repo needs editing for your computer. Each game's own files, and the Azeron
app's profile store, are found on their own (see
[Your computer and your units](#your-computer-and-your-units)).

The editor answers only this computer: it listens on `localhost` and refuses requests
from other devices and from other web pages. `npm run azeron -- serve --host <address>`
opens it to a network you trust.

The CLI is `npm run azeron -- <command>`, which works in either shell, or `bin/azeron`
directly: `./bin/azeron` in bash, `.\bin\azeron` in PowerShell (through `bin/azeron.cmd`).
`npm run azeron -- help` lists everything.

## Your computer and your units

The repo finds what it needs on whatever computer runs it, from PowerShell or WSL:

- **The games' key settings files** are under your Windows user's `AppData\Local`, which is
  where every copy of Everspace 2 and Elite Dangerous keeps them. `game.yaml` names them
  that way (`${LOCALAPPDATA}/ES2/...`), never by one person's folder.
- **Games installed through Steam**, in any of your Steam libraries: the list Steam keeps
  of them is read. Elite's control-scheme preset is found this way.
- **The Azeron app's profile store**, under `AppData\Roaming`.

Two things are yours to tell it, in a file called `local.yaml` at the top of the repo. Git
ignores it, so it never gets committed or overwritten by an update. Copy
`local.example.yaml` to start one.

- **Your keypads.** Each unit reports an id, and **Write to units** (and the press test)
  writes only to a unit whose id it knows. The ids in `devices/` belong to the repo owner's
  units. The first time, it lists the units it found but does not know, each with a
  **This is the left unit** / **This is the right unit** button that puts its id in
  `local.yaml` for you. Unplug one unit to see which id belongs to which hand.
- **Anything installed somewhere unusual**, like a game from another store or a settings
  file that has been moved. When a file is not found, the page and the CLI say where they
  looked and which line of `local.yaml` would point them at it. Until then, comparing keys
  uses the repo's own copy, so nothing breaks.

## Getting a pair onto the units

1. **Give the game its bindings.** Close Everspace 2, then in the editor's **Setup** tab,
   **Update the game's keys…** (or `npm run azeron -- ingame --apply`). This writes the
   game's `Input.ini` from `games/SpaceSims/everspace/actions.yaml`, keeping the previous
   file beside it. You do this once, and again only when an in-game key changes — never
   from the game's own controls screen.
2. **Write to units**, in the editor's header (Chrome or Edge, with the Azeron app
   closed). It writes the layout straight into both units' onboard slots over USB, reads
   each slot back to check it, and leaves each unit running it. No export, no import. It
   tells the two units apart by the id each one reports, puts each hand into the slot that
   already has the layout's name (or a new one), and says before writing how many controls
   each slot will change. The write bar also lists each unit's other slots, with a
   **Delete** beside each.

The Azeron app is the other way in: import
`dist/SpaceSims/everspace/everspace_akimbo_v10_left.json` onto the unit on your left hand
and `…_right.json` onto the one on your right, write each to its unit, then close the app
before playing. It rewrites its own files while it is open.

**Is what is on the units the layout?** After a write that read back clean, the editor
knows: it keeps a fingerprint of what went onto each unit (`logs/units-written.json`). For
a layout that came in through the app, it reads the app's own copy of each profile and
compares it with the layout, key by key. While a unit is behind, the header shows **Not on
the units**: it lists every key the unit does something else on — "Ring 4: the unit has
Inventory (I); the layout has Ultimate (G)" — with a **Write to units** button, and those keys are
marked _not on unit_ on the board. Coming back to the page checks again.
`npm run azeron -- units` says the same in the terminal.

**Is a unit running the layout?** Each unit holds up to six profiles in its own memory and
runs the one its profile button picked. **Check this unit**, beside each unit's name on the
board, lights up one control at a time; press it, and the page reads the key or mouse
button that arrives. Each key goes green or red, and at the end the page says whether the
unit is running this layout, which controls are not, and what to do about it — including
when the unit is on a press-test profile. Point at the board for the mouse-button keys: a
click on the bar is a click on its buttons. **Test keys**, in the header, is the free-form
version: while it is on, every key a unit sends lights the control that sent it.

Both units report the same USB product id, so the computer alone cannot tell them apart.
Write to units asks each unit for its id, which its device map records; the press test
(below) confirms which is which if you are unsure.

### Elite Dangerous

Elite is played in modes, and has a layout for each: **ship**, **srv** (the buggy) and
**on-foot**, each a pair of files in `dist/SpaceSims/eliteDangerous/`. Put all three on the
units, one slot per mode on each, and switch between them with the unit's profile button as
you get out of the ship. The same button is a different thing in each.

Update the game's keys… writes Elite's `Custom.4.1.binds` and tells the game to use it
(`StartPreset.4.start`), keeping copies of both. Close Elite first. Anything you had bound
to a joystick in the game is not in the new file: it starts from the game's keyboard
preset, not your old one.

### Helldivers 2 and Ace Combat 7

Each has a default layout, not yet played. **Helldivers 2** is one unit on the left hand
with a mouse in the right (`dist/FPS/hellDivers/`); the mouse aims, which a keypad stick
cannot. **Ace Combat 7** is a pair (`dist/Flight/aceCombat7/`): throttle and yaw on the
left stick, pitch and roll on the right, both weapons on the index fingers. The repo does
not write either game's bindings, so both layouts send the game's own default keys; check
them in the game's controls screen, and change a key in the game's `actions.yaml` if the
game has it elsewhere.

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

What a save leaves for you to do shows in the header: **Not on the units** says the units
are behind (click it to write them), and **Update the game's keys…**
appears when the wiring or the pedals changed. That one asks whether the game is closed and
then writes its `Input.ini`; it is the one thing saving never does on its own, because it
writes outside the repo. **Clear all keys**, on the Actions bar, empties the board to lay a
layout out again; Undo brings it back.

Beside the board are two tabs: **Checks**, the linter's findings with their count on the
tab, and **Sticks & pedals**. Stick modes (DJI Mode 1/2/3, the game's own twin-stick
layout, and a roll variant) are applied to both sticks in one click there.

Rudder pedals are part of a layout. They are on the Sticks & pedals tab — what each axis
drives, and how far the game's name for it is trusted — and save with the keypads and the
in-game keys. While the pedals carry yaw, a stick mode is applied in its with-pedals
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
| `local.yaml`            | Your computer's own settings, if any. Not committed; copy `local.example.yaml` to start   |

## When it refuses

The linter's rules came from real play sessions. Each finding names its rule:

| Rule                                  | Level   | What it catches                                                   |
| ------------------------------------- | ------- | ----------------------------------------------------------------- |
| `missing-required`                    | error   | An action you need that no unit sends — the reach for the gamepad |
| `key-collision`                       | error   | Two different actions claiming one key                            |
| `unbound-key`                         | error   | A key no action declares, usually an edit made in the app         |
| `action-sends-nothing`                | error   | A control whose action has no key to be sent on                   |
| `unknown-position` / `unknown-action` | error   | A typo in a profile                                               |
| `misplaced-binding`                   | error   | Directions on a key, or a tap on a stick, which the unit ignores  |
| `provided-action-bound`               | error   | An action another device provides (the mouse) put on a key        |
| `raw-types-stale`                     | error   | A kept raw type that would stop a new binding from working        |
| `stick-not-keyboard`                  | error   | A stick in gamepad mode, which made the game stutter              |
| `stick-double-correction`             | error   | Two corrections for one stick rotation                            |
| `pedals-no-device`                    | error   | Pedals on a device with no device map                             |
| `pedals-set-unknown`                  | error   | Pedals in `sets.yaml` for a layout no profile names               |
| `pedal-unknown-axis`                  | error   | A pedal axis the device does not have                             |
| `pedal-unknown-game-axis`             | error   | A pedal driving something that is not a game axis                 |
| `pedal-axis-assigned-twice`           | error   | Two pedals on one game axis without `shared: true`                |
| `pedal-shared-mismatch`               | error   | Shared pedals that disagree on the row's tuning                   |
| `pedals-mode-without-pedals`          | error   | A with-pedals stick mode, and no pedal taking what it gave up     |
| `combat-tap-delayed`                  | warning | A long or double press delaying a fight or flight key             |
| `menu-with-combat`                    | warning | A menu on a key you mash or hold in a fight                       |
| `hold-on-movement`                    | warning | A latching flight key — boost must not latch                      |
| `duplicate-output-key`                | warning | The same key sent from two positions                              |
| `akimbo-role-mismatch`                | warning | The same finger doing unrelated jobs on each hand                 |
| `label-names-other-action`            | warning | A key labelled with another action's name, which the unit shows   |
| `pedal-duplicates-stick`              | warning | A pedal and a stick both sending one axis                         |
| `pedal-rest-on-centred`               | warning | A toe brake, uncalibrated, on an axis read about a centre         |
| `unverified-device`                   | warning | A device map nobody has press-tested                              |
| `stale-acknowledgement`               | note    | An acceptance for a finding that no longer exists                 |

A finding that is real but accepted goes in `game.yaml` under `lint.acknowledged`, with a
reason. [CLAUDE.md](CLAUDE.md) has the constraint behind each rule.

## Less often

**Press-testing a unit.** The right unit is not a mirror of the left — its thumb cluster
is rotated half a turn — so each map is measured. Open the editor's **Press test** tab
(`npm start`, in Chrome or Edge) and press **Put the press test on the units**. It writes
two profiles of its own into each unit over USB, one where every pin sends a different
key and one for the stick, and each unit runs the one for the pass on screen. Press what
the page highlights; it records which pin fired and saves a corrected
`devices/<unit>.yaml`. Then press **Take the press test off**: left there, a unit's
profile button cycles onto them and every key sends a probe key. Nothing else needs to be
installed, and any other keypad software must be closed while the page talks to the
units. (`npm run azeron -- probe` writes the same two profiles to `dist/probe/` as files,
for reading.)

**Starting a new game.** In the Setup tab, **Add a new game**: its name, the kind of game,
which units, and a name for the first layout. No Azeron app is involved. The game starts
with that kind of game's actions, and its default layout on the unit it was written for;
any other unit starts empty. Every action placed is given a key straight away, so the game
opens with nothing on the board sending nothing. (`npm run azeron -- new "Deep Rock
Galactic" --genre FPS --units left` does the same from the terminal.)

The keys handed out come from a pool of 31 chosen to stay out of a game's way, and an
action keeps its key on both hands. A whole default layout can need more than that: the
space-sim one places 38. When it does, the optional controls are left empty (required
actions get their keys first) and the page lists them. On a new game every key in the pool
is then in use, so putting a new action on the other unit means taking one off first.

Writing keys into the game itself is built for Everspace 2's `Input.ini` and Elite
Dangerous's `.binds` only. For another game, set the keys in its own controls screen to
match the In-game tab.

**Adding a layout.** In the Setup tab, **Add a layout**: a name and what it starts from,
either a copy of one of the game's layouts (the next version of the one you are flying,
with its pedals and modes) or an empty one for the units you choose. It opens on the board. From the
terminal: `npm run azeron -- layout everspace akimbo-v11 --copy-of akimbo-v10`.
Acknowledged checks belong to the layout they were accepted on, so a copy shows them again
until you accept them for it too.

**Bringing a profile from the Azeron app**, if you have one made there. Both forms above
fold away an option for it: a game from an export (each key it sends becomes an action
named after the key, to rename on the **In-game** tab), or a layout from each unit's export.
Anything that will not round-trip is kept raw rather than guessed at.
(`npm run azeron -- import` and `decompile` do the same from the terminal.)

**Writing into the app's library directly.** `npm run azeron -- install everspace --yes`
drops each profile into the app's store under its own unit (`--dry-run` first). It
refuses while the app is open and backs up what it replaces. It is unsupported: the app's
store format is not documented. Write to units, or an import through the app, is the way to
get a layout onto the units.

## Contributing

`npm run check` is the gate: build, typecheck, lint, format, unit tests and CLI smoke
tests. The pre-commit hook runs every unit test; pre-push runs the whole gate.
`npm install` wires the hooks (`core.hooksPath .githooks`).

The smoke tests and the hooks are bash scripts. WSL has bash. On Windows, Git for Windows
supplies it: Git runs the hooks in it, and `npm run test:bin` finds it in
`C:\Program Files\Git\bin` even when bash is not on PATH.

`npm run test:e2e` drives the served editor in a browser. It needs Playwright's Chromium
once per shell (`npx playwright install chromium`), and a free port:

```powershell
$env:E2E_PORT = 4181; npm run test:e2e   # PowerShell
```

```sh
E2E_PORT=4181 npm run test:e2e           # WSL
```

Every test runs against a frozen
copy of the data (`tests/fixtures/repo`), never the layouts you are editing, so a layout
half way through a change fails nothing. See [CLAUDE.md](CLAUDE.md).
