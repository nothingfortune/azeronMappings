import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root, resolved from this file's location rather than the working directory. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Join a repo-relative path onto the repo root; absolute paths pass through. */
export function repoPath(...parts: readonly string[]): string {
  const joined = join(...parts);
  return isAbsolute(joined) ? joined : join(repoRoot, joined);
}

/** Where hand-authored data lives. */
export const dataDirs = {
  devices: "devices",
  genres: "genres",
  games: "games",
  templates: "templates",
  /** Compiled Azeron import JSON and the game's bindings. Committed; not the TypeScript build. */
  dist: "dist",
} as const;

/**
 * A path as the machine the Azeron app runs on would write it.
 *
 * The app is Windows-only, so a file it has to import is picked in a Windows dialog. From
 * WSL the repo is under /mnt/c/..., which that dialog cannot take; the same file is
 * C:\\... there. Anything else passes through.
 */
export function hostPath(path: string): string {
  const mounted = /^\/mnt\/([a-z])\/(.*)$/.exec(path);
  if (!mounted) return path;
  const [, drive = "c", rest = ""] = mounted;
  return `${drive.toUpperCase()}:\\${rest.replace(/\//g, "\\")}`;
}
