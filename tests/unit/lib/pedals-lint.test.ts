/**
 * The mistakes pedals make possible, and the toe-brake warning. Contexts are built by hand
 * so each rule can be driven on its own; the live layout is checked against the real files.
 */

import { describe, expect, it } from "vitest";

import { checkLayouts, layoutContextFor, lintGame, lintProfiles } from "../../../src/lib/lint.js";
import type { Finding, LayoutContext } from "../../../src/lib/lint.js";
import { loadPedalsDevice } from "../../../src/lib/io.js";
import { Game } from "../../../src/lib/model.js";
import { Profile } from "../../../src/lib/model-core.js";
import { applyMode } from "../../../src/lib/stickmodes.js";
import type { SetsData } from "../../../src/types/pedals.js";

const game = new Game("games/SpaceSims/everspace");
const modes = game.stickModes;
if (!modes) throw new Error("no stick modes");
const loadedDevice = loadPedalsDevice("logitech-pro-flight-pedals");
if (!loadedDevice) throw new Error("no pedals device");
const device = loadedDevice.data;
const SET = "akimbo-v10";
const PROFILES = game.loadedProfiles().filter((profile) => profile.set === SET);

function context(sets: SetsData, devices = { [device.device]: device }): LayoutContext {
  return { game: game.slug, sets, devices, modes, complete: false };
}

function layout(
  assign: Record<string, Record<string, unknown>>,
  deviceName = device.device,
): SetsData {
  return { sets: { [SET]: { pedals: { device: deviceName, assign: assign as never } } } };
}

/** The set's two profiles with the sticks put into a mode, as the editor would. */
function withSticks(modeId: string, withPedals: boolean): Profile[] {
  const picked = modes?.modes[modeId];
  if (!picked) throw new Error(modeId);
  return PROFILES.map((profile) => {
    const hand = profile.unit === "left" ? "left" : "right";
    const stick = applyMode(profile.positions.stick, modes, picked, hand, withPedals);
    return new Profile(
      { ...profile.data, positions: { ...profile.positions, stick } },
      profile.device,
      { path: profile.path, game },
    );
  });
}

const run = (ctx: LayoutContext, profiles: readonly Profile[] = withSticks("mode2", true)) =>
  checkLayouts(ctx, game.actions, new Map([[SET, profiles]]));
const rules = (findings: readonly Finding[]) => findings.map((finding) => finding.rule);

describe("the live layout", () => {
  it("lints with no error and no warning that is not acknowledged", () => {
    const result = lintGame(new Game("games/SpaceSims/everspace"));
    expect(result.live.filter((f) => f.level === "error" || f.level === "warning")).toEqual([]);
  });

  it("binds no toe brake to a game axis, so there is no toe-brake warning to acknowledge", () => {
    const rule = (finding: Finding) => finding.rule === "pedal-rest-on-centred";
    const result = lintGame(game);
    expect(result.live.filter(rule)).toEqual([]);
    expect(result.acknowledged.filter((entry) => rule(entry.finding))).toEqual([]);
  });

  it("does not call an acknowledgement of a pedal rule stale when the caller gave no layouts", () => {
    // The editor lints without a layout context today; an acknowledgement for a rule that
    // did not run is not stale.
    const config = {
      acknowledged: [
        { profile: SET, rule: "pedal-rest-on-centred", position: "left_toe", reason: "x" },
      ],
    };
    const live = lintProfiles(game.actions, PROFILES, config);
    expect(live.live.filter((finding) => finding.rule === "stale-acknowledgement")).toEqual([]);
    // With the context it does run, and finds nothing to acknowledge.
    const withContext = lintProfiles(game.actions, PROFILES, config, layoutContextFor(game, false));
    expect(
      withContext.live.filter((finding) => finding.rule === "stale-acknowledgement").length,
    ).toBe(1);
  });

  it("is in Mode 2 with pedals, as the layout's pedals expect", () => {
    const found = rules(run(layoutContextFor(game, true), PROFILES));
    expect(found).not.toContain("pedal-duplicates-stick");
    expect(found).not.toContain("pedals-mode-without-pedals");
  });
});

