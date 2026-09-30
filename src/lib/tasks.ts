/**
 * The operations, as functions rather than commands.
 *
 * The CLI and the served editor both call these, so what the UI can do is what the CLI
 * can do -- not a subset that drifts. Each returns a result to render rather than
 * printing, because one caller has a terminal and the other has a page.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { repoPath } from "../config/paths.js";
import type { ExportDocument } from "../types/azeron.js";
import type { ProfileMeta } from "../types/profile.js";
import { compileProfile, dumps } from "./compile.js";
import { decompile, dumpProfile } from "./decompile.js";
import {
  applyVocabulary,
  compareToGame,
  gameCollisions,
  IngameError,
  ownedCollisions,
  parseInput,
} from "./ingame.js";
import type { Comparison, IngameChange } from "./ingame.js";
import { loadDevice, loadTemplate, writeText } from "./io.js";
import { ERROR, WARNING, formatFinding, lintGame, lintGenre } from "./lint.js";
import { Game, Genre } from "./model.js";
import type { Profile } from "./model-core.js";

export interface BuiltProfile {
  profile: string;
  output: string;
  changed: boolean;
  mirroredTo?: string;
}

export interface BuildResult {
  built: BuiltProfile[];
  errors: string[];
}

function templateFor(profile: Profile, game: Game): string {
  const path = profile.template ?? game.config.template;
  if (path === undefined) throw new Error(`${profile.path}: profile.template is required`);
  return path;
}

/** Compile every profile, and mirror to `export_to` where a game sets one. */
export function buildAll(games: readonly Game[], check = false): BuildResult {
  const built: BuiltProfile[] = [];
  const errors: string[] = [];

  for (const game of games) {
    for (const profile of game.loadedProfiles()) {
      let text: string;
      try {
        text = dumps(
          compileProfile(profile, {
            template: loadTemplate(templateFor(profile, game)),
            actions: game.actions.actions,
          }),
        );
      } catch (error) {
        errors.push(`${profile.path}: ${(error as Error).message}`);
        continue;
      }

      const outPath = join(game.distDir(), profile.outputName);
      const previous = existsSync(repoPath(outPath))
        ? readFileSync(repoPath(outPath), "utf8")
        : null;
      const changed = previous !== text;

      if (check) {
        if (changed) errors.push(`stale: ${outPath} does not match ${profile.path}`);
        built.push({ profile: profile.path, output: outPath, changed });
        continue;
      }

      writeText(outPath, text);
      const entry: BuiltProfile = { profile: profile.path, output: outPath, changed };

      const mirror = game.exportDir();
      if (mirror !== undefined) {
        const target = join(mirror, profile.outputName);
        mkdirSync(mirror, { recursive: true });
        writeFileSync(target, text, "utf8");
        entry.mirroredTo = target;
      }
      built.push(entry);
    }
  }
  return { built, errors };
}

export interface LintSummary {
  scope: string;
  errors: string[];
  warnings: string[];
  acknowledged: number;
}

/** Everything the linter has to say, genres included. */
export function lintAll(games: readonly Game[], genres: readonly Genre[]): LintSummary[] {
  const summarise = (scope: string, result: ReturnType<typeof lintGame>): LintSummary => ({
    scope,
    errors: result.live.filter((f) => f.level === ERROR).map(formatFinding),
    warnings: result.live.filter((f) => f.level === WARNING).map(formatFinding),
    acknowledged: result.acknowledged.length,
  });
  return [
    ...genres.map((genre) => summarise(`genres/${genre.name}`, lintGenre(genre))),
    ...games.map((game) => summarise(game.slug, lintGame(game))),
  ];
}

export interface ImportRequest {
  /** The raw export, as the Azeron app wrote it. */
  exported: ExportDocument;
  game: Game;
  device: string;
  /** Where the profile YAML goes, relative to the repo. */
  profilePath: string;
  meta?: Partial<ProfileMeta>;
  /** Where the export itself is kept, relative to the repo. */
  templatePath?: string;
  /** Replace an existing set. Refused by default -- a template is committed history. */
  overwrite?: boolean;
}

export class ImportCollision extends Error {
  constructor(readonly paths: string[]) {
    super(
      `that set already exists: ${paths.join(", ")}. Importing would overwrite it -- pass ` +
        "overwrite to replace it, or choose another set name.",
    );
  }
}

export interface ImportResult {
  profilePath: string;
  templatePath: string | undefined;
  yaml: string;
  positions: number;
}

/**
 * Bring an app export back into the repo as profile YAML.
 *
 * The export is kept as well when a path is given: it is the only record of what the
 * unit actually held, and the compiler needs it as a template.
 */
