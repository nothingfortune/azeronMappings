# Getting analog axes into Everspace 2

Written 2026-09-28. The question was whether the Azerons can present as joysticks rather
than keyboards, and whether they could be a joystick outright -- neither controller nor
keyboard and mouse. Read this before trying it again, and add what you learn.

## What is actually verified

Two things, both paid for in play sessions:

1. **A thumbstick in gamepad/analog mode caused frame-rate stutter.** The game kept
   switching between gamepad and keyboard/mouse input. Keyboard mode fixed it.
2. **In keyboard/mouse mode the game reads exactly two analog axes: mouse X and mouse Y.**
   Everything else is digital.

Everything below this line is reasoning and hypothesis, not observation.

## Why the stutter probably happened

The symptom — the game "kept switching between gamepad and keyboard/mouse" — is a
last-input-wins mode flip, not a performance problem. A stick that is physically at rest
still reports small values, so the unit asserts "gamepad is active" continuously while
the keys assert "keyboard is active", and the game thrashes between the two input modes
(and their UI prompts) many times a second.

If that reading is right, the stutter is caused by **mixing**, not by gamepad mode
itself. Which gives three ways out, and one dead end.

## The throttle case

Reported 2026-09-29: thrust cannot be incremented, and forward thrust feels like a
strafe. That is this constraint arriving in practice, plus one layout change.

`throttle_up` and `throttle_down` are bound to W and S, which in Everspace 2 are forward
and backward thrust, not a throttle notch. Pressed digitally they are a full-power
impulse: 0% or 100%, nothing between. A stick in keyboard mode does not change this — it
is a four-way switch, not an axis, so deflecting it half way sends the same key as
deflecting it fully.

**There is no throttle in the game to bind.** Checked in `Input.ini` since: Everspace 2
has no throttle steps or presets. `MoveForward` is a thrust axis — its display name is
"Thrust axis" — with W at +1 and S at -1, and nothing accumulates. So what a W press
does depends on **inertia dampeners**, which is a toggle:

- **Dampeners on**: releasing W brakes the ship. A key that is down part of the time
  alternates thrust and braking, and should average to a lower speed.
- **Dampeners off**: releasing W coasts. The ship holds whatever speed it reached, so W
  and S already behave as a throttle — tap to add speed, tap S to shed it — and a pulsed
  key only reaches the same top speed more slowly.

That makes the dampener state the thing to control for in any test, and it suggests the
throttle asked for may already exist: dampeners off, tap W. It is the first thing on the
akimbo v10 playtest list.

Cruise and boost give a crude three-notch speed on top (normal, cruise, boost).

## What "mouse" means on a Cyborg II

Four separate things, worth keeping apart:

1. **The unit's own optical sensor.** `profileSettings.isSensorOn`, with five DPI steps
   in `sensitivityValues` (1000 / 4000 / 7500 / 10000 / 15000). Moving the unit moves
   the system pointer. This is a real mouse, and it is why a keypad-only setup can still
   aim.
2. **A stick in mouse mode.** The stick drives the pointer instead of sending keys;
   `analogSettings.mouseSensitivity` shapes it. The type code for this mode has never
   been captured, so the compiler refuses to emit it.
3. **Mouse buttons on keys.** Type `"15"`: 1 is left, 2 middle, 3 right, all confirmed —
   2 in the app's UI, 1 and 3 from a profile labelled "Fire Primary"/"Fire Secondary"
   against the game's own bindings for those.
4. **Scroll.** `scrollSpeed`, `scrollThreshold`, `isSmoothScroll` per input.

**Two units means two sensors, and they drive the same pointer.** The imported akimbo
profiles both had `isSensorOn: true`, inherited from the template, because
`profileSettings` passes through untouched and nothing could say otherwise. A profile can
now set `sensor: true|false` and `dpi: <step>`; the live pair has the left unit's sensor
on and the right unit's off.

What the sensor cannot do is throttle. In Everspace 2's binding file the mouse axes reach
only `CameraPitch` and `CameraYaw`, and those sit with the photo-mode controls — so what
the pointer does in flight is not in the file at all. Whether moving it turns the ship or
only aims is untested, and it decides whether a stick should carry yaw or roll. `MoveForward`'s axis row is `Key1=None` in the
Keyboard group, and the only keyboard bindings it has are W and S at scale +1 and -1.
Whether `MouseY` can be bound to `MoveFwd` instead has not been tried; it would cost the
aim axis, which is probably a bad trade, but it is the one untested way to get a
proportional thrust axis without another device.

