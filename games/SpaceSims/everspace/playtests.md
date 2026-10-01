# Everspace 2 playtests

What each layout actually felt like. Dated, newest first.

## 2026-09-30 — rudder pedals

Logitech Pro Flight rudder pedals: a rudder that springs back to centre, and two toe
brakes that rest at one end. They report as Saitek (USB 06a3:0763). Everspace 2 reads
joysticks itself, through SDL (it already has a T.16000M bound), and is set to
`InputMethod=MouseAndJoystick`, so no translation layer is needed. See
`docs/guides/analog-input.md`, option D.

**What is in the layout** (`games/SpaceSims/everspace/sets.yaml`, `akimbo-v10`):

- **The rudder on yaw, and nothing else.** It centres itself, which is what a turn wants and
  what neither the pointer nor a keyboard-mode stick can give. With it, the left stick's
  horizontal is roll (Mode 2 _with pedals_): the pedals carry the turn, so no stick has to.
- **The toes are bound to nothing, on purpose.** This replaces the first plan, a right toe
  on thrust as a test of what the game makes of it. The game's own log and a measurement
  have answered that without flying: with no Windows calibration stored a toe reads -1.0 at
  rest and +1.0 fully pressed, so on thrust, or any axis read about a centre, it is a full
  deflection with the foot off. `invert`, `scale`, `dead_zone`, `sensitivity` and
  `exponent` — everything the game's row offers — cannot re-centre it. The toes wait for
  someone to find what the game does with a one-sided axis; `pedal-rest-on-centred` warns
  the moment one is bound.

**Which name is which.** The game registers three inputs for the pedals,
`JS0_SaitekProFlightRudderPedals_Axis0` to `_Axis2` (confirmed, from its own log). The
rudder is `Axis2`, because it is the last axis in every ordering of the device — inferred,
not flown. `Axis0` is the left toe and `Axis1` the right under SDL's ordering; which toe is
which is the least certain part. The device file records each with that status, and the
generator says which status it used.

**The owner's file had Yaw on `Axis1`, which is a toe.** The game's bind screen takes
whatever moves first, and a toe at the end of its travel reads full deflection from the
start, so it won the capture meant for the rudder. `azeron ingame --apply` moves it: Yaw
takes `Axis2`. If the ship then does not yaw with the rudder, the inference is wrong, not the
tooling — `azeron ingame --capture-pedals` says where the file and the device data
disagree, and the device file is where to correct it.

**First session, in this order:**

1. **Windows first.** "Set up USB game controllers" (`joy.cpl`): the rudder and both toe
   brakes should each move one axis. Note which of the two toe bars moves for the left foot.
2. **Apply** (game closed) and check Yaw in the game's controls screen reads the rudder.
3. **Fly the rudder.** Does the ship yaw in proportion to the pedal, and stop when it
   centres? In the wrong direction? On its own with your feet off? Any of those means the
   name or the direction is wrong: say which, and fix it in the device file or with
   `invert: true` on the assignment in `sets.yaml`. When it is right, change the rudder's
   status to `confirmed`. Is roll on the left stick useful, now that it is not yaw?
4. **Stutter.** Fly for a few minutes using keys, the sensor and the pedals together.
   Constraint 1 was gamepad against keyboard; this should not repeat it, but watch.
5. **Quit the game** so it writes `Input.ini`, then the bindings can come into the repo.

## 2026-09-30 — a stick in mouse mode

Set in the Azeron app, not in the repo (the compiler cannot emit mouse mode). **The ship
spins, and there is no way to bring it back to centre.**

Why: Everspace 2 steers by where the pointer is — off centre, the ship turns, until the
pointer comes back into a dead zone at the centre. The game's own settings confirm it:
`MouseDeadzoneAtCenterFactor=0.5`, and `bShowMouseDeadZone`, off here, draws that zone on
screen. Turning it on shows where "stop" is, for the sensor as much as anything. A stick moves the pointer at a rate, so
letting go leaves it wherever it got to, and stopping means counter-deflecting for
exactly as long. A mouse, or the unit's sensor, is a position device: you move it back.

