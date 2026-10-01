/**
 * How the repo's games are found and named, and how the entry point is recognised.
 *
 * Nothing here depends on the host operating system: Windows spellings are given to the
 * helpers explicitly through `path.win32`.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { win32 } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { isEntryPoint, repoRelativePath, toPosix } from "../../../src/config/paths.js";
import { Game } from "../../../src/lib/model.js";

describe("repo-relative paths", () => {
  it("are spelled with forward slashes, whatever the platform", () => {
    expect(toPosix("games\\SpaceSims\\everspace")).toBe("games/SpaceSims/everspace");
    expect(toPosix("games/SpaceSims/everspace")).toBe("games/SpaceSims/everspace");
    expect(
      repoRelativePath(
        "C:\\Users\\there\\azeronMappings",
        "C:\\Users\\there\\azeronMappings\\games\\SpaceSims\\everspace",
        win32,
      ),
    ).toBe("games/SpaceSims/everspace");
  });

  it("make a game's slug, folder and dist path compare equal to the editor's", () => {
    const game = new Game("games/SpaceSims/everspace");
    expect(game.rel).toBe("games/SpaceSims/everspace");
    expect(game.distDir()).toBe("dist/SpaceSims/everspace");
    for (const path of game.profilePaths()) {
      expect(path).toMatch(/^games\/SpaceSims\/everspace\/profiles\/[^\\]+\.yaml$/);
    }
  });
});

describe("isEntryPoint", () => {
  const module = pathToFileURL("/repo/build/index.js").href;

  it("is false for an unrelated path that merely contains the name", () => {
    expect(isEntryPoint("/home/me/index-notes/bin/azeron", module)).toBe(false);
    expect(isEntryPoint("/usr/lib/node_modules/reindexer/cli.js", module)).toBe(false);
    expect(isEntryPoint(undefined, module)).toBe(false);
  });

  it("is true for the module itself, and for a symlink to it", () => {
    const dir = mkdtempSync(join(tmpdir(), "azeron-entry-"));
    try {
      const real = join(dir, "index.js");
      writeFileSync(real, "", "utf8");
      const link = join(dir, "azeron-link");
      symlinkSync(real, link);
      const url = pathToFileURL(real).href;
      expect(isEntryPoint(real, url)).toBe(true);
      expect(isEntryPoint(link, url)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Game.discover with a half-made folder", () => {
  let root = "";
  let stderr: MockInstance<typeof process.stderr.write>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "azeron-games-"));
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stderr.mockRestore();
    rmSync(root, { recursive: true, force: true });
  });

  const folder = (name: string, files: Record<string, string>): void => {
    mkdirSync(join(root, "G", name), { recursive: true });
    for (const [file, text] of Object.entries(files)) {
      writeFileSync(join(root, "G", name, file), text, "utf8");
    }
  };
  const written = (): string => stderr.mock.calls.map((call) => String(call[0])).join("");

  it("skips a folder with no actions.yaml, and a folder whose actions.yaml will not load", () => {
    folder("good", { "actions.yaml": "actions: {}\n" });
    folder("no-actions", { "game.yaml": "name: Unfinished\n" });
    folder("broken", { "actions.yaml": "extends: genres/Nope/actions.yaml\n" });

    const found = Game.discover(root);
    expect(found.map((game) => game.slug)).toEqual(["good"]);
    expect(written()).toContain("no-actions");
    expect(written()).toContain("broken");
  });

  it("reports each skipped folder once, however often discovery runs", () => {
    folder("half", { "game.yaml": "name: Half\n" });
    Game.discover(root);
    Game.discover(root);
    Game.discover(root);
    expect(written().match(/half/g)).toHaveLength(1);
  });
});
