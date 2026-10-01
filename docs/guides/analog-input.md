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

- The rudder is the last axis in every ordering (DirectInput's X, Y, Rz and the raw HID
  order Y, X, Rz), so it is **`Axis2`** — strong, but inferred, and not flown.
- Under SDL's DirectInput ordering `Axis0` is the left toe and `Axis1` the right toe. Which
  toe is which is the less certain part; they are recorded as unconfirmed.
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
disagree. Nothing about the toes can be settled until someone finds what the game does with
a one-sided axis — a half-range option in its controls screen, say (none is known to
exist). `pedal-rest-on-centred` warns on any
rest-at-end axis assigned to a centred game axis, so binding one is a visible decision.

One thing we cannot do either way: the Azeron itself cannot be made to present as a
joystick. It exposes a fixed set of USB HID interfaces, with configuration over hidraw on
interface 4 in a proprietary protocol; the profile JSON this repo compiles chooses what
the existing keyboard, mouse and gamepad endpoints send, not which endpoints exist. Adding
a joystick device class would be firmware work, not profile work.

## The dead end — a virtual gamepad

vJoy, ViGEm and friends synthesise a gamepad from digital input. The game still sees a
gamepad, so this reintroduces exactly the mixing that caused the stutter, and buys nothing
that option A does not. Constraint 2 in CLAUDE.md says this plainly: no remapper can add
analog axes without a virtual gamepad, and a virtual gamepad re-triggers constraint 1.

## If you test one of these

Capture the result here and in `playtests.md`, and say which option, for how long, and
whether the stutter returned.
