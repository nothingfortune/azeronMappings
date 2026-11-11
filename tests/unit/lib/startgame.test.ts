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
import { parseDocument } from "yaml";

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
import { Game, Genre } from "../../../src/lib/model.js";
import { ScaffoldError } from "../../../src/lib/scaffold.js";
import {
  acknowledgeFinding,
  addUnitToLayout,
  deleteGame,
  deleteLayout,
  renameLayout,
  buildAll,
  ImportCollision,
  startGame,
  startLayout,
} from "../../../src/lib/tasks.js";

const SIM = "games/SpaceSims/zzSim";

afterEach(() => {
  rmSync(repoPath("games"), { recursive: true, force: true });
  mkdirSync(repoPath("games"));
  rmSync(repoPath("dist"), { recursive: true, force: true });
});

const sim = (devices: string[] = ["cyborg2-left", "cyborg2-right"]) =>
  startGame({ name: "ZZ Sim", slug: "zzSim", genre: "SpaceSims", devices, set: "v1" });

describe("accepting a finding from the page", () => {
  it("adds it to game.yaml with its reason, keeping the file's comments", () => {
    sim();
    const path = `${SIM}/game.yaml`;
    writeFileSync(repoPath(path), `# kept\n${readFileSync(repoPath(path), "utf8")}`);
    const before = (new Game(SIM).config.lint?.acknowledged ?? []).length;
    acknowledgeFinding({
      game: "zzSim",
      rule: "akimbo-role-mismatch",
      profile: "v1",
      position: "pinky_1",
      reason: "the pinkies do different jobs on purpose",
    });
    const text = readFileSync(repoPath(path), "utf8");
    expect(text.startsWith("# kept\n")).toBe(true);
    const acknowledged = new Game(SIM).config.lint?.acknowledged ?? [];
    expect(acknowledged).toHaveLength(before + 1);
    expect(acknowledged.at(-1)).toEqual({
      rule: "akimbo-role-mismatch",
      profile: "v1",
      position: "pinky_1",
      reason: "the pinkies do different jobs on purpose",
    });
  });

  it("refuses one with no reason", () => {
    sim();
    expect(() =>
      acknowledgeFinding({ game: "zzSim", rule: "x", profile: "v1", reason: "  " }),
    ).toThrow(/say why/);
  });
});

