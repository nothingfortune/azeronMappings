# The units' configuration protocol

How the repo writes a layout straight into a Cyborg II's onboard memory, and how sure each
part of that is. The code is `src/lib/unitproto.ts` (the bytes), `src/lib/unitsession.ts`
(the exchanges) and `src/editor/unit-write.ts` (WebHID); the editor's **Write to units**
drives them.

## Where it came from

Recovered on 2026-10-14 from Azeron Software 2.0.2 talking to the left unit, firmware 111.
The app is Electron with its main process shipped as V8 bytecode, so it was not decompiled;
it was watched. Started with `--inspect-brk` (its fuses allow it), the main process took a
logging hook on node-hid before any of its own code ran, and every report it sent and
received was recorded with the JS function that sent it and the IPC message that caused it.
The command table, the key table and the request functions were read out of the running
app's closures. The hook only logged; nothing was sent that the app did not send itself.

What the app was seen to do, in order:

1. connect to the left unit: firmware version, keypad details, profile limit, all three
   onboard profiles streamed in;
2. rebind one key of the press-test profile five times (`BUTTON_BIND`, not used here);
3. import a generated profile with a distinct value in every field, and write it into a
   free slot (slot 3) -- the write this repo repeats;
4. read slot 3 back.

`tests/fixtures/unit-protocol/` holds those reports, and the app's own decoding of every
profile it read. `tests/unit/lib/unitproto.test.ts` is the contract: encoding the test
profile must reproduce the app's 63 reports byte for byte, and decoding must reproduce the
app's JSON for all four profiles. A failure there means this code disagrees with the app,
not that the fixture is stale.

## Reports

The configuration interface is the vendor-defined collection (usage page `0xFF01`, Windows'
`MI_04`, product string "Azeron Keypad - C0nf1gur4t0r"). Reports are 64 bytes with report id
0 in both directions.

```
host:  [0][length][command][seq][parts][part][part length][payload…]
unit:  [length lo][length hi][command][seq][parts][part][part length][payload…]
```

A payload over 57 bytes goes in parts, each carrying the whole length in byte 1. Every
command is answered with a report of the same command; `OBM_COPY` answers each part and
echoes the host's sequence number, the rest use the unit's own counter. The unit also sends
reports nobody asked for -- button positions, diagnostics, released-all-buttons -- which the
session passes over.

## Commands

The app's enum has 60. The repo sends eleven, and `hostReports` refuses any other:

| Command                  | Code   | Used for                                                                     |
| ------------------------ | ------ | ---------------------------------------------------------------------------- |
| `FIRMWARE_VERSION`       | `0x05` | firmware (111) and keypad type (8 = Cyborg II); anything else is refused     |
| `KEYPAD_DETAILS`         | `0x02` | the unit's id (bytes 17–18), which is `software_device_id` in its device map |
| `PROFILE_LIMIT`          | `0x1f` | slots the unit has room for (6)                                              |
| `HARDWARE_PROFILE_INDEX` | `0x0e` | the slot it is running                                                       |
| `PROFILE_PAYLOAD_V2`     | `0x2e` | stream every slot                                                            |
| `PROFILE_INPUT_PIECE`    | `0x2b` | acknowledge each streamed piece, the last one too                            |
| `CHECK_PROFILE`          | `0x1d` | the first thing the app sends before writing a slot                          |
| `PROFILE_NAME`           | `0x10` | `[slot][length][name]`, ASCII, at most 19 characters                         |
| `OBM_COPY`               | `0x0b` | one input record into a slot                                                 |
| `SWITCH_PROFILE`         | `0x1a` | `[slot]`: run that slot, after a write reads back clean                      |
| `DELETE_PROFILE`         | `0x1c` | `[slot]`: remove a slot the unit is not running; the unit answers empty      |

Never sent: `RESET` (12), `DFU` (13), `UPDATE_DEVICE_ID` (41), `KEYPAD_DETAILS_SAVE` (3) and
everything else not seen with a payload this code builds.

## An input record, as written

`OBM_COPY`, 68 bytes, big-endian:

```
 0 slot   1 id   2 pinOne   3 pinTwo
 4 tap:    type | key×4 | modifier×3 | hold | holdTime         | turbo | turboInterval (u8)
24 long:   type | key×4 | modifier×3 | hold | featureDelay | holdTime | turbo | turboInterval
46 double: type | key×4 | modifier×3 | hold | doubleDelay  | holdTime | turbo | turboInterval
```

Types are 1 key, 11 none, 15 mouse button. A key is `0xF000 | HID usage`, a modifier
`0xE000 | bit`, a media key `0xE4xx`; a mouse button is its number. The app skips pin 255,
the profile switch on pin 0, `unknown_pins`, and types it does not write (2, 29, 30) -- and
so does `isWritableInput`. A turbo interval over 255 does not fit and is refused.

