/**
 * Finding a game's files on whatever computer runs the repo, and that computer's own
 * settings. Every machine here is a fake: no test reads the registry, a Steam library, a
 * real game's folder, or the owner's local.yaml.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadDevice } from "../../../src/lib/io.js";
import {
  candidatesFor,
  loadLocal,
  locate,
  LocalSettingsError,
  parseLibraryFolders,
  parseLocal,
  setLocalGamePath,
} from "../../../src/lib/machine.js";
import type { MachineContext } from "../../../src/lib/machine.js";
import { Game } from "../../../src/lib/model.js";

/** A Windows machine seen from PowerShell. */
const windows = (existing: string[] = []): MachineContext => ({
  platform: "win32",
  folders: (token) =>
    ({
      LOCALAPPDATA: ["C:\\Users\\sam\\AppData\\Local"],
      "PROGRAMFILES(X86)": ["C:\\Program Files (x86)"],
    })[token] ?? [],
  steamLibraries: () => ["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"],
  exists: (path) => existing.includes(path),
});

/** The same machine seen from WSL, with two Windows users. */
const wsl = (existing: string[] = []): MachineContext => ({
  platform: "linux",
  folders: (token) =>
    token === "LOCALAPPDATA"
      ? ["/mnt/c/Users/sam/AppData/Local", "/mnt/c/Users/kim/AppData/Local"]
      : [],
  steamLibraries: () => ["/mnt/c/Program Files (x86)/Steam", "/mnt/d/SteamLibrary"],
  exists: (path) => existing.includes(path),
});

/** Linux that is not WSL: no Windows folders at all. */
const plainLinux: MachineContext = {
  platform: "linux",
  folders: () => [],
  steamLibraries: () => [],
  exists: () => false,
};

const ES2 = "${LOCALAPPDATA}/ES2/Saved/Config/Windows/Input.ini";
const PRESET = "${steam:Elite Dangerous}/Products/odyssey/ControlSchemes/KeyboardMouseOnly.binds";

describe("candidatesFor", () => {
  it("finds a user's folder from PowerShell", () => {
    expect(candidatesFor(ES2, windows())).toEqual([
      "C:\\Users\\sam\\AppData\\Local\\ES2\\Saved\\Config\\Windows\\Input.ini",
    ]);
  });

  it("finds it under every Windows user from WSL", () => {
    expect(candidatesFor(ES2, wsl())).toEqual([
      "/mnt/c/Users/sam/AppData/Local/ES2/Saved/Config/Windows/Input.ini",
      "/mnt/c/Users/kim/AppData/Local/ES2/Saved/Config/Windows/Input.ini",
    ]);
  });

  it("looks for a Steam game in every library", () => {
    expect(candidatesFor(PRESET, windows())).toEqual([
      "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Elite Dangerous\\Products\\odyssey\\ControlSchemes\\KeyboardMouseOnly.binds",
      "D:\\SteamLibrary\\steamapps\\common\\Elite Dangerous\\Products\\odyssey\\ControlSchemes\\KeyboardMouseOnly.binds",
    ]);
    expect(candidatesFor(PRESET, wsl())[1]).toBe(
      "/mnt/d/SteamLibrary/steamapps/common/Elite Dangerous/Products/odyssey/ControlSchemes/KeyboardMouseOnly.binds",
    );
  });

  it("spells a literal path for the shell, whichever way it was written", () => {
    expect(candidatesFor("/mnt/c/Games/Input.ini", windows())).toEqual(["C:\\Games\\Input.ini"]);
    expect(candidatesFor("C:\\Games\\Input.ini", wsl())).toEqual(["/mnt/c/Games/Input.ini"]);
  });

  it("has nowhere to look on a computer without Windows", () => {
    expect(candidatesFor(ES2, plainLinux)).toEqual([]);
    expect(candidatesFor(PRESET, plainLinux)).toEqual([]);
  });
});

