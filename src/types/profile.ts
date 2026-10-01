import type { Slot, StickDirection } from "./azeron.js";

/** A slot spec written as raw export tokens, for anything the schema cannot name. */
export interface RawSlotSpec {
  type_raw?: string;
  key_raw?: string;
  meta_raw?: string;
}

/**
 * A stick direction written inline: a key, a mouse button, or -- for a keycode this repo
 * cannot name -- the token verbatim. Every field is optional, so reading one never needs
 * a narrowing check.
 */
export type DirectionSpec = KeySlotSpec & RawSlotSpec;

/** A slot spec written as a key, a modifier, or a mouse button. */
export interface KeySlotSpec {
  key?: string | null;
  meta?: string | null;
  mouse?: string | null;
}

/** An action id, an inline binding, or nothing. */
export type SlotSpec = string | RawSlotSpec | KeySlotSpec | null;

export interface ActionSpec {
  label?: string;
  key?: string | null;
  meta?: string | null;
  mouse?: string | null;
  tags?: string[];
  /** Bound somewhere other than a keypad key (the unit's mouse sensor, the mouse). */
  provided_by?: string;
  axis?: string;
  note?: string;
  /**
   * The game's own name for this action -- the `Action=` field of its row in the game's
   * binding file -- so the game can be made to agree with this file rather than the two
   * being kept in step by hand.
   */
  ingame?: string;
  /**
   * Which half of an axis this action is, for a game action with two rows (Everspace 2's
   * `MoveRight` is one action: -1 strafes left, +1 right). Omitted for a single row.
   */
  ingame_scale?: number;
}

export interface DuplicateKeyAllowance {
  key: string;
  actions?: string[];
  reason?: string;
}

export interface ActionSetData {
  genre?: string;
  game?: string;
  /** Optional because a file may inherit its whole vocabulary from a genre. */
  actions?: Record<string, ActionSpec>;
  duplicate_key_allowlist?: DuplicateKeyAllowance[];
}

export interface PositionSpec {
  label?: string;
  tap?: SlotSpec;
  long?: SlotSpec;
  double?: SlotSpec;
  /** Stick only. */
  mode?: string;
  /**
   * An action id, an inline key, or -- for a direction whose keycode this repo does not
   * understand -- the token verbatim, so a build does not write 0 over it.
   */
  directions?: Partial<Record<StickDirection, string | DirectionSpec>>;
  feature_delay?: number;
  double_delay?: number;
  hold?: boolean;
  hold_long?: boolean;
  hold_double?: boolean;
  /**
   * Repeat the key while it is held, at `turbo_interval` milliseconds.
   *
   * A repeated key spends part of its time up, so for an action the game reads as
   * on/off -- thrust, for one -- it averages to less than a held key. That is the only
   * way to get a part-power press out of a digital key.
   */
  turbo?: boolean;
  turbo_long?: boolean;
  turbo_double?: boolean;
  /**
   * The interval, per slot. The export carries one for each, so a single field silently
   * collapsed a record that set two of them to whichever was read last.
   * `turbo_interval` is the tap's.
   */
  turbo_interval?: number;
  turbo_interval_long?: number;
  turbo_interval_double?: number;
  /** Type codes we cannot derive, preserved verbatim. */
  raw?: { types?: string[] };
}

export interface DevicePosition {
  pin: number;
  pin_two?: number;
  col?: string;
  row?: number;
  kind?: string;
  cluster?: string;
  side?: string;
}

export interface DeviceData {
  device: string;
  hand?: string;
  mirrored?: boolean;
  /** False until the pin map has been press-tested on this physical unit. */
  verified?: boolean;
  /** The id the Azeron software files this unit under in DevicesStorage. */
  software_device_id?: string;
  /**
   * Physical stick direction -> the direction field it drives in the export.
   *
   * The Azeron software is built for a left-handed unit; a mirrored unit does not
   * necessarily report the same directions. Absent means identity.
   */
  stick_directions?: Partial<Record<StickDirection, StickDirection>>;
  /**
   * Which physical push the firmware treats as zero degrees, and the rotation needed to
   * correct it. Measured by `azeron probe --stick`; `analogSettings.angle` is only
   * written when `stick_angle` is set, because the field's units are unverified.
   */
  stick_zero?: string;
  stick_angle?: number;
  /** Pins that exist in exports but whose physical key is unidentified. Never written. */
  unknown_pins?: number[];
  positions: Record<string, DevicePosition>;
}

export interface ProfileMeta {
  id?: string;
  name?: string;
  device: string;
  unit?: string;
  set?: string;
  template?: string;
  output?: string;
  /** True when this profile is a faithful decompile of its template. */
  golden?: boolean;
  /**
   * The unit's own optical sensor, which moves the system pointer.
   *
   * Two units both running their sensors drive the same pointer at once, so a pair
   * normally wants exactly one of them on. Inherited from the template when unset.
   */
  sensor?: boolean;
  /** One of the profile's sensitivity steps, in DPI. */
  dpi?: number;
  template_profile?: number;
}

export interface Acknowledgement {
  profile?: string;
  rule?: string;
  position?: string;
  key?: string;
  reason?: string;
}

export interface LintConfig {
  require_keyboard_stick?: boolean;
  acknowledged?: Acknowledgement[];
}

export interface ProfileData {
  profile: ProfileMeta;
  positions: Record<string, PositionSpec>;
  lint?: LintConfig;
}

export interface GameConfig {
  name?: string;
  slug?: string;
  genre?: string;
  template?: string;
  /**
   * A directory outside the repo that built profiles are copied to, in addition to
   * dist/. dist/ stays the committed copy; this is for wherever the game or the app
   * wants to find them.
   */
  export_to?: string;
  /** The game's own binding file, e.g. Everspace 2's Input.ini. */
  ingame_config?: string;
  /**
   * The binding-file categories whose keyboard rows this repo owns outright -- the ones
   * live while flying. Every row in them must have an action in `actions.yaml`, and
   * generating writes their keys from it. The others (menus, photo mode) are left alone.
   */
  ingame_owned_categories?: number[];
  /**
   * The layout whose pedals are written into the game's Joystick axis rows. The game has
   * one binding file, so one layout's control scheme is what it holds at a time.
   */
  ingame_set?: string;
  lint?: LintConfig;
}

export type SlotName = Slot;
