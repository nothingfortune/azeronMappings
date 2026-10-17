# The units' configuration protocol

How the repo writes a layout straight into a Cyborg II's onboard memory, and how sure each
part of that is. The code is `src/lib/unitproto.ts` (the bytes), `src/lib/unitsession.ts`
(the exchanges) and `src/editor/unit-write.ts` (WebHID); the editor's **Write to unit**
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

The app's enum has 60. The repo sends ten, and `hostReports` refuses any other:

| Command                  | Code   | Used for                                                                     |
| ------------------------ | ------ | ---------------------------------------------------------------------------- |
| `FIRMWARE_VERSION`       | `0x05` | firmware (111) and keypad type (8 = Cyborg II); anything else is refused     |
| `KEYPAD_DETAILS`         | `0x02` | the unit's id (bytes 17–18), which is `software_device_id` in its device map |
| `PROFILE_LIMIT`          | `0x1f` | slots the unit has room for (6)                                              |
| `HARDWARE_PROFILE_INDEX` | `0x0e` | the slot it is running                                                       |
| `PROFILE_PAYLOAD_V2`     | `0x2e` | stream every slot                                                            |
| `REQUEST_PROFILE`        | `0x1e` | stream one slot                                                              |
| `PROFILE_INPUT_PIECE`    | `0x2b` | acknowledge each streamed piece, the last one too                            |
| `CHECK_PROFILE`          | `0x1d` | the first thing the app sends before writing a slot                          |
| `PROFILE_NAME`           | `0x10` | `[slot][length][name]`, ASCII, at most 19 characters                         |
| `OBM_COPY`               | `0x0b` | one input record into a slot                                                 |

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

## A slot, as read

The stream is pieces: a name, the settings, then each record in two pages. A piece starts
`[a][b][c][a^b^c]`; a page longer than one report continues in the next with the same four
bytes. Stored values are little-endian, the hold switches are packed into one byte, and a
record is 53 + 15 bytes (the stick 106 + 28). The stream's `parts` byte is the index of its
last item.

## A write

The slots are read first (a write needs to know how many there are). For a new slot after
the last one, `CHECK_PROFILE` adds it; an existing slot is written over without it. Then
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

## Not known yet

- **The sensor and DPI** (`sensor:`, `dpi:`). The import path did not write them, so the
  editor leaves them as the slot has them. Capturing the app toggling them would add them.
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
- **`DELETE_PROFILE`, `ADD_PROFILE`.** Not sent: deleting a slot still needs the Azeron app.
- **Which unit is which hand.** `KEYPAD_DETAILS` byte 4 reads 0 on both units, so it is not
  the hand; the unit's id is what tells them apart.
