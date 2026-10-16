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

`CHECK_PROFILE`, `PROFILE_NAME`, then `OBM_COPY` for every input the app would write, each
part acknowledged -- then `REQUEST_PROFILE` for the slot, and every input compared with what
was meant. The editor shows any difference. It refuses before sending anything when the
layout cannot be encoded, when the unit's id is not the one the layout's device map names,
when the firmware is not 111, while the layout has unsaved edits, and while the Azeron app
is running (it talks on the same channel).

## Not known yet

- **Overwriting a slot that exists.** The app was seen to write a free slot. The editor
  writes an existing one the same way and checks it by reading it back; the first real
  overwrite should go to a slot that holds nothing of value.
- **The sensor and DPI** (`sensor:`, `dpi:`). The import path did not write them, so the
  editor leaves them as the slot has them. Capturing the app toggling them would add them.
- **LEDs.** `RGB_LED_STATE` (`0x2f`) carries the colours transformed in a way not yet worked
  out, and they read back changed again. Not written.
- **Which stored bit is which stick switch.** The one write that set them set four at
  once. The read-back check only insists on them where none was meant to be on. Where
  `isRightAnalog` and `invertYAxis` sit in the write was inferred from the field order (both
  were off in that write); a right unit's write should be checked against the slot the app
  wrote before it is trusted.
- **The cones.** The app wrote vertical 41 and horizontal 49 and read back 49 and 45. Its
  own round trip disagrees with itself; the layouts here use 45 and 45, where it does not
  matter.
- **`DELETE_PROFILE`, `ADD_PROFILE`, `SWITCH_PROFILE`.** Not sent.
