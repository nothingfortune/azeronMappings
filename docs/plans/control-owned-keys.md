# Plan: keys that belong to controls, not actions

Status: **deferred, 2026-10-02.** Written down so it can be picked up cold. Nothing here is
built. Everspace 2 works without it; Elite Dangerous needs it.

## The problem

Today an action owns a key. `actions.yaml` says thrust is `W`; a layout puts thrust on a
control; the keypad is compiled so that control sends `W`; the game is told `W` is thrust.

That has two costs.

1. **Every change to a layout changes what the keypads send**, so every change means
   importing two files into the Azeron app and writing them to the units. That is the
   slowest and most error-prone step in the whole loop, and it happens for the smallest
   edit.
2. **A control can do one thing.** Elite Dangerous has modes of play — ship, buggy, on
   foot, the scanners, menus — and the same button is meant to be engine boost in the
   ship, turbo in the buggy and sprint on foot. With keys owned by actions, a control sends
   the key of the one action that is on it, and the other modes get nothing.

## The idea

Turn it round. **A control owns a key, for good.** Left pinky 1 always sends, say, `F13`
(or `Numpad 7`, or whatever it is dealt). The keypads are compiled once from that table and
never change again. A layout then says which action each control does, per mode, and the
only thing a layout change rewrites is **the game's own bindings file**: thrust is whatever
key the control it sits on sends.

- Changing a layout: one write to the game's file. No Azeron app, no import, no re-flash.
- One control, several modes: the control's key is bound to a different action in each of
  the game's modes, which is how these games are meant to be bound.
- One keypad profile serves every game. Nothing to switch when changing games.
- A game the editor cannot write to is bound in its own controls screen by pressing the
  control when it asks for a key. The repo is not needed for that game at all.

## What changes

| Piece                       | Today                                  | After                                                    |
| --------------------------- | -------------------------------------- | -------------------------------------------------------- |
| Keypad profiles             | One pair per layout, position → action | One pair, fixed: position → key. Generated, not edited   |
| Layout                      | The profile YAML                       | A file per game and layout: mode → control → action      |
| `actions.yaml`              | Action → key, plus the game's row      | Action → the game's row (and mode, group, role). No keys |
| The game's file             | Written from each action's key         | Written from the key of every control the action is on   |
| The editor's board          | Edits the profile                      | Edits the layout; a mode picker says which mode is shown |
| Compile, the golden fixture | —                                      | Unchanged. `single-v5` stays as the compiler's contract  |

What stays on the keypad, because it is how a control behaves rather than what it means:
long press and double tap (each is its own key), hold-to-latch, turbo (the pulsed-thrust
keys), the stick's keyboard mode, the sensor. Changing one of those still needs a re-import;
they change rarely.

## Things to settle before building

1. **How many keys.** Two units have about 60 controls with the sticks' eight directions;
   long press and double tap, where used, are more. A keyboard has about 100 keys, and both
   games accept a modifier with a key, which multiplies that. Enough, but the deal has to
   avoid keys that mean something outside a game (the Windows key, Alt+Tab, F12 for Steam's
   screenshot, Print Screen) and keys a game refuses.
2. **Does the Azeron send every key it is dealt.** The export format takes
   `KeyboardEvent.code` strings; only the keys seen in real exports are confirmed. `F13` to
   `F24` would be ideal, since no game or desktop uses them, and are unconfirmed on the
   hardware and in both games. One press test of a dealt profile settles it.
3. **Modifiers and mouse buttons.** Boost is on Left Shift and fire on the mouse buttons
   today. Both games take any key for either, so neither has to stay; but a control that
   must be a real mouse button (a game that insists) needs an exception in the table.
4. **Typing.** A keypad that sends arbitrary keys types rubbish into a chat box. True today
   as well. Not a regression; worth a line in the README.
5. **Actions on two controls.** Each game row has two slots (Everspace's `Key1`/`Key2`,
   Elite's Primary/Secondary). An action on more than two controls cannot be written; the
   lint has to say so.
6. **The keyboard.** With every row holding a dealt key, the game's keyboard defaults are
   gone. Where a game has a second slot free, the default can be left in it.
7. **Per-mode collisions.** A key may be bound once per mode. Elite's file does not say which
   mode a control is in; `describeControl` in `src/lib/elite.ts` already does. Everspace's
   categories 0 to 3 are one mode (all live while flying).
8. **Analog.** Pedals and joystick axes are not keys and are already bound by device axis.
   Unchanged, except that Elite needs its own names for them (`06A30763` and `Joy_RZAxis`,
   not Everspace's `JS0_..._Axis2`).

## Order of work

1. **Deal and prove the keys.** A table of control → key for both units; compile it; press
   test it on the hardware, and in each game's bind screen. Nothing else is worth building
   until every dealt key is known to arrive.
2. **The layout file and the generator for Everspace.** Mode is trivial there (one). Write
   the game's rows from control keys; keep `azeron ingame`'s guarantees (owned rows only,
   byte-identical elsewhere, a fixed point). Migrate `akimbo-v10` to a layout file. One
   last import of the fixed profiles.
3. **The editor.** The board edits the layout; Save rewrites the game's file (with the
   game closed, as now) and never asks for an import.
4. **The Elite adapter.** A writer for `.binds` beside the reader in `src/lib/elite.ts`;
   the action list from the file through `describeControl`; a mode picker on the board;
   per-mode collision checks. The 114 bindings to a controller that is gone are cleared on
   the way.
5. **Retire** per-layout profiles, action keys and the wiring pool, which this replaces.

Steps 1 and 2 are the risk. If the hardware or a game refuses the dealt keys, the plan
changes at step 1, before anything is rebuilt.

## What exists already and carries over

- `src/lib/elite.ts`: reads a `.binds` file keeping every line, translates key names both
  ways, and names, groups and assigns a mode to all 396 controls.
- `src/lib/wiring.ts`: the pool of keys that stay out of a game's way, and the rule that a
  key once given is never re-dealt. The pool becomes the start of the deal.
- The pedal model, which already separates what a control is from what the game calls it.
- The tests run against a frozen copy of the data, so the layouts can be migrated without
  the suite going red half way.
