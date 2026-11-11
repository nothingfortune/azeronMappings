# azeronMappings

Azeron Cyborg II layouts as code. A layout says which **game action** each **control** on a
pair of keypads does; this repo writes it onto the units over USB, checks it against what
has already gone wrong in play, and, for the games it knows, writes the game's own key
bindings to match — so a layout is changed in one place.

Everything is done from one page, the editor. The terminal is only for starting it. No
Azeron app is needed for any of it.

## Start

You need Node 22 or newer and Git, and Chrome or Edge.

```sh
git clone https://github.com/nothingfortune/azeronMappings
cd azeronMappings
npm install
npm start
```

`npm start` builds the editor and opens it in Chrome or Edge, the browsers that can talk to
the units (WebHID). PowerShell and WSL both work, with the same commands; switching between
them needs nothing from you. Nothing in the repo needs editing for your computer.

Then, in the editor:

1. **Add your game.** In the **Setup** tab, **Add a new game**: its name, the kind of game
   (shooter, flight, space sim) and how to lay it out on the pair:
   - **Like a controller** (the default): the pair held like an Xbox pad. The left stick
     moves, the right stick looks or steers, A, B, X and Y are under the right thumb, the
     d-pad under the left, the bumpers and triggers under the index fingers. The rest of
     the game's actions go on the keys a pad does not have.
   - **Like a keyboard**: the left unit is the keyboard half, with banks of abilities and
     weapons under the fingers, and the right unit takes the rest.

   Where the kind of game has a use for them (a space sim's yaw), add **rudder pedals** to
   either. Every action placed is given a key straight away, and the game opens on the
   **Edit** tab with nothing on the board that sends nothing.

2. **Name your units**, the first time. Press **Write to units** in the header. It lists the
   units it finds; press **This is the left unit** / **This is the right unit** for each
   (unplug one to see which is which). That goes into `local.yaml`, which git ignores.
3. **Write to units** again: each unit gets the layout in one of its onboard slots, read
   back to check it, and is switched to it. Close the Azeron app first if it is open: it
   talks to the units on the same channel.
4. **Tell the game the keys.** For a game the repo knows the settings file of, **Update the
   game's keys…** writes it (game closed). For any other game, the **In-game** tab lists
   each action and its key: set the same keys in the game's own controls screen once.

The editor answers only this computer: it listens on `localhost` and refuses requests from
other devices and other web pages. `npm run azeron -- serve --host <address>` opens it to a
network you trust.

## Changing a layout

The **Edit** tab is both units, and the pedals. **Changes save themselves** about a second
after the last one; **Undo** (Ctrl+Z) takes one back, and the ⋯ menu turns autosave off.

- Drag an action from the list onto a key, or onto one of a stick's four directions. Drag a
  key onto another to swap them, or back onto the list to clear it. Clicking a key and then
  an action does the same, and reaches the long press and double tap.
- Hovering an action shows where it is, and the Xbox button a game usually puts it on.
- **The keys are the editor's to choose.** An action reaches the game on a key: the unit
  sends it and the game listens for it. The editor gives an action a key the first time it
  is put on a control, from a pool of 48 chosen to stay out of a game's way (navigation keys,
  the numpad, punctuation, F13 to F24), and the action keeps it.
- **Sticks & pedals**, beside the board, applies a stick mode to both sticks in one click
  (Mode 1, 2 and 3 as on an RC transmitter, or the game's own twin-stick layout), and sets
  what each pedal drives.

The header says what a save leaves to do: **Not on the units** (click it to write them) and
**Update the game's keys…** when the keys or pedals changed. **Print layout**, in the ⋯
menu, prints the board for reference.

**Is a unit running it?** **Check this unit**, beside each unit's name on the board, lights
one control at a time; press it, and the page reads what the unit sends and says whether
the unit is running this layout. **Test keys**, in the header, lights every control as you
press it.

## Your computer and your units

The repo finds what it needs on any computer: a game's settings file under your Windows
user's `AppData`, Steam games in any of your Steam libraries, and the Azeron app's profile
store if it is installed. `local.yaml` (copy `local.example.yaml`) holds what is yours:

- **Your units' ids.** Write to units writes only to a unit it knows, and the ids in
  `devices/` belong to the repo owner's units. The naming buttons above fill this in.
- **Anything installed somewhere unusual.** When a file is not found, the page says where
  it looked and which line of `local.yaml` would point it there. Until then the repo's own
  copy is used, so nothing breaks.

## When it refuses

The checks came from real play sessions: a stick in gamepad mode that made a game stutter,
a menu on a key mashed in a fight, a long press that delayed a heal. Each finding names its
rule:

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
reason. A controller-style layout starts with a few of these: a pad's d-pad and its A B X Y
are different jobs for the two thumbs on purpose. [CLAUDE.md](CLAUDE.md) has the
constraint behind each rule.

## Less often

**Press-testing a unit.** Each unit's map of which pin is which control is measured, not
assumed: the right unit is not a mirror of the left. In the **Press test** tab, **Put the
press test on the units** writes two test profiles into each unit, and each unit runs the
one for the pass on screen. Press what the page highlights; it saves a corrected
`devices/<unit>.yaml`. Then **Take the press test off**.

**Adding a layout** to a game: Setup, **Add a layout**, as a copy of one the game has (the
next version of the one you play, pedals included) or empty.

**From an Azeron app export**, if you have a profile made there: both Setup forms fold away
an option for it. Each key the export sends becomes an action named after the key, to
rename on the In-game tab.

**From the terminal**: `npm run azeron -- help` lists everything the editor does, for
scripting it — `new "Deep Rock Galactic" --genre FPS --style keyboard`, `lint`, `build`,
`units`. `bin/azeron` runs it directly (`.\bin\azeron` in PowerShell).

## Where things are

| Path                    | What it is                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `games/<Genre>/<game>/` | A game: `actions.yaml` (its actions and keys), `profiles/` (its layouts)           |
| `genres/<Genre>/`       | What a kind of game shares: actions, Xbox buttons, stick modes, the two styles     |
| `devices/`              | Which pin each control is, per unit — measured by the press test                   |
| `templates/`            | Real exports from the Azeron app, which every layout is built on                   |
| `dist/`                 | The compiled layouts and game key files. Committed, so any past version is at hand |
| `local.yaml`            | Your computer's own settings. Not committed                                        |

## Case studies

The games already here, and what each one taught. Each folder's `README.md` has the
details, and `playtests.md` how it felt to play.

- [Everspace 2](games/SpaceSims/everspace/README.md): a pair and rudder pedals; most of the
  checks came from it.
- [Elite Dangerous](games/SpaceSims/eliteDangerous/README.md): one layout per mode of play,
  switched with the profile button.
- [Ace Combat 7](games/Flight/aceCombat7/README.md): a pair flying Mode 2, no mouse.
- [Helldivers 2](games/FPS/hellDivers/README.md): one unit and a mouse.

## Contributing

`npm run check` is the gate: build, typecheck, lint, format, unit tests and CLI smoke
tests. The pre-commit hook runs every unit test and pre-push the whole gate; `npm install`
wires them. The smoke tests and hooks are bash, which Git for Windows supplies.

`npm run test:e2e` drives the served editor in a browser, after
`npx playwright install chromium`, on a free port (`$env:E2E_PORT = 4181` in PowerShell,
`E2E_PORT=4181` in WSL). Every test runs against a frozen copy of the data
(`tests/fixtures/repo`), never the layouts you are editing. See [CLAUDE.md](CLAUDE.md).
