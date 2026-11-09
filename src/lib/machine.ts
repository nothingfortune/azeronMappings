/**
 * Where this machine keeps the files a game.yaml names, and this machine's own settings.
 *
 * The repo is downloaded and run by people whose Windows user, Steam library and keypads are
 * not the owner's, from PowerShell or from WSL. So nothing per-machine goes in a committed
 * file. game.yaml names a game's files by where every install puts them --
 * `${LOCALAPPDATA}/ES2/...`, `${steam:Elite Dangerous}/...` -- and they are looked up here,
 * on whatever machine runs it. Anything unusual (a game installed somewhere odd, an export
 * folder, the ids of this person's units) goes in `local.yaml` at the data root, which git
 * ignores.
 *
 * The lookup is pure over a `MachineContext`; `machineContext()` is the real machine, and a
 * test passes its own, so no test reads the registry, a Steam library or a real game.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { posix, win32 } from "node:path";

import { parse, parseDocument } from "yaml";

import { dataRoot, localPath } from "../config/paths.js";
import { messageOf } from "./object.js";
import { isPlainObject } from "./yaml.js";

/** What a lookup needs to know about the machine. */
export interface MachineContext {
  platform: NodeJS.Platform;
  /**
   * The folders a Windows folder token names (`LOCALAPPDATA`, `APPDATA`, `USERPROFILE`,
   * `PROGRAMFILES`, `PROGRAMFILES(X86)`), spelled for this shell. Under WSL there is one per
   * Windows user, since WSL cannot ask which of them is at the keyboard.
   */
  folders(token: string): string[];
  /** Every Steam library folder, spelled for this shell. */
  steamLibraries(): string[];
  exists(path: string): boolean;
}

/** Where a game.yaml path led on this machine. */
export interface Located {
  /** The file found, or where it would be when none was; undefined when nothing was named. */
  path: string | undefined;
  found: boolean;
  /** Every place looked, in order. */
  tried: string[];
  /** Who named it: this machine's local.yaml, or the committed game.yaml. */
  from: "local" | "game" | null;
}

const TOKEN = /^\$\{([^}]+)\}(.*)$/;

/** Whether a path names a place by token rather than literally. */
export function hasToken(path: string): boolean {
  return TOKEN.test(path);
}

function tidy(path: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? win32.normalize(path) : posix.normalize(path.replace(/\\/g, "/"));
}

/**
 * Every place a game.yaml path could mean on this machine, in order.
 *
 * A literal path is one place, in this shell's spelling. A path that starts with a token is
 * one place per folder the token names: `${steam:Elite Dangerous}` is
 * `<library>/steamapps/common/Elite Dangerous` in each Steam library.
 */
export function candidatesFor(path: string, ctx: MachineContext): string[] {
  const match = TOKEN.exec(path);
  if (!match) return [localPath(path, ctx.platform)];
  const [, token = "", rest = ""] = match;
  const steam = /^steam:(.+)$/i.exec(token);
  const bases = steam
    ? ctx.steamLibraries().map((library) => `${library}/steamapps/common/${steam[1] ?? ""}`)
    : ctx.folders(token.toUpperCase());
  return bases.map((base) => tidy(`${base}${rest}`, ctx.platform));
}

/** The first place a path names that exists here, preferring this machine's own setting. */
export function locate(
  local: string | undefined,
  game: string | undefined,
  ctx: MachineContext,
): Located {
  const named = local ?? game;
  if (named === undefined) return { path: undefined, found: false, tried: [], from: null };
  const tried = candidatesFor(named, ctx);
  const hit = tried.find((path) => ctx.exists(path));
  return {
    path: hit ?? tried[0],
    found: hit !== undefined,
    tried,
    from: local === undefined ? "game" : "local",
  };
}

/** The library folders listed in Steam's `steamapps/libraryfolders.vdf`, as written there. */
export function parseLibraryFolders(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)) {
    found.push((match[1] ?? "").replace(/\\(.)/g, "$1"));
  }
  return found;
}