## Option 0 — duty cycling, which needs nothing new

Taken from arygtm/everspace2-spacemouse, which drives Everspace 2 from a 3Dconnexion
SpaceMouse. It does not use a virtual joystick or a gamepad at all: it emits **keyboard**
presses and gets an analog feel out of them by varying how long the key is held. A small
push taps the key in short bursts; a bigger push holds it longer; past a threshold it
holds continuously. The game only ever sees a keyboard, so there is nothing to flip
between and no stutter to trigger.

The Azeron can do a fixed version of this on its own. Every key record carries `isTurbo`
and `turboInterval`, and a repeated key spends part of its time up, so for an action the
game reads as on/off it averages to less than a held key. `turbo: true` and
`turbo_interval: <ms>` are expressible in a profile now, and survive a round trip.

That does not give deflection-proportional thrust -- the interval is fixed per key, not
driven by how far anything is pushed -- but it does give **thrust notches**. A d-pad with
full thrust on one key and a turbo'd thrust on another is a two-speed throttle, and a
third interval makes it three. Untested in game: whether a pulsed `MoveFwd` reads as
smooth part-power or as judder is a question only a session can answer, and it is the
cheapest of everything on this page to try.

The SpaceMouse project also shows the ceiling of the approach. It reaches proportional
control because software recomputes the duty cycle continuously from a live analog
reading; a keypad running a fixed interval onboard cannot. Anything beyond notches needs
a real axis, which is what the options below are about.

## Option A — commit fully to gamepad

Put everything on the gamepad: both units in gamepad mode, aim on a stick, no keyboard or
mouse input at all. Nothing ever contradicts the game about which device is active, so
there is nothing to flip between.

- **Cost:** you lose mouse aiming, and the game applies its gamepad flight handling and
  aim assist. For a twitchy space sim that is a real downgrade.
- **Cost:** the repo's `require_keyboard_stick` lint rule exists to stop exactly this, so
  it would have to be turned off for the game deliberately in `game.yaml` — not quietly.
- **Untested.** Worth one session if full-analog flight matters more than mouse aim.

## Option B — stick in mouse mode: tried, and it spins

Tried 2026-09-30. **The ship turns and does not stop, and there is no way to bring it
back to centre.** It is not a tuning problem.

The reasoning for it was that a deflected stick moves the pointer continuously, which is
rate control. It is — rate control _of the pointer_. But Everspace 2 steers by where the
pointer _is_: off centre, the ship turns, and it keeps turning until the pointer comes
back. So the stick sets how fast the pointer moves, the pointer's position sets how fast
the ship turns, and letting go leaves the pointer wherever it got to. Stopping means
counter-deflecting for exactly as long as it took to get there. A mouse does not have
this problem because it is a position device: you move it back to where it was.

One thing would change this reading: if, after letting go, the ship creeps slowly rather
than holding the turn it had, the stick is drifting at rest and a larger deadzone in the
app would fix it. Holding the same turn is the steering model, and no setting fixes that.

What the stick _can_ give is rate control of the ship directly, in keyboard mode: the
game's own `Yaw` and `Pitch` actions are on keys, and a stick sending them turns the ship
while it is held and stops when it is released. That is the `twin_stick` stick mode, and
yaw on the left stick in Mode 2. It is digital — full rate or nothing — but it centres.

## Option C — translate the gamepad to mouse outside the game

Azeron in gamepad mode, with Steam Input (or a similar remapper) converting the stick into
mouse movement. The game is launched through Steam and only ever sees keyboard and mouse.

- Same no-mixing property as option B, with more moving parts and another layer to
  configure.
- **Ruled out by option B.** It still ends in the pointer, so it spins for the same reason.

## Option D — a real joystick, neither gamepad nor keyboard

**Checked 2026-09-30: Everspace 2 reads DirectInput joysticks natively.** Its `Input.ini`
has a Joystick group alongside Keyboard and Gamepad, and already holds 24 bindings to a
Thrustmaster T.16000M, named `JS-1_T16000M_Button0` and so on — the game names each input
`JS<index>_<Device>_<Input>`, and the index is its own count of devices, negative for a
stick that is not plugged in. `GameUserSettings.ini` carries `InputMethod=MouseAndJoystick`: mouse
and joystick together is a mode the game is built for, not a mix it flips between. The
stutter in constraint 1 was gamepad against keyboard and mouse; this is not that.

