import { realpathSync } from "node:fs";
import * as nodePath from "node:path";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root, resolved from this file's location rather than the working directory. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Join a repo-relative path onto the repo root; absolute paths pass through. */
export function repoPath(...parts: readonly string[]): string {
  const joined = join(...parts);
  return isAbsolute(joined) ? joined : join(repoRoot, joined);
}

/** The parts of `node:path` the repo-relative helpers use, so a test can pass `win32`. */
export type PathApi = Pick<typeof nodePath, "relative">;

/**
 * A path with forward slashes only.
 *
 * Repo-relative paths are identifiers: they are compared with the ones the editor sends,
 * written into profile metadata and stored in the committed dist. On Windows `path.join`
 * and `path.relative` produce backslashes, and `games\SpaceSims\everspace` is not equal to
 * `games/SpaceSims/everspace`. Every repo-relative path is made here, in one spelling.
 */
export function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

/** `target` relative to `root`, in forward slashes whatever the platform. */
export function repoRelativePath(root: string, target: string, api: PathApi = nodePath): string {
  return toPosix(api.relative(root, target));
}

/** `path.join`, in forward slashes whatever the platform. */
export function posixJoin(...parts: readonly string[]): string {
  return toPosix(join(...parts));
}

/**
 * Whether `argv1` (what node was started with) is the module at `moduleUrl`.
 *
 * A substring test on the script name is true for any unrelated path that happens to
 * contain it, and the entry point then runs a second time under another script.
 */
export function isEntryPoint(argv1: string | undefined, moduleUrl: string): boolean {
  if (argv1 === undefined || argv1 === "") return false;
  const real = (path: string): string => {
    try {
      return realpathSync(path);
    } catch {
      return resolve(path);
    }
  };
  return real(argv1) === real(fileURLToPath(moduleUrl));
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
