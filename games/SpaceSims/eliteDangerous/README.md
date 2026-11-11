# Case study: Elite Dangerous

A game played in modes, where one key is meant to be a different thing in each.

**A layout per mode.** **ship**, **srv** (the buggy) and **on-foot** are each a pair of
files in `dist/SpaceSims/eliteDangerous/`. Put all three on the units, one slot per mode on
each, and switch between them with the unit's profile button as you get out of the ship.
`sets.yaml` says which modes each layout plays, so the checks only call two actions a
collision when some layout has both live at once.

**The game's keys are written by the repo.** Update the game's keys… writes Elite's
`Custom.4.1.binds` and tells the game to use it (`StartPreset.4.start`), keeping copies of
both. Close Elite first. It starts from the game's own keyboard preset, not your old file,
so anything bound to a joystick there is not carried over.

**The vocabulary** is every button control in the game's presets, 358 actions, made once by
a script. It is edited, not regenerated: regenerating would deal out keys again, and the
layouts depend on each action keeping its key.
