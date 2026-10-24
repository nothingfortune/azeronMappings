/**
 * A pedal that is half an axis -- a toe brake -- drives one direction of a game axis, and is
 * written onto the game's own row for that direction, so two toes can be the two ends of
 * one axis: hover up on one foot, hover down on the other.
 */
import { describe, expect, it } from "vitest";

import { applyPedalRows, directionRow, joystickRows, parseInput } from "../../../src/lib/ingame.js";
import { loadPedalsDevice } from "../../../src/lib/io.js";
import { checkLayouts, lintProfiles } from "../../../src/lib/lint.js";
import type { LayoutContext } from "../../../src/lib/lint.js";
import { Game } from "../../../src/lib/model.js";
import { removeKey } from "../../../src/lib/object.js";
import { ActionSet } from "../../../src/lib/model-core.js";
import {
  PedalsError,
  gameRowFor,
  ingamePlan,
  parseSets,
  planAxes,
} from "../../../src/lib/pedals.js";
import { patchSetPedals } from "../../../src/lib/setsfile.js";
import type { StickModeSet } from "../../../src/lib/stickmodes.js";
import type { SetPedals, SetsData } from "../../../src/types/pedals.js";
import { LIVE_SET } from "../../helpers/fixtures.js";
import { AXIS0, AXIS1, AXIS2, withFlightStick } from "../../helpers/pedals.js";

const game = new Game("games/SpaceSims/everspace");
const foundModes = game.stickModes;
const loaded = loadPedalsDevice("logitech-pro-flight-pedals");
if (!foundModes || !loaded) throw new Error("the fixture has no stick modes or no pedals");
const modes: StickModeSet = foundModes;
const device = loaded.data;
const actions = game.actions.actions;
const profiles = game.loadedProfiles().filter((profile) => profile.set === LIVE_SET);

/** Hover on the two toes, a direction each, and the rudder on yaw. */
const TWO_TOES: SetPedals = {
  device: device.device,
  assign: {
    rudder: { drives: "yaw" },
    right_toe: { drives: "vertical", end: "up" },
    left_toe: { drives: "vertical", end: "down" },
  },
};

const sets = (pedals: SetPedals): SetsData => ({ sets: { [LIVE_SET]: { pedals } } });
const context = (pedals: SetPedals): LayoutContext => ({
  game: game.slug,
  sets: sets(pedals),
  devices: { [device.device]: device },
  modes,
  complete: false,
});

function apply(pedals: SetPedals, text = withFlightStick()) {
  const axes = planAxes(pedals, device, modes, actions, game.slug);
  const plan = ingamePlan(axes, device, modes, actions, game.slug);
  const done = applyPedalRows(parseInput(text), plan);
  return { ...done, rows: joystickRows(parseInput(done.text)) };
}

describe("which row a pedal lands on", () => {
  it("is the axis row for a whole axis, and the direction's own row for one end", () => {
    expect(gameRowFor("vertical", modes, actions)).toBe("MoveUp");
    expect(gameRowFor("vertical", modes, actions, "up")).toBe("MoveUp+");
    expect(gameRowFor("vertical", modes, actions, "down")).toBe("MoveUp-");
    expect(gameRowFor("strafe", modes, actions, "down")).toBe("MoveRight-");
    expect(gameRowFor("nonsense", modes, actions, "up")).toBeNull();
    expect(directionRow("Yaw", -1)).toBe("Yaw-");
  });

  it("finds those rows in the game's file: each axis has one for each way", () => {
    const rows = joystickRows(parseInput(withFlightStick()));
    expect(rows.get("MoveUp")?.isAxis).toBe(true);
    expect(rows.get("MoveUp+")).toMatchObject({ isAxis: false, scale: 1 });
    expect(rows.get("MoveUp-")).toMatchObject({ isAxis: false, scale: -1 });
  });
});

describe("two toes on the two ends of one axis", () => {
  it("are written onto the two direction rows, and the axis row is left alone", () => {
    const { rows, changes } = apply(TWO_TOES);
    expect(rows.get("MoveUp+")?.key).toBe(AXIS1);
    expect(rows.get("MoveUp-")?.key).toBe(AXIS0);
    expect(rows.get("MoveUp")?.key).toBe("None");
    expect(rows.get("Yaw")?.key).toBe(AXIS2);
    // The direction is the row's scale, which is not touched; nor is any invert.
    expect(rows.get("MoveUp-")?.scale).toBe(-1);
    expect(changes.map((change) => change.field).every((field) => field === "Key1")).toBe(true);
    expect(changes.map((change) => change.row).sort()).toEqual(["MoveUp+", "MoveUp-", "Yaw"]);
  });

  it("is a fixed point: applying to what was written changes nothing", () => {
    const first = apply(TWO_TOES);
    expect(apply(TWO_TOES, first.text).changes).toEqual([]);
  });

  it("moves a toe off a direction row the layout no longer uses", () => {
    const first = apply(TWO_TOES);
    const one: SetPedals = {
      ...TWO_TOES,
      assign: { rudder: { drives: "yaw" }, right_toe: { drives: "vertical", end: "up" } },
    };
    const { rows } = apply(one, first.text);
    expect(rows.get("MoveUp-")?.key).toBe("None");
    expect(rows.get("MoveUp+")?.key).toBe(AXIS1);
  });

  it("raise no finding: different rows, and calibrated toes rest at zero", () => {
    const bySet = new Map([[LIVE_SET, profiles]]);
    const rules = checkLayouts(context(TWO_TOES), game.actions, bySet).map((found) => found.rule);
    expect(rules).not.toContain("pedal-axis-assigned-twice");
    expect(rules).not.toContain("pedal-rest-on-centred");
  });

  it("are refused on the same end, which is one row", () => {
    const same: SetPedals = {
      ...TWO_TOES,
      assign: {
        right_toe: { drives: "vertical", end: "up" },
        left_toe: { drives: "vertical", end: "up" },
      },
    };
    const bySet = new Map([[LIVE_SET, profiles]]);
    const rules = checkLayouts(context(same), game.actions, bySet).map((found) => found.rule);
    expect(rules).toContain("pedal-axis-assigned-twice");
  });
});

