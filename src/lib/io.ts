/** Every filesystem touch the toolchain makes, in one place. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";

import { dataDirs, repoPath } from "../config/paths.js";
import type { ExportDocument } from "../types/azeron.js";
import type { PedalsDeviceData, SetsData } from "../types/pedals.js";
import type { DeviceData, ProfileData } from "../types/profile.js";
import type { GameLike } from "./model-core.js";
import { ActionSet, Device, Profile } from "./model-core.js";
import { normalizeProfileData } from "./normalize.js";
import { parsePedalsDevice, parseSets } from "./pedals.js";
import { StickModeError, validateStickModes } from "./stickmodes.js";
import type { StickModeSet } from "./stickmodes.js";
import { loadInherited, loadYaml } from "./yaml-io.js";

export function loadTemplate(path: string): ExportDocument {
  return JSON.parse(readFileSync(repoPath(path), "utf8")) as ExportDocument;
}

export const loadExport = loadTemplate;

export function loadDevice(nameOrPath: string): Device {
  const path =
    nameOrPath.includes(sep) || nameOrPath.includes("/") || nameOrPath.endsWith(".yaml")
      ? nameOrPath
      : join(dataDirs.devices, `${nameOrPath}.yaml`);
  return new Device(loadYaml(path) as DeviceData, path);
}

export function loadActionSet(path: string): ActionSet {
  return new ActionSet(loadInherited(path), path);
}

export function loadProfileData(path: string): ProfileData {
  return normalizeProfileData(loadInherited(path), path);
}

export function loadProfile(path: string, game: GameLike | null = null): Profile {
  const data = loadProfileData(path);
  return new Profile(data, loadDevice(data.profile.device), { path, game });
}

/** A pedals device file, parsed, with the text it came from for patching. */
export interface LoadedPedals {
  data: PedalsDeviceData;
  path: string;
  text: string;
}

/**
 * `devices/<name>.yaml` as a pedals device, or null when there is no such file. A file
 * that exists and is malformed throws: a layout must not quietly lose its pedals.
 */
export function loadPedalsDevice(name: string): LoadedPedals | null {
  const path = join(dataDirs.devices, `${name}.yaml`);
  if (!existsSync(repoPath(path))) return null;
  const text = readFileSync(repoPath(path), "utf8");
  return { data: parsePedalsDevice(loadYaml(path), path), path, text };
}

/** A game's `sets.yaml`, or no sets when it has none. */
export function loadSets(gameRel: string): SetsData {
  const path = join(gameRel, "sets.yaml");
  if (!existsSync(repoPath(path))) return { sets: {} };
  return parseSets(loadYaml(path), path);
}

/** A genre's stick modes, validated, or undefined when it defines none. */
export function loadStickModes(genreRel: string): StickModeSet | undefined {
  const path = join(genreRel, "stick-modes.yaml");
  if (!existsSync(repoPath(path))) return undefined;
  const set = loadInherited(path) as unknown as StickModeSet;
  const problems = validateStickModes(set);
  if (problems.length > 0) throw new StickModeError(`${path}:\n  ${problems.join("\n  ")}`);
  return set;
}

export function writeText(path: string, text: string): void {
  const full = repoPath(path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text, "utf8");
}