// ---------------------------------------------------------------------------------------
// The real machine. Each part is worked out once per process, on first use: the served
// editor discovers every game on every request.

function isWsl(): boolean {
  if (process.platform !== "linux") return false;
  try {
    return readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}

const NOT_PEOPLE = new Set(["all users", "default", "default user", "public", "wsiaccount"]);

let homesMemo: string[] | null = null;

/**
 * The Windows users' home folders, seen from WSL: `/mnt/c/Users/<name>`. The one named like
 * the WSL user comes first, when there is one. Empty anywhere but WSL.
 */
export function windowsHomes(): string[] {
  if (homesMemo !== null) return homesMemo;
  const users = "/mnt/c/Users";
  let homes: string[] = [];
  if (isWsl() && existsSync(users)) {
    homes = readdirSync(users)
      .filter((name) => !NOT_PEOPLE.has(name.toLowerCase()))
      .map((name) => `${users}/${name}`)
      .filter((path) => {
        try {
          return statSync(path).isDirectory();
        } catch {
          return false;
        }
      });
    const me = (process.env.USER ?? "").toLowerCase();
    homes.sort(
      (a, b) =>
        Number(b.toLowerCase().endsWith(`/${me}`)) - Number(a.toLowerCase().endsWith(`/${me}`)),
    );
  }
  homesMemo = homes;
  return homes;
}

const WINDOWS_ENV: Record<string, string> = {
  LOCALAPPDATA: "LOCALAPPDATA",
  APPDATA: "APPDATA",
  USERPROFILE: "USERPROFILE",
  PROGRAMFILES: "ProgramFiles",
  "PROGRAMFILES(X86)": "ProgramFiles(x86)",
};

const WSL_FOLDERS: Record<string, (home: string) => string> = {
  LOCALAPPDATA: (home) => `${home}/AppData/Local`,
  APPDATA: (home) => `${home}/AppData/Roaming`,
  USERPROFILE: (home) => home,
};

function realFolders(token: string): string[] {
  if (process.platform === "win32") {
    const name = WINDOWS_ENV[token];
    const value = name === undefined ? undefined : process.env[name];
    return value === undefined || value === "" ? [] : [value];
  }
  if (!isWsl()) return [];
  if (token === "PROGRAMFILES") return ["/mnt/c/Program Files"];
  if (token === "PROGRAMFILES(X86)") return ["/mnt/c/Program Files (x86)"];
  const under = WSL_FOLDERS[token];
  return under === undefined ? [] : windowsHomes().map(under);
}

/** Steam's own folder from the registry, on Windows; null when it says nothing. */
function registrySteamPath(): string | null {
  if (process.platform !== "win32") return null;
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      windowsHide: true,
    });
    const match = /SteamPath\s+REG_SZ\s+(.+)/.exec(out);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

let steamMemo: string[] | null = null;

function realSteamLibraries(): string[] {
  if (steamMemo !== null) return steamMemo;
  const roots = [
    registrySteamPath(),
    ...realFolders("PROGRAMFILES(X86)").map((dir) => `${dir}/Steam`),
    ...realFolders("PROGRAMFILES").map((dir) => `${dir}/Steam`),
  ].filter((root): root is string => root !== null);
  const seen = new Set<string>();
  const libraries: string[] = [];
  const add = (path: string): void => {
    const spelled = tidy(localPath(path), process.platform);
    const key = spelled.toLowerCase().replace(/[\\/]+$/, "");
    if (seen.has(key)) return;
    seen.add(key);
    libraries.push(spelled);
  };
  for (const root of roots) {
    const vdf = `${localPath(root)}/steamapps/libraryfolders.vdf`;
    if (!existsSync(vdf)) continue;
    add(root);
    try {
      for (const library of parseLibraryFolders(readFileSync(vdf, "utf8"))) add(library);
    } catch {
      // An unreadable list is no libraries beyond Steam's own.
    }
  }
  steamMemo = libraries;
  return libraries;
}

let contextMemo: MachineContext | null = null;

