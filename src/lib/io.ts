/** Every filesystem touch the toolchain makes, in one place. */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";

import { dataDirs, repoPath } from "../config/paths.js";
import type { ExportDocument } from "../types/azeron.js";
import type { DeviceData, ProfileData } from "../types/profile.js";
import type { GameLike } from "./model-core.js";
import { ActionSet, Device, Profile } from "./model-core.js";
import { normalizeProfileData } from "./normalize.js";
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

export function writeText(path: string, text: string): void {
  const full = repoPath(path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text, "utf8");
}