describe("deleting and renaming layouts and games", () => {
  /** A space sim with pedals on v1, and v2 as its copy. */
  const twoLayouts = (): void => {
    startGame({
      name: "ZZ Sim",
      slug: "zzSim",
      genre: "SpaceSims",
      devices: ["cyborg2-left", "cyborg2-right"],
      set: "v1",
      pedals: "logitech-pro-flight-pedals",
    });
    startLayout({ game: "zzSim", set: "v2", devices: [], copyOf: "v1" });
  };
  const layouts = (): string[] =>
    [
      ...new Set(new Game(SIM).loadedProfiles().map((profile) => profile.set ?? profile.slug)),
    ].sort();

  it("deletes a layout's profiles and its pedals, and leaves the other layout whole", () => {
    twoLayouts();
    const v1 = readFileSync(repoPath(`${SIM}/profiles/v1-left.yaml`), "utf8");
    deleteLayout({ game: "zzSim", set: "v2" });
    expect(layouts()).toEqual(["v1"]);
    expect(Object.keys(new Game(SIM).sets.sets)).toEqual(["v1"]);
    expect(readFileSync(repoPath(`${SIM}/profiles/v1-left.yaml`), "utf8")).toBe(v1);
  });

  it("refuses to delete a game's only layout", () => {
    sim();
    expect(() => deleteLayout({ game: "zzSim", set: "v1" })).toThrow(/only layout/);
  });

  it("renames a layout everywhere it is named, keeping its ids and keys", () => {
    twoLayouts();
    const before = loadProfileData(`${SIM}/profiles/v1-left.yaml`);
    renameLayout({ game: "zzSim", set: "v1", to: "main" });
    expect(layouts()).toEqual(["main", "v2"]);
    expect(existsSync(repoPath(`${SIM}/profiles/v1-left.yaml`))).toBe(false);
    const after = loadProfileData(`${SIM}/profiles/main-left.yaml`);
    expect(after.profile.id).toBe(before.profile.id);
    expect(after.positions).toEqual(before.positions);
    expect(after.profile).toMatchObject({ set: "main", name: "ZZ Sim main left" });
    const game = new Game(SIM);
    expect(Object.keys(game.sets.sets).sort()).toEqual(["main", "v2"]);
    // The pad's split thumbs were acknowledged for v1; they follow it.
    const profiles = (game.config.lint?.acknowledged ?? []).map((entry) => entry.profile);
    expect(profiles).not.toContain("v1");
    expect(profiles).toContain("main");
    expect(lintGame(game).live.filter((finding) => finding.level === "error")).toEqual([]);
  });

  it("moves an acknowledgement that names one profile's file, not only the layout", () => {
    twoLayouts();
    const path = repoPath(`${SIM}/game.yaml`);
    const doc = parseDocument(readFileSync(path, "utf8"));
    doc.addIn(["lint", "acknowledged"], {
      rule: "key-collision",
      profile: "v1-left",
      key: "KeyS",
      reason: "the same key on purpose",
    });
    writeFileSync(path, doc.toString());
    renameLayout({ game: "zzSim", set: "v1", to: "main" });
    const named = (new Game(SIM).config.lint?.acknowledged ?? []).map((entry) => entry.profile);
    expect(named).toContain("main-left");
    expect(named).not.toContain("v1-left");
    deleteLayout({ game: "zzSim", set: "main" });
    const left = (new Game(SIM).config.lint?.acknowledged ?? []).map((entry) => entry.profile);
    expect(left).not.toContain("main-left");
  });

  it("finds a layout whose profile names none, by its file name, as the editor does", () => {
    twoLayouts();
    // v2's left unit on its own, with no set: its layout is its file name, v2-left.
    const path = repoPath(`${SIM}/profiles/v2-left.yaml`);
    writeFileSync(path, readFileSync(path, "utf8").replace(/^ {2}set: v2\n/m, ""));
    expect(layouts()).toContain("v2-left");
    renameLayout({ game: "zzSim", set: "v2-left", to: "solo" });
    expect(layouts()).toContain("solo");
    deleteLayout({ game: "zzSim", set: "solo" });
    expect(layouts()).not.toContain("solo");
  });

  it("keeps the last game: the page needs one to open", () => {
    sim();
    expect(() => {
      deleteGame({ game: "zzSim" });
    }).toThrow(/only game/);
  });

  it("refuses a name another layout has", () => {
    twoLayouts();
    expect(() => renameLayout({ game: "zzSim", set: "v1", to: "v2" })).toThrow(/already has/);
  });

  it("deletes a game's folder", () => {
    sim();
    startGame({
      name: "ZZ Other",
      slug: "zzOther",
      genre: "FPS",
      devices: ["cyborg2-left"],
      set: "v1",
    });
    deleteGame({ game: "zzSim" });
    expect(existsSync(repoPath(SIM))).toBe(false);
  });
});

