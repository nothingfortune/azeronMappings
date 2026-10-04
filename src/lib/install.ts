/**
 * Write a compiled profile straight into the Azeron app's own profile store.
 *
 * The app is Electron and keeps one JSON file per profile at
 *   <store>/DevicesStorage/<deviceId>/ProfileStorage/profile_<uuid>.json
 * where each file is exactly the object our export puts in `profiles[0]`.
 *
 * Two things make this unsupported rather than merely undocumented:
 *   1. the stored schema is a strict SUBSET of the export schema -- the app expands
 *      defaults on export -- so we project our object down to the shape of a profile
 *      the app itself wrote, when one is available to copy the shape from;
 *   2. the app reads this directory at startup and rewrites it as it pleases, so it has
 *      to be closed or it will overwrite whatever we put there.
 *
 * Importing through the app stays the supported path. This is the shortcut, and it
 * refuses to run rather than guess.
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

import type { ExportProfile } from "../types/azeron.js";

export class InstallError extends Error {}

const STORE_TAIL = join("Azeron Software", "Storage", "DevicesStorage");

function wslWindowsHome(): string | null {
  try {
    if (!readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft")) return null;
  } catch {
    return null;
  }
  const users = "/mnt/c/Users";
  if (!existsSync(users)) return null;
  for (const user of readdirSync(users)) {
    const candidate = join(users, user, "AppData", "Roaming", STORE_TAIL);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Where the app keeps its profiles, or null when it cannot be found. */
export function findStore(explicit?: string): string | null {
  if (explicit) return explicit;
  const fromEnv = process.env.AZERON_STORE;
  if (fromEnv) return fromEnv;

  const candidates: string[] = [];
  const home = homedir();
  switch (platform()) {
    case "win32": {
      const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
      candidates.push(join(appData, STORE_TAIL));
      break;
    }
    case "darwin":
      candidates.push(join(home, "Library", "Application Support", STORE_TAIL));
      break;
    default:
      candidates.push(join(home, ".config", STORE_TAIL));
      break;
  }
  const wsl = wslWindowsHome();
  if (wsl) candidates.push(wsl);

  return candidates.find((path) => existsSync(path)) ?? null;
}

export function listDeviceIds(store: string): string[] {
  if (!existsSync(store)) return [];
  return readdirSync(store)
    .filter((name) => existsSync(join(store, name, "ProfileStorage")))
    .sort();
}

export interface StoredProfileInfo {
  id: string;
  name: string;
  file: string;
}

export function listStoredProfiles(store: string, deviceId: string): StoredProfileInfo[] {
  const dir = join(store, deviceId, "ProfileStorage");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const data = JSON.parse(readFileSync(join(dir, file), "utf8")) as ExportProfile;
      return { id: data.id, name: data.name, file };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface StoredProfile {
  deviceId: string;
  /** The file, under the store. */
  path: string;
  /** When the app last wrote it. */
  modified: Date;
  profile: ExportProfile;
}

/**
 * Every copy of a profile the app holds under `name`, newest first. The app gives an
 * imported profile a new id but keeps its name, so the name is what finds it; importing
 * the same file twice leaves two. A file that does not parse is passed over: the app owns
 * the directory, and a half-written file is its business.
 */
export function findStoredProfiles(store: string, name: string): StoredProfile[] {
  const found: StoredProfile[] = [];
  for (const deviceId of listDeviceIds(store)) {
    const dir = join(store, deviceId, "ProfileStorage");
    for (const file of readdirSync(dir).filter((entry) => entry.endsWith(".json"))) {
      const path = join(dir, file);
      let profile: ExportProfile;
      try {
        profile = JSON.parse(readFileSync(path, "utf8")) as ExportProfile;
      } catch {
        continue;
      }
      if (profile.name !== name || !Array.isArray(profile.inputs)) continue;
      found.push({ deviceId, path, modified: statSync(path).mtime, profile });
    }
  }
  return found.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

/** True when the Azeron app looks like it is running. */
export function appIsRunning(): boolean {
  const isWindowsish = platform() === "win32" || wslWindowsHome() !== null;
  try {
    if (isWindowsish) {
      const out = execFileSync("tasklist.exe", ["/FI", "IMAGENAME eq Azeron Software.exe"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return out.includes("Azeron Software.exe");
    }
    const out = execFileSync("pgrep", ["-f", "Azeron"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().length > 0;
  } catch {
    // pgrep exits non-zero when nothing matches, and tasklist may not exist at all.
    return false;
  }
}

/**
 * Project a profile onto the key set the app itself writes.
 *
 * Without a reference the export shape is used as-is, which carries fields the store has
 * never been seen to hold.
 */
export function shapeLikeStored(
  profile: ExportProfile,
  reference: ExportProfile | null,
): ExportProfile {
  if (!reference) return profile;

  const pick = (
    source: Record<string, unknown>,
    model: Record<string, unknown>,
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(model)) {
      if (!(key in source)) continue;
      const value = source[key];
      const modelValue = model[key];
      if (
        key === "inputs" &&
        Array.isArray(value) &&
        Array.isArray(modelValue) &&
        modelValue.length > 0
      ) {
        const inputModel = modelValue[0] as Record<string, unknown>;
        out[key] = value.map((record) => pick(record as Record<string, unknown>, inputModel));
      } else {
        out[key] = value;
      }
    }
    return out;
  };

  return pick(profile, reference) as unknown as ExportProfile;
}

export interface InstallOptions {
  store: string;
  deviceId: string;
  profile: ExportProfile;
  dryRun?: boolean;
}

export interface InstallResult {
  path: string;
  backedUpTo?: string;
  shaped: boolean;
  wrote: boolean;
}

export function installProfile(options: InstallOptions): InstallResult {
  const { store, deviceId, profile } = options;
  const dir = join(store, deviceId, "ProfileStorage");
  if (!existsSync(dir)) {
    if (options.dryRun)
      throw new InstallError(`no ProfileStorage for device ${deviceId} in ${store}`);
    mkdirSync(dir, { recursive: true });
  }

  const existing = listStoredProfiles(store, deviceId);
  const first = existing[0];
  const reference = first
    ? (JSON.parse(readFileSync(join(dir, first.file), "utf8")) as ExportProfile)
    : null;
  const payload = shapeLikeStored(profile, reference);

  const target = join(dir, `profile_${profile.id}.json`);
  const result: InstallResult = { path: target, shaped: reference !== null, wrote: false };

  if (existsSync(target)) {
    const backup = `${target}.bak-${new Date().toISOString().replace(/[:.]/g, "")}`;
    if (!options.dryRun) copyFileSync(target, backup);
    result.backedUpTo = backup;
  }

  if (!options.dryRun) {
    writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    result.wrote = true;
  }
  return result;
}