The Joystick group's flight rows are axes waiting for one: `MoveForward`, `MoveRight`,
`MoveUp`, `Pitch`, `Yaw` and `Roll`, each `bIsAxis=True` with `Key1=None`, a 0.1 dead zone
and, for `MoveForward` alone, `bInvert=True` — the shape of a throttle lever.

**This is the route being taken.** Logitech Pro Flight rudder pedals, bought 2026-09-30,
give three axes: the rudder, which springs back to centre, and two toe brakes, which rest
at one end and are pressed towards the other.

- **Rudder to yaw** is the natural fit: proportional, and it centres itself — what neither
  the pointer (a position you have to return) nor a keyboard-mode stick (full rate or
  nothing) can give.
- **A toe brake to thrust** looked like the proportional throttle this whole guide has been
  looking for, with one question first: `MoveForward` expects a centred axis, −1 to +1, and
  a toe brake rests at an end. **That question now has a measured answer, and it is no.**
  With no Windows calibration stored, each toe reads −1.0 at rest and +1.0 fully pressed. On
  any game axis read about a centre — all six flight axes — a toe is therefore a full
  deflection with the foot off, and the fields the game's row offers (`bInvert`, `Scale`,
  `DeadZone`, `Sensitivity`, `Exponent`) cannot re-centre it: none of them is an offset.
  The toes are not bound to anything.

**A Windows calibration makes a toe rest at zero — set and measured 2026-10-01.** The game
reads the pedals through SDL's DirectInput backend, and DirectInput applies the calibration
`joy.cpl` stores: a minimum, a centre and a maximum per axis, with everything from the
centre up mapped onto the top half of the range. A toe reports 0 at rest and 127 fully
pressed, so a centre at 0 and a maximum at 127 make it read 0.0 at rest and +1.0 pressed:
half an axis, which is what a throttle is. The Logitech driver replaces the page that has
the Calibrate button, so the values are written directly:

```
HKCU\System\CurrentControlSet\Control\MediaProperties\PrivateProperties\DirectInput\
  VID_06A3&PID_0763\Calibration\0\Type\Axes\0   Calibration = 81ffffff 00000000 7f000000
  VID_06A3&PID_0763\Calibration\0\Type\Axes\1   Calibration = 81ffffff 00000000 7f000000
```

Three little-endian numbers: minimum −127, centre 0, maximum 127. Axis 0 is X, the left
toe, and axis 1 is Y, the right; the rudder (axis 5) is left alone. Deleting the two `Axes`
keys puts the toes back as they were.

- **The minimum has to be below the rest position, not equal to it.** The first attempt
  was minimum 0, centre 0, maximum 127. A pressed toe then read correctly, but at rest it
  read −1.0 — a value at the minimum is the minimum, whatever the centre — and jumped to
  the positive half at the first touch. With the minimum at −127, which the toe never
  reaches, rest is the centre.
- **Measured** by reading the pedals through SDL 2.30.6's DirectInput backend while each
  toe was pressed: both rest at 0, rise in proportion and reach the top of the range fully
  pressed. That is the same backend the game uses, in a newer SDL; it is not the game.
  `calibrated_rest: centre` on each toe in the device file records it, and is what stops
  `pedal-rest-on-centred` from warning.
- A program reads a device with the calibration it had when it opened it, so the game has
  to be started after the values are written.
- The calibration belongs to the machine, not the repo. A driver reinstall, another
  Windows user or another computer has none, and a toe is then a full deflection at rest
  again. The registry key is filed under the device's instance (`Calibration\0`); whether a
  different USB port counts as another instance has not been checked.

**The game's thrust row is inverted as it ships.** `MoveForward` in the Joystick group has
`bInvert=True`, the shape of a throttle lever pushed away from you. A toe put on thrust
needs `invert: false`, or pressing it reverses. The editor writes `invert` outright for an
axis assigned in the Pedals panel, so its box shows what the game is given.

