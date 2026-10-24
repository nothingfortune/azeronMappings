/** Linter behaviour: no findings on the baseline, and detection of each known failure. */

import { beforeEach, describe, expect, it } from "vitest";

import {
  ERROR,
  WARNING,
  checkProfile,
  checkSet,
  lintGame,
  lintProfiles,
} from "../../../src/lib/lint.js";
import type { Finding } from "../../../src/lib/lint.js";
import { loadProfile } from "../../../src/lib/io.js";
import { Game } from "../../../src/lib/model.js";
import { ActionSet, Profile } from "../../../src/lib/model-core.js";
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

  it("warns on a key labelled with another action's name, which the unit would show", () => {
    const findings = mutate((data) => {
      const key = data.positions.pinky_1;
      if (key) key.label = "Inventory";
    });
    const found = findings.filter((finding) => finding.rule === "label-names-other-action");
    expect(found.map((finding) => [finding.level, finding.position])).toEqual([
      [WARNING, "pinky_1"],
    ]);
    expect(found[0]?.message).toContain("'inventory'");
    expect(found[0]?.message).toContain("'consume_1'");
  });

  it("leaves a key's own name alone, and its action's name in another case", () => {
    const findings = mutate((data) => {
      const key = data.positions.pinky_1;
      if (key) key.label = "Heal (spam)";
      const other = data.positions.index_1;
      if (other) other.label = "HOVER UP";
    });
    expect(findings.map((finding) => finding.rule)).not.toContain("label-names-other-action");
  });

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

  it("warns when boost waits for a long press, which constraint 4 names outright", () => {
    // The rule used to check only the combat tag, and boost is a movement action -- so the
    // one action the constraint names by name was the one it could not see.
    const findings = mutate((data) => {
      const boost = data.positions.index_3;
      if (boost) boost.long = "fling";
    });
    expect(rules(findings, WARNING)).toContain("combat-tap-delayed");
  });

  it("warns when a flight key opens a menu if it is held", () => {
    // A flight key is held rather than mashed. Past the long-press window the menu opens.
    const findings = mutate((data) => {
      const boost = data.positions.index_3;
      if (boost) boost.long = "map";
    });
    expect(rules(findings, WARNING)).toContain("menu-with-combat");
  });

  it("leaves a utility key with a long press alone", () => {
    const findings = mutate((data) => {
      const position = data.positions.pinky_1;
      if (position) {
        position.tap = "headlight";
        position.long = "toggle_hud";
      }
    });
    const here = findings.filter((finding) => finding.position === "pinky_1");
    expect(rules(here, WARNING)).not.toContain("combat-tap-delayed");
  });

  it("errors on a mouse button no action declares, as the binding sheet already did", () => {
    // The rule only looked at slots with a `key`, so an inline mouse button was never
    // checked. A vocabulary without a right-button action makes one undeclared.
    const data = structuredClone(base.data);
    const position = data.positions.pinky_1;
    if (position) position.tap = { mouse: "right" };
    const withoutRight = new ActionSet({
      actions: Object.fromEntries(
        Object.entries(game.actions.actions).filter(([id]) => id !== "fire_secondary"),
      ),
    });
    const profile = new Profile(data, base.device, { path: base.path, game });
    const here = checkProfile(profile, withoutRight, game.lintConfig).filter(
      (finding) => finding.position === "pinky_1",
    );
    expect(rules(here, ERROR)).toContain("unbound-key");
  });

  it("does not read a raw mouse button as the keyboard key with the same number", () => {
    // Button 4 read as a key was "4" -- which could collide with whatever a key token of
    // 4 means, or be reported as a key. It is a mouse button.
    const findings = mutate((data) => {
      const position = data.positions.pinky_1;
      if (position) position.tap = { type_raw: "15", key_raw: "4" };
    });
    const message = findings.find(
      (finding) => finding.position === "pinky_1" && finding.rule === "unbound-key",
    )?.message;
    expect(message).toContain("mouse:4");
  });

  it("errors when a kept type code would override a new binding", () => {
    // v5's thumb pad keeps raw.types ["1", "1", "6"]. Binding its double tap used to
    // compile with type "6" and lint clean -- and the key did nothing in game.
    const findings = mutate((data) => {
      const pad = data.positions.dpad_up;
      if (pad) pad.double = "map";
    });
    const here = findings.filter((finding) => finding.position === "dpad_up");
    expect(rules(here, ERROR)).toContain("raw-types-stale");
  });

  it("errors on a tap put on a stick, or directions put on a key", () => {
    const findings = mutate((data) => {
      const stick = data.positions.stick;
      if (stick) stick.tap = "boost";
      const key = data.positions.pinky_1;
      if (key) key.directions = { up: "boost" };
    });
    const misplaced = findings.filter((finding) => finding.rule === "misplaced-binding");
    expect(new Set(misplaced.map((finding) => finding.position))).toEqual(
      new Set(["pinky_1", "stick"]),
    );
  });

  it("errors on a key no action declares", () => {
    const findings = mutate((data) => {
      const position = data.positions.pinky_1;
      // Every letter is declared now that the vocabulary covers every live game row.
      if (position) position.tap = { key: "F12" };
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

describe("linting part of a game", () => {
  it("does not call another profile's acknowledgements stale", () => {
    // The editor lints one layout. The golden profile's acknowledgements match nothing in
    // it, and were reported stale -- with "delete it" -- which would have broken lint for
    // the profile they belong to.
    const game = new Game("games/SpaceSims/everspace");
    const live = game.loadedProfiles().filter((profile) => profile.set !== "single-v5");
    const result = lintProfiles(game.actions, live, game.lintConfig);
    expect(result.live.filter((finding) => finding.rule === "stale-acknowledgement")).toEqual([]);
  });

  it("still reports one that is stale for a profile it did lint", () => {
    const game = new Game("games/SpaceSims/everspace");
    const config = {
      ...game.lintConfig,
      acknowledged: [
        ...(game.lintConfig.acknowledged ?? []),
        { profile: "single-v5", rule: "hold-on-movement", position: "pinky_1", reason: "x" },
      ],
    };
    const result = lintProfiles(game.actions, game.loadedProfiles(), config);
    expect(result.live.some((finding) => finding.rule === "stale-acknowledgement")).toBe(true);
  });
});