describe("locate", () => {
  const kim = "/mnt/c/Users/kim/AppData/Local/ES2/Saved/Config/Windows/Input.ini";

  it("takes the first place that exists", () => {
    expect(locate(undefined, ES2, wsl([kim]))).toMatchObject({
      path: kim,
      found: true,
      from: "game",
    });
  });

  it("names the first place looked when none exists, and says so", () => {
    const place = locate(undefined, ES2, wsl());
    expect(place.found).toBe(false);
    expect(place.path).toBe("/mnt/c/Users/sam/AppData/Local/ES2/Saved/Config/Windows/Input.ini");
    expect(place.tried).toHaveLength(2);
  });

  it("prefers this computer's own setting to the game's", () => {
    const place = locate("E:\\ES2\\Input.ini", ES2, windows(["E:\\ES2\\Input.ini"]));
    expect(place).toMatchObject({ path: "E:\\ES2\\Input.ini", found: true, from: "local" });
  });

  it("is nothing when nothing is named, and nothing where a token has no folder", () => {
    expect(locate(undefined, undefined, windows())).toMatchObject({ path: undefined, from: null });
    expect(locate(undefined, ES2, plainLinux)).toMatchObject({ path: undefined, from: "game" });
  });
});

describe("parseLibraryFolders", () => {
  it("reads the libraries Steam lists, unescaped", () => {
    const vdf = [
      '"libraryfolders"',
      "{",
      '\t"0"',
      "\t{",
      '\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"',
      '\t\t"label"\t\t""',
      "\t}",
      '\t"1"',
      "\t{",
      '\t\t"path"\t\t"D:\\\\SteamLibrary"',
      "\t}",
      "}",
    ].join("\n");
    expect(parseLibraryFolders(vdf)).toEqual([
      "C:\\Program Files (x86)\\Steam",
      "D:\\SteamLibrary",
    ]);
  });
});

describe("local.yaml", () => {
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "azeron-local-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("the committed example is a valid local.yaml", () => {
    const example = parseLocal(readFileSync("local.example.yaml", "utf8"));
    expect(example.games.everspace?.ingame_config).toContain("Input.ini");
    expect(example.devices["cyborg2-left"]?.software_device_id).toBe("12345");
  });

  it("is nothing when there is no file", () => {
    expect(loadLocal(root)).toEqual({ games: {}, devices: {} });
  });

  it("takes a unit's id written as a number", () => {
    expect(parseLocal("devices:\n  cyborg2-left:\n    software_device_id: 4242\n").devices).toEqual(
      {
        "cyborg2-left": { software_device_id: "4242" },
      },
    );
  });

  it("refuses a setting that is not one", () => {
    expect(() => parseLocal("games:\n  everspace:\n    ingame_confg: x\n")).toThrow(
      LocalSettingsError,
    );
    expect(() => parseLocal("- a list\n")).toThrow(LocalSettingsError);
  });

  it("sets a game's path and keeps what was there", () => {
    writeFileSync(
      join(root, "local.yaml"),
      '# mine\ndevices:\n  cyborg2-left:\n    software_device_id: "1"\n',
      "utf8",
    );
    setLocalGamePath("newGame", "export_to", "C:\\Exports", root);
    const text = readFileSync(join(root, "local.yaml"), "utf8");
    expect(text).toContain("# mine");
    expect(loadLocal(root)).toEqual({
      games: { newGame: { export_to: "C:\\Exports" } },
      devices: { "cyborg2-left": { software_device_id: "1" } },
    });
  });

  it("starts the file when there is none", () => {
    setLocalGamePath("newGame", "export_to", "/mnt/c/Exports", root);
    expect(readFileSync(join(root, "local.yaml"), "utf8")).toContain("Git ignores this file");
    expect(loadLocal(root).games.newGame?.export_to).toBe("/mnt/c/Exports");
  });
});

describe("this computer's units", () => {
  it("gives a device map the id local.yaml has for it", () => {
    const local = { games: {}, devices: { "cyborg2-left": { software_device_id: "777" } } };
    expect(loadDevice("cyborg2-left", local).softwareDeviceId).toBe("777");
    expect(loadDevice("cyborg2-right", local).softwareDeviceId).toBe(
      loadDevice("cyborg2-right", { games: {}, devices: {} }).softwareDeviceId,
    );
  });
});

describe("a game's places", () => {
  it("records where its file was looked for, from game.yaml", () => {
    const game = new Game("games/SpaceSims/everspace");
    expect(game.places.ingame_config.from).toBe("game");
    expect(game.places.ingame_config.found).toBe(false);
    expect(game.config.ingame_config).toBe(game.places.ingame_config.path);
    expect(game.places.export_to.from).toBeNull();
    expect(game.config.export_to).toBeUndefined();
  });
});
