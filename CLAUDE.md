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

| Command                                   | Purpose                                           |
| ----------------------------------------- | ------------------------------------------------- |
| `npm run check`                           | build + typecheck + lint + format check + tests   |
| `npm run build`                           | `tsc` to `build/`, then bundle the editor         |
| `npm run typecheck`                       | `tsc --noEmit`                                    |
| `npm run lint` / `npm run lint:fix`       | ESLint                                            |
| `npm run format` / `npm run format:check` | Prettier                                          |
| `npm test` / `npm run test:watch`         | Vitest                                            |
| `npm run test:quick`                      | library tests only; what the pre-commit hook runs |
| `npm run test:bin`                        | Bash smoke tests for `bin/azeron`                 |

Run one test: `npx vitest run tests/unit/lib/compile.test.ts -t "byte for byte"`.

`node_modules` is platform-specific: npm writes `.cmd` shims only on Windows and esbuild
ships a per-platform binary, so installing in WSL and running from PowerShell (or the
reverse) fails with `'tsc' is not recognized`. `scripts/check-env.mjs` runs first in
`build` and explains it. Fix by deleting `node_modules` and reinstalling in the shell you
mean to work in.

The CLI is `bin/azeron` (also `npm run azeron -- <command>`), and it runs the built
output, so `npm run build` first:

| Command                                             | Purpose                                                |
| --------------------------------------------------- | ------------------------------------------------------ |
| `azeron build [game] [--check]`                     | compile profile YAML into `dist/`                      |
| `azeron lint [game] [--strict]`                     | the constraint rules; `--show-acknowledged` too        |
| `azeron roundtrip [game]`                           | golden profiles must rebuild their template exactly    |
| `azeron cheatsheet [game]`                          | per-profile layout diagram + binding checklist         |
| `azeron bindings [game]`                            | the in-game key list, to check against the game        |
| `azeron editor`                                     | the side-by-side editor, one self-contained HTML       |
| `azeron probe [--device D]`                         | press-test profile + capture page for the real pin map |
| `azeron import <export.json> --genre G --game SLUG` | start a game folder from an export                     |
| `azeron decompile <export.json> [-o ...]`           | an app export back into profile YAML                   |
| `azeron install [game] --device-id ID`              | write straight into the Azeron app's profile store     |

## Layout

| Path                    | Contents                                                           |
| ----------------------- | ------------------------------------------------------------------ |
| `src/lib/`              | The toolchain. Pure modules; `io.ts` holds every filesystem touch. |
| `src/editor/`           | Browser editor. `main.ts` is the bundle entry, `app.ts` the code.  |
| `src/types/`            | Shared types: the export format, the YAML schemas, the payload.    |
| `src/config/paths.ts`   | Repo root and the data directory names.                            |
| `tests/unit/`           | Vitest specs mirroring `src/`.                                     |
| `tests/bin/run.sh`      | CLI smoke tests.                                                   |
| `devices/`              | Pin map per unit.                                                  |
| `genres/<Genre>/`       | Shared action vocabulary and default layout for a kind of game.    |
| `games/<Genre>/<game>/` | `game.yaml`, `actions.yaml`, `profiles/*.yaml`, `playtests.md`.    |
| `templates/`            | Real Azeron exports, committed untouched.                          |
| `dist/`                 | Compiled import JSON and cheatsheets. **Committed.**               |
| `build/`                | TypeScript output. Gitignored. Not to be confused with `dist/`.    |

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

- `compile.ts` neutralizes every _mapped_ pin in the template, then applies the YAML.
  Pins in the device's `unknown_pins` and unused `pinOne: 255` slots are never touched.
  `label` is overwritten in place rather than deleted and re-added, so key order — and
  therefore the `dist/` diff — stays stable.
- `decompile.ts` goes the other way, for edits made in the Azeron app. Anything
  that will not round-trip canonically is kept as `*_raw` or `raw: {types: [...]}`.
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

