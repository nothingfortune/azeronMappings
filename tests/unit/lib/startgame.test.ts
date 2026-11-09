/**
 * Starting a game with no export, from its genre: no Azeron app involved.
 *
 * The data root is swapped for a scratch copy, as newgame.test.ts does: these tests make
 * and remove whole game folders, and other test files discover games at the same time.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/config/paths.js")>();
  const root = mkdtempSync(join(tmpdir(), "azeron-startgame-"));
  for (const dir of ["genres", "devices", "templates"])
    cpSync(join(actual.dataRoot, dir), join(root, dir), { recursive: true });
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
import { patchActionBindings } from "../../../src/lib/actionfile.js";
import { loadProfileData } from "../../../src/lib/io.js";
import { lintGame } from "../../../src/lib/lint.js";
import { Game } from "../../../src/lib/model.js";
import { ScaffoldError } from "../../../src/lib/scaffold.js";
import { buildAll, ImportCollision, startGame, startLayout } from "../../../src/lib/tasks.js";

const SIM = "games/SpaceSims/zzSim";

afterEach(() => {
  rmSync(repoPath("games"), { recursive: true, force: true });
  mkdirSync(repoPath("games"));
  rmSync(repoPath("dist"), { recursive: true, force: true });
});

const sim = (devices: string[] = ["cyborg2-left", "cyborg2-right"]) =>
  startGame({ name: "ZZ Sim", slug: "zzSim", genre: "SpaceSims", devices, set: "v1" });

describe("startGame", () => {
  it("writes the game, and a profile per unit on that unit's own export", () => {
    const result = sim();
    expect(result.gameDir).toBe(SIM);
    for (const file of ["game.yaml", "actions.yaml", "playtests.md"]) {
      expect(existsSync(repoPath(`${SIM}/${file}`)), file).toBe(true);
    }
    const left = loadProfileData(`${SIM}/profiles/v1-left.yaml`);
    const right = loadProfileData(`${SIM}/profiles/v1-right.yaml`);
    expect(left.profile).toMatchObject({
      name: "ZZ Sim v1 left",
      device: "cyborg2-left",
      unit: "left",
      set: "v1",
      template: "templates/everspace2-akimbo-left.json",
      output: "zzSim_v1_left.json",
    });
    // The right unit's own export carries its stick rotation; the left one's would not.
    expect(right.profile.template).toBe("templates/everspace2-akimbo-right.json");
    // Fresh ids, never the template's: the app would otherwise take them for one profile.
    expect(left.profile.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(left.profile.id).not.toBe(right.profile.id);
  });

  it("puts the genre's default layout on its unit, and starts the other empty", () => {
    const result = sim();
    const [left, right] = result.profiles;
    expect(left?.positions).toBeGreaterThan(20);
    expect(right?.positions).toBe(0);
  });

  it("gives every placed action a key of its own, so the game builds and lints clean", () => {
    const result = sim();
    expect(result.wired).toBeGreaterThan(0);
    const game = new Game(SIM);
    const keys = Object.values(game.actions.actions)
      .map((spec) => spec.key)
      .filter((key): key is string => typeof key === "string");
    expect(new Set(keys).size).toBe(keys.length);
    expect(buildAll([game]).errors).toEqual([]);
    const rules = lintGame(game).live.map((finding) => finding.rule);
    expect(rules).not.toContain("action-sends-nothing");
    expect(rules).not.toContain("key-collision");
  });

  it("leaves off, and says so, what the pool of keys cannot carry", () => {
    const result = sim();
    // The space-sim default places more actions than there are out-of-the-way keys.
    expect(result.leftOff.length).toBeGreaterThan(0);
    const left = loadProfileData(`${SIM}/profiles/v1-left.yaml`);
    const placed = JSON.stringify(left.positions);
    for (const entry of result.leftOff) {
      const action = entry.split(": ")[1] ?? "";
      expect(placed).not.toContain(`"${action}"`);
    }
  });

  it("gives required actions their keys before optional ones", () => {
    const result = startGame({
      name: "ZZ Gun",
      slug: "zzGun",
      genre: "FPS",
      devices: ["cyborg2-left"],
      set: "v1",
    });
    expect(lintGame(new Game(`games/FPS/${result.slug}`)).live.map((f) => f.rule)).not.toContain(
      "missing-required",
    );
  });

  it("starts a right-unit game with no actions of its own, which a save can still add to", () => {
    sim(["cyborg2-right"]);
    const text = readFileSync(repoPath(`${SIM}/actions.yaml`), "utf8");
    expect(text).toContain("actions: {}");
    expect(Object.keys(new Game(SIM).actions.actions).length).toBeGreaterThan(0);
    const patched = patchActionBindings(text, { boost: { key: "Insert" } });
    expect(patched).toContain("actions:\n  boost: {key: Insert}");
    expect(patched).not.toContain("{}");
  });

  it("refuses what cannot be a layout", () => {
    expect(() => sim([])).toThrow(/at least one unit/);
    expect(() => sim(["cyborg2-left", "cyborg2-left"].concat("cyborg2-nope"))).toThrow(
      ScaffoldError,
    );
    expect(() =>
      startGame({ name: "ZZ", genre: "Nope", devices: ["cyborg2-left"], set: "v1" }),
    ).toThrow(/not a genre/);
  });

  it("refuses two units for one hand", () => {
    writeFileSync(
      repoPath("devices/cyborg2-left-spare.yaml"),
      readFileSync(repoPath("devices/cyborg2-left.yaml"), "utf8").replace(
        "device: cyborg2-left",
        "device: cyborg2-left-spare",
      ),
      "utf8",
    );
    try {
      expect(() => sim(["cyborg2-left", "cyborg2-left-spare"])).toThrow(/one unit per hand/);
    } finally {
      rmSync(repoPath("devices/cyborg2-left-spare.yaml"));
    }
  });

  it("refuses a unit whose device map names no export to build on", () => {
    const path = repoPath("devices/cyborg2-right.yaml");
    const before = readFileSync(path, "utf8");
    writeFileSync(path, before.replace(/^template: .*$/m, ""), "utf8");
    try {
      expect(() => sim(["cyborg2-right"])).toThrow(/names no template/);
      expect(existsSync(repoPath(SIM))).toBe(false);
    } finally {
      writeFileSync(path, before, "utf8");
    }
  });

  it("asks before replacing a game that exists", () => {
    sim();
    expect(() => sim()).toThrow(ImportCollision);
    expect(() =>
      startGame({
        name: "ZZ Sim",
        slug: "zzSim",
        genre: "SpaceSims",
        devices: ["cyborg2-left"],
        set: "v1",
        overwrite: true,
      }),
    ).not.toThrow();
  });

  it("leaves nothing behind when a write fails part way", () => {
    // A file where the profiles folder should be: the game's files are written, then the
    // first profile fails.
    mkdirSync(repoPath(SIM), { recursive: true });
    writeFileSync(repoPath(`${SIM}/profiles`), "in the way", "utf8");
    expect(() => sim()).toThrow();
    expect(existsSync(repoPath(`${SIM}/game.yaml`))).toBe(false);
    expect(existsSync(repoPath(`${SIM}/actions.yaml`))).toBe(false);
  });
});

describe("startLayout", () => {
  /** Everspace from the frozen fixture, which has a pair with pedals in sets.yaml. */
  const everspace = (): void => {
    cpSync("tests/fixtures/repo/games/SpaceSims/everspace", repoPath("games/SpaceSims/everspace"), {
      recursive: true,
    });
  };
  const live = (): string =>
    new Game("games/SpaceSims/everspace")
      .profilePaths()
      .map((path) => loadProfileData(path).profile.set ?? "")
      .filter((set) => /^akimbo-v\d+$/.test(set))
      .sort()
      .pop() ?? "";

  it("copies a layout, pedals included, as a new one with its own ids", () => {
    everspace();
    const source = live();
    const result = startLayout({ game: "everspace", set: "next", devices: [], copyOf: source });
    expect(result.pedals).toBe(true);
    expect(result.profiles.map((profile) => profile.device)).toEqual([
      "cyborg2-left",
      "cyborg2-right",
    ]);
    const game = new Game("games/SpaceSims/everspace");
    const from = loadProfileData(`games/SpaceSims/everspace/profiles/${source}-left.yaml`);
    const copy = loadProfileData("games/SpaceSims/everspace/profiles/next-left.yaml");
    expect(copy.positions).toEqual(from.positions);
    expect(copy.profile).toMatchObject({
      set: "next",
      output: "everspace_next_left.json",
      template: from.profile.template,
    });
    expect(copy.profile.id).not.toBe(from.profile.id);
    expect(copy.profile.golden).toBeUndefined();
    expect(game.sets.sets.next?.pedals).toEqual(game.sets.sets[source]?.pedals);
    expect(buildAll([game]).errors).toEqual([]);
  });

  it("keeps the modes a copied layout plays, which decide what it is checked against", () => {
    sim();
    writeFileSync(
      repoPath(`${SIM}/sets.yaml`),
      "# The modes each layout plays.\nsets:\n  v1:\n    modes: [ship, map] # flying\n",
      "utf8",
    );
    const result = startLayout({ game: "zzSim", set: "v2", devices: [], copyOf: "v1" });
    expect(result).toMatchObject({ modes: true, pedals: false });
    const text = readFileSync(repoPath(`${SIM}/sets.yaml`), "utf8");
    // Added beside the original, which is left exactly as it was, comments and all.
    expect(text).toContain("# The modes each layout plays.\n");
    expect(text).toContain("    modes: [ship, map] # flying\n");
    expect(new Game(SIM).sets.sets.v2?.modes).toEqual(["ship", "map"]);
  });

  it("starts an empty one on each unit's own export", () => {
    sim();
    const result = startLayout({ game: "zzSim", set: "blank", devices: ["cyborg2-right"] });
    expect(result.profiles).toEqual([
      { device: "cyborg2-right", path: `${SIM}/profiles/blank-right.yaml`, positions: 0 },
    ]);
    expect(loadProfileData(`${SIM}/profiles/blank-right.yaml`).profile.template).toBe(
      "templates/everspace2-akimbo-right.json",
    );
    expect(result.pedals).toBe(false);
  });

  it("refuses a name in use, a layout that is not there, and a game that is not", () => {
    sim();
    expect(() => startLayout({ game: "zzSim", set: "v1", devices: ["cyborg2-left"] })).toThrow(
      ImportCollision,
    );
    expect(() => startLayout({ game: "zzSim", set: "v2", devices: [], copyOf: "nope" })).toThrow(
      /no layout called/,
    );
    expect(() => startLayout({ game: "nope", set: "v2", devices: ["cyborg2-left"] })).toThrow(
      /no game/,
    );
  });
});
