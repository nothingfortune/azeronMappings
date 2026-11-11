/** Repo-aware discovery: games, genres, and the loaders that read them from disk. */

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename } from "node:path";

// Every path built here is a repo-relative identifier, so `join` is the forward-slash one.
import {
  dataDirs,
  posixJoin as join,
  repoPath,
  repoRelativePath,
  dataRelativePath,
} from "../config/paths.js";
import { locate, loadLocal, machineContext, MACHINE_PATHS } from "./machine.js";
import type { Located, MachinePathField } from "./machine.js";
import { messageOf, removeKey } from "./object.js";
import type { SetsData } from "../types/pedals.js";
import type { GameConfig, LintConfig, ProfileData } from "../types/profile.js";
import {
  loadActionSet,
  loadPedalsDevice,
  loadProfile,
  loadProfileData,
  loadSets,
  loadStickModes,
} from "./io.js";
import type { LoadedPedals } from "./io.js";
import type { ActionSet, GameLike } from "./model-core.js";
import { Profile } from "./model-core.js";
import type { StickModeSet } from "./stickmodes.js";
import { parseStyles } from "./styles.js";
import type { StyleSpec } from "./styles.js";
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
  /** The parts of a layout that belong to no single profile: today, its pedals. */
  readonly sets: SetsData;
  /**
   * Where each of game.yaml's outside paths led on this machine. `config` holds the place
   * found (or, when none was, the first place looked), so every reader sees one path.
   */
  readonly places: Record<MachinePathField, Located>;

  constructor(dir: string) {
    this.rel = dataRelativePath(dir);
    const configPath = join(this.rel, "game.yaml");
    const raw = existsSync(repoPath(configPath)) ? (loadYaml(configPath) as GameConfig) : {};
    this.slug = raw.slug ?? basename(this.rel);
    const mine = loadLocal().games[this.slug] ?? {};
    const ctx = machineContext();
    const config: GameConfig = { ...raw };
    const places = {} as Record<MachinePathField, Located>;
    for (const field of MACHINE_PATHS) {
      const place = locate(mine[field], raw[field], ctx);
      places[field] = place;
      if (place.path === undefined) removeKey(config, field);
      else config[field] = place.path;
    }
    this.places = places;
    this.config = config;
    this.name = this.config.name ?? this.slug;
    this.actions = loadActionSet(join(this.rel, "actions.yaml"));
    this.lintConfig = this.config.lint ?? {};
    this.sets = loadSets(this.rel);
  }

  /** The stick modes of this game's genre, which also name the axes pedals can drive. */
  get stickModes(): StickModeSet | undefined {
    const genre = this.rel.split("/")[1];
    return genre === undefined ? undefined : loadStickModes(join(dataDirs.genres, genre));
  }

  /** A pedals device by name, or null when no such file exists. */
  pedalsDevice(name: string): LoadedPedals | null {
    return loadPedalsDevice(name);
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

  /** Absolute directory outside the repo to mirror builds into, if configured. */
  exportDir(): string | undefined {
    return this.config.export_to;
  }

  distDir(): string {
    return join(dataDirs.dist, repoRelativePath(dataDirs.games, this.rel));
  }

  /**
   * Every game under `root` (the repo's games/ by default).
   *
   * A folder that is half made -- it has a game.yaml or profiles but no actions.yaml, or an
   * actions.yaml that will not load -- is skipped and named once on stderr. It used to
   * throw, and one unfinished folder then broke every command and the served editor.
   */
  static discover(root: string = dataDirs.games): Game[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(repoPath(dir))) {
        const child = join(dir, entry);
        if (!statSync(repoPath(child)).isDirectory()) continue;
        if (existsSync(repoPath(join(child, "actions.yaml")))) found.push(child);
        else if (
          existsSync(repoPath(join(child, "game.yaml"))) ||
          existsSync(repoPath(join(child, "profiles")))
        ) {
          reportSkipped(child, "it has no actions.yaml");
        } else walk(child);
      }
    };
    if (existsSync(repoPath(root))) walk(root);
    const games: Game[] = [];
    for (const dir of found.sort()) {
      try {
        games.push(new Game(dir));
      } catch (error) {
        reportSkipped(dir, messageOf(error));
      }
    }
    return games;
  }
}

const skippedReported = new Set<string>();

/** Name a skipped game folder on stderr, the first time only: discovery runs per request. */
function reportSkipped(dir: string, why: string): void {
  if (skippedReported.has(dir)) return;
  skippedReported.add(dir);
  process.stderr.write(`warning: skipping ${dir}: ${why}\n`);
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
  /** The styles a new game can start in (layouts.yaml); empty when it has none. */
  readonly styles: Record<string, StyleSpec>;

  constructor(dir: string) {
    this.rel = dataRelativePath(dir);
    this.name = basename(this.rel);
    this.actions = loadActionSet(join(this.rel, "actions.yaml"));
    this.defaultPath = join(this.rel, "default.yaml");
    this.config = loadProfileData(this.defaultPath);
    this.lintConfig = this.config.lint ?? {};
    const layouts = join(this.rel, "layouts.yaml");
    this.styles = existsSync(repoPath(layouts)) ? parseStyles(loadYaml(layouts), layouts) : {};
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
