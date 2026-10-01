/**
 * The operations, as functions rather than commands.
 *
 * The CLI and the served editor both call these, so what the UI can do is what the CLI
 * can do -- not a subset that drifts. Each returns a result to render rather than
 * printing, because one caller has a terminal and the other has a page.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { dataDirs, hostPath, repoPath } from "../config/paths.js";
import type { ExportDocument } from "../types/azeron.js";
import type { ProfileMeta } from "../types/profile.js";
import { compileProfile, dumps } from "./compile.js";
import { decompile, dumpProfile } from "./decompile.js";
import {
  applyPedalRows,
  applyVocabulary,
  compareToGame,
  gameCollisions,
  IngameError,
  ownedCollisions,
  parseInput,
} from "./ingame.js";
import type { Comparison, IngameChange, PedalChange, PedalPlan, PedalWaiting } from "./ingame.js";
import { loadDevice, loadProfileData, loadTemplate, writeText } from "./io.js";
import type { LoadedPedals } from "./io.js";
import { capturePedals, ingamePlan, planAxes, recordCandidateNames } from "./pedals.js";
import type { CaptureOptions, CaptureResult, PlannedAxis } from "./pedals.js";
import type { StickModeSet } from "./stickmodes.js";
import type { NameStatus } from "../types/pedals.js";
import { ERROR, WARNING, formatFinding, lintGame, lintGenre } from "./lint.js";
import type { Finding } from "./lint.js";
import { Game, Genre } from "./model.js";
import type { Profile } from "./model-core.js";
import {
  ScaffoldError,
  checkFileName,
  checkGameName,
  gameConfig,
  seedActions,
  slugFromName,
  unnamedPositions,
} from "./scaffold.js";
import { dumpYaml } from "./yaml.js";
import { messageOf } from "./object.js";

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
        errors.push(`${profile.path}: ${messageOf(error)}`);
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
  constructor(
    readonly paths: string[],
    message?: string,
  ) {
    super(
      message ??
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

export interface NewGameRequest {
  /** The raw export, as the Azeron app wrote it. */
  exported: ExportDocument;
  /** What the game is called, as a person says it. */
  name: string;
  /** The folder and file spelling. Derived from the name when left out. */
  slug?: string | undefined;
  /** One of the folders under genres/. */
  genre: string;
  /** A device map name from devices/ -- which unit the export came from. */
  device: string;
  /** What the first layout is called. */
  set: string;
  /** A directory outside the repo that builds are also copied to. The CLI's to give. */
  exportTo?: string | undefined;
  /** Replace a game or layout already on disk. Refused by default. */
  overwrite?: boolean;
}

export interface NewGameResult {
  slug: string;
  name: string;
  gameDir: string;
  templatePath: string;
  profilePath: string;
  /** How many actions were seeded from the keys the export sends. */
  actions: number;
  /** Positions the seeded vocabulary could not name. */
  unnamed: string[];
  positions: number;
}

/** Names of the device maps in devices/, without the extension. */
export function deviceNames(): string[] {
  const dir = repoPath(dataDirs.devices);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".yaml"))
    .map((file) => file.slice(0, -".yaml".length))
    .sort();
}

/**
 * Start a game from an Azeron export: its folder, its vocabulary, its game config, the
 * export kept as the compiler's template, and the first layout decompiled from it.
 *
 * Every name that lands in a path is checked here, so the page and the CLI get the same
 * answer and neither can write outside games/ or templates/. Nothing is written until all
 * of them pass, and a failure part way removes what this call created.
 */
