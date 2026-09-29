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
