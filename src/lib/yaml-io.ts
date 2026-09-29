/** Reading YAML off disk. The pure shaping lives in `yaml.ts`. */

import { readFileSync } from "node:fs";
import { parse } from "yaml";

import { repoPath } from "../config/paths.js";
import { withoutKey } from "./object.js";
import { deepMerge, isPlainObject } from "./yaml.js";

export { deepMerge, dumpYaml } from "./yaml.js";

export function loadYaml(path: string): unknown {
  return parse(readFileSync(repoPath(path), "utf8"));
}

/**
 * Load YAML, resolving an `extends:` chain of repo-relative paths.
 *
 * Genre defaults use this twice over: a game's actions.yaml inherits the genre's action
 * vocabulary and supplies only the in-game keys, and a profile inherits the genre's
 * default layout and overrides only the positions it changes.
 */
export function loadInherited(path: string): Record<string, unknown> {
  const parsed = loadYaml(path);
  const data = isPlainObject(parsed) ? parsed : {};
  const parent = data.extends;
  if (typeof parent !== "string") return data;
  return deepMerge(loadInherited(parent), withoutKey(data, "extends"));
}