export function importExport(request: ImportRequest): ImportResult {
  const device = loadDevice(request.device);

  // Both writes are silent overwrites, and one of them is a committed template -- the only
  // record of what the unit actually held. Re-importing under a name already in use used
  // to destroy both without a word.
  if (request.overwrite !== true) {
    const taken = [request.profilePath, request.templatePath]
      .filter((path): path is string => path !== undefined)
      .filter((path) => existsSync(repoPath(path)));
    if (taken.length > 0) throw new ImportCollision(taken);
  }

  if (request.templatePath !== undefined) {
    writeText(request.templatePath, `${JSON.stringify(request.exported, null, 2)}\n`);
  }

  const meta: Partial<ProfileMeta> = { ...request.meta };
  if (request.templatePath !== undefined) meta.template = request.templatePath;

  const data = decompile(request.exported, device, { actions: request.game.actions, meta });
  const yaml = dumpProfile(data);
  writeText(request.profilePath, yaml);
  return {
    profilePath: request.profilePath,
    templatePath: request.templatePath,
    yaml,
    positions: Object.keys(data.positions).length,
  };
}

export interface IngameReport {
  path: string;
  rows: Comparison[];
  collisions: { key: string; actions: string[] }[];
}

/** What the game's own binding file says about the keys we send. */
export function ingameReport(game: Game, override?: string): IngameReport {
  const path = ingameSource(game, override);
  const file = parseInput(readFileSync(path, "utf8"));
  // Menus and photo mode reuse flight keys on purpose. Where a game says which categories
  // are live while flying, only a collision inside those is worth reporting.
  const owned = new Set(game.config.ingame_owned_categories ?? []);
  const collisions = owned.size > 0 ? ownedCollisions(file, owned) : gameCollisions(file);
  return { path, rows: compareToGame(game.actions, file), collisions };
}

/** The committed copy of the game's binding file, as last generated. */
export function ingameDistPath(game: Game): string {
  return join(game.distDir(), "Input.ini");
}

/**
 * The binding file to start from: the game's own when it is installed here, otherwise the
 * committed copy, so generating works on a machine without the game -- or in CI.
 */
function ingameSource(game: Game, override?: string): string {
  // A path asked for by name is the one meant. Falling back would report on a different
  // file than the one requested, and say nothing about it.
  if (override !== undefined) {
    if (!existsSync(override)) throw new Error(`${override} does not exist`);
    return override;
  }
  const live = game.config.ingame_config;
  if (live !== undefined && existsSync(live)) return live;
  const committed = repoPath(ingameDistPath(game));
  if (existsSync(committed)) return committed;
  throw new Error(
    live === undefined
      ? `${game.slug} has no ingame_config in game.yaml, and no committed copy to start from`
      : `${live} does not exist, and there is no committed copy to start from`,
  );
}

export interface IngameApplyResult {
  /** The file generation started from. */
  source: string;
  changes: IngameChange[];
  /** Pairs of rows still sharing a key in the owned categories. */
  collisions: { key: string; actions: string[] }[];
  /** Everything written, in order. Empty when `write` is false. */
  written: string[];
  /** Where the game's previous file was copied before being replaced, if it was. */
  backup: string | null;
}

/**
 * Make the game's binding file agree with actions.yaml.
 *
 * The committed copy under dist/ is always rewritten, so the repo records what the game
 * was given. The game's own file is only touched when it exists and would change, and is
 * copied aside first -- it belongs to the game, and the game must be closed, because it
 * rewrites the file on exit.
 */
export function applyIngame(
  game: Game,
  options: {
    /** Write anything at all. False is a dry run. */
    write: boolean;
    /** Also replace the game's own file. The committed copy is written either way. */
    toGame?: boolean;
    /** Read from this file instead of the game's. Never written to. */
    override?: string;
  },
): IngameApplyResult {
  const owned = new Set(game.config.ingame_owned_categories ?? []);
  if (owned.size === 0) {
    throw new IngameError(
      `${game.slug} owns no binding categories -- set ingame_owned_categories in game.yaml`,
    );
  }
  const source = ingameSource(game, options.override);
  const before = readFileSync(source, "utf8");
  const { text, changes } = applyVocabulary(parseInput(before), game.actions, owned);
  const collisions = ownedCollisions(parseInput(text), owned);

  const written: string[] = [];
  let backup: string | null = null;
  if (options.write) {
    const committed = ingameDistPath(game);
    writeText(committed, text);
    written.push(committed);

    const live = game.config.ingame_config;
    if (
      options.toGame === true &&
      live !== undefined &&
      existsSync(live) &&
      readFileSync(live, "utf8") !== text
    ) {
      backup = `${live}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      writeFileSync(backup, readFileSync(live));
      writeFileSync(live, text, "utf8");
      written.push(live);
    }
  }
  return { source, changes, collisions, written, backup };
}

/** Where a decompiled profile should live for a game and set. */
export function profilePathFor(game: Game, setName: string, unit: string): string {
  return join(game.rel, "profiles", `${setName}-${unit}.yaml`);
}

export function templatePathFor(game: Game, setName: string, unit: string): string {
  return join("templates", `${game.slug}-${setName}-${unit}.json`);
}
