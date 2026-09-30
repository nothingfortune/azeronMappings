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

The layout change: v5 and v6 put throttle on the left stick's up/down. v7 moved it to the
right thumb pad as two buttons (`thumb_up`, `thumb_down`). Both are digital, so neither
gives proportional thrust, but a thumb deflection reads as a throttle in a way a button
press does not — which is the likely reason it feels worse now than it did.

**Check the controls screen before anything else.** If Everspace 2 offers throttle steps
or presets — "increase/decrease throttle", or "throttle 25/50/75/100%" — then discrete
keys are exactly the right shape for it, the thumb pad is a good home for a four-way
preset bank, and this problem is solved without touching the analog question. Whether the
game has those bindings is not recorded here and has not been checked.

If it does not, there is no proportional throttle without an analog axis, and the options
below are the only ones. Note that cruise and boost already give a crude three-notch
speed (normal, cruise, boost), which may be as close as the game allows.

## What "mouse" means on a Cyborg II

Four separate things, worth keeping apart:

1. **The unit's own optical sensor.** `profileSettings.isSensorOn`, with five DPI steps
   in `sensitivityValues` (1000 / 4000 / 7500 / 10000 / 15000). Moving the unit moves
   the system pointer. This is a real mouse, and it is why a keypad-only setup can still
   aim.
2. **A stick in mouse mode.** The stick drives the pointer instead of sending keys;
   `analogSettings.mouseSensitivity` shapes it. The type code for this mode has never
   been captured, so the compiler refuses to emit it.
3. **Mouse buttons on keys.** Type `"15"`, with codes 1, 2 and 3 seen in the wild; only
   2 (middle) is confirmed.
4. **Scroll.** `scrollSpeed`, `scrollThreshold`, `isSmoothScroll` per input.

**Two units means two sensors, and they drive the same pointer.** Both akimbo v7
profiles shipped with `isSensorOn: true`, inherited from the v5 template, because
`profileSettings` passes through untouched and nothing could say otherwise. A profile can
now set `sensor: true|false` and `dpi: <step>`; the pair is set so the left unit aims and
the right unit's sensor is off.

What the sensor cannot do is throttle. In Everspace 2's own config the mouse axes reach
only `CameraPitch` and `CameraYaw` — aim. `MoveForward`'s axis row is `Key1=None` in the
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

## Option B — stick in mouse mode (most promising, least explored)

The Azeron stick has a mouse mode. Mouse X/Y are the only analog axes the game reads in
KB/M mode, so a stick driving the mouse is **analog input that the game never sees as a
gamepad**. No device ever contradicts another, so there is nothing to flip between.

- It gives _rate_ control (a deflected stick moves the pointer continuously), which is
  what you want for pitch and yaw in a space sim anyway.
- You get two axes total, and they are the same two the mouse uses — so it is stick aim
  _instead of_ mouse aim, not as well.
- It cannot drive an absolute axis such as a throttle.
- **The export format for a mouse-mode stick is unknown.** The compiler refuses to emit a
  mode it has not seen. To unblock it: set a stick to mouse mode in the Azeron app, export
  the profile, and run `azeron decompile` on it — the unknown fields come back as `raw`
  values and we can add the mode properly.
- **Untested for stutter.** It should be immune by the reasoning above, but that is a
  prediction, not a result.

## Option C — translate the gamepad to mouse outside the game

Azeron in gamepad mode, with Steam Input (or a similar remapper) converting the stick into
mouse movement. The game is launched through Steam and only ever sees keyboard and mouse.

- Same no-mixing property as option B, with more moving parts and another layer to
  configure.
- Worth trying only if option B's mouse mode turns out to be unusable.

## Option D — a real joystick, neither gamepad nor keyboard

The appealing idea: stop pretending to be either device and present as a flight stick.
Whether that is possible turns on one fact nobody here has checked yet.

**Everspace 2 is Unreal Engine, and Unreal reads XInput gamepads and keyboard/mouse.** A
generic HID joystick — the DirectInput class a HOTAS uses — is not something a UE game
reads unless the developer wired it up deliberately. Plenty of space sims do; plenty of
UE ones do not.

**Check this before spending an evening on it.** Plug in any joystick, open Settings >
Input > Customize Controls, and see whether the game offers joystick axes at all, or
lists the device. Two minutes, and it decides everything below.

- **If the game does read joysticks natively:** this is the best available answer. A
  virtual joystick (vJoy) fed from the Azerons gives real analog axes in a device class
  the game reads directly, with no gamepad to flip to and no mouse to share. Worth doing
  properly if it works.
- **If it does not:** "joystick" has to be translated into something the game does read,
  and there are only two targets — an XInput gamepad, which _is_ a controller and brings
  back the mixing problem, or keyboard and mouse, which is where we already are. The
  third option is not actually a third option.

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
whether the stutter returned. If option B works, it is the best outcome available: analog
pitch and yaw, no gamepad, no mode switching, and the rest of the layout unchanged.