/** This machine. */
export function machineContext(): MachineContext {
  contextMemo ??= {
    platform: process.platform,
    folders: realFolders,
    steamLibraries: realSteamLibraries,
    exists: existsSync,
  };
  return contextMemo;
}

// ---------------------------------------------------------------------------------------
// local.yaml: this machine's own settings, never committed.

/** The paths in game.yaml that name places outside the repo. */
export const MACHINE_PATHS = ["ingame_config", "ingame_preset", "export_to"] as const;
export type MachinePathField = (typeof MACHINE_PATHS)[number];

export interface LocalSettings {
  /** Per game slug: a place for any of the game's paths, overriding game.yaml. */
  games: Record<string, Partial<Record<MachinePathField, string>>>;
  /** Per device map name: the id this person's unit reports. */
  devices: Record<string, { software_device_id?: string }>;
}

export const LOCAL_FILE = "local.yaml";

export class LocalSettingsError extends Error {}

/** `local.yaml`'s text as settings. A file that is not the expected shape throws. */
export function parseLocal(text: string, where = LOCAL_FILE): LocalSettings {
  const settings: LocalSettings = { games: {}, devices: {} };
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new LocalSettingsError(`${where} is not valid YAML: ${messageOf(error)}`);
  }
  if (data === null || data === undefined) return settings;
  if (!isPlainObject(data)) throw new LocalSettingsError(`${where} must be a mapping`);
  const section = (key: string): Record<string, unknown> => {
    const value = data[key];
    if (value === undefined || value === null) return {};
    if (!isPlainObject(value)) throw new LocalSettingsError(`${where}: ${key} must be a mapping`);
    return value;
  };
  for (const [slug, entry] of Object.entries(section("games"))) {
    if (!isPlainObject(entry))
      throw new LocalSettingsError(`${where}: games.${slug} must be a mapping`);
    const paths: Partial<Record<MachinePathField, string>> = {};
    for (const [field, value] of Object.entries(entry)) {
      if (!(MACHINE_PATHS as readonly string[]).includes(field)) {
        throw new LocalSettingsError(
          `${where}: games.${slug}.${field} is not a setting (${MACHINE_PATHS.join(", ")})`,
        );
      }
      if (typeof value !== "string") {
        throw new LocalSettingsError(`${where}: games.${slug}.${field} must be a path`);
      }
      paths[field as MachinePathField] = value;
    }
    settings.games[slug] = paths;
  }
  for (const [name, entry] of Object.entries(section("devices"))) {
    if (!isPlainObject(entry))
      throw new LocalSettingsError(`${where}: devices.${name} must be a mapping`);
    const id = entry.software_device_id;
    if (id === undefined) continue;
    if (typeof id !== "string" && typeof id !== "number") {
      throw new LocalSettingsError(
        `${where}: devices.${name}.software_device_id must be the unit's id`,
      );
    }
    settings.devices[name] = { software_device_id: String(id) };
  }
  return settings;
}

/** This machine's settings, read fresh: an edit by hand shows on the next request. */
export function loadLocal(root: string = dataRoot): LocalSettings {
  const file = `${root}/${LOCAL_FILE}`;
  if (!existsSync(file)) return { games: {}, devices: {} };
  return parseLocal(readFileSync(file, "utf8"), file);
}

const LOCAL_HEADER =
  "# This computer's own settings. Git ignores this file: nothing here is shared.\n" +
  "# local.example.yaml says what can go in it.\n";

/** Set one game's path in local.yaml, keeping whatever else and any comments it holds. */
export function setLocalGamePath(
  slug: string,
  field: MachinePathField,
  value: string,
  root: string = dataRoot,
): string {
  const file = `${root}/${LOCAL_FILE}`;
  const text = existsSync(file) ? readFileSync(file, "utf8") : LOCAL_HEADER;
  parseLocal(text, file);
  const doc = parseDocument(text);
  doc.setIn(["games", slug, field], value);
  writeFileSync(file, doc.toString(), "utf8");
  return file;
}
