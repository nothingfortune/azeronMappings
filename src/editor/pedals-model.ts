/**
 * What the editor knows about a layout's pedals, apart from how it draws them.
 *
 * Plain functions over plain data so they can be tested without a page: the words the UI
 * uses for axes and for how far a game name is trusted, how the sticks read once pedals are
 * part of the layout, what a freshly added set of pedals does, and the one comparison that
 * says whether the pedals have unsaved edits.
 */

import type { LayoutContext } from "../lib/lint.js";
import { canonical } from "../lib/setsfile.js";
import { axesOnSticks, detectStickModes, pedalAxes } from "../lib/stickmodes.js";
import type { StickModeSet } from "../lib/stickmodes.js";
import type {
  NameStatus,
  PedalAssignment,
  PedalAxisData,
  PedalsDeviceData,
  SetPedals,
  SetsData,
} from "../types/pedals.js";
import type { PositionSpec } from "../types/profile.js";

/** What a game axis is called on screen. An axis this table does not know keeps its id. */
const GAME_AXIS_LABELS: Record<string, string> = {
  thrust: "Thrust",
  vertical: "Hover",
  strafe: "Strafe",
  yaw: "Turn (yaw)",
  pitch: "Pitch",
  roll: "Roll",
};

/** Said beside the name where there is room, so "Hover" is not a riddle. */
const GAME_AXIS_HINTS: Record<string, string> = {
  thrust: "forward and back",
  vertical: "up and down",
  strafe: "left and right",
  yaw: "turn the nose left and right",
  pitch: "nose up and down",
  roll: "bank left and right",
};

export function gameAxisLabel(axis: string): string {
  return GAME_AXIS_LABELS[axis] ?? axis;
}

export function gameAxisHint(axis: string): string {
  return GAME_AXIS_HINTS[axis] ?? "";
}

/** "Left toe brake" is the hardware's name; the editor says "Left toe". */
export function pedalAxisLabel(axis: string, spec: PedalAxisData | undefined): string {
  const label = spec?.label ?? axis;
  return label.replace(/\s+brake$/i, "");
}

/** How an axis behaves with nothing touching it, in a short sentence. */
export function restSentence(spec: PedalAxisData | undefined): string {
  if (spec === undefined) return "";
  if (spec.rest === "centre") return "Springs back to centre.";
  return spec.rest_end === "min"
    ? "Rests at the end of its travel: -1.0 at rest, +1.0 pressed."
    : "Rests at the end of its travel.";
}

/** How far to trust a game name, in words that do not claim more than the evidence. */
export function statusWords(status: NameStatus | null): { short: string; long: string } {
  switch (status) {
    case "confirmed":
      return { short: "Confirmed in flight", long: "Flown: the game's name does what it says." };
    case "inferred":
      return {
        short: "Inferred, not flown",
        long: "Reasoned from the order the game lists the device's axes. Not flown.",
      };
    case "unconfirmed":
      return {
        short: "Axis not established",
        long: "The game really has this name; which pedal axis it is has not been established.",
      };
    case "bound":
      return {
        short: "Read from the game, unchecked",
        long:
          "Recorded from a file where the axis was bound in the game's own screen. It shows what " +
          "the game wrote, not that this pedal was the one moved.",
      };
    case "candidate":
      return { short: "A guess", long: "Written by hand; nothing has shown it is right." };
    case null:
      return {
        short: "No game name yet",
        long: "No name is recorded for this axis in this game, so nothing is written for it.",
      };
  }
}

/** Whether the pedal drives a game axis the game reads about a centre, while resting at an end. */
export function restsOnCentred(
  spec: PedalAxisData | undefined,
  modes: StickModeSet | undefined,
  drives: string,
): boolean {
  if (spec?.rest !== "end") return false;
  const ends = modes?.axes[drives];
  return ends !== undefined && ends.centred !== false;
}

/** Which of the axes the pedals take (by default, yaw) some pedal in the layout drives. */
export function takenAxesCarried(
  modes: StickModeSet | undefined,
  pedals: SetPedals | undefined,
): { takes: readonly string[]; missing: string[] } {
  const takes = modes === undefined ? [] : pedalAxes(modes);
  const driven = new Set(Object.values(pedals?.assign ?? {}).map((entry) => entry.drives));
  return { takes, missing: takes.filter((axis) => !driven.has(axis)) };
}

