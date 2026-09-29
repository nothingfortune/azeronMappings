# Changelog

Every profile change, and why.

## Unreleased

### Added

- Toolchain in strict TypeScript, following the `nothingfortune/base` conventions:
  `npm run check` is the gate (build, typecheck, lint, format, Vitest, CLI smoke tests),
  CI runs exactly that, and `.githooks` wires a quick pre-commit gate plus a full
  pre-push one.
- `bin/azeron` with `build`, `lint`, `roundtrip`, `cheatsheet`, `decompile`, `editor` and
  `install`.
- **Side-by-side editor** (`azeron editor`): both units at once, click-to-edit, live
  coverage and constraint checks, and export to either profile YAML or import JSON. It
  imports the same compiler and linter the CLI uses, so there is no second implementation
  to drift.
- **`azeron install`**: writes a compiled profile into the Azeron app's own profile store
  (`Storage/DevicesStorage/<deviceId>/ProfileStorage/`). Refuses while the app is running,
  backs up what it would overwrite, and projects the profile onto the shape the app itself
  writes, because the stored schema is a strict subset of the export schema.
- `devices/cyborg2-left.yaml` and `devices/cyborg2-right.yaml`. Both units export the same
  pin numbers; the right map is flagged `mirrored` with a TODO to press-test the thumb-pad
  directions.
- Genre layer: `genres/SpaceSims/` and `genres/FPS/`, each with an action vocabulary and a
  default layout. Both lint clean with zero acknowledgements. Games inherit with
  `extends:` and supply only keys.
- `games/SpaceSims/everspace/`: `actions.yaml` (keys only, vocabulary inherited),
  `single-v5.yaml` decompiled from the known-good export, and the **akimbo v6 draft** for
  both hands.
- `templates/everspace2-v5.json`, the known-good export from Azeron software 2.0.2, committed
  untouched as both the compiler template and the golden test fixture.

### Added (press test)

- **`azeron probe`**: a generated profile where every pin sends a distinguishable key,
  plus a guided capture page. It prompts for one position at a time on a diagram of the
  unit, records which pin actually fired, handles both units separately, diffs each
  against the assumed map and the two against each other, and exports corrected device
  YAML. The least reliable probe keys (F13+) are reserved for the pins nobody has
  identified, so a firmware limitation cannot cost a known position.
- **Stick zero calibration**: a second, stick-only probe profile with all eight sectors
  bound and eight-directional mode on, plus a calibration pass in the page that asks for
  eight physical pushes and derives the rotation by majority vote. Writes `stick_zero`
  and `stick_angle` onto the device; the compiler writes `analogSettings.angle` only when
  a device has been measured, because that field's units are unverified.
- `verified` on a device map, and the `unverified-device` lint warning for any profile
  built on a map that has not been press-tested.
- `stick_directions` on a device map: redirects a physical stick direction onto the
  export field it actually drives, for a unit that does not match the left-handed
  software's assumption.
- `docs/guides/analog-input.md`: what is actually known about getting analog axes into
  Everspace 2, the three untested ways it might work, and the one dead end.

### Changed

- **`devices/cyborg2-right.yaml` no longer claims the right unit mirrors the left.** It
  did, on the strength of an earlier note. The two are not 1:1, particularly the
  directions. Every position in it is now flagged as an inherited guess
  and the file is `verified: false` until the press test says otherwise. The akimbo v6
  right-hand draft carries an acknowledgement saying it must not be flashed before then.

- The compiler now reproduces the golden export **byte for byte**, not merely field for
  field: `label` is overwritten in place instead of being deleted and re-appended, so key
  order and therefore the `dist/` diff stay stable.

### Findings from linting the v5 baseline

Acknowledged in `game.yaml` rather than silenced, and the agenda for v6:

- The five thumb-pad keys carry a 1000 ms `featureDelay`, so the ULT tap and all four
  weapon-cycle taps wait a full second before firing (constraint 4).
- Those same five keys pair a combat tap with a menu long-press (constraint 5's shape,
  though Tab is not Escape).
- `Tab` and `KeyI` are each sent from two positions; both are deliberate.

### Known gaps

- `primary_3` (F3) is not bound in the single-unit baseline, so it is not `required`.
- Mouse button codes other than middle-click are unverified, as are the type codes for a
  stick in mouse or gamepad mode; the compiler refuses to invent them.
- The akimbo draft is **not playtested**. Its two sticks deliberately do different jobs,
  which is the first thing to judge in a session.