describe("an axis assigned twice", () => {
  const twice = layout({ rudder: { drives: "yaw" }, left_toe: { drives: "yaw" } });

  it("is an error, naming both pedal axes", () => {
    const found = run(context(twice)).filter((f) => f.rule === "pedal-axis-assigned-twice");
    expect(found.length).toBe(1);
    expect(found[0]?.level).toBe("error");
    expect(found[0]?.message).toMatch(/rudder and left_toe both drive the game's 'Yaw'/);
  });

  it("is allowed when every one of them says shared", () => {
    const shared = layout({
      rudder: { drives: "yaw", shared: true },
      left_toe: { drives: "yaw", shared: true },
    });
    expect(rules(run(context(shared)))).not.toContain("pedal-axis-assigned-twice");
  });

  it("is not enough for one of them to say shared", () => {
    const half = layout({ rudder: { drives: "yaw", shared: true }, left_toe: { drives: "yaw" } });
    expect(rules(run(context(half)))).toContain("pedal-axis-assigned-twice");
  });

  it("must agree on tuning, because the game keeps one of each per row", () => {
    const apart = layout({
      rudder: { drives: "yaw", shared: true, invert: true },
      left_toe: { drives: "yaw", shared: true },
    });
    expect(rules(run(context(apart)))).toContain("pedal-shared-mismatch");
  });

  it("cannot be three", () => {
    const three = layout({
      rudder: { drives: "yaw", shared: true },
      left_toe: { drives: "yaw", shared: true },
      right_toe: { drives: "yaw", shared: true },
    });
    expect(run(context(three)).some((f) => f.message.includes("room for two"))).toBe(true);
  });
});

describe("a game axis that does not exist", () => {
  it("is an error on the pedal that names it", () => {
    const found = run(context(layout({ rudder: { drives: "warp" } }))).filter(
      (f) => f.rule === "pedal-unknown-game-axis",
    );
    expect(found.length).toBe(1);
    expect(found[0]?.position).toBe("rudder");
    expect(found[0]?.message).toMatch(/'warp'/);
  });

  it("includes an axis whose action the game has no row for", () => {
    const noRow = JSON.parse(JSON.stringify(modes)) as typeof modes;
    noRow.axes.ghost = { up: "escape_menu", down: "escape_menu" };
    const found = run({ ...context(layout({ rudder: { drives: "ghost" } })), modes: noRow });
    expect(rules(found)).toContain("pedal-unknown-game-axis");
  });
});

describe("a pedal axis the device does not have", () => {
  it("is an error", () => {
    const found = run(context(layout({ brake: { drives: "yaw" } })));
    expect(found.find((f) => f.rule === "pedal-unknown-axis")?.message).toMatch(
      /has no axis 'brake'/,
    );
  });
});

describe("pedals in a layout but no device", () => {
  it("is an error", () => {
    const found = run(context(layout({ rudder: { drives: "yaw" } }, "no-such-pedals"), {}));
    expect(rules(found)).toContain("pedals-no-device");
  });
});

describe("the toe-brake question", () => {
  it("warns when an axis that rests at an end is bound to a centred game axis", () => {
    const found = run(context(layout({ right_toe: { drives: "thrust" } })));
    const warning = found.find((f) => f.rule === "pedal-rest-on-centred");
    expect(warning?.level).toBe("warning");
    expect(warning?.position).toBe("right_toe");
    expect(warning?.message).toMatch(/full deflection/);
    // The device says where a toe rests, as measured, and the warning says so.
    expect(warning?.message).toMatch(/-1\.0 at rest/);
  });

  it("does not warn for the rudder, which springs back to centre", () => {
    expect(rules(run(context(layout({ rudder: { drives: "yaw" } }))))).not.toContain(
      "pedal-rest-on-centred",
    );
  });

  it("does not warn when the game axis is not centred", () => {
    const half = JSON.parse(JSON.stringify(modes)) as typeof modes;
    const thrust = half.axes.thrust;
    if (!thrust) throw new Error("fixture");
    thrust.centred = false;
    const found = run({ ...context(layout({ right_toe: { drives: "thrust" } })), modes: half });
    expect(rules(found)).not.toContain("pedal-rest-on-centred");
  });
});

describe("the sticks and the pedals", () => {
  const rudder = layout({ rudder: { drives: "yaw" } });

  it("warns when a pedal drives yaw and a stick still sends it", () => {
    const found = run(context(rudder), withSticks("mode2", false));
    expect(found.find((f) => f.rule === "pedal-duplicates-stick")?.message).toMatch(/'yaw'/);
  });

  it("is quiet when the sticks are in the with-pedals variant", () => {
    expect(rules(run(context(rudder), withSticks("mode2", true)))).not.toContain(
      "pedal-duplicates-stick",
    );
  });

  it("errors when the sticks gave up yaw for pedals the layout does not have", () => {
    // Mode 1 with pedals is a stick layout no plain mode has: yaw is gone from it.
    const found = run(context({ sets: {} }), withSticks("mode1", true));
    expect(found.find((f) => f.rule === "pedals-mode-without-pedals")?.level).toBe("error");
  });

  it("does not, for Mode 2 with pedals, which is also Mode 2 roll for yaw", () => {
    expect(rules(run(context({ sets: {} }), withSticks("mode2", true)))).not.toContain(
      "pedals-mode-without-pedals",
    );
  });

  it("is satisfied by a pedal that drives the axis the sticks gave up", () => {
    expect(rules(run(context(rudder), withSticks("mode1", true)))).not.toContain(
      "pedals-mode-without-pedals",
    );
  });
});

describe("a set that no profile belongs to", () => {
  it("is an error when linting the whole game", () => {
    const ctx = {
      ...context({ sets: { "ghost-v1": { pedals: { device: device.device, assign: {} } } } }),
      complete: true,
    };
    expect(rules(run(ctx))).toContain("pedals-set-unknown");
    expect(rules(run({ ...ctx, complete: false }))).not.toContain("pedals-set-unknown");
  });
});
