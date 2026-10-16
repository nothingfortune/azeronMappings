# Capturing what the Azeron app says to a unit

The repo speaks the part of the units' configuration protocol the Azeron app was seen to
use -- reading slots and writing a layout into one (`docs/guides/unit-protocol.md`). The
rest, the sensor, DPI, lights and deleting a slot, is still to be learned, and a guessed
request to a unit could change what it holds. The way to learn it is to **watch the Azeron
app do it**, one setting at a time, and read the bytes. This is the procedure with USBPcap.
Nothing here sends anything to a unit: USBPcap only copies the traffic, and `azeron hidcap`
only reads the file it is given.

## What is known before you start

- Both Cyborg II units are USB `16d0:12f7`. The app configures them on a vendor-defined
  HID interface (Windows lists it as `MI_04`, "HID-compliant vendor-defined device"; the
  app's own device table gives it usage page `0xFF01`).
- Two units share the id, so a capture tells them apart only by USB address, which
  changes when a unit is replugged. Capture one unit at a time and note which one it was.

## One-time setup

1. Install **USBPcap** (it ships with Wireshark's installer as an optional component, or
   on its own from <https://desowin.org/usbpcap/>). Reboot when it asks; the filter driver
   attaches at boot.
2. Open an **administrator** terminal; capturing needs it.
3. List the root hubs and the devices on them, and note the `USBPcapN` the unit hangs
   off and its address:

   ```
   "C:\Program Files\USBPcap\USBPcapCMD.exe"
   ```

   It is interactive and lists every device with its address. Pick the unit, not its hub:
   **a capture of a whole hub includes your keyboard**, and what you type is in the file.

## One capture

Close the Azeron app first, so the capture starts from a known state, then:

```
USBPcapCMD.exe -d \\.\USBPcap1 -o baseline.pcap --devices 4 --inject-descriptors
```

(`--devices` takes the address from step 3. `--inject-descriptors` writes the descriptors
of devices that are already plugged in at the start, which is what gives the capture the
unit's id and the HID report descriptor without replugging it. Check the flags with
`USBPcapCMD.exe --help`; they have moved between versions.)

While it runs: open the Azeron app, wait for the unit to appear, then do **one** thing and
nothing else. Stop the capture with Ctrl+C.

## Finding the protocol

Capture the same short sequence twice with exactly one setting different, then diff them:

```
npm run azeron -- hidcap devices baseline.pcap
npm run azeron -- hidcap decode baseline.pcap --usb-device 4
npm run azeron -- hidcap diff baseline.pcap led-brightness-50.pcap --usb-device 4
```

`devices` lists the addresses in the file, and the unit's id when the descriptors were
captured. `decode` prints the HID conversation: reports the app set (`set-report`),
asked for (`get-report`), and the interrupt traffic each way. `diff` prints the payloads
only the second capture has, and the **byte offsets that moved**: that is where the setting
lives.

Good first settings, because each is one value and fully reversible in the app:

1. LED brightness: 0, then 50, then 100 (three captures; the offset that tracks the value).
2. LED on / off.
3. A single control's label, then a single control's key. Not a profile import: it is
   many fields at once.

Name each file for what it holds (`led-brightness-50.pcap`), and write down the app version
(2.0.2) and the unit's firmware as shown in the app.

## What the output can and cannot tell you

- A **control transfer** states its report type and id in the setup packet, so
  `set-report feature id 0x05` is exact.
- An **interrupt transfer** has no such field. Its first byte is the report id only when
  the HID report descriptor numbers its reports; the descriptor is in the capture only if
  `--inject-descriptors` (or a replug) put it there, and `decode` shows a `get-descriptor
HID report` event for it. Until then the bytes are raw.
- Input noise: a held key or a moved stick is interrupt traffic too. Keep your hands off
  the unit during a capture you mean to diff, or narrow with `--endpoint 0x84`.
- `diff` compares whole payloads. A counter or timestamp in a report shows as a changed
  byte in every capture; a byte that moves with no setting changed is not the setting.

## Rules

- **Listen, never ask.** Do not replay a captured request at a unit, and do not write a
  tool that sends one until the protocol is read and a unit's profile is backed up (export
  it from the app). The pedals were hung by a single `GET_REPORT`; the keypads' configuration
  channel is less forgiving than that.
- Never send anything on the firmware or bootloader path (`dfu-util`, the STM32 bootloader
  driver). That is not configuration.
- A capture file holds what the unit sent, including the keys you pressed. Keep them out of
  the repo (`*.pcap` is not committed) and do not share one without reading it first.

## Not yet verified

The reader follows USBPcap's documented packet layout and is tested against files built to
it. It has not yet been run against a capture from a real machine: the first real file may
expose a stage or field it does not handle. `azeron hidcap decode` reports a truncated file
and the number of records it could not read rather than dropping them silently.
