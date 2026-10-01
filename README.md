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

The CLI is `npm run azeron -- <command>`, which works in either shell (`./bin/azeron`
works in bash only). `npm run azeron -- help` lists everything.

## Getting a pair onto the units

1. **Give the game its bindings.** Close Everspace 2, then in the editor's **Setup** tab,
   **Write the game's bindings** (or `npm run azeron -- ingame --apply`). This writes the
   game's `Input.ini` from `games/SpaceSims/everspace/actions.yaml`, keeping the previous
   file beside it. You do this once, and again only when an in-game key changes — never
   from the game's own controls screen.
2. **Import both files** in the Azeron app (2.0.2), each onto its own unit:
   - `dist/SpaceSims/everspace/everspace_akimbo_v10_left.json` → the unit on your left hand
   - `dist/SpaceSims/everspace/everspace_akimbo_v10_right.json` → the unit on your right
3. **Write each profile to its unit, then close the app before playing.** Profiles run
   onboard, and the app rewrites its own files while it is open.

Both units report the same USB product id, so nothing on the computer can tell them
apart for you — the app lists them separately, and the press test (below) will confirm
which is which if you are unsure.

## Changing a binding

A layout is one control scheme: both keypads and the keys the game listens for. There are
two things to change, both in the editor, and **one Save** (top right) writes whatever
changed in either:

- **Which key does what** — the **Edit** tab. Click a key on the board, click an action.
  The label follows the action.
- **Which key the game listens for** — the **In-game** tab. Click the action's key, press
  the new one. Every layout follows; nothing needs re-importing.

Save comes back with the linter's verdict and the file to re-import, as a path the Azeron
app's dialog takes. If in-game keys were saved it also offers **Update the game's keys…**,
which asks whether the game is closed and then writes its `Input.ini` (the same step is in
the header's menu). That is the one thing Save does not do on its own, because it writes
outside the repo.

Stick modes (DJI Mode 1/2/3, the game's own twin-stick layout, and a roll variant) are
applied to both sticks in one click from the editor's side panel.

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
| `unknown-position` / `unknown-action` | error   | A typo in a profile                                               |
| `stick-not-keyboard`                  | error   | A stick in gamepad mode, which made the game stutter              |
| `stick-double-correction`             | error   | Two corrections for one stick rotation                            |
| `combat-tap-delayed`                  | warning | A long or double press delaying a fight or flight key             |
| `menu-with-combat`                    | warning | A menu on a key you mash or hold in a fight                       |
| `hold-on-movement`                    | warning | A latching flight key — boost must not latch                      |
| `duplicate-output-key`                | warning | The same key sent from two positions                              |
| `akimbo-role-mismatch`                | warning | The same finger doing unrelated jobs on each hand                 |
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

**Bringing an edit made in the app home.** The editor's Setup tab takes an export and
turns it back into profile YAML (`npm run azeron -- decompile` from the terminal).
Anything that will not round-trip is kept raw rather than guessed at.

**Starting a new game.** Upload an export from the Setup tab, or
`npm run azeron -- import <export.json> --genre G --game SLUG`. Each distinct key becomes
an action named after the key — an export says which keys are pressed, not what they do,
so naming them is the first job.

**Writing into the app's library directly.** `npm run azeron -- install everspace --yes`
drops each profile into the app's store under its own unit (`--dry-run` first). It
refuses while the app is open and backs up what it replaces. Importing through the app
stays the supported path.

## Contributing

`npm run check` is the gate: build, typecheck, lint, format, unit tests and CLI smoke
tests. The pre-commit hook runs every unit test; pre-push runs the whole gate.
`npm run test:e2e` drives the served editor in a browser. See [CLAUDE.md](CLAUDE.md).
