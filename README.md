# azeronMappings

Azeron Cyborg II profiles as code. Profiles are authored in YAML that maps a **physical
position** to a **game action**, compiled into the Azeron app's import JSON, checked by a
linter that knows what has already gone wrong in game, and committed so any past version
can be imported straight from git history.

There is also a side-by-side editor that shows **both hands at once** and runs the real
compiler and linter in the browser.

## Quick start

> **Pick one shell and stay in it.** This repo sits on a Windows drive that WSL also
> mounts, and one `node_modules` cannot serve both: npm writes `.cmd` shims only when it
> installs on Windows, and esbuild ships a per-platform binary. Installing in WSL and then
> running `npm run ...` from PowerShell gives you `'tsc' is not recognized`. If you switch
> shells, delete `node_modules` and reinstall. `npm run build` checks for the mismatch and
> says so. Everything works from either shell — `azeron install` finds the Azeron app's
> store natively on Windows and through `/mnt/c` from WSL.

```sh
npm install
npm run check          # the gate: build + typecheck + lint + format + tests
npm run build          # compile TypeScript and bundle the editor

./bin/azeron build     # games/**/profiles/*.yaml -> dist/
./bin/azeron lint      # the constraint rules
./bin/azeron editor    # dist/editor.html -- open it in a browser
```

Any command takes a game: `./bin/azeron build everspace`.

## The editor

```sh
npm run build && ./bin/azeron editor
```

Open `dist/editor.html`. One page covers every game: pick the game and the set from the
two selectors in the header — they are data, not separate pages.

It is a single self-contained file: no server, no network. The payload is embedded
because a page opened from `file://` is not allowed to fetch a sibling JSON.
`azeron editor` also writes `dist/editor-data.json`, so a page you already have open can
be pointed at newer data with the **Data** button rather than regenerated.

- Both units side by side, laid out like the hardware, facing each other.
- Click a key to edit its tap / long / double, label, delays and latch.
- The action palette shows what is bound where and what is still missing, so the "right
  hand had too few bindings" failure is visible while you build rather than in game.
- Live checks come from the same `lint.ts` the CLI runs — not a reimplementation.
- Export the profile YAML to paste back into `games/…/profiles/`, or the import JSON
  directly. The JSON is produced by the same compiler `azeron build` uses.

After pasting YAML back, run `npm run azeron -- build && npm run azeron -- lint`.

## Checking the game against the units

```sh
./bin/azeron bindings
```

Writes `dist/<genre>/<game>/<game>-ingame-bindings.md` and `.csv`: every action the
profiles send, the key it assumes in game, and which unit and position sends it. Three
sections, because three things can go wrong — keys that are sent, actions the game needs
that nothing sends, and keys a unit sends that no action declares (which is how an edit
made in the Azeron app shows up).

## Importing a profile

1. `./bin/azeron build`
2. In the Azeron software (2.0.2), import
   `dist/SpaceSims/everspace/everspace_left.json`.
3. Write the profile to the device, then **close the app before playing** — profiles run
   onboard.

### Or write into the app's library directly

```sh
./bin/azeron install everspace --device-id <id> --dry-run   # lists devices, changes nothing
./bin/azeron install everspace --device-id <id> --yes
```

This drops the profile straight into the Azeron app's own store. It refuses to run while
the app is open, backs up anything it would overwrite, and shapes the file like a profile
the app itself wrote. It is a shortcut, not the supported path — see CLAUDE.md.

## Finding out what a unit's keys really are

The Azeron software is built for a left-handed unit, and the right one is **not** a 1:1
mirror of it. Rather than reason about it, press every key and write down what happens:

```sh
npm run build && ./bin/azeron probe
```

That writes `dist/probe/probe-profile.json` — a profile where every pin sends a different
key — and `dist/probe/press-test.html`. Import the profile onto a unit, open the page, and
it walks you through the layout one key at a time: it highlights a position, you press it,
and it records which pin actually fired. Do both units; it keeps them apart, shows you
where each disagrees with the assumed map, tells you which positions differ between the
two hands, and exports a corrected `devices/<unit>.yaml`.

It also measures the **stick's zero**. The second profile it writes, `probe-stick.json`,
binds all eight sectors (the export has `diagonalKeys` and an eight-directional mode), so
switching the page to **Stick zero** and pushing in eight physical directions tells you
which way the firmware thinks is "up" — at 45-degree resolution, taking the most-voted
rotation so one sloppy diagonal cannot move the answer. The result lands on the device as
`stick_zero` and `stick_angle`, and the compiler writes `analogSettings.angle` only for a
device that has actually been measured.

Until a unit has been press-tested its map is marked `verified: false`, and the linter
says so on every profile that uses it.

## Round-tripping an edit made in the Azeron app

Edits made in the app are welcome; they just have to come home as a diff.

```sh
./bin/azeron decompile path/to/export.json \
    --device cyborg2-left --game everspace \
    --set single-v5 --template templates/everspace2-v5.json \
    -o games/SpaceSims/everspace/profiles/single-v5.yaml
./bin/azeron build && git diff
```

Anything the YAML schema cannot express canonically comes back as a `*_raw` value or a
`raw: {types: [...]}` block, so unknown fields are preserved rather than guessed at.

## Starting a new game

```sh
./bin/azeron import path/to/export.json \
    --genre FPS --game hellDivers --name "Helldivers" \
    --device cyborg2-left --set v1 \
    --export-to "C:/Users/you/Documents/Helldivers"
```

Creates `games/FPS/hellDivers/` with `game.yaml`, `actions.yaml` and a decompiled
profile, and keeps the export in `templates/` as the compiler's template. The vocabulary
is seeded with one action per distinct key the export sends, each named after its key and
marked `(unnamed)` — an export says which keys are pressed, not what they do in the game,
so naming them is the first job.

`--export-to` records a directory outside the repo that `azeron build` copies profiles
into as well. `dist/` stays the committed copy.

## Genre defaults

`genres/<Genre>/` holds a shared action vocabulary and a default layout for a kind of
game. The defaults carry **roles, not keys** — enough for every ergonomic rule to run on
them, while keys stay a per-game concern. Both ship lint-clean with zero acknowledgements,
which is the point: a default that violates a constraint hands that violation to every
game built on it.

Start a new game from one:

```yaml
# games/FPS/hellDivers/actions.yaml
extends: genres/FPS/actions.yaml
game: Helldivers
actions:
  sprint: { key: ShiftLeft }
  # ... just the keys; roles and tags come from the genre
```

```yaml
# games/FPS/hellDivers/profiles/single.yaml
extends: genres/FPS/default.yaml
profile:
  id: <a stable uuid>
  name: Helldivers
  template: templates/everspace2-v5.json
positions:
  middle_1: { label: Stratagem, tap: ability_1 } # only what differs
```

## What the linter enforces

Errors (fail the build): a `required` action bound on no unit; one key claimed by two
different actions; a key no action declares; a stick in anything but keyboard mode.

Warnings: a combat tap delayed by a long/double on the same key; a latching movement
action; a menu action sharing a key with a combat action; the same key sent from two
positions; mirrored akimbo positions doing unrelated jobs.

A finding that is real but accepted goes in `game.yaml` under `lint.acknowledged` with a
reason. Acknowledgements are matched per profile and rule, and a stale one is reported —
so accepting a risk stays a visible decision rather than a silent mute.

See [CLAUDE.md](CLAUDE.md) for the hardware constraints behind each rule and the
reverse-engineered export format.