describe("adding the unit a layout is missing", () => {
  it("adds the other hand, empty, and leaves the one there untouched", () => {
    sim(["cyborg2-left"]);
    const before = readFileSync(repoPath(`${SIM}/profiles/v1-left.yaml`), "utf8");
    const result = addUnitToLayout({ game: "zzSim", set: "v1", device: "cyborg2-right" });
    expect(result.profile.path).toBe(`${SIM}/profiles/v1-right.yaml`);
    const right = loadProfileData(result.profile.path);
    expect(right.profile).toMatchObject({ unit: "right", set: "v1", device: "cyborg2-right" });
    expect(right.positions).toEqual({});
    expect(readFileSync(repoPath(`${SIM}/profiles/v1-left.yaml`), "utf8")).toBe(before);
    // Both hands are now one layout.
    const units = new Game(SIM).loadedProfiles().filter((profile) => profile.set === "v1");
    expect(units.map((profile) => profile.unit).sort()).toEqual(["left", "right"]);
  });

  it("refuses a hand the layout already has, and a layout that is not there", () => {
    sim(["cyborg2-left"]);
    expect(() => addUnitToLayout({ game: "zzSim", set: "v1", device: "cyborg2-left" })).toThrow(
      /already has a left unit/,
    );
    expect(() => addUnitToLayout({ game: "zzSim", set: "v9", device: "cyborg2-right" })).toThrow(
      /no layout called 'v9'/,
    );
  });
});

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

  it("lays a pair out like a controller unless told otherwise", () => {
    const result = sim();
    expect(result.style).toBe("controller");
    const left = loadProfileData(`${SIM}/profiles/v1-left.yaml`).positions;
    const right = loadProfileData(`${SIM}/profiles/v1-right.yaml`).positions;
    // The sticks fly the style's mode: twin-stick, as the game's own pad layout does.
    expect(left.stick?.directions).toMatchObject({ up: "throttle_up", left: "strafe_left" });
    expect(right.stick?.directions).toMatchObject({ up: "pitch_up", right: "yaw_right" });
    // Each action with an Xbox control is where that control sits on the pair.
    expect(right.dpad_down?.tap).toBe("interact"); // A
    expect(right.index_3?.tap).toBe("fire_primary"); // RT
    expect(left.index_3?.tap).toBe("fire_secondary"); // LT
    expect(left.dpad_up?.tap).toBe("hover_up"); // d-pad up
    // And the rest of the vocabulary under the fingers.
    expect(left.index_1?.tap).toBe("cruise");
  });

  it("lays a pair out like a keyboard: the genre's one-unit default on the left", () => {
    const result = startGame({
      name: "ZZ Sim",
      slug: "zzSim",
      genre: "SpaceSims",
      devices: ["cyborg2-left", "cyborg2-right"],
      set: "v1",
      style: "keyboard",
    });
    expect(result.style).toBe("keyboard");
    const left = loadProfileData(`${SIM}/profiles/v1-left.yaml`).positions;
    const right = loadProfileData(`${SIM}/profiles/v1-right.yaml`).positions;
    expect(left.pinky_1?.tap).toBe("consume_1");
    expect(right.middle_2?.tap).toBe("fire_primary");
    expect(right.stick?.directions).toMatchObject({ up: "pitch_up" });
  });

  it("starts each style with nothing for the checks to say, the pad's split thumbs acknowledged", () => {
    for (const style of ["controller", "keyboard"]) {
      for (const genre of ["SpaceSims", "FPS"]) {
        const slug = `zz${genre}${style}`;
        startGame({
          name: slug,
          slug,
          genre,
          devices: ["cyborg2-left", "cyborg2-right"],
          set: "v1",
          style,
        });
        const game = new Game(`games/${genre}/${slug}`);
        const result = lintGame(game);
        expect(result.live, `${genre} ${style}`).toEqual([]);
        expect(buildAll([game]).errors).toEqual([]);
        if (style === "controller") {
          expect(result.acknowledged.length, `${genre} ${style}`).toBeGreaterThan(0);
          expect(
            result.acknowledged.every(
              ({ ack }) =>
                (ack.position ?? "").startsWith("dpad") ||
                ack.position === "stick_press" ||
                ack.position === "thumb_aux_upper",
            ),
          ).toBe(true);
        }
      }
    }
  });

  it("fires a shooter with no mouse from a key, as the pad's triggers", () => {
    startGame({
      name: "ZZ Gun",
      slug: "zzGun",
      genre: "FPS",
      devices: ["cyborg2-left", "cyborg2-right"],
      set: "v1",
    });
    const text = readFileSync(repoPath("games/FPS/zzGun/actions.yaml"), "utf8");
    expect(text).toMatch(/fire_primary: +\{mouse: left, provided_by: null\}/);
    const game = new Game("games/FPS/zzGun");
    expect(game.actions.actions.fire_primary).toMatchObject({ mouse: "left" });
    expect(game.actions.actions.fire_primary?.provided_by).toBeUndefined();
    const right = loadProfileData("games/FPS/zzGun/profiles/v1-right.yaml").positions;
    expect(right.index_3?.tap).toBe("fire_primary");
    expect(right.stick?.directions).toMatchObject({ up: "look_up", left: "look_left" });
    // Renamed on the In-game tab, the trigger still sends its mouse button.
    const renamed = patchActionBindings(text, { fire_primary: { label: "Shoot" } });
    expect(renamed).toMatch(/fire_primary: +\{label: Shoot, mouse: left, provided_by: null\}/);
  });

  it("adds pedals where the genre's sticks say what they take, and flies the sticks around them", () => {
    const result = startGame({
      name: "ZZ Sim",
      slug: "zzSim",
      genre: "SpaceSims",
      devices: ["cyborg2-left", "cyborg2-right"],
      set: "v1",
      pedals: "logitech-pro-flight-pedals",
    });
    expect(result.pedals).toBe("logitech-pro-flight-pedals");
    const sets = readFileSync(repoPath(`${SIM}/sets.yaml`), "utf8");
    expect(sets).toContain("device: logitech-pro-flight-pedals");
    expect(sets).toContain("rudder: {drives: yaw}");
    // The rudder has yaw, so the right stick rolls: the mode's with-pedals variant.
    const right = loadProfileData(`${SIM}/profiles/v1-right.yaml`).positions;
    expect(right.stick?.directions).toMatchObject({ right: "roll_right", left: "roll_left" });
    expect(lintGame(new Game(SIM)).live).toEqual([]);
  });

  it("started again, changes only its own layout's pedals and keeps the others'", () => {
    const request = {
      name: "ZZ Sim",
      slug: "zzSim",
      genre: "SpaceSims",
      devices: ["cyborg2-left", "cyborg2-right"],
      pedals: "logitech-pro-flight-pedals",
    };
    startGame({ ...request, set: "v1" });
    startGame({ ...request, set: "v2", overwrite: true });
    const both = new Game(SIM).sets.sets;
    expect(both.v1?.pedals?.device).toBe("logitech-pro-flight-pedals");
    expect(both.v2?.pedals?.device).toBe("logitech-pro-flight-pedals");
    // v1 again, now with no pedals: its own are gone and v2 keeps its.
    const { pedals: _pedals, ...noPedals } = request;
    startGame({ ...noPedals, set: "v1", overwrite: true });
    const after = new Game(SIM).sets.sets;
    expect(after.v1?.pedals).toBeUndefined();
    expect(after.v2?.pedals?.device).toBe("logitech-pro-flight-pedals");
  });

  it("offers no pedals to a genre whose sticks do not say what they would take", () => {
    expect(() =>
      startGame({
        name: "ZZ Gun",
        genre: "FPS",
        devices: ["cyborg2-left", "cyborg2-right"],
        set: "v1",
        pedals: "logitech-pro-flight-pedals",
      }),
    ).toThrow(/pedals/);
    expect(existsSync(repoPath("games/FPS/zzGun"))).toBe(false);
  });

  it("gives one unit on its own the genre's one-unit default, and refuses it a style", () => {
    const result = sim(["cyborg2-left"]);
    expect(result.style).toBeNull();
    expect(result.profiles[0]?.positions).toBeGreaterThan(20);
    expect(() =>
      startGame({
        name: "ZZ Other",
        genre: "SpaceSims",
        devices: ["cyborg2-left"],
        set: "v1",
        style: "controller",
      }),
    ).toThrow(/both units/);
    expect(() =>
      startGame({
        name: "ZZ Other",
        genre: "SpaceSims",
        devices: ["cyborg2-left", "cyborg2-right"],
        set: "v1",
        style: "gamepad",
      }),
    ).toThrow(/no 'gamepad' style/);
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
    // A style that places the whole space-sim vocabulary: more actions than there are
    // out-of-the-way keys.
    const layouts = repoPath("genres/SpaceSims/layouts.yaml");
    const before = readFileSync(layouts, "utf8");
    const defaults = new Set(
      JSON.stringify(loadProfileData("genres/SpaceSims/default.yaml").positions).match(
        /[a-z_0-9]+/g,
      ),
    );
    const rest = Object.entries(
      Genre.discover().find((genre) => genre.name === "SpaceSims")?.actions.actions ?? {},
    )
      .filter(([id, spec]) => !spec.provided_by && !defaults.has(id))
      .map(([id]) => id);
    const fingers = ["pinky", "ring", "middle", "index"].flatMap((col) =>
      [1, 2, 3, 4, 5].map((row) => `${col}_${String(row)}`),
    );
    const right = fingers.map(
      (position, index) => `    ${position}: {tap: ${rest[index] ?? "boost"}}`,
    );
    const style = ["everything:", "  label: Everything", "  left: default", "  right:", ...right];
    writeFileSync(layouts, `${before}\n${style.join("\n")}\n`, "utf8");
    let result: ReturnType<typeof startGame>;
    try {
      result = startGame({
        name: "ZZ Sim",
        slug: "zzSim",
        genre: "SpaceSims",
        devices: ["cyborg2-left", "cyborg2-right"],
        set: "v1",
        style: "everything",
      });
    } finally {
      writeFileSync(layouts, before, "utf8");
    }
    expect(result.leftOff.length).toBeGreaterThan(0);
    const both = ["left", "right"].map((unit) =>
      loadProfileData(`${SIM}/profiles/v1-${unit}.yaml`),
    );
    const placed = JSON.stringify(both.map((data) => data.positions));
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