/**
 * Whether the layout's pedals carry what the sticks give up.
 *
 * Not merely whether pedals exist: with the pedals present but nothing on yaw, a stick that
 * gave yaw up leaves the ship with no way to turn, and a stick that kept it is right. So the
 * with-pedals reading of the sticks follows the yaw assignment, which is what makes adding
 * or removing it change what the sticks are read as.
 */
export function pedalsCarry(
  modes: StickModeSet | undefined,
  pedals: SetPedals | undefined,
): boolean {
  if (pedals === undefined) return false;
  return takenAxesCarried(modes, pedals).missing.length === 0;
}

export interface StickReading {
  /** The mode's id, or null when the sticks match none of them. */
  mode: string | null;
  /** True when the sticks are in the mode's with-pedals variant. */
  pedals: boolean;
  /** The words for it: "Mode 2 (RC default), with pedals". */
  text: string;
}

/**
 * How the sticks read, given whether the layout's pedals carry the axis the sticks give up.
 *
 * The same eight directions can be two things: Mode 2 with pedals is exactly Mode 2, roll
 * for yaw. The sticks cannot say which; the layout can, and this asks it.
 */
export function readSticks(
  set: StickModeSet,
  left: PositionSpec | undefined,
  right: PositionSpec | undefined,
  carry: boolean,
): StickReading {
  const matches = detectStickModes(set, left, right);
  const label = (id: string): string => set.modes[id]?.label ?? id;
  const chosen = matches.find((match) => match.pedals === carry) ?? matches[0];
  if (chosen === undefined) return { mode: null, pedals: false, text: "custom" };
  if (chosen.pedals === carry) {
    return {
      mode: chosen.mode,
      pedals: carry,
      text: carry ? `${label(chosen.mode)}, with pedals` : label(chosen.mode),
    };
  }
  if (carry) {
    const kept = [...axesOnSticks(set, [left, right])].filter((axis) =>
      pedalAxes(set).includes(axis),
    );
    return {
      mode: chosen.mode,
      pedals: false,
      text: `${label(chosen.mode)}, plain (the sticks still send ${kept.join(", ") || "what the pedals carry"})`,
    };
  }
  return {
    mode: chosen.mode,
    pedals: true,
    text: `${label(chosen.mode)}, with-pedals variant (nothing carries what it gave up)`,
  };
}

/**
 * What a layout's pedals do the moment they are added: the axis that springs back to
 * centre takes what the pedals take (yaw), and everything else is left unassigned. A toe
 * is never assigned for the owner -- see the comments in sets.yaml.
 */
export function defaultPedals(
  name: string,
  device: PedalsDeviceData,
  modes: StickModeSet | undefined,
): SetPedals {
  const assign: Record<string, PedalAssignment> = {};
  const takes = modes === undefined ? [] : pedalAxes(modes);
  const centred = Object.entries(device.axes).filter(([, spec]) => spec.rest === "centre");
  takes.forEach((axis, index) => {
    const entry = centred[index];
    if (entry !== undefined) assign[entry[0]] = { drives: axis };
  });
  return { device: name, assign };
}

/** The names of every set whose pedals differ between two sets files. */
export function changedSets(loaded: SetsData, working: SetsData): string[] {
  const names = new Set([...Object.keys(loaded.sets), ...Object.keys(working.sets)]);
  return [...names].filter(
    (name) => canonical(loaded.sets[name]?.pedals) !== canonical(working.sets[name]?.pedals),
  );
}

/** Everything the pedal rules need to run against the layout on screen. */
export function layoutContext(
  game: string,
  sets: SetsData,
  devices: Readonly<Record<string, PedalsDeviceData>>,
  modes: StickModeSet | undefined,
): LayoutContext {
  const used: Record<string, PedalsDeviceData | undefined> = {};
  for (const layout of Object.values(sets.sets)) {
    const name = layout.pedals?.device;
    if (name !== undefined) used[name] = devices[name];
  }
  return { game, sets, devices: used, modes };
}
