/**
 * The operations the CLI and the served editor share. Testing them here rather than
 * through either surface is the point: both call the same functions, so neither can
 * drift into doing something the other cannot.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { hostPath, repoPath } from "../../../src/config/paths.js";
import { loadTemplate } from "../../../src/lib/io.js";
import {
  buildAll,
  checkAfterSave,
  ImportCollision,
  importExport,
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
    // The name promises this, and nothing asserted it: the committed dist is current, so
    // nothing should report as changed.
    expect(result.built.filter((entry) => entry.changed)).toEqual([]);
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

describe("importExport refusing to overwrite", () => {
  /**
   * The import writes two files, and one of them is a committed template -- the only record
   * of what the unit actually held. Re-importing under a set name already in use used to
   * destroy both without a word.
   */
  const game = new Game("games/SpaceSims/everspace");

  function request(overwrite?: boolean): Parameters<typeof importExport>[0] {
    const exported = loadTemplate("templates/everspace2-v5.json");
    return {
      exported,
      game,
      device: "cyborg2-left",
      profilePath: "games/SpaceSims/everspace/profiles/single-v5.yaml",
      templatePath: "templates/everspace2-v5.json",
      ...(overwrite === undefined ? {} : { overwrite }),
    };
  }

  it("refuses a set whose files already exist, and names them", () => {
    expect(() => importExport(request())).toThrow(ImportCollision);
    expect(() => importExport(request())).toThrow(/single-v5\.yaml/);
    expect(() => importExport(request())).toThrow(/everspace2-v5\.json/);
  });

  it("leaves both files untouched when it refuses", () => {
    const before = readFileSync(repoPath("games/SpaceSims/everspace/profiles/single-v5.yaml"));
    const template = readFileSync(repoPath("templates/everspace2-v5.json"));
    expect(() => importExport(request())).toThrow(ImportCollision);
    expect(readFileSync(repoPath("games/SpaceSims/everspace/profiles/single-v5.yaml"))).toEqual(
      before,
    );
    expect(readFileSync(repoPath("templates/everspace2-v5.json"))).toEqual(template);
  });
});

describe("checkAfterSave", () => {
  // Check-only: a test has no business rewriting dist/, even with identical bytes.
  const all = games();

  it("reports on the game the saved file belongs to, not every game", () => {
    const check = checkAfterSave("games/SpaceSims/everspace/profiles/x.yaml", all, true);
    expect(check.game).toBe("everspace");
    const everspace = all.find((game) => game.slug === "everspace");
    expect(check.built.every((entry) => entry.output.startsWith(everspace?.distDir() ?? "?"))).toBe(
      true,
    );
  });

  it("gives each built file as the Azeron app's import dialog would take it", () => {
    const check = checkAfterSave("games/SpaceSims/everspace/profiles/x.yaml", all, true);
    for (const entry of check.built) {
      expect(entry.importPath.endsWith(entry.output.split("/").pop() ?? "?")).toBe(true);
      expect(entry.importPath.startsWith("/mnt/")).toBe(false);
    }
  });

  it("checks every game for a file they share, such as a device map", () => {
    expect(checkAfterSave("devices/cyborg2-left.yaml", all, true).game).toBeNull();
  });
});

describe("hostPath", () => {
  it("turns a WSL mount into the Windows path the app's dialog needs", () => {
    expect(hostPath("/mnt/c/Users/there/repo/dist/a.json")).toBe(
      "C:\\Users\\there\\repo\\dist\\a.json",
    );
  });

  it("leaves any other path alone", () => {
    expect(hostPath("C:\\Users\\there")).toBe("C:\\Users\\there");
    expect(hostPath("/home/alex/repo")).toBe("/home/alex/repo");
  });
});
