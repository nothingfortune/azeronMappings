/**
 * The operations, as functions rather than commands.
 *
 * The CLI and the served editor both call these, so what the UI can do is what the CLI
 * can do -- not a subset that drifts. Each returns a result to render rather than
 * printing, because one caller has a terminal and the other has a page.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { repoPath } from "../config/paths.js";
import type { ExportDocument } from "../types/azeron.js";
import type { ProfileMeta } from "../types/profile.js";
import { compileProfile, dumps } from "./compile.js";
import { decompile, dumpProfile } from "./decompile.js";
import { compareToGame, gameCollisions, parseInput } from "./ingame.js";
import type { Comparison } from "./ingame.js";
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
  const path = override ?? game.config.ingame_config;
  if (path === undefined) throw new Error(`${game.slug} has no ingame_config in game.yaml`);
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  const file = parseInput(readFileSync(path, "utf8"));
  return { path, rows: compareToGame(game.actions, file), collisions: gameCollisions(file) };
}

/** Where a decompiled profile should live for a game and set. */
export function profilePathFor(game: Game, setName: string, unit: string): string {
  return join(game.rel, "profiles", `${setName}-${unit}.yaml`);
}

export function templatePathFor(game: Game, setName: string, unit: string): string {
  return join("templates", `${game.slug}-${setName}-${unit}.json`);
}

export { dirname };