The keyboard-mode stick is 134 bytes: the same four, type 4, 33 bytes of tuning (limits,
angle as signed 16-bit, sensitivity, cones, magnitudes, hold, rotation, angle lock, and the
`isRightAnalog` / `invertXAxis` / `invertYAxis` switches), then 16 directions as
key/modifier/modifier: the left block, the right block, then both blocks' diagonals.

The stick's hold key is not encoded like a direction key. The app writes the export's
`"16"` (Shift) as `0xE002`, the left-Shift modifier, and `"17"` as `0x0011`: the number as
it stands. `holdKeyCode` does the same, and anything that is not a number is refused.

## A slot, as read

The stream is pieces: a name, the settings, then each record in two pages. A piece starts
`[a][b][c][a^b^c]`; a page longer than one report continues in the next with the same four
bytes. Stored values are little-endian, the hold switches are packed into one byte, and a
record is 53 + 15 bytes (the stick 106 + 28). The stream's `parts` byte is the index of its
last item.

### A slot's settings

The piece after the name, 32 bytes after its prefix. Decoded, each against the app's own
reading of the same bytes:

| Bytes | Field                                                    |
| ----- | -------------------------------------------------------- |
| 3–12  | the five DPI steps, LE16 in units of 50 (20 is 1000 DPI) |
| 25–27 | each light on or off                                     |
| 28    | the light effect                                         |
| 29    | the light brightness                                     |

The Cyborg II has no optical sensor; the settings carry the fields all the same, for the
app's other keypads. Not decoded: the current DPI step, whether the sensor is on and the
sensor's angle. Every
slot seen holds 1, true and 0, and the bytes they could be in (`01 01 00` at 0–2 and
`01 00 00` at 13–15) hold those values too, so which is which cannot be told. The colours
(16–24) are stored transformed. All 32 bytes are kept as read. For a unit with a sensor
the write bar says what the layout wants for the sensor and DPI step, since neither is
written, and which DPI steps the slot holds when they are not the layout's; for the Cyborg
II (`sensor: false` in its device map) it says nothing of either.

## A write

The slots are read first (a write needs to know which there are). `CHECK_PROFILE` adds a
slot, and the unit answers it only for the lowest number not in use -- after a deletion
that is the gap, not the end -- so a new slot always goes there; an existing slot is
written over without it. Then
`PROFILE_NAME`, then `OBM_COPY` for every input the app would write, each part
acknowledged -- then every slot is read again and the written one compared with what was
meant, input by input. `REQUEST_PROFILE` is not used for that: whatever slot it is asked
for, the unit answers with the one it is running.

Seen on 2026-10-15, on both units: an overwrite of an existing slot and a new slot, 31
inputs each in about 1.5 seconds, read back with no differences.

The editor's **Write to units** finds the units the page has been given, asks each its id,
and matches it to the device map that records it, so it knows which is which without
being told. Each hand goes into the slot that already has the layout's name, or a new one.
It says, before writing, how many controls each slot will change, and warns when a stick's
inversion changes. It refuses a unit no device map names, firmware other than 111, and a
running Azeron app (which it can close).

## Deleting a slot

Seen 2026-10-17, when a slot was deleted in the app: `DELETE_PROFILE [slot]`, answered
with an empty report. The other slots keep their numbers, so the unit is left with a gap,
and the next slot added fills it. The editor's write bar lists each unit's other slots
with a Delete beside each; it will not delete the slot the unit is running, a slot it does
not have, or the last one, and reads the slots back to see it gone. It is not retried.

## What a unit reports while it is used

