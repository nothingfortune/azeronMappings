/**
 * What a game started from an export holds the moment it exists: a vocabulary that covers
 * everything the export sends, and a layout named for the game it belongs to.
 *
 * The repo root is swapped for a scratch copy, as in newgame.test.ts.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

vi.mock("../../../src/config/paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/config/paths.js")>();
  const root = mkdtempSync(join(tmpdir(), "azeron-newgame-seed-"));
  for (const dir of ["genres", "devices"])
    cpSync(join(actual.dataRoot, dir), join(root, dir), { recursive: true });
  mkdirSync(join(root, "templates"));
  cpSync(
    join(actual.dataRoot, "templates", "everspace2-v5.json"),
    join(root, "templates", "everspace2-v5.json"),
  );
  mkdirSync(join(root, "games"));
  return {
    ...actual,
    repoRoot: root,
    dataRoot: root,
    repoPath: (...parts: readonly string[]) => {
      const joined = join(...parts);
      return isAbsolute(joined) ? joined : join(root, joined);
    },
  };
});

import { repoPath } from "../../../src/config/paths.js";
import { compileProfile, dumps } from "../../../src/lib/compile.js";
import { loadTemplate } from "../../../src/lib/io.js";
import { lintGame } from "../../../src/lib/lint.js";
import { Game } from "../../../src/lib/model.js";
import { createGame } from "../../../src/lib/tasks.js";

const SLUG = "zzSeedTest";

function make(unit: "left" | "right") {
  return createGame({
    exported: loadTemplate("templates/everspace2-v5.json"),
    name: "Deep Rock Galactic",
    slug: SLUG,
    genre: "FPS",
    device: `cyborg2-${unit}`,
    set: "main",
    overwrite: true,
  });
}

afterAll(() => {
  rmSync(repoPath(`games/FPS/${SLUG}`), { recursive: true, force: true });
});

describe("a game started from an export", () => {
  it("has no unbound-key error, because every button the export sends has an action", () => {
    const result = make("left");
    const game = new Game(result.gameDir);
    const unbound = lintGame(game).live.filter((finding) => finding.rule === "unbound-key");
    expect(unbound).toEqual([]);
    const actions = parse(readFileSync(repoPath(result.gameDir, "actions.yaml"), "utf8")) as {
      actions: Record<string, { mouse?: string }>;
    };
    expect(actions.actions.mouse_middle?.mouse).toBe("middle");
  });

  it("names the layout for the game, the layout and the unit, not for the export", () => {
    // It kept the export's own name, so the board said "Everspace 2 v5" for a game called
    // Deep Rock Galactic.
    const left = make("left");
    const profile = parse(readFileSync(repoPath(left.profilePath), "utf8")) as {
      profile: { name: string };
    };
    expect(profile.profile.name).toBe("Deep Rock Galactic main left");

    const right = make("right");
    const other = parse(readFileSync(repoPath(right.profilePath), "utf8")) as {
      profile: { name: string };
    };
    expect(other.profile.name).toBe("Deep Rock Galactic main right");
  });

  it("carries that name into the file the Azeron app imports", () => {
    const result = make("left");
    const game = new Game(result.gameDir);
    const [profile] = game.loadedProfiles();
    if (!profile) throw new Error("the game has no profile");
    const text = dumps(
      compileProfile(profile, {
        template: loadTemplate(result.templatePath),
        actions: game.actions.actions,
      }),
    );
    expect(text).toContain('"name": "Deep Rock Galactic main left"');
    expect(text).not.toContain("Everspace 2 v5");
  });
});
