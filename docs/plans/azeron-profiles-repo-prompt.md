> **Historical.** The original brief, from 2026-09-28, kept as written. The layout and
> tool names in it are not the current ones — CLAUDE.md and the README are.

# Brief: Azeron Profiles as Code

## Goal

Set up a version-controlled repository that treats Azeron Cyborg II profiles as source code. Profiles are authored in readable YAML, compiled into Azeron's import JSON, checked by a linter, and tracked in git with a changelog and playtest log. The first game is Everspace 2. The design must support more games later.

The repository owner is Alex. He will drop his current known-good export, `azeronMappings\docs\plans\everspace2-v5.json`, into the repo. That file is the baseline and the golden test fixture. Both hands json files are identical (although physical layouts are mirriored)

## Hardware

- Two Azeron Cyborg II units: the original left-handed unit and a right-handed (mirrored) unit.
- Alex has confirmed that the right unit's export uses the same pin numbers as the left. The physical layout is mirrored. Verify directional keys on the right unit's thumb pad (left and right may be physically swapped) with a press test before relying on them.
- Profiles run onboard (written to the device), with the Azeron app closed during play. The export format is from Azeron software 2.0.2.
- Name the files {game}_left.json and {game}_right.json and store them in a game specific folder, organized by genre

## Hard-won constraints (do not relearn these)

1. **Never put a thumbstick in gamepad/analog joystick mode for Everspace 2.** It caused frame-rate stutter: the game kept switching between gamepad and keyboard/mouse input. Keyboard mode fixed it. Mouse mode on a stick is untested for stutter and must be tested before being relied on.
2. **Everspace 2 reads only two analog axes in keyboard/mouse mode** (mouse X and mouse Y). Everything else is digital. No remapper can add analog axes without a virtual gamepad, which triggers constraint 1.
3. **Everspace 2 bindings are fully rebindable by Alex**, including axes (Settings > Input > Customize Controls; the roll axis can move to mouse X, and the axis it replaces must then be rebound). Treat the in-game bindings as part of the source of truth, versioned in this repo.
4. **Long-press and double-tap add a delay to the tap.** Once a key has a long or double action, its tap waits until the long threshold (`featureDelay`) or double window (`doubleDelay`) passes. Never put long/double actions on combat-critical keys (consumables, targeting, fire, boost).
5. **Never put Escape (or any menu) on a key that might be mashed in combat.** v3 had Escape as a double-tap on a consumable; mashing a heal opened the menu.
6. **`isHold: true` latches a key** until pressed again. Boost must not latch.
7. **The akimbo experiment on 2026-09-28 failed for two reasons:** the right hand had too few bindings (Alex kept reaching for a gamepad), and the two hands used the same finger positions for unrelated jobs. The next akimbo attempt must (a) cover every game action without a gamepad, and (b) mirror roles, so the same finger position on each hand does an analogous job.

## Azeron export format (reverse-engineered, partially verified)

Top level: `{ "version": "2.0.2", "profiles": [ profile ] }`.

Profile fields: `id` (UUID), `name`, `inputs` (array), `isSoftware`, `profileSettings`, `isFavorite`, `version`, `systemTags`, `profileTags`, `metaData`.

Each input:

| Field                                                      | Meaning                                                                                                                                                                                       | Confidence                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `pinOne`                                                   | Physical key id (see pin map). `255` = unused slot                                                                                                                                            | Verified                                      |
| `pinTwo`                                                   | Second pin for sticks (stick uses 31 and 30); `255` otherwise                                                                                                                                 | Verified                                      |
| `types`                                                    | `[tap, long, double]` action types. `"1"` keyboard, `"11"` none, `"15"` mouse button, `"4"` keyboard-mode stick                                                                               | Verified                                      |
| `types` other codes                                        | `"6"` appears in long/double slots; `"2"` on pin 0; `subType` `"29"` on one unused slot                                                                                                       | Unknown: preserve from template, never invent |
| `keyValues[0]` / `keyValuesLong[0]` / `keyValuesDouble[0]` | Key for tap / long / double. Mostly `KeyboardEvent.code` strings (`KeyF`, `Digit1`, `F4`, `Tab`, `Escape`, `Equal`). Some legacy numeric JS keyCodes (`"37"` to `"40"` arrows, `"27"` Escape) | Verified                                      |
| `metaValues[0]`                                            | Modifier for tap: `"AltLeft"`, `"16"` (Shift)                                                                                                                                                 | Verified                                      |
| Mouse button values (type `15`)                            | `"2"` = middle click (confirmed in the app UI). Left/right codes unverified                                                                                                                   | Partial                                       |
| `featureDelay`                                             | Long-press threshold, ms                                                                                                                                                                      | Verified                                      |
| `doubleDelay`                                              | Double-tap window, ms                                                                                                                                                                         | Verified                                      |
| `isHold`                                                   | Latching toggle                                                                                                                                                                               | Verified                                      |
| Stick (type `4`)                                           | `analogSettings.analogKeys.left.{up,right,down,left}[0]` are numeric JS keyCodes (87 W, 68 D, 83 S, 65 A)                                                                                     | Verified                                      |
| Mouse-mode stick                                           | Type code and fields unknown                                                                                                                                                                  | Must capture from a real export               |
| `label`                                                    | Free text shown in the app                                                                                                                                                                    | Verified                                      |

Rules for the compiler:

