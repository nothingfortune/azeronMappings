/** Repo-aware discovery: games, genres, and the loaders that read them from disk. */

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { dataDirs, repoPath, repoRoot } from "../config/paths.js";
import type { GameConfig, LintConfig, ProfileData } from "../types/profile.js";
import { loadActionSet, loadProfile, loadProfileData } from "./io.js";
import type { ActionSet, GameLike } from "./model-core.js";
import { Profile } from "./model-core.js";
import { loadYaml } from "./yaml-io.js";

export { ActionSet, Device, Profile } from "./model-core.js";
export type { GameLike } from "./model-core.js";
export { loadActionSet, loadDevice, loadProfile, loadTemplate } from "./io.js";

/** A game directory: games/<Genre>/<game>/. */
export class Game implements GameLike {
  readonly rel: string;
  readonly config: GameConfig;
  readonly slug: string;
  readonly name: string;
  readonly actions: ActionSet;
  readonly lintConfig: LintConfig;

  constructor(dir: string) {
    this.rel = relative(repoRoot, repoPath(dir));
    const configPath = join(this.rel, "game.yaml");
    this.config = existsSync(repoPath(configPath)) ? (loadYaml(configPath) as GameConfig) : {};
    this.slug = this.config.slug ?? basename(this.rel);
    this.name = this.config.name ?? this.slug;
    this.actions = loadActionSet(join(this.rel, "actions.yaml"));
    this.lintConfig = this.config.lint ?? {};
  }

  profilePaths(): string[] {
    const dir = join(this.rel, "profiles");
    if (!existsSync(repoPath(dir))) return [];
    return readdirSync(repoPath(dir))
      .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
      .sort()
      .map((file) => join(dir, file));
  }

  loadedProfiles(): Profile[] {
    return this.profilePaths().map((path) => loadProfile(path, this));
  }

  distDir(): string {
    return join(dataDirs.dist, relative(dataDirs.games, this.rel));
  }

  static discover(): Game[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(repoPath(dir))) {
        const child = join(dir, entry);
        if (!statSync(repoPath(child)).isDirectory()) continue;
        if (existsSync(repoPath(join(child, "actions.yaml")))) found.push(child);
        else walk(child);
      }
    };
    if (existsSync(repoPath(dataDirs.games))) walk(dataDirs.games);
    return found.sort().map((dir) => new Game(dir));
  }
}

/**
 * genres/<Name>/ -- the shared vocabulary and default layout for a kind of game.
 *
 * A genre default carries no keys: it says which ROLE sits at each position. That is
 * enough for every ergonomic rule to run on it, while keys stay a per-game concern.
 */
export class Genre {
  readonly name: string;
  readonly rel: string;
  readonly actions: ActionSet;
  readonly defaultPath: string;
  readonly config: ProfileData & { lint?: LintConfig };
  readonly lintConfig: LintConfig;

  constructor(dir: string) {
    this.rel = relative(repoRoot, repoPath(dir));
    this.name = basename(this.rel);
    this.actions = loadActionSet(join(this.rel, "actions.yaml"));
    this.defaultPath = join(this.rel, "default.yaml");
    this.config = loadProfileData(this.defaultPath);
    this.lintConfig = this.config.lint ?? {};
  }

  defaultProfile(): Profile {
    return loadProfile(this.defaultPath);
  }

  static discover(): Genre[] {
    if (!existsSync(repoPath(dataDirs.genres))) return [];
    return readdirSync(repoPath(dataDirs.genres))
      .filter((name) => existsSync(repoPath(join(dataDirs.genres, name, "actions.yaml"))))
      .sort()
      .map((name) => new Genre(join(dataDirs.genres, name)));
  }
}
