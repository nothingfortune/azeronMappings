/** Rudder pedals and the other analog devices that are not Azeron keypads. */

/**
 * Where an axis sits when nothing is touching it.
 *
 * `centre` springs back to the middle of its travel, as a rudder does. `end` rests at one
 * end and is pressed towards the other, as a toe brake does. The distinction is the whole
 * of the toe-brake question: a game axis that expects a centred -1..+1 range reads a toe
 * at rest as a full deflection one way.
 */
export type PedalRest = "centre" | "end";

/**
 * How far to trust a game name for an axis.
 *
 * - `confirmed`: the axis was flown and does what the name says. Nothing is, yet.
 * - `inferred`: reasoned from evidence -- the order the game enumerates a device's axes --
 *   and not flown. Written by hand, with the reasoning in `note`.
 * - `unconfirmed`: the name is real (the game registers it) but which pedal axis it is has
 *   not been established -- which of two toes is which.
 * - `bound`: written by `--capture-pedals` from a file where someone bound that axis in the
 *   game's own screen. It records what the game wrote, not that the right pedal was moved:
 *   a toe brake rests at the end of its travel, so touching it wins a capture meant for the
 *   rudder, and the file says so only if the layout is asked.
 * - `candidate`: a hand-written guess with nothing behind it.
 *
 * Generation writes any of them into the game's file and says which it was using.
 */
export type NameStatus = "confirmed" | "inferred" | "unconfirmed" | "bound" | "candidate";

/** What the game calls one axis, and how sure we are. */
export interface PedalName {
  name: string;
  status: NameStatus;
  /** Where it came from, for whoever has to decide whether to trust it. */
  note?: string;
}

export interface PedalAxisData {
  label?: string;
  rest: PedalRest;
  /**
   * For an axis that rests at an end: which one, as measured. `min` reads -1.0 at rest and
   * +1.0 fully pressed, which a game axis read about a centre sees as a full deflection.
   */
  rest_end?: "min" | "max";
  /**
   * For an axis that rests at an end: `centre` when a Windows calibration has been set and
   * seen to make the rest position read 0.0 and a full press +1.0 -- half an axis, which is
   * what a throttle is. The calibration lives in the machine's registry, not in the repo;
   * this records that it is there, so the axis is no longer treated as a full deflection
   * with the foot off.
   */
  calibrated_rest?: "centre";
  /**
   * The name the game gives this axis, per game slug -- `JS<index>_<Device>_Axis<n>` in
   * Everspace 2, with the status that says how far to trust it. A name is never invented:
   * it is read from a file the game wrote, or reasoned from evidence and marked so.
   */
  names?: Record<string, PedalName>;
}

/** A pedal-like analog device: no pins, only axes. */
export interface PedalsDeviceData {
  device: string;
  kind: "pedals";
  name?: string;
  /** What the hardware reports itself as, which is not always what it is sold as. */
  reports_as?: string;
  usb?: { vendor_id: string; product_id: string };
  /**
   * The inputs a game registers for this device, per game slug, as its own log lists them.
   * The names are confirmed; which axis each is, is what `names` says and how sure it is.
   * When present, no axis may carry a name outside it.
   */
  inputs?: Record<string, string[]>;
  axes: Record<string, PedalAxisData>;
}

/** What one pedal axis does in a layout. */
export interface PedalAssignment {
  /** A game axis in the genre's vocabulary: thrust, vertical, strafe, yaw, pitch, roll. */
  drives: string;
  /**
   * For a pedal that is half an axis -- a toe brake, which rests at zero and is pressed one
   * way: which end of the game axis it drives. `up` is the axis's up end ("Hover up",
   * "Thrust forward"), `down` the other. The pedal is then written onto the game's own row
   * for that direction, not onto the axis row, so two toes can drive the two ends of one
   * axis. An assignment with an end has no `invert` or `scale`: the end is the direction.
   */
  end?: "up" | "down";
  /** Written to `bInvert` on the game's row when set; left as the game has it otherwise. */
  invert?: boolean;
  /** `DeadZone`. */
  dead_zone?: number;
  /** `Scale`. */
  scale?: number;
  /** `Sensitivity`. */
  sensitivity?: number;
  /** `Exponent`. */
  exponent?: number;
  /**
   * Two pedal axes may drive one game axis only when every one of them says so. The game
   * row has two slots (Key1 and Key2), so two fit; the row's invert, scale and the rest
   * are shared between them.
   */
  shared?: boolean;
  note?: string;
}

/** What a layout's pedals do. */
export interface SetPedals {
  /** A `devices/<name>.yaml` with `kind: pedals`. */
  device: string;
  /** Pedal axis -> what it does. Axes not listed do nothing. */
  assign: Record<string, PedalAssignment>;
}

export interface SetLayout {
  pedals?: SetPedals;
  /**
   * The modes of play this layout is for, in a game that has them (Elite Dangerous's
   * `ship`, `srv`, `foot`, ...). The layout shows and checks only actions in these modes,
   * and actions in modes no layout plays together may share a key. Absent: every action.
   */
  modes?: string[];
}

/** A game's `sets.yaml`: the parts of a layout that belong to no single profile. */
export interface SetsData {
  sets: Record<string, SetLayout>;
}