**Do not ask the pedals for their state.** A HID `GET_REPORT` request
(`HidD_GetInputReport`), sent as a diagnostic on 2026-09-30, hung them: they answered once,
then sent nothing to anything — the game and `joy.cpl` included — until they were unplugged
and plugged back in. Listening to the reports they send on their own is safe.

**This has a home in the repo.** The pedals are a device (`devices/logitech-pro-flight-
pedals.yaml`), what a layout does with them is in the game's `sets.yaml` beside its profiles
(`akimbo-v10`: the rudder on yaw), and the stick mode has a with-pedals variant that hands
the stick axis the rudder now carries to roll. `azeron ingame --apply` writes the layout's
pedals into the Joystick group's axis rows, under the keyboard side's guarantees; see "The
game's own binding file" in `CLAUDE.md`.

**What is known about the names, and what is not.** The pedals are sold as Logitech and
report as Saitek (USB 06a3:0763); Windows lists three axes, X, Y and Rz, which the driver
labels "Left Toe", "Right Toe" and "Rudder". The game reads joysticks through SDL and its own
log (`LogJoystickPlugin_*.log`) registers exactly three inputs for them, zero-based:
`JS0_SaitekProFlightRudderPedals_Axis0`, `_Axis1`, `_Axis2`. Those three names are
confirmed. Which is which is not:

- Recorded 2026-10-01 through SDL's DirectInput backend while each pedal was moved: the
  axis that rests at centre and swings both ways is **`Axis2`**, so that is the rudder.
  Measured in the backend the game uses, and not flown.
- `Axis0` follows the device's X and `Axis1` its Y. The driver labels X "Left Toe" and Y
  "Right Toe", and X was the toe pressed first when the left was asked for first.
- The owner's own `Input.ini` had Yaw on `Axis1`. That is a toe: the game's bind screen
  takes whatever moves first, and a toe reads full deflection from the start, so it won a
  capture meant for the rudder. It was a mis-capture, not a fact about the rudder, and it
  is the reason a capture is recorded as `bound` (what the game wrote) and never as
  confirmed. `azeron ingame --apply` moves it: Yaw takes `Axis2`.

Each name in the device file carries a status — `confirmed` (flown; none yet), `inferred`,
`unconfirmed`, `bound`, `candidate` — and generation says which it used, so a name that is
not yet flown is never mistaken for one that is.

**What to do next.** Apply, then fly the rudder: does the ship yaw in proportion to the
pedal, and stop when it centres? If it yaws on its own or the wrong way, the inference is
wrong and `azeron ingame --capture-pedals` will say where the file and the device data
disagree. Then a toe: put the right toe on thrust in the Pedals panel, write the game's
bindings, and see whether thrust follows the pedal from nothing to full and stops when the
foot comes off. If the ship thrusts on its own, the calibration is not reaching the game.

The Azeron exposes a fixed set of USB HID interfaces, with configuration over hidraw on
interface 4 in a proprietary protocol; the profile JSON this repo compiles chooses what
the existing keyboard, mouse and gamepad endpoints send, not which endpoints exist. Adding
a device class would be firmware work, not profile work.

**An untested lead: the units already enumerate as DirectInput joysticks.** Measured
2026-10-01 with SDL 2.30.6 on the owner's machine, both units plugged in: SDL's DirectInput
backend lists four devices named `Azeron Keypad - DirectInput` (two with 6 axes and 32
buttons, two with 5 axes and 10 buttons), and its XInput backend lists two named
`Controller (Azeron Keypad - XInput)`. The game's own joystick log, the same day, listed
only the pedals. Why it leaves the Azerons out is not known — it may skip anything XInput
also claims, which is what a stick in gamepad mode is, and that mode is constraint 1's
stutter. Whether a unit can be made to send its stick on the DirectInput interface alone,
and whether the game would then read it in the Joystick group without the flip, has not
been tried.

## The dead end — a virtual gamepad

vJoy, ViGEm and friends synthesise a gamepad from digital input. The game still sees a
gamepad, so this reintroduces exactly the mixing that caused the stutter, and buys nothing
that option A does not. Constraint 2 in CLAUDE.md says this plainly: no remapper can add
analog axes without a virtual gamepad, and a virtual gamepad re-triggers constraint 1.

## If you test one of these

Capture the result here and in `playtests.md`, and say which option, for how long, and
whether the stutter returned.
