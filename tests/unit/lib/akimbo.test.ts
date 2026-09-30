/**
 * Constraints on the live akimbo pair, from the two failures recorded on 2026-09-28: the
 * right hand carried too few bindings to play without a gamepad, and mirrored positions
 * carried unrelated roles.
 *
 * Departures the layout has earned are recorded as acknowledgements in game.yaml rather
 * than asserted here.
 */

import { describe, expect, it } from "vitest";

import { applyAcknowledgements, checkSet, iterBindings } from "../../../src/lib/lint.js";
import { loadProfile } from "../../../src/lib/io.js";
import { Game } from "../../../src/lib/model.js";
import type { Profile } from "../../../src/lib/model-core.js";

const PAIR = [
  "games/SpaceSims/everspace/profiles/akimbo-v9-left.yaml",
  "games/SpaceSims/everspace/profiles/akimbo-v9-right.yaml",
];

const game = new Game("games/SpaceSims/everspace");
const profiles = PAIR.map((path) => loadProfile(path, game));

const bound = (profile: Profile): Set<string> => {
  const actions = new Set<string>();
  for (const binding of iterBindings(profile)) {
    if (binding.action) actions.add(binding.action);
  }
  return actions;
};

describe("the akimbo pair", () => {
  it("binds every action the game requires", () => {
    // The vocabulary also carries optional actions -- firing sits on a mouse in a
    // keypad-plus-mouse setup -- so coverage is measured against what is required.
    const all = new Set<string>();
    for (const profile of profiles) for (const action of bound(profile)) all.add(action);
    const required = Object.entries(game.actions.actions)
      .filter(([, spec]) => (spec.tags ?? []).includes("required") && !spec.provided_by)
      .map(([id]) => id);
    expect(required.filter((id) => !all.has(id))).toEqual([]);
  });

  it("gives neither hand so little to do that a gamepad looks appealing", () => {
    const counts = profiles.map((profile) => bound(profile).size);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(15);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(6);
  });

  it("puts the same role at the same position on both hands, or says why not", () => {
    // The pair specialises the hands, which the rule catches by design. Each departure is
    // a line in game.yaml with a reason; an undeclared one is the 2026-09-28 failure again.
    const findings = checkSet(profiles, game.actions);
    const { live } = applyAcknowledgements(findings, game.lintConfig.acknowledged ?? []);
    expect(live.filter((finding) => finding.rule === "akimbo-role-mismatch")).toEqual([]);
  });

  it("never delays a tap or latches a key", () => {
    for (const profile of profiles) {
      for (const [position, spec] of Object.entries(profile.positions)) {
        expect(spec.long, `${profile.slug}:${position}`).toBeUndefined();
        expect(spec.double, `${profile.slug}:${position}`).toBeUndefined();
        expect(spec.hold, `${profile.slug}:${position}`).toBeFalsy();
      }
    }
  });

  it("needs no excuse for the rules that came from a lost fight", () => {
    // Which hand does which job is a layout choice, and reaching an action from two
    // positions is a convenience -- both may be argued for in game.yaml. These five are
    // not: each one cost input in play, so an acknowledgement here would mean the layout
    // is wrong rather than unusual.
    const unexcusable = [
      "stick-not-keyboard",
      "combat-tap-delayed",
      "menu-with-combat",
      "hold-on-movement",
      "missing-required",
    ];
    const excused = (game.lintConfig.acknowledged ?? [])
      .filter((ack) => (ack.profile ?? "").startsWith("akimbo-v9"))
      .map((ack) => String(ack.rule))
      .filter((rule) => unexcusable.includes(rule));
    expect(excused).toEqual([]);
  });

  it("is built on a press-tested map of the right unit", () => {
    // The right unit is not a 1:1 mirror -- its thumb cluster is rotated half a turn --
    // so this profile is only meaningful against a map someone actually pressed.
    expect(profiles[1]?.device.verified).toBe(true);
  });

  it("never applies two corrections for the same stick rotation", () => {
    for (const profile of profiles) {
      const device = profile.device;
      const bothSet =
        device.stickAngle !== undefined && Object.keys(device.stickDirections).length > 0;
      expect(bothSet, `${device.name}: the two cancel each other out`).toBe(false);
    }
  });
});