- Use `everspace2-v5.json` as the template. Copy every field the YAML does not specify, so unknown fields survive untouched.
- Keep profile `id` stable per profile (store it in YAML). A new UUID on every build creates duplicate profiles on import.
- Emit JSON with 2-space indentation and stable key order so git diffs stay readable.

## Left unit pin map (from the app screenshot and export)

Positions use finger column plus row. Rows run 1 (top/far) to 4 (near), with row 5 the bottom row. Row 3 aligns with the side keys and is assumed to be the resting row; confirm with Alex.

| Position                                | Pin                | Position                        | Pin                |
| --------------------------------------- | ------------------ | ------------------------------- | ------------------ |
| Pinky 1 to 5                            | 5, 4, 3, 2, 1      | Ring 1 to 5                     | 11, 10, 9, 8, 7    |
| Middle 1 to 5                           | 17, 16, 15, 14, 13 | Index 1 to 5                    | 26, 25, 24, 23, 22 |
| Pinky side                              | 6                  | Index side                      | 27                 |
| Thumb up / left / center / right / down | 34, 35, 37, 33, 36 | Stick                           | 31 + 30            |
| Thumb aux, upper right of stick         | 20                 | Thumb aux, lower right of stick | 19                 |
| Thumb aux, below stick                  | 32                 | Unlabeled / unknown             | 28, 29, 0          |

Store this as `devices/cyborg2-left.yaml`. Create `devices/cyborg2-right.yaml` with the same pins, flagged `mirrored: true`, and a TODO to confirm thumb-pad directions.

## Repository layout

```
azeron-profiles/
  README.md                 how to build, import, and round-trip
  CHANGELOG.md              every profile change with the reason
  devices/                  pin maps per unit
  games/everspace2/
    actions.yaml            every game action and its in-game key binding
    profiles/               one YAML per profile (single-v5, akimbo-left, akimbo-right, ...)
    playtests.md            dated notes from play sessions
  templates/                raw exports, committed untouched
  dist/                     compiled import JSON (committed, so each version is importable from history)
  tools/                    build, decompile, lint, cheatsheet
  tests/
```

Profile YAML maps positions to game actions, not raw keys. The compiler looks up each action's key in `actions.yaml`. Changing an in-game binding then means editing one line.

## Tools

1. **build**: YAML plus template to `dist/*.json`.
2. **decompile**: an Azeron export back to YAML. Alex edits in the Azeron app too, so exports from the app must round-trip into the repo and show up as a git diff.
3. **lint**, failing the build on errors:
   - Error: a game action in `actions.yaml` marked `required` is not bound on any unit (coverage; this is the "reached for the gamepad" failure).
   - Error: one output key triggers two different game actions (the F10 Hover Down / Next Target collision from v3).
   - Error: a key is sent that is not bound in `actions.yaml`.
   - Error: any stick in gamepad mode on an Everspace 2 profile.
   - Warning: long or double on an action tagged `combat`.
   - Warning: `isHold` on an action tagged `movement`.
   - Warning: a menu action on a key that also carries a combat action.
   - Warning (akimbo pairs): mirrored positions carry actions from unrelated role groups.
   - Warning: the same output key on two positions, unless allowlisted (for example F on both Interact and Cruise).
4. **cheatsheet**: a per-profile layout diagram (HTML or SVG, laid out like the Azeron app) for learning the keys. Also emit an "in-game bindings to set" checklist from `actions.yaml`.

## Tests and acceptance criteria

- **Golden round trip:** `decompile(everspace2-v5.json)` then `build` reproduces `everspace2-v5.json` field for field (ignoring nothing but key order).
- Idempotence: `build(decompile(build(x)))` equals `build(x)`.
- Lint runs clean on the v5 profile, apart from the known allowlisted duplicate F.
- One command builds everything, runs lint and tests (a Makefile or task runner script).
- A pre-commit hook fails if `dist/` is stale relative to the YAML.

## Git conventions

- Conventional commits (`feat(everspace2): ...`, `fix: ...`).
- `main` holds known-good profiles only. Experiments (akimbo) live on branches until a playtest confirms them.
- Tag each importable release, for example `everspace2-single-v6`.
- `CHANGELOG.md` records what changed and why; `playtests.md` records what it felt like.

## Seed content

- `games/everspace2/actions.yaml`: build from the v5 export plus these game facts: throttle W/S, strafe A/D, roll Q/E, boost Shift, pitch/yaw on the mouse, hover up F9, hover down F10, next target F4, primaries F1 to F3, devices 1 to 4, consumables 5 to 8, ultimate G, inertia dampeners Alt, cruise F, supralight C, interact F, weapon cycling on the arrow keys (Alex rebound these; the game default puts pitch/yaw on the arrows, so that default must stay unbound). Tag each action with `combat`, `movement`, `menu`, `travel` and `required` where applicable.
- `games/everspace2/profiles/single-v5.yaml`: decompiled from the export.
- `games/everspace2/playtests.md`, first entry (2026-09-28): the akimbo Mode 2 attempt felt awkward; the right hand had too few buttons and the two hands used positions differently; Alex kept switching back to a gamepad.

## Open questions to ask Alex, not guess

1. Is row 3 the resting row on both units?
2. An export with a stick in mouse mode, to learn that format.
3. An export with left and right mouse buttons bound, to confirm their codes.
4. Whether long-press Escape on Missions actually works in-game (it was set by editing JSON, not in the app).
5. What the unlabeled pins 28, 29 and 0 are physically.

## Out of scope for the first pass

Designing the next akimbo layout. Build the tooling and baseline first; the next layout is authored in YAML afterward, where the linter can hold it to the constraints above.
