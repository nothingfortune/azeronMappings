# Case study: Everspace 2

The game this repo was built around, and the one most of its rules came from. Its layouts
are a pair of units and rudder pedals (`akimbo-v10`), and an older single-unit layout
(`single-v5`), which the compiler must still rebuild byte for byte from the app's export.

**What it taught.** Gamepad mode on a stick made the game stutter, flipping between pad and
keyboard input; mouse mode spins. Long-press and double-tap delay the tap, so they stay off
anything pressed in a fight. Escape as a double-tap on a consumable opened the menu while
mashing a heal. Each is a check now (see the README's table and CLAUDE.md's constraints).
`playtests.md` beside this file is the log of how each version flew.

**The game's keys are written by the repo.** Everspace 2 keeps its bindings in
`Input.ini`; **Update the game's keys…** (or `npm run azeron -- ingame --apply`) writes
every row the layout owns from `actions.yaml`, keeping the previous file beside it. Close
the game first: it rewrites the file on exit. Never change a key in the game's own
controls screen.

**The pedals.** The rudder and the two toe brakes are written into the game's Joystick rows.
A toe rests at the end of its travel, so it needs a Windows calibration before the game can
read it about a centre; the values are in `docs/guides/analog-input.md`.

**Through the Azeron app**, instead of Write to units: import
`dist/SpaceSims/everspace/everspace_akimbo_v10_left.json` onto the unit on your left hand
and `…_right.json` onto the right one, then close the app before playing.