export function createGame(request: NewGameRequest): NewGameResult {
  const name = checkGameName(request.name);
  const slug = checkFileName("game folder name", request.slug ?? slugFromName(name));
  const set = checkFileName("layout name", request.set);
  const genreNames = Genre.discover().map((genre) => genre.name);
  if (!genreNames.includes(request.genre)) {
    throw new ScaffoldError(
      `'${request.genre}' is not a genre here (have: ${genreNames.join(", ")})`,
    );
  }
  const deviceName = typeof request.device === "string" ? request.device : "";
  if (!deviceNames().includes(deviceName)) {
    throw new ScaffoldError(
      `'${deviceName}' is not a device map (have: ${deviceNames().join(", ")})`,
    );
  }
  const profiles = (request.exported as { profiles?: unknown } | null)?.profiles;
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new ScaffoldError("the export has no profiles in it -- is it an Azeron export?");
  }

  const device = loadDevice(deviceName);
  const unit = device.hand ?? "left";
  const gameDir = join(dataDirs.games, request.genre, slug);
  const templatePath = join(dataDirs.templates, `${slug}-${set}-${unit}.json`);
  const profilePath = join(gameDir, "profiles", `${set}-${unit}.yaml`);

  // Two games with one slug (or one name) cannot be told apart by `azeron build <game>`,
  // and share a dist/ folder and template names. That is never what was meant, so it is
  // not something confirming can override.
  for (const existing of Game.discover()) {
    if (existing.rel === gameDir) continue;
    if (existing.slug.toLowerCase() === slug.toLowerCase()) {
      throw new ScaffoldError(
        `a game with the folder name '${slug}' already exists: ${existing.rel}`,
      );
    }
    if (existing.name.toLowerCase() === name.toLowerCase()) {
      throw new ScaffoldError(`a game called '${existing.name}' already exists: ${existing.rel}`);
    }
  }

  if (request.overwrite !== true) {
    const taken = [
      join(gameDir, "game.yaml"),
      join(gameDir, "actions.yaml"),
      profilePath,
      templatePath,
    ].filter((path) => existsSync(repoPath(path)));
    if (taken.length > 0) {
      throw new ImportCollision(
        taken,
        `${name} already exists: ${taken.join(", ")}. Starting it again would replace its ` +
          "actions.yaml, which holds every action you have named. To add a layout or a unit " +
          "to a game that exists, import into it instead.",
      );
    }
  }

  const actions = seedActions(request.exported);
  const madeDir = !existsSync(repoPath(gameDir));
  // What overwriting replaces, so a failure part way can put it back.
  const touched = [
    templatePath,
    join(gameDir, "game.yaml"),
    join(gameDir, "actions.yaml"),
    profilePath,
  ].map((path) => ({
    path,
    text: existsSync(repoPath(path)) ? readFileSync(repoPath(path), "utf8") : null,
  }));
  try {
    writeText(templatePath, `${JSON.stringify(request.exported, null, 2)}\n`);
    writeText(
      join(gameDir, "actions.yaml"),
      dumpYaml(
        { extends: join(dataDirs.genres, request.genre, "actions.yaml"), game: name, actions },
        `# ${name} -- every action and the in-game key it is bound to.\n` +
          "#\n# Seeded by `azeron import` from the keys the export sends. Each action is named\n" +
          "# after its key because an export cannot say what a key does in game. Rename and\n" +
          "# tag them as you learn them; the genre vocabulary is inherited above.\n",
      ),
    );
    writeText(
      join(gameDir, "game.yaml"),
      dumpYaml(
        gameConfig({
          name,
          slug,
          genre: request.genre,
          template: templatePath,
          exportTo: request.exportTo,
        }),
        `# ${name}\n`,
      ),
    );

    const game = new Game(gameDir);
    const data = decompile(request.exported, device, {
      actions: game.actions,
      meta: { set, template: templatePath, output: `${slug}_${set}_${unit}.json` },
    });
    writeText(profilePath, dumpProfile(data));
    if (!existsSync(repoPath(join(gameDir, "playtests.md")))) {
      writeText(join(gameDir, "playtests.md"), `# ${name} playtests\n`);
    }
    return {
      slug,
      name,
      gameDir,
      templatePath,
      profilePath,
      actions: Object.keys(actions).length,
      unnamed: unnamedPositions(data, device.data),
      positions: Object.keys(data.positions).length,
    };
  } catch (error) {
    // Half a game is worse than none: it would be discovered, and fail every build.
    if (madeDir) rmSync(repoPath(gameDir), { recursive: true, force: true });
    for (const { path, text } of touched) {
      if (text === null) rmSync(repoPath(path), { force: true });
      else writeFileSync(repoPath(path), text, "utf8");
    }
    throw error;
  }
}

/** A layout's pedals, resolved against the device, the genre's axes and the game's rows. */
export interface PedalsInPlay {
  set: string;
  device: LoadedPedals;
  modes: StickModeSet;
  axes: PlannedAxis[];
  plan: PedalPlan;
}

/**
 * The pedals of a set -- the game's `ingame_set` unless one is named -- or null when the
 * set has none. A set that is named but missing, or whose device or genre axes are not
 * there, throws: asking for pedals that cannot be resolved is not the same as not having any.
 */