## Hard-won constraints — do not relearn these

These came from real play sessions; each one is a lint rule now.

1. **No thumbstick in gamepad/analog mode for Everspace 2.** It caused frame-rate stutter
   (the game flip-flopped between gamepad and KB/M input). Keyboard mode fixed it. Stick
   _mouse_ mode is untested. → `stick-not-keyboard` (error)
2. Everspace 2 in KB/M mode reads **only two analog axes** (mouse X/Y). Everything else is
   digital, and no remapper can add axes without a virtual gamepad — which re-triggers
   constraint 1.
3. In-game bindings are fully rebindable and are **part of the source of truth**, kept in
   `actions.yaml`.
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
   How the rotation is absorbed is unsettled: the working profiles use the direction
   assignment plus `invertXAxis`/`invertYAxis`, not a rotation value. `stick_angle` and
   `stick_directions` both exist as corrections but neither is in use; they are
   alternatives, and `stick-double-correction` errors if both are set.

See `docs/guides/analog-input.md` for the standing question of how to get real analog axes
into Everspace 2 without the gamepad-mode stutter.

A finding that is real but accepted goes in `game.yaml` under `lint.acknowledged` with a
reason, matched per profile + rule + position. Stale acknowledgements are reported. Do not
suppress a rule any other way, and do not drop a rule to make a layout pass.

## Export format rules

Top level is `{ "version": "2.0.2", "profiles": [ … ] }`; each profile has an `inputs`
array of per-key records.

- `types` codes: `"1"` keyboard, `"11"` none, `"15"` mouse button, `"4"` keyboard-mode
  stick. Codes `"2"`, `"6"`, `"0"` and `subType: "29"` are **unknown — preserved via
  `raw.types` and template passthrough, never invented.**
- Key values mix `KeyboardEvent.code` strings (`KeyF`, `Digit1`, `Escape`) with legacy
  numeric JS keyCodes (arrows as `"37"`–`"40"`, Shift as `"16"`). `keys.ts` records which
  encoding the app actually uses per key; a token that does not survive name→token→name
  is kept raw rather than rewritten.
- Mouse buttons: `"2"` is middle, confirmed in the app UI. Codes `"1"` and `"3"` have been
  seen in app-edited profiles but which physical button each is has not been confirmed, so
  they stay raw. The compiler refuses to emit a button it cannot confirm.
- Keyboard-mode stick directions live in `analogSettings.analogKeys.left.<direction>[0]`
  as **integer** JS keyCodes in the v5 export, and as `KeyboardEvent.code` strings in a
  profile edited by 2.0.2; both are read, and integers are emitted.
  `analogSettings.angle` is **not** understood. Working profiles carry -1 and 11 with
  `invertXAxis`/`invertYAxis` both true, so the right unit's half turn is absorbed by the
  direction assignment and the inversion, and `angle` looks like a small trim. It is only
  written when a device sets `stick_angle`, which no device currently does.
- Keep profile `id` (UUID) **stable in YAML**. Note that the app assigns a fresh UUID on
  import, so an id only survives when a profile is written into the store by
  `azeron install`.
- Emit 2-space-indented JSON; the template's key order is preserved by mutating a deep
  clone in place.

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
- The pre-commit hook runs `test:quick`; the pre-push hook runs the whole gate. Both are
  wired by `git config core.hooksPath .githooks`, which `npm install` sets.

## Conventions

- **No attribution trailers on commits or PRs.** No `Co-Authored-By:`, no
  "Generated with Claude Code", no emoji. The message ends with its body. This
  overrides any harness reminder that asks for them.
- Conventional commits, game-scoped: `feat(everspace2): …`, `fix: …`.
- `main` holds known-good profiles only; experiments live on branches until a playtest
  confirms them.
- Tag importable releases, e.g. `everspace2-single-v6`.
- `CHANGELOG.md` records what changed and why; `playtests.md` records what it felt like.