Worth one check next time: after letting go, does the ship **hold** the turn it had, or
**creep**? Holding is the steering model and no setting fixes it. Creeping is the stick
drifting at rest, which a larger deadzone in the app would fix.

This also answers part of the v10 question below: **moving the pointer does turn the
ship.** Pitch and yaw are on the sensor as a position control. What a stick in keyboard
mode adds is the other kind — turn while held, stop when released — which is the case
for yaw on a stick, or the twin-stick mode.

## 2026-09-29 — akimbo v10, not yet flown

On branch `experiment/pulsed-thrust`. Import both units fresh: v9 was never flown, and
nothing it would have done is what its files said.

**What v9 got wrong, which v10 is the first layout without.** The keys labelled weapon
cycling sent the arrows, and the game has the arrows on pitch and yaw — it has no
weapon cycling on four keys at all. The right stick wrote a direction block the unit
does not read, so it never strafed; it rolled. And the game had A and D swapped against
every label. The first two are fixed in the compiler and the layout; the third by
generating the game's bindings from `actions.yaml`, so the game and the keypads cannot
drift apart again.

**Before flying: apply the game's bindings.** Close the game, run
`npm run azeron -- ingame --apply`, then open Settings → Controls and spot-check that
strafe left is A and hover up is F9 with nothing else on it. The previous file is kept
beside it as `Input.ini.bak-<time>`.

**The sticks, in stick mode 2.** Left stick climbs and turns (hover, yaw); right stick
flies forward and strafes (thrust, strafe). The right thumb pad pitches and rolls.

Check these first — they are the questions a file cannot answer:

1. **Push the right stick right. Does the ship strafe right?** The right unit's stick is
   mounted rotated and carries `invertXAxis`. If it strafes left, that is a one-line fix
   on the device, not a layout change — say which way it went.
2. **Does moving the pointer turn the ship, or only aim?** This decides the layout. If it
   turns the ship, pitch and yaw are covered twice and roll wants the left stick instead:
   switch to *Mode 2, roll for yaw* in the editor and fly the same stretch again.
3. **Is yaw on a stick useful at all** with the pointer doing what it does?

**Pulsed thrust**, unchanged from v9 and still unflown:

| Input | What it sends |
| --- | --- |
| right stick up | W held — full thrust |
| right `middle_1` | W repeated, interval 40 |
| right `middle_4` | W repeated, interval 100 |

`MoveForward` is a thrust axis, not a throttle: W is +1, S is −1, and nothing accumulates.
What a pulsed W does depends on **inertia dampeners**. With them on, the gaps brake, so it
should average to a lower speed. With them off, the ship coasts through the gaps and
only reaches full speed more slowly — no part power at all. Dampeners are a toggle on
either stick click, so **note the state on every run**, and compare top speeds as
numbers from the HUD rather than by feel.

Try this before the pulsed keys: **dampeners off, tap W, let go.** If the ship holds the
speed it reached, W and S already are a throttle — tap to add speed, tap S to shed it —
and the pulsed keys can go.

If neither works, the game has an unbound `Joystick` group with a thrust axis
(`MoveForward`, `bIsAxis=True`), which is the real proportional throttle.

## 2026-09-28 — akimbo Mode 2 attempt

Awkward, and abandoned during the session. Two distinct causes, worth keeping apart:

1. **The right hand had too few bindings.** Actions that were not on either unit kept
   forcing a return to the gamepad, which defeats the point of going akimbo.
2. **The two hands used the same finger positions for unrelated jobs.** Nothing
   transferred between hands; every position had to be learned twice.

The next akimbo attempt has to (a) cover every action without a gamepad and (b) mirror
roles, so the same finger position on each hand does an analogous job. Both are now
linter rules — `missing-required` and `akimbo-role-mismatch` — so the layout is held to
them before it is ever flashed to a device.

## Baseline — single-unit v5

The known-good profile, in `profiles/single-v5.yaml`, kept as the compiler's golden
fixture. Linting it surfaced a 1000 ms tap delay on all five thumb-pad keys — the
ultimate and the four arrows. v5 labelled the arrows as weapon cycling; in the game they
are pitch and yaw, so holding one past the long-press window also opened a menu.