With the app's live view open, a unit sends `BTN_POS` (`0x39`), `[input id][1 pressed, 0
released]`, and `JOYSTICK_POSITION` (`0x37`), x and y as LE16 from 0 to about 1023, centred
near 512. The repo does not ask for either; Test keys reads the keystrokes instead.

## Firmware 112 and app 2.0.3 (captured 2026-11-13)

The app 2.0.3 makes a unit on 111 read-only, so the owner updated to 112, and the app was
recorded writing five profiles into the left unit (`tests/fixtures/unit-protocol/write-112.json`
holds the first, an Everspace 2 layout into slot 4):

- **The write is unchanged.** Every `OBM_COPY` is byte for byte what `encodeInputRecord`
  and `encodeStickRecord` build, and the framing is the same.
- **The sequence number skips 255.** Every capture wraps 254 to 0; `nextSeq` does the same.
- **`"6"` is Disabled**, an empty slot. The app writes a record with a Disabled slot (the
  Everspace thumb pad's double tap) with type byte 6 where `"11"` would put 11, and nothing
  else different. This repo used to skip such a record altogether, so the unit kept what the
  slot held before.

What the app stores on the unit, each in the record layout above unless said:

| Type | What                | On the wire                                                                                                |
| ---- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| 22   | Xbox button         | type 0x16, the key field the XInput bit (A 0x1000, B 0x2000, Guide 0x0400)                                 |
| 23   | Xbox trigger        | type 0x17, key field 1 or 2 (`T2` is the right trigger)                                                    |
| 21   | Stick as Xbox stick | the 134-byte stick record with type 0x15                                                                   |
| 40   | Stick as mouse      | the stick record with type 0x28; mouse sensitivity is the byte at 16 (default 5)                           |
| 35   | Button mouse wheel  | a 55-byte record: type 0x23, x, y, interval (u16 BE), y interval (u16 BE), then the long and double blocks |
| 12   | DirectInput d-pad   | type 0x0c                                                                                                  |

Each works on a long press or double tap as well as the tap (Xbox buttons were seen on
both; scroll only on a tap).

**What this repo writes of these** (`tests/fixtures/unit-protocol/onboard-112.json` holds
the app's own records, and the encoder reproduces every one byte for byte):

- A key's `{xbox: A}` (any button by its XInput bit, `LT` / `RT` as `T1` / `T2`) on any press.
- `{wheel: up, speed: 33}` on a tap. The app turns a speed of 0 to 100 into
  `interval = (100 - speed) * 1.5` for the moving axis and 150 for the other, sends the
  interval whole (100.5 went as 100), and stores the direction as `x` 1 right / -1 left and
  `y` 1 up / -1 down. Up and right were captured; **down and left are refused on a unit**
  until a capture shows how a negative direction goes. **No write with scroll is made at
  all** yet, because a write is checked by reading the slot back and how a unit stores a
  scroll record is not captured; a layout with scroll goes through the Azeron app for now.
- A stick's `mode: xbox` (type 21) and `mode: mouse` (type 40, `mouse_sensitivity` into the
  byte at 16; the owner's "super sensitive" stored 2). Which Xbox stick a right unit's
  drives is not captured: the left unit's export named the left stick.
- Reading a slot back, a record of a type whose stored layout is not known (scroll, so
  far) is kept by its id, pins and types and reported as one that cannot be checked,
  rather than misread. A slot the app filled with them used to stop every slot after it
  from being read.
- App 2.0.3 exports the stick's hold key by name (`"ShiftLeft"`) and sends it as that key's
  code.

**Not stored on the unit**: a macro (16), an input sequence (37) and a layer switch (24).
The app writes each as an empty record and does the work itself on the PC: it types the
macro, or it sends `SWITCH_PROFILE` when the layer key is pressed (seen seven times while
the owner tried one). A macro's steps, in the export, are `{type, duration, keyCode,
direction: Full | Down | Up}`.

Also seen: `0x2c` sets the LED colours (sent over and over while a colour is picked), `0x2f`
saves a slot's colours, and `0x06` / `0x0e` go with a profile switch.

## Not known yet

- **Writing the sensor and DPI** (`sensor:`, `dpi:`), for a keypad that has a sensor. The
  Cyborg II has none, so for these units there is nothing to capture.
- **LEDs.** `RGB_LED_STATE` (`0x2f`) carries the colours transformed in a way not yet worked
  out, and they read back changed again. Not written.
- **Three of the stick's switches.** Combined, hold trigger and angle lock are three bits
  of `0x07` in an order not yet known; the read-back check counts them. Invert X (`0x08`),
  invert Y (`0x10`) and the right stick (its own byte) are confirmed by the app's decoding.
- **The right unit's slot 2, as the app wrote it on 5 October, inverts Y, not X**, by the
  app's own decoding -- while the layout says invert X. The app's older paged write and its
  `OBM_COPY` disagree. Writing the layout from the editor makes it invert X, which changes
  how the right stick behaves; the editor says so before writing.
- **The cones.** The app wrote vertical 41 and horizontal 49 and read back 49 and 45. Its
  own round trip disagrees with itself; the layouts here use 45 and 45, where it does not
  matter.
- **`ADD_PROFILE`, `REQUEST_PROFILE`.** Not sent: `CHECK_PROFILE` is how the app adds a
  slot, and `REQUEST_PROFILE` only ever returns the running slot.
- **A slot added and then left empty** (a write that stopped after `CHECK_PROFILE`) streams
  as its name and settings with no records; the reader ends a stream on those as well, so
  the unit stays readable. How the real unit streams such a slot has not been seen.
- **Which unit is which hand.** `KEYPAD_DETAILS` byte 4 reads 0 on both units, so it is not
  the hand; the unit's id is what tells them apart.
