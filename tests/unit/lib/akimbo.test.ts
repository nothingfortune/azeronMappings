/**
 * Constraints on the akimbo v6 pair, from the two failures recorded on 2026-09-28: the
 * right hand carried too few bindings to play without a gamepad, and mirrored positions
 * carried unrelated roles.
 *
 * v7 is the layout as edited on the units; its departures are recorded as
 * acknowledgements in game.yaml rather than asserted here.
 */

import { describe, expect, it } from "vitest";

import { checkSet, iterBindings } from "../../../src/lib/lint.js";
import { loadProfile } from "../../../src/lib/io.js";
import { Game } from "../../../src/lib/model.js";
import type { Profile } from "../../../src/lib/model-core.js";

const PAIR = [
  "games/SpaceSims/everspace/profiles/akimbo-v6-left.yaml",
  "games/SpaceSims/everspace/profiles/akimbo-v6-right.yaml",
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
  it("binds every action a keypad can send", () => {
    const all = new Set<string>();
    for (const profile of profiles) for (const action of bound(profile)) all.add(action);
    const expected = Object.entries(game.actions.actions)
      .filter(([, spec]) => !spec.provided_by)
      .map(([id]) => id);
    expect(expected.filter((id) => !all.has(id))).toEqual([]);
  });

  it("gives neither hand so little to do that a gamepad looks appealing", () => {
    const counts = profiles.map((profile) => bound(profile).size);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(15);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(6);
  });

  it("puts the same role at the same position on both hands", () => {
    const findings = checkSet(profiles, game.actions);
    expect(findings.filter((finding) => finding.rule === "akimbo-role-mismatch")).toEqual([]);
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

  it("needs no excuse for any of the layout rules", () => {
    // The draft is allowed one acknowledgement -- that the right unit's pin map has not
    // been press-tested -- and no others. An ergonomic rule quieted on this profile
    // would mean the layout is wrong, not that the device is unknown.
    const layoutRules = (game.lintConfig.acknowledged ?? [])
      .filter((ack) => (ack.profile ?? "").startsWith("akimbo-v6"))
      .map((ack) => ack.rule)
      .filter((rule) => rule !== "unverified-device");
    expect(layoutRules).toEqual([]);
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
