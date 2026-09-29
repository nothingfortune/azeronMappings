# Everspace 2 playtests

What each layout actually felt like. Dated, newest first.

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
