# Everspace 2 playtests

What each layout actually felt like. Dated, newest first.

## 2026-09-29 — akimbo v9, not yet flown

On branch `experiment/pulsed-thrust`. Two changes to judge, both untested.

**The sticks fly.** The imported layout had both sticks cycling weapons while thrust sat
on a d-pad, which put the discrete job on the only input that is not discrete. v9 uses
stick mode 2: the right stick thrusts and strafes, the left climbs and rolls, and weapon
cycling moves to four keys. The left unit's sensor aims and the right unit's is off —
they were both on, driving the same pointer against each other.

**Pulsed thrust.** Thrust forward is also on two keys of the right unit, so a pulsed
press can be compared against the stick holding it:

| Input | What it sends |
| --- | --- |
| right stick up | W held — full thrust |
| `middle_1` | W repeated every 40 |
| `middle_4` | W repeated every 100 |

The question is whether a repeated key reads as part power or as judder. Everspace 2's
`MoveFwd` is a digital half-axis on keyboard — W is 100%, released is 0% — so a key that
spends part of its time up is the only part-power press available without an analog axis.
Two intervals because the units of `turbo_interval` are unverified; flying both says
whether a larger number pulses slower or holds longer, and whether either is usable.

What to record: does either feel like part throttle, or does the ship judder? Is one
interval clearly better? Does it help at all with the complaint that thrust reads like a
strafe?

If neither works, delete the two keys and the acknowledgement in `game.yaml` and the
answer is that notches are not available this way — which leaves the Joystick group,
since the game has one and `MoveFwd` accepts an axis.

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

The known-good profile, in `profiles/single-v5.yaml`. Linting it surfaced a 1000 ms tap
delay on all five thumb-pad keys (ULT and the four weapon-cycle arrows); not yet
playtested against, but it is the first thing to try changing in v6.
