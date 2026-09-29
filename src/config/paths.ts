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
  /** Compiled Azeron import JSON and cheatsheets. Committed; not the TypeScript build. */
  dist: "dist",
} as const;
