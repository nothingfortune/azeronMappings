# Everspace 2 playtests

What each layout actually felt like. Dated, newest first.

## 2026-09-30 — rudder pedals, not yet connected

Logitech Pro Flight rudder pedals: a rudder that springs back to centre, and two toe
brakes that rest at one end. Everspace 2 reads DirectInput joysticks itself (it already
has a T.16000M bound) and is set to `InputMethod=MouseAndJoystick`, so no translation
layer is needed. See `docs/guides/analog-input.md`, option D.

First session, in this order:

1. **Windows first.** "Set up USB game controllers" (`joy.cpl`): the rudder and both toe
   brakes should each move one axis. If a toe brake barely moves its bar, calibrate there.
2. **Rudder to yaw**, in the game's Settings → Controls, Joystick column, `Yaw` axis. Fly.
   Does the ship yaw in proportion to the pedal, and stop when it centres?
3. **Stutter.** Fly for a few minutes using keys, the sensor and the pedals together.
   Constraint 1 was gamepad against keyboard; this should not repeat it, but watch.
4. **A toe brake to thrust**, `MoveForward` axis. **With your foot off, watch the ship.**
   If it moves on its own, the game reads the resting toe as full thrust one way — note
   which, and the ship's speed at half and full press.
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
