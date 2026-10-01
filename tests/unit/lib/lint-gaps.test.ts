/** Three ways a layout used to pass the linter while doing the wrong thing. */

import { beforeEach, describe, expect, it } from "vitest";

import { compileProfile } from "../../../src/lib/compile.js";
import { ERROR, applyAcknowledgements, checkProfile } from "../../../src/lib/lint.js";
import type { Finding } from "../../../src/lib/lint.js";
import { loadProfile, loadTemplate } from "../../../src/lib/io.js";
import { Game } from "../../../src/lib/model.js";
import { Profile } from "../../../src/lib/model-core.js";
import { lintFails } from "../../../src/lib/tasks.js";
import type { ProfileData } from "../../../src/types/profile.js";

const SINGLE_V5 = "games/SpaceSims/everspace/profiles/single-v5.yaml";

describe("rules", () => {
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
  const errors = (findings: Finding[]): string[] =>
    findings.filter((finding) => finding.level === ERROR).map((finding) => finding.rule);

  it("stick-not-keyboard sees a mode hidden in raw.types", () => {
    const template = loadTemplate("templates/everspace2-v5.json");
    const data = structuredClone(base.data);
    const stick = data.positions.stick;
    if (!stick) throw new Error("the baseline has a stick");
    stick.mode = "keyboard";
    stick.raw = { types: ["6", "11", "11"] };
    const profile = new Profile(data, base.device, { path: base.path, game });

    // The premise: the compiler really does send the raw code, whatever the mode says.
    const doc = compileProfile(profile, { template, actions: game.actions.actions });
    const pin = base.device.pinByPosition.stick;
    expect(doc.profiles[0]?.inputs.find((record) => record.pinOne === pin)?.types[0]).toBe("6");

    expect(errors(checkProfile(profile, game.actions, game.lintConfig))).toContain(
      "stick-not-keyboard",
    );
  });

  it("stick-not-keyboard leaves a raw.types that agrees with keyboard mode alone", () => {
    const findings = mutate((data) => {
      const stick = data.positions.stick;
      if (stick) stick.raw = { types: ["4", "11", "11"] };
    });
    expect(errors(findings)).not.toContain("stick-not-keyboard");
  });

  it("errors on a key position bound to an action the sensor provides", () => {
    const findings = mutate((data) => {
      const key = data.positions.index_1;
      if (key) key.tap = "pointer_x";
    });
    const found = findings.filter((finding) => finding.rule === "provided-action-bound");
    expect(found).toHaveLength(1);
    expect(found[0]?.level).toBe(ERROR);
    expect(found[0]?.position).toBe("index_1");
  });

  it("has no provided-action finding on the baseline", () => {
    expect(mutate(() => undefined).map((finding) => finding.rule)).not.toContain(
      "provided-action-bound",
    );
  });
});

describe("lintFails", () => {
  const stale = applyAcknowledgements([], [{ rule: "gone", profile: "x", reason: "was needed" }]);

  it("treats a stale acknowledgement as a failure only under --strict", () => {
    expect(stale.live.map((finding) => finding.rule)).toEqual(["stale-acknowledgement"]);
    expect(lintFails(stale, false)).toBe(false);
    expect(lintFails(stale, true)).toBe(true);
  });

  it("fails on an error either way, and on a clean run neither way", () => {
    const error = applyAcknowledgements([{ level: ERROR, rule: "r", message: "m" }], []);
    expect(lintFails(error, false)).toBe(true);
    const clean = applyAcknowledgements([], []);
    expect(lintFails(clean, true)).toBe(false);
  });
});
