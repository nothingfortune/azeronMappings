# Feature roadmap: what to build, and where it runs

The aim is the best tool for Azeron keypads (plus keyboard, mouse and Xbox controller
bindings), not a copy of reWASD. This compares three things: what this repo does, what the
Azeron units can do on their own, and what reWASD offers. reWASD was surveyed from its
installed file names and the text its screens show (2026-11-13); its code was not
decompiled. The units' abilities come from the recon captures of 2026-11-13 (app 2.0.3,
firmware 112), summarised in `docs/guides/unit-protocol.md` once written up.

## Where a feature can run

- **On the unit.** Stored in an onboard profile; works with nothing running on the PC, in
  every game, with no driver and no anti-cheat question. Best wherever the firmware allows.
- **In a helper on the PC.** A small background program of ours that watches the unit's
  presses on its configuration channel. Needed for anything the firmware cannot store.
  Optional, off by default per game.
- **In the editor.** Designing, checking and sharing layouts.

## The comparison

| Feature                                     | reWASD                                | Azeron unit (firmware 112)                               | Here today             | Plan                                      |
| ------------------------------------------- | ------------------------------------- | -------------------------------------------------------- | ---------------------- | ----------------------------------------- |
| Remap keys and mouse buttons                | yes                                   | onboard                                                  | yes                    | --                                        |
| Long press, double tap, hold, turbo         | yes (also triple tap, on release)     | onboard                                                  | yes                    | --                                        |
| Xbox controller output                      | virtual controller (driver)           | **onboard: buttons, triggers, stick (types 21-23)**      | no                     | **build: onboard**                        |
| Stick as mouse movement                     | mouse settings                        | **onboard (type 40), sensitivity byte**                  | no                     | **build: onboard**                        |
| Scroll wheel from a key                     | yes                                   | **onboard (type 35): direction and speed**               | no                     | **build: onboard**                        |
| Stick tuning: deadzones, sensitivity, angle | deadzones, curves                     | onboard (in the stick record)                            | passes through         | **build: editor for it**                  |
| Calibration                                 | gyro calibration                      | the app's analog calibration (a device command)          | no                     | later: needs a capture                    |
| Disabled slot (type 6)                      | --                                    | onboard                                                  | **skipped: bug**       | **fix**                                   |
| Shift layers                                | up to 15 shifts, hold / toggle / jump | not stored: the app switches slots when a key is pressed | no                     | **build: helper switches slots**          |
| Macros (step by step)                       | combos with recording                 | not stored: the app types them                           | no                     | **build: helper, opt-in per game**        |
| Chords (up to 4 keys at once)               | combos                                | onboard (4 keys + 3 modifiers per slot)                  | one key + one modifier | build: onboard                            |
| Profile per game, switched automatically    | autodetect                            | --                                                       | no                     | build: helper watches the running game    |
| Radial menu                                 | yes                                   | --                                                       | no                     | maybe: helper + overlay                   |
| In-game overlay                             | yes (menu, crosshair, messages)       | --                                                       | no                     | maybe: a cheat-sheet of the current layer |
| Hide the physical device from games         | exclusive access                      | --                                                       | --                     | not needed: output is onboard             |
| Gyro, adaptive triggers, rumble, trackpads  | yes                                   | the Cyborg II has none                                   | --                     | no                                        |
| Console adapters (ESP32, GIMX)              | yes                                   | --                                                       | --                     | no                                        |
| Sharing layouts                             | community configs                     | --                                                       | git                    | build: one-file export and import         |
| Command line                                | yes                                   | --                                                       | yes (`azeron`)         | --                                        |
| Game's own key file written                 | no                                    | --                                                       | Everspace 2, Elite     | keep growing                              |
| Checks from play sessions                   | no                                    | --                                                       | yes                    | keep growing                              |

## Order

1. Merge the game-keys fallback (PR #34).
2. Allow firmware 112 (the write capture matches our encoder byte for byte) and write
   Disabled (type 6) slots, which the encoder skips today.
3. Onboard Xbox output, stick mouse and scroll, with an editor for stick sensitivity,
   deadzones and angle.
4. Chords: up to 4 keys and 3 modifiers on one slot.
5. The PC helper: layers (hold for a temporary layer, tap to toggle), then automatic
   profile switching per game.
6. Macros in the helper, opt-in per game, with a warning that some anti-cheat flags
   software input.
7. Maybe: a cheat-sheet overlay, a radial menu, calibration.