export function pedalsFor(game: Game, setName?: string): PedalsInPlay | null {
  const set = setName ?? game.config.ingame_set;
  if (set === undefined) return null;
  const layout = game.sets.sets[set];
  if (layout === undefined) {
    // A set with no entry has no pedals. A name no profile carries is a typo, not a set.
    const exists = game.profilePaths().some((path) => loadProfileData(path).profile.set === set);
    if (!exists) throw new IngameError(`${game.slug} has no set '${set}' -- no profile carries it`);
    return null;
  }
  if (layout.pedals === undefined) return null;
  const device = game.pedalsDevice(layout.pedals.device);
  if (device === null) {
    throw new IngameError(
      `set '${set}' has pedals on '${layout.pedals.device}', which has no file`,
    );
  }
  const modes = game.stickModes;
  if (modes === undefined) {
    throw new IngameError(
      `${game.slug}'s genre has no stick-modes.yaml, so its game axes are unknown`,
    );
  }
  const axes = planAxes(layout.pedals, device.data, modes, game.actions.actions, game.slug);
  return {
    set,
    device,
    modes,
    axes,
    plan: ingamePlan(axes, device.data, modes, game.actions.actions, game.slug),
  };
}

export interface IngameReport {
  path: string;
  rows: Comparison[];
  collisions: { key: string; actions: string[] }[];
  /** The pedals the game's `ingame_set` has, and which are still waiting for a name. */
  pedals: {
    set: string;
    axes: {
      pedalAxis: string;
      row: string | null;
      /** The name generation would write: captured, else a hand-written candidate. */
      name: string | null;
      /** How far the name is trusted, or `waiting` when there is none. */
      status: NameStatus | "waiting";
    }[];
  } | null;
}

/** What the game's own binding file says about the keys we send. */
export function ingameReport(game: Game, override?: string): IngameReport {
  const path = ingameSource(game, override);
  const file = parseInput(readFileSync(path, "utf8"));
  // Menus and photo mode reuse flight keys on purpose. Where a game says which categories
  // are live while flying, only a collision inside those is worth reporting.
  const owned = new Set(game.config.ingame_owned_categories ?? []);
  const collisions = owned.size > 0 ? ownedCollisions(file, owned) : gameCollisions(file);
  const pedals = pedalsFor(game);
  return {
    path,
    rows: compareToGame(game.actions, file),
    collisions,
    pedals:
      pedals === null
        ? null
        : {
            set: pedals.set,
            axes: pedals.axes.map((axis) => ({
              pedalAxis: axis.pedalAxis,
              row: axis.row,
              name: axis.name,
              status: axis.status ?? ("waiting" as const),
            })),
          },
  };
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
  /**
   * What the layout's pedals did to the Joystick rows. `waiting` are pedal axes with no
   * captured game name, which write nothing; null when the game's set has no pedals.
   */
  pedals: { set: string; changes: PedalChange[]; waiting: PedalWaiting[] } | null;
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
    /** Refuse, rather than report, a pedal axis whose game name is not captured yet. */
    requirePedals?: boolean;
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
  const keyboard = applyVocabulary(parseInput(before), game.actions, owned);
  const { changes } = keyboard;
  let text = keyboard.text;
  let pedalReport: IngameApplyResult["pedals"] = null;
  const pedals = pedalsFor(game);
  if (pedals !== null) {
    const written = applyPedalRows(parseInput(text), pedals.plan, {
      strict: options.requirePedals === true,
    });
    text = written.text;
    pedalReport = { set: pedals.set, changes: written.changes, waiting: written.waiting };
  }
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
  return { source, changes, collisions, written, backup, pedals: pedalReport };
}

export interface CapturePedalsRequest extends CaptureOptions {
  /** The set whose pedals these are; the game's `ingame_set` when omitted. */
  set?: string;
  /** Read this file instead of the game's own. */
  override?: string;
  /** Write the names into the device file. False reports what would be recorded. */
  write: boolean;
}

export interface CapturePedalsResult {
  source: string;
  set: string;
  device: string;
  result: CaptureResult;
  /** The device file written, when anything was. */
  written: string | null;
}

/**
 * Record the pedals' game names from a file the user has bound them in.
 *
 * The game's file is only read. The names go into the pedals device file, a line at a
 * time, and only the ones the layout and the file together place without a doubt.
 */