describe("the file a layout's pedals are kept in", () => {
  it("takes an end, and refuses an invert or a scale beside one", () => {
    const parsed = parseSets(
      {
        sets: {
          a: { pedals: { device: "p", assign: { toe: { drives: "vertical", end: "down" } } } },
        },
      },
      "sets.yaml",
    );
    expect(parsed.sets.a?.pedals?.assign.toe).toEqual({ drives: "vertical", end: "down" });
    const bad = (extra: Record<string, unknown>) => () =>
      parseSets(
        {
          sets: {
            a: { pedals: { device: "p", assign: { toe: { drives: "vertical", ...extra } } } },
          },
        },
        "sets.yaml",
      );
    expect(bad({ end: "sideways" })).toThrow(PedalsError);
    expect(bad({ end: "up", invert: true })).toThrow(/direction in `end`/);
    expect(bad({ end: "up", scale: 2 })).toThrow(/direction in `end`/);
  });

  it("is patched with the end beside what the pedal drives", () => {
    const text =
      "sets:\n  a:\n    pedals:\n      device: p\n      assign:\n        rudder: {drives: yaw}\n";
    const patched = patchSetPedals(text, "a", {
      device: "p",
      assign: { rudder: { drives: "yaw" }, left_toe: { drives: "vertical", end: "down" } },
    });
    expect(patched).toContain("left_toe: {drives: vertical, end: down}");
    expect(patched).toContain("rudder: {drives: yaw}");
  });
});

describe("a required action that a pedal carries", () => {
  // Hover made required, and taken off every key: only the pedals can carry it.
  const hover = structuredClone(actions);
  for (const id of ["hover_up", "hover_down"]) {
    const spec = hover[id];
    if (!spec) throw new Error(id);
    spec.tags = [...(spec.tags ?? []).filter((tag) => tag !== "required"), "required"];
  }
  const required = new ActionSet({
    actions: hover,
    duplicate_key_allowlist: game.actions.duplicateKeyAllowlist,
  });
  const bare = profiles.map((profile) => {
    const copy = structuredClone(profile.data);
    for (const spec of Object.values(copy.positions)) {
      for (const slot of ["tap", "long", "double"] as const) {
        if (spec[slot] === "hover_up" || spec[slot] === "hover_down") removeKey(spec, slot);
      }
      for (const [direction, value] of Object.entries(spec.directions ?? {})) {
        if (value === "hover_up" || value === "hover_down") {
          if (spec.directions) removeKey(spec.directions, direction);
        }
      }
    }
    return new (profile.constructor as new (...args: unknown[]) => typeof profile)(
      copy,
      profile.device,
      { path: profile.path, game },
    );
  });
  const missing = (pedals: SetPedals | null): string[] =>
    lintProfiles(required, bare, {}, pedals === null ? undefined : context(pedals))
      .live.filter((found) => found.rule === "missing-required")
      .map((found) => /'([a-z_0-9]+)'/.exec(found.message)?.[1] ?? "");

  it("is missing when nothing carries it", () => {
    expect(missing(null)).toEqual(expect.arrayContaining(["hover_up", "hover_down"]));
  });

  it("is not missing when a pedal drives its end, and still is for the other end", () => {
    const up: SetPedals = {
      device: device.device,
      assign: { right_toe: { drives: "vertical", end: "up" } },
    };
    expect(missing(up)).toContain("hover_down");
    expect(missing(up)).not.toContain("hover_up");
    expect(missing(TWO_TOES)).not.toContain("hover_up");
    expect(missing(TWO_TOES)).not.toContain("hover_down");
  });

  it("is not missing at either end when a pedal drives the whole axis", () => {
    const whole: SetPedals = { device: device.device, assign: { rudder: { drives: "vertical" } } };
    expect(missing(whole)).not.toContain("hover_up");
    expect(missing(whole)).not.toContain("hover_down");
  });
});
