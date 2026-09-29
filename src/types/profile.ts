import type { Slot, StickDirection } from "./azeron.js";

/** A slot spec written as raw export tokens, for anything the schema cannot name. */
export interface RawSlotSpec {
  type_raw?: string;
  key_raw?: string;
  meta_raw?: string;
}

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
  directions?: Partial<Record<StickDirection, string | KeySlotSpec>>;
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
  turbo_interval?: number;
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
  lint?: LintConfig;
}

export type SlotName = Slot;