export function capturePedalsFrom(game: Game, request: CapturePedalsRequest): CapturePedalsResult {
  const pedals = pedalsFor(game, request.set);
  if (pedals === null) {
    throw new IngameError(
      `${game.slug} has no pedals to capture: name a set that has them with --set, or set ingame_set`,
    );
  }
  const source = ingameSource(game, request.override);
  const file = parseInput(readFileSync(source, "utf8"));
  const options: CaptureOptions = {
    ...(request.assign === undefined ? {} : { assign: request.assign }),
    ...(request.ignoreDevices === undefined ? {} : { ignoreDevices: request.ignoreDevices }),
  };
  const result = capturePedals(
    file,
    pedals.device.text,
    pedals.device.data,
    pedals.axes,
    game.slug,
    options,
  );
  let written: string | null = null;
  if (request.write && result.text !== null) {
    writeText(pedals.device.path, result.text);
    written = pedals.device.path;
  }
  return { source, set: pedals.set, device: pedals.device.data.device, result, written };
}

/** Where a decompiled profile should live for a game and set. */
export function profilePathFor(game: Game, setName: string, unit: string): string {
  return join(game.rel, "profiles", `${setName}-${unit}.yaml`);
}

export function templatePathFor(game: Game, setName: string, unit: string): string {
  return join("templates", `${game.slug}-${setName}-${unit}.json`);
}

export interface CheckedBuild {
  /** Repo-relative. */
  output: string;
  /** The same file as the Azeron app's import dialog would take it. */
  importPath: string;
  mirroredTo?: string;
  changed: boolean;
}

export interface SaveCheck {
  /** The game the saved file belongs to, or null when it is shared (a device map). */
  game: string | null;
  built: CheckedBuild[];
  /** Live errors and warnings for that game -- not every game's, joined into one line. */
  findings: Finding[];
  buildErrors: string[];
}

/**
 * What a save means for the game it touched: rebuild, then lint.
 *
 * The file has already been written by the time this runs, so nothing here can make a
 * save not have happened -- a failure is reported as a finding on a saved file. Scoped to
 * the saved file's game, because a list of another game's errors after saving this one
 * says nothing about whether this one is right.
 */
export function checkAfterSave(
  path: string,
  games: readonly Game[],
  /** Compare against dist/ instead of writing it -- for callers that must not touch it. */
  checkOnly = false,
): SaveCheck {
  const owner = games.find((game) => path.startsWith(`${game.rel}/`));
  const scope = owner ? [owner] : games;
  const build = buildAll(scope, checkOnly);
  const findings = scope.flatMap((game) =>
    lintGame(game).live.filter((finding) => finding.level === ERROR || finding.level === WARNING),
  );
  return {
    game: owner?.slug ?? null,
    built: build.built.map((entry) => ({
      output: entry.output,
      importPath: hostPath(repoPath(entry.output)),
      ...(entry.mirroredTo === undefined ? {} : { mirroredTo: hostPath(entry.mirroredTo) }),
      changed: entry.changed,
    })),
    findings,
    buildErrors: build.errors,
  };
}

export interface SetCandidatesRequest {
  /** The set whose pedals these are; the game's `ingame_set` when omitted. */
  set?: string;
  /** Pedal axis -> the name to try. The caller chooses it; nothing here does. */
  names: Readonly<Record<string, string>>;
  write: boolean;
}

/**
 * Write names by hand, marked untested, for a pedal axis the game's controls screen will
 * not bind. Generation then writes them into the game's file so they can be tried; a later
 * capture of the real name replaces them.
 */
export function setPedalCandidates(
  game: Game,
  request: SetCandidatesRequest,
): { set: string; device: string; text: string; written: string | null } {
  const pedals = pedalsFor(game, request.set);
  if (pedals === null) {
    throw new IngameError(`${game.slug} has no pedals: name a set that has them with --set`);
  }
  for (const axis of Object.keys(request.names)) {
    if (!(axis in pedals.device.data.axes)) {
      throw new IngameError(`${pedals.device.data.device} has no axis '${axis}'`);
    }
  }
  const text = recordCandidateNames(pedals.device.text, game.slug, request.names);
  let written: string | null = null;
  if (request.write) {
    writeText(pedals.device.path, text);
    written = pedals.device.path;
  }
  return { set: pedals.set, device: pedals.device.data.device, text, written };
}
