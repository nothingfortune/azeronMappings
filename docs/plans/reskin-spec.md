# Editor reskin: design spec

What the reskin in `src/editor/styles.ts` and `probe-styles.ts` is built on. It changes how the
editor looks, never what it does: no class, id or `data-*` is renamed or removed.

## Tokens

Defined once each in `LIGHT` and `DARK`; print re-applies `LIGHT`, so every themed token lives
inside those two strings. Dark is the main theme.

| Token                        | Dark                  | Light                 | Use                                            |
| ---------------------------- | --------------------- | --------------------- | ---------------------------------------------- |
| `--bg`                       | `#0d1015`             | `#eef1f5`             | the page                                       |
| `--panel`                    | `#151920`             | `#ffffff`             | panels, the header, cards                      |
| `--raised`                   | `#1c212a`             | `#ffffff`             | buttons, chips, anything that is pressed       |
| `--sunken`                   | `#0f1218`             | `#e7ebf0`             | text boxes, wells, the thumb groups            |
| `--hover`                    | `#232a35`             | `#f1f4f8`             | a raised surface under the pointer             |
| `--fg` / `--muted`           | `#e9edf3` / `#98a2b3` | `#12161c` / `#566070` | text, secondary text                           |
| `--line` / `--line-strong`   | `#272e39` / `#3a4352` | `#d6dce4` / `#b6c0cc` | borders; hover borders                         |
| `--accent` / `--accent-fg`   | `#4fb3ff` / `#061320` | `#0b74b8` / `#ffffff` | primary action, selection, focus               |
| `--key-top` / `--key-bottom` | `#252b36` / `#1c212a` | `#ffffff` / `#f0f3f7` | the keycap's face                              |
| `--shadow-1..3`              |                       |                       | resting, lifted (menus, cards on hover), modal |

Roles (`--combat`, `--movement`, `--menu`, `--travel`, `--utility`) and states (`--error`,
`--warn`, `--ok`) are eight distinct hues: coral, mint, violet, amber, slate; crimson, yellow,
lime. Each is at least 4.7:1 against `--bg`, `--panel` and `--raised` in both themes, and
`--panel` text on each (an active role switch) is at least 5.3:1.

The one accent is kept for the primary button, the selected key, the current tab and focus.

## Scales

- Type: 12 / 13 / 15 / 18 / 24, with 10-11px only for a key's position label and captions.
  Nothing renders under 9px. One system stack: Segoe UI Variable, Segoe UI, system-ui.
- Weights: 700 titles, 600 labels and key names, 400 secondary text.
- Spacing: multiples of 4. Radii: 6 (chips, inputs), 10 (keys, buttons, cards), 14 (panels, hands).
- Motion: 150ms on hover and selection only; none under `prefers-reduced-motion`.

## The key

A keycap on a plate. The hand is the plate (a panel with an inner shade); each key is a face
(`--key-top` to `--key-bottom`), a 1px edge, a 2px darker lip along its bottom and a highlight
along its top, so it reads as raised. The role is a 3px stripe down its left edge, as before.
Position label 10px muted, action name 11-12px 600.

| State     | Look                                                                      |
| --------- | ------------------------------------------------------------------------- |
| hover     | border `--line-strong`, face one step lighter                             |
| selected  | 2px accent outline offset 2px, accent-tinted face                         |
| empty     | no face, dashed border, label muted; on hover the dashed border is accent |
| drag-over | solid accent outline and an accent-tinted face                            |
| focus     | the focus ring (2px accent outline)                                       |
| stale     | inset warn ring and the "≠ unit" tag, as before                           |

The stick is a dial: four direction cells around a round knob with a ring of eight ticks.

## Component states

Every button, select, chip and card follows one pattern: hover lifts the border to
`--line-strong` and the surface to `--hover`; active presses it to `--sunken`; focus-visible
draws the accent ring; disabled is 45% opacity with no hover; selected/current is accent.
