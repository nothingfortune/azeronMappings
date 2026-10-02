/**
 * What saving a game's sets.yaml returns: the file's text reaches the page so it can patch
 * it, and the save's verdict says what the game's pedals came to.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { Game } from "../../../src/lib/model.js";
import { checkAfterSave } from "../../../src/lib/tasks.js";

const SETS = "games/SpaceSims/everspace/sets.yaml";

describe("the payload's sets.yaml", () => {
  it("is the file as written, comments included, for the page to patch", () => {
    const game = buildPayload().games.find((entry) => entry.slug === "everspace");
    expect(game?.setsText).toBe(readFileSync(repoPath(SETS), "utf8"));
    expect(game?.setsText).toContain("THE RIGHT TOE IS THE THROTTLE");
  });

  it("is empty for a game that has none", () => {
    const payload = buildPayload();
    for (const game of payload.games) {
      if (Object.keys(game.sets.sets).length === 0) expect(game.setsText).toBe("");
    }
  });
});

describe("checkAfterSave on sets.yaml", () => {
  const games = Game.discover();

  it("says what the game's pedals come to, and how far each name is trusted", () => {
    const check = checkAfterSave(SETS, games, true);
    expect(check.game).toBe("everspace");
    expect(check.pedals?.set).toBe("akimbo-v10");
    expect(check.pedals?.problem).toBeUndefined();
    const rudder = check.pedals?.axes.find((axis) => axis.pedalAxis === "rudder");
    expect(rudder).toMatchObject({
      drives: "yaw",
      row: "Yaw",
      name: "JS0_SaitekProFlightRudderPedals_Axis2",
      status: "inferred",
    });
  });

  it("says nothing about pedals for any other file", () => {
    const check = checkAfterSave("games/SpaceSims/everspace/profiles/x.yaml", games, true);
    expect(check.pedals).toBeUndefined();
  });
});
