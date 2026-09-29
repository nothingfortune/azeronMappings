/** Linter behaviour: no findings on the baseline, and detection of each known failure. */

import { beforeEach, describe, expect, it } from "vitest";

import { ERROR, WARNING, checkProfile, checkSet, lintGame } from "../../../src/lib/lint.js";
import type { Finding } from "../../../src/lib/lint.js";
import { loadProfile } from "../../../src/lib/io.js";
import { Game } from "../../../src/lib/model.js";
import { Profile } from "../../../src/lib/model-core.js";
import type { ProfileData } from "../../../src/types/profile.js";

const SINGLE_V5 = "games/SpaceSims/everspace/profiles/single-v5.yaml";

describe("the everspace baseline", () => {
  it("has no live findings", () => {
    const result = lintGame(new Game("games/SpaceSims/everspace"));
    expect(result.live.map((finding) => `${finding.rule} ${finding.message}`)).toEqual([]);
  });

  it("still lists its acknowledged findings rather than hiding them", () => {
    const result = lintGame(new Game("games/SpaceSims/everspace"));
    expect(result.acknowledged.length).toBeGreaterThan(0);
    for (const { ack } of result.acknowledged) expect(ack.reason).toBeTruthy();
  });
});

describe("rules catch the known failures", () => {
  let game: Game;
  let base: Profile;

  beforeEach(() => {
    game = new Game("games/SpaceSims/everspace");
    base = loadProfile(SINGLE_V5, game);
  });

  const mutate = (change: (data: ProfileData) => void): Finding[] => {
    const data = structuredClone(base.data);
    change(data);
    const profile = new Profile(data, base.device, { path: base.path, game });
    return checkProfile(profile, game.actions, game.lintConfig);
  };

  const rules = (findings: Finding[], level: string): string[] =>
    findings.filter((finding) => finding.level === level).map((finding) => finding.rule);

  it("errors on a stick in gamepad mode", () => {
    const findings = mutate((data) => {
      const stick = data.positions.stick;
      if (stick) stick.mode = "gamepad";
    });
    expect(rules(findings, ERROR)).toContain("stick-not-keyboard");
  });

  it("warns when a movement action latches", () => {
    const findings = mutate((data) => {
      const boost = data.positions.index_3;
      if (boost) boost.hold = true;
    });
    expect(rules(findings, WARNING)).toContain("hold-on-movement");
  });

  it("warns about Escape on a consumable, the v3 failure", () => {
    const findings = mutate((data) => {
      const consumable = data.positions.pinky_1;
      if (consumable) consumable.double = "escape_menu";
    });
    expect(rules(findings, WARNING)).toContain("menu-with-combat");
    expect(rules(findings, WARNING)).toContain("combat-tap-delayed");
  });

  it("errors on a key no action declares", () => {
    const findings = mutate((data) => {
      const position = data.positions.pinky_1;
      if (position) position.tap = { key: "KeyZ" };
    });
    expect(rules(findings, ERROR)).toContain("unbound-key");
  });

  it("errors when a required action is bound nowhere", () => {
    const data = structuredClone(base.data);
    delete data.positions.index_3; // boost
    const profile = new Profile(data, base.device, { path: base.path, game });
    expect(rules(checkSet([profile], game.actions), ERROR)).toContain("missing-required");
  });

  it("warns when an akimbo pair puts unrelated roles on the same position", () => {
    const left = new Profile(structuredClone(base.data), base.device, { path: base.path, game });
    const rightData = structuredClone(base.data);
    rightData.profile.device = "cyborg2-right";
    rightData.profile.unit = "right";
    const position = rightData.positions.pinky_1;
    if (position) position.tap = "map"; // menu where the left hand has combat
    const right = new Profile(rightData, base.device, { path: base.path, game });
    expect(rules(checkSet([left, right], game.actions), WARNING)).toContain("akimbo-role-mismatch");
  });
});

describe("encoding", () => {
  it("applies role rules to a binding written as raw tokens", () => {
    // single-v5 holds Shift as the legacy "16", so boost is a raw slot rather than an
    // action id. The movement rules must still see it as boost.
    const game = new Game("games/SpaceSims/everspace");
    const base = loadProfile(SINGLE_V5, game);
    const data = structuredClone(base.data);
    const boost = data.positions.index_3;
    expect(boost?.tap).not.toBe("boost");
    if (boost) boost.hold = true;
    const profile = new Profile(data, base.device, { path: base.path, game });
    const findings = checkProfile(profile, game.actions, game.lintConfig);
    expect(findings.map((finding) => finding.rule)).toContain("hold-on-movement");
  });
});
