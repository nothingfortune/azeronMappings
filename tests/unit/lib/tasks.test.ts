/**
 * The operations the CLI and the served editor share. Testing them here rather than
 * through either surface is the point: both call the same functions, so neither can
 * drift into doing something the other cannot.
 */

import { describe, expect, it } from "vitest";

import {
  buildAll,
  ingameReport,
  lintAll,
  profilePathFor,
  templatePathFor,
} from "../../../src/lib/tasks.js";
import { Game, Genre } from "../../../src/lib/model.js";

const games = () => Game.discover();

describe("buildAll", () => {
  it("reports every profile and whether it changed, without writing in check mode", () => {
    const result = buildAll(games(), true);
    expect(result.built.length).toBeGreaterThan(0);
    for (const entry of result.built) {
      expect(entry.profile).toMatch(/\.yaml$/);
      expect(entry.output).toMatch(/\.json$/);
    }
  });

  it("is clean against the committed dist", () => {
    // Same assertion the dist test makes, reached the way the UI reaches it.
    expect(buildAll(games(), true).errors).toEqual([]);
  });
});

describe("lintAll", () => {
  it("covers genres as well as games", () => {
    const summaries = lintAll(games(), Genre.discover());
    expect(summaries.map((summary) => summary.scope)).toContain("genres/SpaceSims");
    expect(summaries.map((summary) => summary.scope)).toContain("everspace");
  });

  it("finds nothing live in the repo as it stands", () => {
    for (const summary of lintAll(games(), Genre.discover())) {
      expect(summary.errors, summary.scope).toEqual([]);
      expect(summary.warnings, summary.scope).toEqual([]);
    }
  });
});

describe("paths", () => {
  it("puts an imported profile and its export where the layout expects them", () => {
    const game = games().find((candidate) => candidate.slug === "everspace");
    if (!game) throw new Error("no everspace game");
    expect(profilePathFor(game, "v9", "left")).toBe(
      "games/SpaceSims/everspace/profiles/v9-left.yaml",
    );
    expect(templatePathFor(game, "v9", "left")).toBe("templates/everspace-v9-left.json");
  });
});

describe("ingameReport", () => {
  it("refuses a game with no config rather than inventing a path", () => {
    const game = games().find((candidate) => candidate.slug === "everspace");
    if (!game) throw new Error("no everspace game");
    expect(() => ingameReport(game, "/definitely/not/here/Input.ini")).toThrow(/does not exist/);
  });
});
