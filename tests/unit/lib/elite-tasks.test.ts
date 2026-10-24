/**
 * `azeron ingame` for Elite Dangerous: the report, the committed copy, and the write into
 * the player's bindings folder. The "player's" folder is a scratch directory under the OS
 * temp dir; nothing here is pointed at the real one.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import { parseBinds } from "../../../src/lib/elite.js";
import { IngameError } from "../../../src/lib/ingame.js";
import { Game } from "../../../src/lib/model.js";
import { ActionSet } from "../../../src/lib/model-core.js";
import { applyIngame, ingameDistPath, ingameReport } from "../../../src/lib/tasks.js";
import type { ActionSpec, GameConfig } from "../../../src/types/profile.js";

const PRESET = repoPath("tests/fixtures/elite-KeyboardMouseOnly.binds");
const OLD_CUSTOM = repoPath("tests/fixtures/elite-Custom.4.1.binds");

const ACTIONS: Record<string, ActionSpec> = {
  boost: { ingame: "UseBoostJuice", key: "KeyB" },
  jump: { ingame: "HumanoidJumpButton", key: "KeyJ", meta: "ShiftLeft" },
};

let folder = "";
const elite = (config: GameConfig = {}, actions = ACTIONS): Game => {
  const game = new Game("games/SpaceSims/everspace");
  Object.assign(game, {
    rel: "games/SpaceSims/elitetest",
    config: {
      ingame_format: "elite-binds",
      ingame_config: join(folder, "Custom.4.1.binds"),
      ingame_preset: PRESET,
      ...config,
    },
    actions: new ActionSet({ actions }),
  });
  return game;
};

const START = ["ClassicKeyboardOnly", "GenericJoystick", "KeyboardMouseOnly", "KeyboardMouseOnly"];

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "azeron-elite-"));
  writeFileSync(join(folder, "StartPreset.4.start"), `${START.join("\n")}\n`);
  writeFileSync(join(folder, "Custom.4.1.binds"), readFileSync(OLD_CUSTOM));
});
const scratchDist = repoPath("dist/SpaceSims/elitetest");
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
  rmSync(scratchDist, { recursive: true, force: true });
});
afterAll(() => {
  rmSync(scratchDist, { recursive: true, force: true });
});

const committed = (game: Game): string => repoPath(ingameDistPath(game));

describe("applyIngame for Elite, to the repo only", () => {
  it("starts from the preset, not the player's file, and writes the committed copy", () => {
    const game = elite();
    const result = applyIngame(game, { write: true });
    expect(result.source).toBe(PRESET);
    expect(ingameDistPath(game)).toMatch(/dist\/SpaceSims\/elitetest\/Custom\.4\.1\.binds$/);
    expect(result.written).toEqual([ingameDistPath(game)]);
    const binds = parseBinds(readFileSync(committed(game), "utf8"));
    expect([binds.preset, binds.major, binds.minor]).toEqual(["Custom", "4", "1"]);
    expect(result.pedals).toBeNull();
    expect(result.collisions).toEqual([]);
    // The player's folder is untouched.
    expect(readFileSync(join(folder, "Custom.4.1.binds"))).toEqual(readFileSync(OLD_CUSTOM));
    expect(readdirSync(folder).sort()).toEqual(["Custom.4.1.binds", "StartPreset.4.start"]);
  });

  it("reports changes in the shape the editor shows", () => {
    const result = applyIngame(elite(), { write: false });
    expect(result.written).toEqual([]);
    expect(result.changes).toEqual([
      {
        action: "boost",
        display: "Engine boost [primary]",
        category: 0,
        from: "Tab",
        to: "KeyB",
        by: "boost",
      },
      {
        action: "jump",
        display: expect.stringContaining("[primary]") as string,
        category: 0,
        from: "Space",
        to: "ShiftLeft+KeyJ",
        by: "jump",
      },
    ]);
  });

  it("makes the committed copy a fixed point of the vocabulary", () => {
    const game = elite();
    applyIngame(game, { write: true });
    const first = readFileSync(committed(game), "utf8");
    const again = applyIngame(game, { write: true, override: committed(game) });
    expect(again.changes).toEqual([]);
    expect(readFileSync(committed(game), "utf8")).toBe(first);
  });

  it("falls back to the committed copy where the preset is not installed", () => {
    const game = elite();
    applyIngame(game, { write: true });
    const there = elite({ ingame_preset: join(folder, "not-installed.binds") });
    const result = applyIngame(there, { write: true });
    expect(result.source).toBe(committed(there));
    expect(result.changes).toEqual([]);
  });

  it("turns a refusal from the writer into an IngameError", () => {
    const game = elite({}, { x: { ingame: "UseBoostJuice", key: "Fn" } });
    expect(() => applyIngame(game, { write: true })).toThrow(IngameError);
    expect(existsSync(committed(game))).toBe(false);
  });
});

describe("applyIngame for Elite, to the game", () => {
  it("backs up both files, writes the bindings, and points every category at Custom", () => {
    const game = elite();
    const result = applyIngame(game, { write: true, toGame: true });
    const live = join(folder, "Custom.4.1.binds");
    const start = join(folder, "StartPreset.4.start");
    expect(result.written).toEqual([ingameDistPath(game), live, start]);
    expect(readFileSync(live, "utf8")).toBe(readFileSync(committed(game), "utf8"));
    expect(readFileSync(start, "utf8")).toBe("Custom\nCustom\nCustom\nCustom\n");
    expect(result.backups).toHaveLength(2);
    expect(result.backup).toBe(result.backups?.[0]);
    const [custom, preset] = result.backups ?? [];
    expect(custom).toMatch(/Custom\.4\.1\.binds\.bak-\d{4}-/);
    expect(preset).toMatch(/StartPreset\.4\.start\.bak-\d{4}-/);
    expect(readFileSync(custom ?? "")).toEqual(readFileSync(OLD_CUSTOM));
    expect(readFileSync(preset ?? "", "utf8")).toBe(`${START.join("\n")}\n`);
  });

  it("keeps the number of lines and the line ending of StartPreset.4.start", () => {
    writeFileSync(join(folder, "StartPreset.4.start"), "A\r\nB\r\nC\r\n");
    applyIngame(elite(), { write: true, toGame: true });
    expect(readFileSync(join(folder, "StartPreset.4.start"), "utf8")).toBe(
      "Custom\r\nCustom\r\nCustom\r\n",
    );
  });

  it("changes nothing, and backs nothing up, the second time", () => {
    const game = elite();
    applyIngame(game, { write: true, toGame: true });
    const second = applyIngame(game, { write: true, toGame: true });
    expect(second.backups).toEqual([]);
    expect(second.backup).toBeNull();
    expect(second.written).toEqual([ingameDistPath(game)]);
    expect(readdirSync(folder)).toHaveLength(4);
  });

  it("does not touch the game unless asked", () => {
    applyIngame(elite(), { write: true });
    expect(readFileSync(join(folder, "StartPreset.4.start"), "utf8")).toBe(`${START.join("\n")}\n`);
  });

  it("creates the bindings file when the folder has none", () => {
    rmSync(join(folder, "Custom.4.1.binds"));
    const result = applyIngame(elite(), { write: true, toGame: true });
    expect(existsSync(join(folder, "Custom.4.1.binds"))).toBe(true);
    expect(result.backups).toHaveLength(1);
  });

  describe("refuses before writing anything", () => {
    const refuses = (game: Game, pattern: RegExp): void => {
      expect(() => applyIngame(game, { write: true, toGame: true })).toThrow(IngameError);
      expect(() => applyIngame(game, { write: true, toGame: true })).toThrow(pattern);
      expect(existsSync(committed(game))).toBe(false);
      expect(readdirSync(folder).sort()).toEqual(["Custom.4.1.binds", "StartPreset.4.start"]);
      expect(readFileSync(join(folder, "StartPreset.4.start"), "utf8")).toBe(
        `${START.join("\n")}\n`,
      );
    };

    it("without an ingame_config", () => {
      const game = elite();
      delete game.config.ingame_config;
      refuses(game, /no ingame_config/);
    });

    it("when the bindings folder does not exist", () => {
      refuses(elite({ ingame_config: join(folder, "gone", "Custom.4.1.binds") }), /gone/);
    });

    it("when the preset is not installed", () => {
      refuses(elite({ ingame_preset: join(folder, "nope.binds") }), /preset.*nope\.binds/);
    });

    it("when there is no StartPreset.4.start to change", () => {
      rmSync(join(folder, "StartPreset.4.start"));
      const game = elite();
      expect(() => applyIngame(game, { write: true, toGame: true })).toThrow(/StartPreset/);
      expect(existsSync(committed(game))).toBe(false);
      expect(readFileSync(join(folder, "Custom.4.1.binds"))).toEqual(readFileSync(OLD_CUSTOM));
    });

    it("when the vocabulary cannot be written", () => {
      const game = elite({}, { x: { ingame: "UseBoostJuice", key: "Fn" } });
      expect(() => applyIngame(game, { write: true, toGame: true })).toThrow(/Fn/);
      expect(existsSync(committed(game))).toBe(false);
      expect(readFileSync(join(folder, "StartPreset.4.start"), "utf8")).toBe(
        `${START.join("\n")}\n`,
      );
    });
  });
});

describe("ingameReport for Elite", () => {
  it("compares the player's file and says which controls differ", () => {
    const game = elite({}, { ...ACTIONS, ghost: { ingame: "NoSuchControl", key: "KeyG" } });
    const report = ingameReport(game);
    expect(report.path).toBe(join(folder, "Custom.4.1.binds"));
    expect(report.pedals).toBeNull();
    expect(report.collisions).toEqual([]);
    expect(report.rows.map((row) => [row.action, row.status])).toEqual([
      ["boost", "differs"],
      ["jump", "differs"],
      ["ghost", "unmatched"],
    ]);
  });

  it("agrees once the game has been given what we wrote", () => {
    const game = elite();
    applyIngame(game, { write: true, toGame: true });
    expect(ingameReport(game).rows.map((row) => row.status)).toEqual(["agrees", "agrees"]);
  });

  it("reads a file named by hand", () => {
    expect(ingameReport(elite(), PRESET).path).toBe(PRESET);
    expect(() => ingameReport(elite(), join(folder, "nope"))).toThrow(/does not exist/);
  });
});
