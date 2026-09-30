# Changelog

Every profile change, and why. `playtests.md` records what each layout felt like.

## Unreleased

### Added

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

- **akimbo v10** is the live pair: stick mode 2 with yaw on the left stick, pitch and roll
  on the right thumb pad, weapons and targeting on the left hand, every label the
  action's own. Not yet flown. v6 to v9 are in git history; none was flown, and none did
  what its files said — see below.
- `single-v5` is the known-good export, kept as the compiler's golden fixture.

### Changed

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
