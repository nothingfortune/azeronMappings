/**
 * Starting a game from an export, which both the CLI and the editor's Setup tab do.
 *
 * The repo root is swapped for a scratch copy of the data directories. These tests create
 * and remove whole game folders, and other test files discover games in the real tree at
 * the same time -- a folder appearing and vanishing under them fails them at random.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/config/paths.js")>();
  const root = mkdtempSync(join(tmpdir(), "azeron-newgame-"));
  for (const dir of ["genres", "devices"])
    cpSync(join(actual.repoRoot, dir), join(root, dir), { recursive: true });
  mkdirSync(join(root, "templates"));
  cpSync(
    join(actual.repoRoot, "templates", "everspace2-v5.json"),
    join(root, "templates", "everspace2-v5.json"),
  );
  cpSync(join(actual.repoRoot, "games", "SpaceSims"), join(root, "games", "SpaceSims"), {
    recursive: true,
  });
  return {
    ...actual,
    repoRoot: root,
    repoPath: (...parts: readonly string[]) => {
      const joined = join(...parts);
      return isAbsolute(joined) ? joined : join(root, joined);
    },
  };
});

import { repoPath, repoRoot } from "../../../src/config/paths.js";
import { loadTemplate } from "../../../src/lib/io.js";
import { Game } from "../../../src/lib/model.js";
import {
  checkFileName,
  checkGameName,
  isFileName,
  ScaffoldError,
  slugFromName,
} from "../../../src/lib/scaffold.js";
import { createGame, ImportCollision } from "../../../src/lib/tasks.js";
import type { NewGameRequest } from "../../../src/lib/tasks.js";

const SLUG = "zzNewGameTest";
const FOLDER = `games/FPS/${SLUG}`;

function cleanup(): void {
  rmSync(repoPath(FOLDER), { recursive: true, force: true });
  rmSync(repoPath(`games/SpaceSims/${SLUG}`), { recursive: true, force: true });
  for (const unit of ["left", "right"]) {
    rmSync(repoPath(`templates/${SLUG}-v1-${unit}.json`), { force: true });
  }
}

function request(extra: Partial<NewGameRequest> = {}): NewGameRequest {
  return {
    exported: loadTemplate("templates/everspace2-v5.json"),
    name: "ZZ New Game Test",
    slug: SLUG,
    genre: "FPS",
    device: "cyborg2-left",
    set: "v1",
    ...extra,
  };
}

afterEach(cleanup);
afterAll(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("names that become paths", () => {
  it("accepts ordinary names", () => {
    for (const name of ["v1", "akimbo-v11", "hellDivers", "a.b_c"]) {
      expect(isFileName(name)).toBe(true);
    }
  });

  it("refuses anything that could leave its folder or that Windows would mangle", () => {
    for (const name of [
      "",
      "..",
      "../x",
      "a/b",
      "a\\b",
      "/abs",
      ".hidden",
      "trail.",
      "a b",
      "con",
      "NUL.txt",
    ]) {
      expect(isFileName(name)).toBe(false);
    }
    expect(() => checkFileName("layout name", "../../escaped")).toThrow(/cannot be a layout name/);
  });

  it("derives a folder name from what a person types", () => {
    expect(slugFromName("Deep Rock Galactic")).toBe("deepRockGalactic");
    expect(slugFromName("Helldivers 2")).toBe("helldivers2");
    expect(slugFromName("!!!")).toBe("");
  });

  it("keeps a game name to one short line", () => {
    expect(checkGameName("  Deep Rock  ")).toBe("Deep Rock");
    expect(() => checkGameName("two\nlines")).toThrow(ScaffoldError);
    expect(() => checkGameName("x".repeat(81))).toThrow(ScaffoldError);
    expect(() => checkGameName("   ")).toThrow(/needs a name/);
  });
});

describe("createGame", () => {
  it("makes the folder, the template, the vocabulary and the first layout", () => {
    const result = createGame(request());
    expect(result.gameDir).toBe(FOLDER);
    expect(result.profilePath).toBe(`${FOLDER}/profiles/v1-left.yaml`);
    expect(result.templatePath).toBe(`templates/${SLUG}-v1-left.json`);
    for (const path of [
      `${FOLDER}/game.yaml`,
      `${FOLDER}/actions.yaml`,
      `${FOLDER}/playtests.md`,
      result.profilePath,
      result.templatePath,
    ]) {
      expect(existsSync(repoPath(path))).toBe(true);
    }
    expect(result.actions).toBeGreaterThan(0);

    // It is a real game now: discoverable, and its profile loads against its vocabulary.
    const game = Game.discover().find((entry) => entry.slug === SLUG);
    expect(game?.name).toBe("ZZ New Game Test");
    expect(game?.loadedProfiles().length).toBe(1);
  });

  it("names the right unit's files for the right unit", () => {
    const result = createGame(request({ device: "cyborg2-right" }));
    expect(result.profilePath).toBe(`${FOLDER}/profiles/v1-right.yaml`);
  });

  it("derives the folder from the name when no slug is given", () => {
    const result = createGame(request({ slug: undefined, name: `ZZ ${SLUG.slice(2)}` }));
    expect(result.slug).toBe(`zz${SLUG.slice(2)}`);
    rmSync(repoPath(result.gameDir), { recursive: true, force: true });
    rmSync(repoPath(result.templatePath), { force: true });
  });

  it("refuses names that would write outside games/ or templates/", () => {
    expect(() => createGame(request({ slug: "../escape" }))).toThrow(
      /cannot be a game folder name/,
    );
    expect(() => createGame(request({ set: "../../escape" }))).toThrow(/cannot be a layout name/);
    expect(() => createGame(request({ genre: "../genres/FPS" }))).toThrow(/not a genre/);
    expect(() => createGame(request({ device: "../../etc/passwd" }))).toThrow(/not a device map/);
    expect(existsSync(repoPath(FOLDER))).toBe(false);
  });

  it("refuses something that is not an export, and writes nothing", () => {
    expect(() => createGame(request({ exported: { profiles: [] } as never }))).toThrow(
      /no profiles/,
    );
    expect(existsSync(repoPath(FOLDER))).toBe(false);
  });

  it("refuses to replace a game that exists, and leaves it untouched", () => {
    createGame(request());
    const before = readFileSync(repoPath(`${FOLDER}/actions.yaml`), "utf8");
    expect(() => createGame(request())).toThrow(ImportCollision);
    expect(() => createGame(request())).toThrow(/actions\.yaml/);
    expect(readFileSync(repoPath(`${FOLDER}/actions.yaml`), "utf8")).toBe(before);
  });

  it("replaces it when told to", () => {
    createGame(request());
    expect(() => createGame(request({ overwrite: true }))).not.toThrow();
  });

  it("never lets two games share a folder name, even when told to overwrite", () => {
    createGame(request());
    expect(() =>
      createGame(request({ genre: "SpaceSims", name: "Another Name", overwrite: true })),
    ).toThrow(/already exists/);
    expect(existsSync(repoPath(`games/SpaceSims/${SLUG}`))).toBe(false);
  });

  it("refuses a name an existing game already has", () => {
    expect(() => createGame(request({ name: "Everspace 2" }))).toThrow(/already exists/);
  });

  it("removes what it made when it fails part way", () => {
    const broken = loadTemplate("templates/everspace2-v5.json");
    (broken.profiles[0] as unknown as { inputs: unknown }).inputs = "not an array";
    expect(() => createGame(request({ exported: broken }))).toThrow();
    expect(existsSync(repoPath(FOLDER))).toBe(false);
    expect(existsSync(repoPath(`templates/${SLUG}-v1-left.json`))).toBe(false);
  });
});
