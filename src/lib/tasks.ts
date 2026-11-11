/**
 * The operations, as functions rather than commands.
 *
 * The CLI and the served editor both call these, so what the UI can do is what the CLI
 * can do -- not a subset that drifts. Each returns a result to render rather than
 * printing, because one caller has a terminal and the other has a page.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { isMap, isSeq, parse, parseDocument } from "yaml";

import { dataDirs, hostPath, posixJoin, repoPath } from "../config/paths.js";
import type { ExportDocument } from "../types/azeron.js";
import type { Acknowledgement, ActionSpec, ProfileData, ProfileMeta } from "../types/profile.js";
import { SLOTS } from "../types/azeron.js";
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
import { applyBinds, compareBinds, describeControl, EliteError, parseBinds } from "./elite.js";
import {
  loadDevice,
  loadDirectWrites,
  loadPedalsDevice,
  loadProfileData,
  loadStickModes,
  loadTemplate,
  writeText,
} from "./io.js";
import { buildStyle, STYLE_ORDER } from "./styles.js";
import { currentWrite, layoutFingerprint } from "./written.js";
import type { LoadedPedals } from "./io.js";
import { capturePedals, ingamePlan, parseSets, planAxes, recordCandidateNames } from "./pedals.js";
import type { CaptureOptions, CaptureResult, PlannedAxis } from "./pedals.js";
import type { StickModeSet } from "./stickmodes.js";
import type { NameStatus } from "../types/pedals.js";
import { ERROR, WARNING, formatFinding, lintGame, lintGenre } from "./lint.js";
import type { Finding, LintResult } from "./lint.js";
import { setLocalDeviceId, setLocalGamePath } from "./machine.js";
import type { MachinePathField } from "./machine.js";
import { Game, Genre } from "./model.js";
import type { Profile } from "./model-core.js";
import {
  ScaffoldError,
  actionsYaml,
  checkFileName,
  checkGameName,
  gameConfig,
  seedActions,
  slugFromName,
  unnamedPositions,
} from "./scaffold.js";
import type { WrittenAction } from "./scaffold.js";
import { addSetEntry, patchSetPedals, removeSetEntry, renameSetEntry } from "./setsfile.js";
import { leadingComments } from "./serve.js";
import { needsWire, wireAction } from "./wiring.js";
import { deepMerge, dumpYaml } from "./yaml.js";
import { loadInherited } from "./yaml-io.js";
import { messageOf, removeKey } from "./object.js";
import { findStore, findStoredProfiles } from "./install.js";
import { compareUnit } from "./units.js";
import type { UnitCheck, UnitDifference, UnitsReport } from "./units.js";

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

      const outPath = posixJoin(game.distDir(), profile.outputName);
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

/**
 * Whether a lint run should fail the command.
 *
 * Errors always do. Under `strict`, so do warnings and stale acknowledgements: an
 * acknowledgement that matches nothing is a suppression that outlived its finding, and a
 * strict run is the one that is meant to notice.
 */
export function lintFails(result: LintResult, strict: boolean): boolean {
  if (result.live.some((finding) => finding.level === ERROR)) return true;
  if (!strict) return false;
  return result.live.some(
    (finding) => finding.level === WARNING || finding.rule === "stale-acknowledgement",
  );
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

  // Decompile first: it is the step that can reject the export, and nothing is on disk
  // until it has not. The template path is only a name inside the profile's metadata here.
  const meta: Partial<ProfileMeta> = { ...request.meta };
  if (request.templatePath !== undefined) meta.template = request.templatePath;

  const data = decompile(request.exported, device, { actions: request.game.actions, meta });
  const yaml = dumpProfile(data);

  // Two writes. If the second fails the first is undone, so a failed import leaves the
  // repo as it found it: a template that did not exist is removed, one that did is put back.
  const templateFull =
    request.templatePath === undefined ? undefined : repoPath(request.templatePath);
  const previousTemplate =
    templateFull !== undefined && existsSync(templateFull)
      ? readFileSync(templateFull, "utf8")
      : null;
  if (request.templatePath !== undefined) {
    writeText(request.templatePath, `${JSON.stringify(request.exported, null, 2)}\n`);
  }
  try {
    writeText(request.profilePath, yaml);
  } catch (error) {
    if (templateFull !== undefined) {
      if (previousTemplate === null) rmSync(templateFull, { force: true });
      else writeFileSync(templateFull, previousTemplate, "utf8");
    }
    throw error;
  }
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

/**
 * Names of the keypad pin maps in devices/, without the extension. Pedals live in the same
 * folder and have axes, not pins: an export cannot have come from them.
 */
export function deviceNames(): string[] {
  const dir = repoPath(dataDirs.devices);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".yaml"))
    .filter((file) => loadInherited(posixJoin(dataDirs.devices, file)).kind !== "pedals")
    .map((file) => file.slice(0, -".yaml".length))
    .sort();
}

/**
 * Tell this computer which hand a unit is: its id, as the unit reported it, goes in
 * local.yaml under the device map's name. Write to units and the press test then write to
 * it. Returns the file written.
 */
export function nameUnit(device: string, id: string): string {
  if (!deviceNames().includes(device)) {
    throw new ScaffoldError(`no keypad device map called '${device}' in devices/`);
  }
  return setLocalDeviceId(device, id);
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
  const gameDir = posixJoin(dataDirs.games, request.genre, slug);
  const templatePath = posixJoin(dataDirs.templates, `${slug}-${set}-${unit}.json`);
  const profilePath = posixJoin(gameDir, "profiles", `${set}-${unit}.yaml`);

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
      posixJoin(gameDir, "game.yaml"),
      posixJoin(gameDir, "actions.yaml"),
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
    posixJoin(gameDir, "game.yaml"),
    posixJoin(gameDir, "actions.yaml"),
    profilePath,
  ].map((path) => ({
    path,
    text: existsSync(repoPath(path)) ? readFileSync(repoPath(path), "utf8") : null,
  }));
  try {
    writeText(templatePath, `${JSON.stringify(request.exported, null, 2)}\n`);
    writeText(
      posixJoin(gameDir, "actions.yaml"),
      actionsYaml(
        name,
        posixJoin(dataDirs.genres, request.genre, "actions.yaml"),
        actions,
        `# ${name} -- every action and the in-game key it is bound to.\n` +
          "#\n# Seeded by `azeron import` from the keys the export sends. Each action is named\n" +
          "# after its key because an export cannot say what a key does in game. Rename and\n" +
          "# tag them as you learn them (the editor's In-game tab does it); the genre\n" +
          "# vocabulary is inherited above.\n",
      ),
    );
    writeText(
      posixJoin(gameDir, "game.yaml"),
      dumpYaml(
        gameConfig({
          name,
          slug,
          genre: request.genre,
          template: templatePath,
        }),
        `# ${name}\n`,
      ),
    );

    const game = new Game(gameDir);
    const data = decompile(request.exported, device, {
      actions: game.actions,
      meta: { set, template: templatePath, output: `${slug}_${set}_${unit}.json` },
    });
    // The export's own name is the app's: it would say "Everspace 2 v5" on a game called
    // something else. Name it for what it is -- the game, the layout and the unit -- which
    // is what the app lists it as once imported.
    data.profile.name = `${name} ${set} ${unit}`;
    writeText(profilePath, dumpProfile(data));
    if (!existsSync(repoPath(posixJoin(gameDir, "playtests.md")))) {
      writeText(posixJoin(gameDir, "playtests.md"), `# ${name} playtests\n`);
    }
    // A folder on this computer is this computer's setting, not the game's: it goes in
    // local.yaml, which git ignores, so nobody else's builds are sent to it.
    if (request.exportTo !== undefined && request.exportTo !== "") {
      setLocalGamePath(slug, "export_to", request.exportTo);
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

export interface StartGameRequest {
  /** What the game is called, as a person says it. */
  name: string;
  /** The folder and file spelling. Derived from the name when left out. */
  slug?: string | undefined;
  /** One of the folders under genres/. */
  genre: string;
  /** The units the first layout is for: one device map name, or a pair. */
  devices: readonly string[];
  /** What the first layout is called. */
  set: string;
  /** Replace a game already on disk. Refused by default. */
  overwrite?: boolean;
  /**
   * The genre's style to start in (layouts.yaml): `controller` or `keyboard`. The first
   * the genre has when left out; a genre with none puts its default.yaml on one unit.
   */
  style?: string | undefined;
  /** A pedals device for the layout, in a genre whose sticks know what pedals take. */
  pedals?: string | undefined;
}

export interface StartGameResult {
  slug: string;
  name: string;
  gameDir: string;
  /** Each unit's new profile. */
  profiles: { device: string; path: string; positions: number }[];
  /** Actions the genre's default layout placed, each given a key to be sent on. */
  wired: number;
  /** Controls of the default layout left empty: no free key to send their action on. */
  leftOff: string[];
  /** The style it started in, or null for a genre with none. */
  style: string | null;
  /** The pedals device the layout has, or null. */
  pedals: string | null;
}

/** Every action a profile's controls carry: each key's presses and each stick direction. */
function actionsPlaced(data: ProfileData): string[] {
  const found: string[] = [];
  for (const spec of Object.values(data.positions)) {
    for (const slot of SLOTS) {
      const value = spec[slot];
      if (typeof value === "string") found.push(value);
    }
    for (const value of Object.values(spec.directions ?? {})) {
      if (typeof value === "string") found.push(value);
    }
  }
  return [...new Set(found)];
}

/**
 * Which pedal axis a new layout's pedals put to work, and on what: the axis that springs
 * back to centre (the rudder) drives what the genre's sticks say pedals take. Refused for
 * a genre whose sticks say nothing of pedals, and for a device that is not pedals.
 */
function newLayoutPedals(
  device: string,
  modes: StickModeSet | undefined,
): { axis: string; drives: string } {
  const takes = modes?.pedals?.takes[0];
  if (takes === undefined) {
    throw new ScaffoldError(
      "pedals are offered where the genre's stick-modes.yaml says what they take over " +
        "(its `pedals:` section), and this genre's does not",
    );
  }
  const loaded = loadPedalsDevice(device);
  if (loaded === null) throw new ScaffoldError(`'${device}' is not a pedals device here`);
  const centred = Object.entries(loaded.data.axes).find(([, axis]) => axis.rest === "centre");
  if (centred === undefined) {
    throw new ScaffoldError(`${device} has no axis that rests at centre to drive ${takes}`);
  }
  return { axis: centred[0], drives: takes };
}

/**
 * Start a game with no export: no Azeron app involved at all.
 *
 * Each unit's layout is built on that unit's own real export (`template:` in its device
 * map), which carries what the repo does not model. The genre's default layout goes on the
 * unit it was written for, and any other unit starts empty. The game's vocabulary is the
 * genre's, and every action the default layout places is given a key now, with the same
 * wiring the editor uses when an action is dropped on a control, so the game builds and
 * lints with nothing sent on no key.
 *
 * The same checks as `createGame`, and the same undo on a failure part way.
 */
export function startGame(request: StartGameRequest): StartGameResult {
  const name = checkGameName(request.name);
  const slug = checkFileName("game folder name", request.slug ?? slugFromName(name));
  const set = checkFileName("layout name", request.set);
  const genre = Genre.discover().find((entry) => entry.name === request.genre);
  if (genre === undefined) {
    const have = Genre.discover().map((entry) => entry.name);
    throw new ScaffoldError(`'${request.genre}' is not a genre here (have: ${have.join(", ")})`);
  }
  const names = [...new Set(request.devices)];
  if (names.length === 0) throw new ScaffoldError("choose at least one unit");
  const known = deviceNames();
  const devices = names.map((deviceName) => {
    if (!known.includes(deviceName)) {
      throw new ScaffoldError(`'${deviceName}' is not a device map (have: ${known.join(", ")})`);
    }
    const device = loadDevice(deviceName);
    if (device.template === undefined) {
      throw new ScaffoldError(
        `${deviceName} names no template: a game with no export of its own needs one, as ` +
          "`template:` in the device map",
      );
    }
    if (!existsSync(repoPath(device.template))) {
      throw new ScaffoldError(`${deviceName}'s template ${device.template} does not exist`);
    }
    return device;
  });
  const units = devices.map((device) => device.hand ?? "left");
  if (new Set(units).size !== units.length) {
    throw new ScaffoldError("a layout has one unit per hand: choose a left unit and a right one");
  }

  // A style lays out a pair. One unit on its own gets the genre's single-unit default.
  const paired = devices.length === 2;
  if (!paired && request.style !== undefined) {
    throw new ScaffoldError("a style lays out both units: choose the left unit and the right one");
  }
  const styleName = !paired
    ? null
    : (request.style ?? STYLE_ORDER.find((name) => name in genre.styles) ?? null);
  const style = styleName === null ? undefined : genre.styles[styleName];
  if (styleName !== null && style === undefined) {
    const have = Object.keys(genre.styles);
    throw new ScaffoldError(
      `${request.genre} has no '${styleName}' style (have: ${have.join(", ") || "none"})`,
    );
  }
  const modes = loadStickModes(genre.rel);
  const pedalAxis = request.pedals === undefined ? null : newLayoutPedals(request.pedals, modes);

  const gameDir = posixJoin(dataDirs.games, request.genre, slug);
  const profilePaths = units.map((unit) => posixJoin(gameDir, "profiles", `${set}-${unit}.yaml`));

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
  const owned = [
    posixJoin(gameDir, "game.yaml"),
    posixJoin(gameDir, "actions.yaml"),
    ...(pedalAxis === null ? [] : [posixJoin(gameDir, "sets.yaml")]),
    ...profilePaths,
  ];
  if (request.overwrite !== true) {
    const taken = owned.filter((path) => existsSync(repoPath(path)));
    if (taken.length > 0) {
      throw new ImportCollision(
        taken,
        `${name} already exists: ${taken.join(", ")}. Starting it again would replace its ` +
          "actions.yaml, which holds every action you have named.",
      );
    }
  }

  // The first layout: the style's two hands, or for a genre with no styles, its default on
  // the unit it was written for and the rest empty.
  const built =
    style === undefined || styleName === null
      ? null
      : buildStyle(styleName, style, {
          actions: genre.actions.actions,
          defaults: genre.config.positions,
          modes,
          withPedals: pedalAxis !== null,
        });
  const layouts = devices.map((device, index): ProfileData => {
    const unit = units[index] ?? "left";
    const seeded = genre.config.profile.device === device.name;
    const positions =
      built === null
        ? seeded
          ? structuredClone(genre.config.positions)
          : {}
        : unit === "right"
          ? built.right
          : built.left;
    return {
      profile: {
        id: randomUUID(),
        name: `${name} ${set} ${unit}`,
        device: device.name,
        unit,
        ...(device.template === undefined ? {} : { template: device.template }),
        set,
        output: `${slug}_${set}_${unit}.json`,
      },
      positions,
    };
  });

  // Give each placed action a key, as dropping it on a control in the editor would.
  const vocabulary = structuredClone(genre.actions.actions);
  const keys: Record<string, WrittenAction> = {};
  // What the style says of an action beyond its key (fire on a mouse button, with no mouse
  // to provide it) is the game's from the start, and is in place before anything is wired.
  for (const [id, fields] of Object.entries(built?.actions ?? {})) {
    const merged = deepMerge({ ...(vocabulary[id] ?? {}) }, fields) as ActionSpec;
    vocabulary[id] = merged;
    keys[id] = fields;
  }
  const unsendable = new Set<string>();
  // Required actions first, so if the pool runs short it is something optional left off.
  const required = (id: string): number =>
    (vocabulary[id]?.tags ?? []).includes("required") ? 0 : 1;
  const placed = [...new Set(layouts.flatMap(actionsPlaced))].sort(
    (a, b) => required(a) - required(b),
  );
  for (const id of placed) {
    const key = wireAction(vocabulary, id);
    if (key !== null) keys[id] = { ...keys[id], key };
    else if (needsWire(vocabulary[id])) unsendable.add(id);
  }
  // The pool of out-of-the-way keys is smaller than a whole default layout. An action left
  // without one is taken off its control rather than placed sending nothing, so the game
  // starts clean; the editor lists it, to place once a key is freed.
  const leftOff: string[] = [];
  for (const data of layouts) {
    for (const [position, spec] of Object.entries(data.positions)) {
      for (const slot of SLOTS) {
        const value = spec[slot];
        if (typeof value === "string" && unsendable.has(value)) {
          leftOff.push(`${position} ${slot}: ${value}`);
          removeKey(spec, slot);
        }
      }
      for (const [direction, value] of Object.entries(spec.directions ?? {})) {
        if (typeof value === "string" && unsendable.has(value) && spec.directions) {
          leftOff.push(`${position} ${direction}: ${value}`);
          removeKey(spec.directions, direction);
        }
      }
      if (
        !SLOTS.some((slot) => spec[slot] !== undefined) &&
        Object.keys(spec.directions ?? {}).length === 0
      ) {
        removeKey(data.positions, position);
      }
    }
  }

  const madeDir = !existsSync(repoPath(gameDir));
  // sets.yaml holds every layout's pedals, so a game started again keeps the others' and
  // only this layout's entry changes. It is restored with the rest on a failure.
  const setsPath = posixJoin(gameDir, "sets.yaml");
  const touched = [...new Set([...owned, setsPath])].map((path) => ({
    path,
    text: existsSync(repoPath(path)) ? readFileSync(repoPath(path), "utf8") : null,
  }));
  try {
    writeText(
      posixJoin(gameDir, "actions.yaml"),
      actionsYaml(
        name,
        posixJoin(dataDirs.genres, request.genre, "actions.yaml"),
        keys,
        `# ${name} -- the in-game key each action is sent on.\n` +
          "#\n# The actions themselves are the genre's, inherited above. Each one placed on a\n" +
          "# control is given a key nothing else is on; Update the game's keys… tells the\n" +
          "# game, or set the same key in the game's own controls screen.\n",
      ),
    );
    const firstTemplate = devices[0]?.template;
    const config = gameConfig({ name, slug, genre: request.genre, template: firstTemplate ?? "" });
    const writeConfig = (): void => {
      writeText(posixJoin(gameDir, "game.yaml"), dumpYaml(config, `# ${name}\n`));
    };
    writeConfig();
    const setsText = touched.find((entry) => entry.path === setsPath)?.text ?? null;
    const hasSet =
      setsText !== null && set in parseSets((parse(setsText) as unknown) ?? {}, setsPath).sets;
    const pedals =
      pedalAxis !== null && request.pedals !== undefined
        ? { device: request.pedals, assign: { [pedalAxis.axis]: { drives: pedalAxis.drives } } }
        : null;
    if (setsText !== null && hasSet) {
      // Started again: this layout's pedals are what was asked for now, none included.
      writeText(setsPath, patchSetPedals(setsText, set, pedals));
    } else if (pedals !== null) {
      const header = `# ${name} -- what a layout does beyond its profiles: its pedals.\n`;
      writeText(setsPath, addSetEntry(setsText ?? header, set, { pedals }));
    }
    const profiles = layouts.map((data, index) => {
      const path = profilePaths[index] ?? "";
      writeText(path, dumpProfile(data, `# ${name} -- ${set}, ${units[index] ?? "left"} unit.\n`));
      return {
        device: data.profile.device,
        path,
        positions: Object.keys(data.positions).length,
      };
    });
    if (!existsSync(repoPath(posixJoin(gameDir, "playtests.md")))) {
      writeText(posixJoin(gameDir, "playtests.md"), `# ${name} playtests\n`);
    }
    // A style that has the two hands do different jobs on purpose -- a pad's d-pad against
    // its A B X Y -- says so, and each position the checks would raise is acknowledged with
    // that reason. Only those the checks raise, so none is stale from the start.
    const meant = built?.acknowledge;
    if (meant) {
      const raised = lintGame(new Game(gameDir)).live.filter(
        (finding) =>
          finding.rule === "akimbo-role-mismatch" &&
          finding.position !== undefined &&
          meant.positions.includes(finding.position),
      );
      if (raised.length > 0) {
        config.lint = {
          ...config.lint,
          acknowledged: raised.map((finding) => ({
            rule: finding.rule,
            profile: set,
            ...(finding.position === undefined ? {} : { position: finding.position }),
            reason: meant.reason,
          })),
        };
        writeConfig();
      }
    }
    const wired = Object.values(keys).filter((spec) => spec.key !== undefined).length;
    return {
      slug,
      name,
      gameDir,
      profiles,
      wired,
      leftOff,
      style: styleName,
      pedals: pedalAxis === null ? null : (request.pedals ?? null),
    };
  } catch (error) {
    if (madeDir) rmSync(repoPath(gameDir), { recursive: true, force: true });
    for (const { path, text } of touched) {
      if (text === null) rmSync(repoPath(path), { force: true });
      else writeFileSync(repoPath(path), text, "utf8");
    }
    throw error;
  }
}

export interface StartLayoutRequest {
  /** The game's slug. */
  game: string;
  /** What the new layout is called. */
  set: string;
  /** The units it is for. Empty with `copyOf` means the units that layout has. */
  devices: readonly string[];
  /** An existing layout of the game to start as a copy of, pedals included. */
  copyOf?: string | undefined;
  /** Replace a layout of that name. Refused by default. */
  overwrite?: boolean;
}

export interface StartLayoutResult {
  set: string;
  profiles: { device: string; path: string; positions: number }[];
  /** Whether the copied layout's pedals came with it. */
  pedals: boolean;
  /** Whether the copied layout's modes of play came with it. */
  modes: boolean;
}

/**
 * A new layout for a game that exists, with no export: empty, or a copy of one of the
 * game's layouts to change from (the next version, say). Each unit's profile is built on
 * the export its layout already uses, or the unit's own stock export when empty. A copy
 * brings its pedals, in sets.yaml, since the pedals are part of a layout.
 */
export function startLayout(request: StartLayoutRequest): StartLayoutResult {
  const game = Game.discover().find((entry) => entry.slug === request.game);
  if (game === undefined) throw new ScaffoldError(`no game '${request.game}'`);
  const set = checkFileName("layout name", request.set);

  const sources = new Map<string, ProfileData>();
  if (request.copyOf !== undefined && request.copyOf !== "") {
    for (const path of game.profilePaths()) {
      const data = loadProfileData(path);
      if (data.profile.set === request.copyOf) sources.set(data.profile.device, data);
    }
    if (sources.size === 0) {
      throw new ScaffoldError(`${game.name} has no layout called '${request.copyOf}' to copy`);
    }
  }
  const names = [...new Set(request.devices.length > 0 ? request.devices : [...sources.keys()])];
  if (names.length === 0) throw new ScaffoldError("choose at least one unit");
  const known = deviceNames();
  const devices = names.map((deviceName) => {
    if (!known.includes(deviceName)) {
      throw new ScaffoldError(`'${deviceName}' is not a device map (have: ${known.join(", ")})`);
    }
    const device = loadDevice(deviceName);
    if (!sources.has(deviceName) && device.template === undefined) {
      throw new ScaffoldError(
        `${deviceName} names no template to build an empty layout on (\`template:\` in its device map)`,
      );
    }
    return device;
  });
  const units = devices.map((device) => device.hand ?? "left");
  if (new Set(units).size !== units.length) {
    throw new ScaffoldError("a layout has one unit per hand: choose a left unit and a right one");
  }

  const paths = units.map((unit) => profilePathFor(game, set, unit));
  const taken = game.profilePaths().filter((path) => loadProfileData(path).profile.set === set);
  if (request.overwrite !== true) {
    const clash = [...new Set([...taken, ...paths.filter((path) => existsSync(repoPath(path)))])];
    if (clash.length > 0) {
      throw new ImportCollision(clash, `${game.name} already has a layout called '${set}'.`);
    }
  }

  const layouts = devices.map((device, index): ProfileData => {
    const unit = units[index] ?? "left";
    const meta = {
      id: randomUUID(),
      name: `${game.name} ${set} ${unit}`,
      device: device.name,
      unit,
      set,
      output: `${game.slug}_${set}_${unit}.json`,
    };
    const source = sources.get(device.name);
    if (source !== undefined) {
      const copy = structuredClone(source);
      // A copy is not the golden fixture, whatever its source was.
      removeKey(copy.profile, "golden");
      return { ...copy, profile: { ...copy.profile, ...meta } };
    }
    return {
      profile: { ...meta, ...(device.template === undefined ? {} : { template: device.template }) },
      positions: {},
    };
  });

  // What the layout is beyond its profiles -- its pedals and the modes it plays -- comes
  // with a copy, as one entry in sets.yaml.
  const extra =
    request.copyOf === undefined || request.copyOf === ""
      ? undefined
      : game.sets.sets[request.copyOf];
  const carried = {
    ...(extra?.pedals === undefined ? {} : { pedals: extra.pedals }),
    ...(extra?.modes === undefined ? {} : { modes: extra.modes }),
  };
  const hasExtra = Object.keys(carried).length > 0;
  const setsPath = posixJoin(game.rel, "sets.yaml");
  const touched = [...paths, ...(hasExtra ? [setsPath] : [])].map((path) => ({
    path,
    text: existsSync(repoPath(path)) ? readFileSync(repoPath(path), "utf8") : null,
  }));
  try {
    const profiles = layouts.map((data, index) => {
      const path = paths[index] ?? "";
      const from = sources.has(data.profile.device) ? ` Copied from ${request.copyOf ?? ""}.` : "";
      writeText(
        path,
        dumpProfile(data, `# ${game.name} -- ${set}, ${units[index] ?? "left"} unit.${from}\n`),
      );
      return { device: data.profile.device, path, positions: Object.keys(data.positions).length };
    });
    if (hasExtra) {
      const text = touched.find((entry) => entry.path === setsPath)?.text ?? "";
      writeText(setsPath, addSetEntry(text, set, carried));
    }
    return {
      set,
      profiles,
      pedals: carried.pedals !== undefined,
      modes: carried.modes !== undefined,
    };
  } catch (error) {
    for (const { path, text } of touched) {
      if (text === null) rmSync(repoPath(path), { force: true });
      else writeFileSync(repoPath(path), text, "utf8");
    }
    throw error;
  }
}

export interface AddUnitRequest {
  /** The game's slug. */
  game: string;
  /** The layout to add the unit to. */
  set: string;
  /** The unit's device map. */
  device: string;
}

/**
 * One more unit for a layout that has a hand free: an empty profile on the unit's own
 * export, beside the ones it has. The layout keeps its name, its other unit and its
 * entry in sets.yaml; this only adds the file for the hand that had none.
 */
export function addUnitToLayout(request: AddUnitRequest): {
  set: string;
  profile: { device: string; path: string };
} {
  const game = Game.discover().find((entry) => entry.slug === request.game);
  if (game === undefined) throw new ScaffoldError(`no game '${request.game}'`);
  const existing = game
    .loadedProfiles()
    .filter((profile) => layoutName(profile) === request.set)
    .map((profile) => profile.data);
  if (existing.length === 0) {
    throw new ScaffoldError(`${game.name} has no layout called '${request.set}'`);
  }
  if (!deviceNames().includes(request.device)) {
    throw new ScaffoldError(`'${request.device}' is not a unit this computer knows`);
  }
  const device = loadDevice(request.device);
  if (device.template === undefined) {
    throw new ScaffoldError(`${request.device} names no export to build an empty layout on`);
  }
  const unit = device.hand ?? "left";
  if (existing.some((data) => (data.profile.unit ?? "left") === unit)) {
    throw new ScaffoldError(`${request.set} already has a ${unit} unit`);
  }
  const path = profilePathFor(game, request.set, unit);
  if (existsSync(repoPath(path))) throw new ImportCollision([path], `${path} already exists`);
  const data: ProfileData = {
    profile: {
      id: randomUUID(),
      name: `${game.name} ${request.set} ${unit}`,
      device: device.name,
      unit,
      set: request.set,
      output: `${game.slug}_${request.set}_${unit}.json`,
      template: device.template,
    },
    positions: {},
  };
  writeText(
    path,
    dumpProfile(
      data,
      `# ${game.name} -- ${request.set}, ${unit} unit.
`,
    ),
  );
  return { set: request.set, profile: { device: device.name, path } };
}

/**
 * Accept a finding on purpose: an entry in game.yaml's `lint.acknowledged`, written through
 * the YAML document so the file's comments stay. The reason is required, because an
 * acknowledgement with none is a warning switched off rather than a decision recorded.
 */
export function acknowledgeFinding(request: {
  game: string;
  rule: string;
  profile: string;
  position?: string | undefined;
  key?: string | undefined;
  reason: string;
}): Acknowledgement {
  const game = gameNamed(request.game);
  const reason = request.reason.trim();
  if (reason === "") throw new ScaffoldError("say why this is fine: the reason is kept with it");
  if (!/^[a-z][a-z0-9-]*$/.test(request.rule)) {
    throw new ScaffoldError(`'${request.rule}' is not a check`);
  }
  if (request.rule === "stale-acknowledgement") {
    throw new ScaffoldError("a stale acknowledgement is not accepted: it is removed");
  }
  const entry: Acknowledgement = {
    rule: request.rule,
    profile: request.profile,
    ...(request.position === undefined ? {} : { position: request.position }),
    ...(request.key === undefined ? {} : { key: request.key }),
    reason,
  };
  const path = posixJoin(game.rel, "game.yaml");
  const doc = parseDocument(readFileSync(repoPath(path), "utf8"));
  const existing = doc.getIn(["lint", "acknowledged"]);
  // The same finding accepted twice would leave the second entry stale, which the strict
  // checks fail on; it is recorded once.
  const same = (item: unknown): boolean => {
    if (!isMap(item)) return false;
    return (["rule", "profile", "position", "key"] as const).every(
      (field) => (item.get(field) ?? undefined) === entry[field],
    );
  };
  if (isSeq(existing) && existing.items.some(same)) return entry;
  if (isSeq(existing)) existing.add(doc.createNode(entry));
  else doc.setIn(["lint", "acknowledged"], doc.createNode([entry]));
  writeText(path, doc.toString());
  return entry;
}

/**
 * The layout a profile belongs to: its `set`, or, for a profile that names none, its own
 * file name -- as the editor's layout list and the checks resolve it.
 */
function layoutName(profile: Profile): string {
  return profile.set ?? profile.slug;
}

/** The game a request names, or a refusal that says so. */
function gameNamed(slug: string): Game {
  const game = Game.discover().find((entry) => entry.slug === slug);
  if (game === undefined) throw new ScaffoldError(`no game '${slug}'`);
  return game;
}

/**
 * Write each file's new text, or remove it (null), putting every one back as it was if any
 * write fails, so a change is made whole or not at all.
 */
function writeAll(changes: ReadonlyMap<string, string | null>): void {
  const before = [...changes.keys()].map((path) => ({
    path,
    text: existsSync(repoPath(path)) ? readFileSync(repoPath(path), "utf8") : null,
  }));
  try {
    for (const [path, text] of changes) {
      if (text === null) rmSync(repoPath(path), { force: true });
      else writeText(path, text);
    }
  } catch (error) {
    for (const { path, text } of before) {
      if (text === null) rmSync(repoPath(path), { force: true });
      else writeFileSync(repoPath(path), text, "utf8");
    }
    throw error;
  }
}

/**
 * game.yaml with what names a layout changed: its acknowledgements and `ingame_set`. Edited
 * through the YAML document so the file's comments stay; null when nothing changes.
 */
function gameYamlForLayout(
  text: string,
  set: string,
  to: string | null,
  /** Each profile's file name, old to new (null when deleted): an acknowledgement may name one. */
  slugs: ReadonlyMap<string, string | null>,
): string | null {
  const doc = parseDocument(text);
  let changed = false;
  const renamed = new Map<string, string | null>([[set, to], ...slugs]);
  const acknowledged = doc.getIn(["lint", "acknowledged"]);
  if (isSeq(acknowledged)) {
    const kept = acknowledged.items.filter((item) => {
      if (!isMap(item)) return true;
      const named = item.get("profile");
      if (typeof named !== "string" || !renamed.has(named)) return true;
      changed = true;
      const next = renamed.get(named) ?? null;
      if (next === null) return false;
      item.set("profile", next);
      return true;
    });
    acknowledged.items = kept;
  }
  if (doc.get("ingame_set") === set) {
    changed = true;
    if (to === null) doc.delete("ingame_set");
    else doc.set("ingame_set", to);
  }
  return changed ? doc.toString() : null;
}

/**
 * Delete a layout: its profiles, their compiled files, its entry in sets.yaml, and what
 * game.yaml says about it. The game keeps at least one layout, and the reference layout the
 * tests compare against is never deleted from here.
 */
export function deleteLayout(request: { game: string; set: string }): { removed: string[] } {
  const game = gameNamed(request.game);
  const all = game.loadedProfiles();
  const profiles = all.filter((profile) => layoutName(profile) === request.set);
  if (profiles.length === 0) {
    throw new ScaffoldError(`${game.name} has no layout called '${request.set}'`);
  }
  if (all.every((profile) => layoutName(profile) === request.set)) {
    throw new ScaffoldError(
      `${request.set} is ${game.name}'s only layout. Delete the game instead, or add another layout first.`,
    );
  }
  if (profiles.some((profile) => profile.data.profile.golden === true)) {
    throw new ScaffoldError(`${request.set} is the reference layout the checks compare against`);
  }
  const changes = new Map<string, string | null>();
  for (const profile of profiles) {
    changes.set(profile.path, null);
    const output = posixJoin(game.distDir(), profile.outputName);
    if (existsSync(repoPath(output))) changes.set(output, null);
  }
  const setsPath = posixJoin(game.rel, "sets.yaml");
  if (existsSync(repoPath(setsPath))) {
    const text = readFileSync(repoPath(setsPath), "utf8");
    const out = removeSetEntry(text, request.set);
    if (out !== text) changes.set(setsPath, out);
  }
  const configPath = posixJoin(game.rel, "game.yaml");
  const slugs = new Map(profiles.map((profile) => [profile.slug, null]));
  const config = gameYamlForLayout(
    readFileSync(repoPath(configPath), "utf8"),
    request.set,
    null,
    slugs,
  );
  if (config !== null) changes.set(configPath, config);
  writeAll(changes);
  return {
    removed: [...changes.entries()].filter(([, text]) => text === null).map(([path]) => path),
  };
}

/**
 * Rename a layout: each profile moves to the new name's file (its id, keys and template
 * kept), and sets.yaml and game.yaml follow. The compiled files go; the next build writes
 * them under the new name.
 */
export function renameLayout(request: { game: string; set: string; to: string }): {
  set: string;
  profiles: string[];
} {
  const game = gameNamed(request.game);
  const to = checkFileName("layout name", request.to);
  const all = game.loadedProfiles();
  const profiles = all.filter((profile) => layoutName(profile) === request.set);
  if (profiles.length === 0) {
    throw new ScaffoldError(`${game.name} has no layout called '${request.set}'`);
  }
  if (to === request.set) return { set: to, profiles: profiles.map((profile) => profile.path) };
  if (all.some((profile) => layoutName(profile) === to)) {
    throw new ScaffoldError(`${game.name} already has a layout called '${to}'`);
  }
  if (profiles.some((profile) => profile.data.profile.golden === true)) {
    throw new ScaffoldError(`${request.set} is the reference layout the checks compare against`);
  }
  const changes = new Map<string, string | null>();
  const moved: string[] = [];
  for (const profile of profiles) {
    const unit = profile.unit ?? "left";
    const data = structuredClone(profile.data);
    data.profile.set = to;
    if (data.profile.name === `${game.name} ${request.set} ${unit}`) {
      data.profile.name = `${game.name} ${to} ${unit}`;
    }
    if (data.profile.output === `${game.slug}_${request.set}_${unit}.json`) {
      data.profile.output = `${game.slug}_${to}_${unit}.json`;
    }
    const path = profilePathFor(game, to, unit);
    if (existsSync(repoPath(path))) throw new ImportCollision([path], `${path} already exists`);
    const old = readFileSync(repoPath(profile.path), "utf8");
    changes.set(profile.path, null);
    changes.set(path, dumpProfile(data, leadingComments(old)));
    const output = posixJoin(game.distDir(), profile.outputName);
    if (existsSync(repoPath(output))) changes.set(output, null);
    moved.push(path);
  }
  const setsPath = posixJoin(game.rel, "sets.yaml");
  if (existsSync(repoPath(setsPath))) {
    const text = readFileSync(repoPath(setsPath), "utf8");
    const out = renameSetEntry(text, request.set, to);
    if (out !== text) changes.set(setsPath, out);
  }
  const configPath = posixJoin(game.rel, "game.yaml");
  const slugs = new Map(
    profiles.map((profile) => [
      profile.slug,
      basename(profilePathFor(game, to, profile.unit ?? "left")).replace(/\.ya?ml$/, ""),
    ]),
  );
  const config = gameYamlForLayout(
    readFileSync(repoPath(configPath), "utf8"),
    request.set,
    to,
    slugs,
  );
  if (config !== null) changes.set(configPath, config);
  writeAll(changes);
  return { set: to, profiles: moved };
}

/**
 * Delete a game: its folder and its compiled files. The game whose layouts the checks
 * compare against is never deleted from here.
 */
export function deleteGame(request: { game: string }): { removed: string[] } {
  const game = gameNamed(request.game);
  if (Game.discover().length <= 1) {
    throw new ScaffoldError(
      `${game.name} is the only game. Add another first: the page needs one to open.`,
    );
  }
  if (game.loadedProfiles().some((profile) => profile.data.profile.golden === true)) {
    throw new ScaffoldError(`${game.name} holds the reference layout the checks compare against`);
  }
  const removed = [game.rel, game.distDir()].filter((path) => existsSync(repoPath(path)));
  for (const path of removed) rmSync(repoPath(path), { recursive: true, force: true });
  return { removed };
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
  if (isElite(game)) return eliteReport(game, override);
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
  return posixJoin(game.distDir(), isElite(game) ? "Custom.4.1.binds" : "Input.ini");
}

/**
 * Where a game's file was looked for on this computer, and how to point the repo at it. Every
 * refusal about a missing game file ends with this, so the fix is never "edit game.yaml".
 */
export function whereLooked(game: Game, field: MachinePathField): string {
  const place = game.places[field];
  const looked = place.tried.length > 1 ? ` Looked in: ${place.tried.join(", ")}.` : "";
  return (
    `${looked} If it is somewhere else on this computer, name it in local.yaml as ` +
    `games.${game.slug}.${field} (local.example.yaml shows how).`
  );
}

/** Why a game has no path for one of its files here: none named, or none this computer has. */
function noPath(game: Game, field: MachinePathField, doing: string): string {
  const place = game.places[field];
  // Named, but by a token that names no folder here (Linux that is not WSL, say).
  return place.from !== null && place.path === undefined
    ? `${game.slug}'s ${field} names a Windows folder this computer does not have ${doing}.` +
        whereLooked(game, field)
    : `${game.slug} has no ${field} in game.yaml ${doing}`;
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
      ? noPath(game, "ingame_config", "and no committed copy to start from")
      : `${live} does not exist, and there is no committed copy to start from.` +
          whereLooked(game, "ingame_config"),
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
  /** Elite: every file copied aside, the bindings file and the list of presets. */
  backups?: string[];
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
  if (isElite(game)) return applyElite(game, options);
  const owned = new Set(game.config.ingame_owned_categories ?? []);
  if (owned.size === 0) {
    throw new IngameError(
      `${game.slug} owns no binding categories -- set ingame_owned_categories in game.yaml`,
    );
  }
  // Asked to write to the game, and there is no game file to write to: refuse before
  // anything is written, rather than update the committed copy and report success.
  if (options.write && options.toGame === true) {
    const live = game.config.ingame_config;
    if (live === undefined) {
      throw new IngameError(noPath(game, "ingame_config", "to write to"));
    }
    if (!existsSync(live)) {
      throw new IngameError(
        `the game's binding file ${live} does not exist, so nothing can be written to it -- ` +
          "run the game once so it writes the file." +
          whereLooked(game, "ingame_config"),
      );
    }
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
  return posixJoin(game.rel, "profiles", `${setName}-${unit}.yaml`);
}

export function templatePathFor(game: Game, setName: string, unit: string): string {
  return posixJoin("templates", `${game.slug}-${setName}-${unit}.json`);
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
  /**
   * Present when the saved file was a game's `sets.yaml`: what the game's own layout
   * (`ingame_set`) now has for its pedals, as generation would write it, or why it cannot
   * be written. The lint findings above carry the pedal rules; this says what they came to.
   */
  pedals?: SavedPedals;
}

export interface SavedPedals {
  set: string;
  /** Why the pedals cannot be written into the game's file, when they cannot. */
  problem?: string;
  axes: {
    pedalAxis: string;
    label: string;
    drives: string;
    /** The game's own row, or null when `drives` reaches none. */
    row: string | null;
    name: string | null;
    status: NameStatus | null;
  }[];
}

/** What the game's pedals come to once `sets.yaml` is saved, for the save's verdict. */
function savedPedals(game: Game): SavedPedals | undefined {
  const set = game.config.ingame_set;
  if (set === undefined) return undefined;
  const layout = game.sets.sets[set]?.pedals;
  if (layout === undefined) return { set, axes: [] };
  const device = game.pedalsDevice(layout.device)?.data;
  const planned = planAxes(layout, device, game.stickModes, game.actions.actions, game.slug);
  const axes = planned.map((axis) => ({
    pedalAxis: axis.pedalAxis,
    label: axis.label,
    drives: axis.assignment.drives,
    row: axis.row,
    name: axis.name,
    status: axis.status,
  }));
  try {
    pedalsFor(game, set);
  } catch (error) {
    return { set, axes, problem: messageOf(error) };
  }
  return { set, axes };
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
  const pedals =
    owner !== undefined && /(^|\/)sets\.ya?ml$/.test(path) ? savedPedals(owner) : undefined;
  return {
    game: owner?.slug ?? null,
    ...(pedals === undefined ? {} : { pedals }),
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

// --- Elite Dangerous ----------------------------------------------------------------------

const isElite = (game: Game): boolean => game.config.ingame_format === "elite-binds";

/** The file in which the game lists the preset it uses for each category of binding. */
const START_PRESET = "StartPreset.4.start";

/** What the game's own bindings file says about the keys we send. */
function eliteReport(game: Game, override?: string): IngameReport {
  const path = ingameSource(game, override);
  const binds = parseBinds(readFileSync(path, "utf8"));
  const rows: Comparison[] = compareBinds(binds, game.actions.actions).map((row) => {
    const label = describeControl(row.control).label;
    return {
      action: row.action,
      label,
      ours: row.ours === "" ? null : row.ours,
      theirs: row.theirs.map((key) => ({ action: row.control, display: label, key, scale: 1 })),
      status: row.status === "missing" ? "unmatched" : row.status,
    };
  });
  return { path, rows, collisions: [], pedals: null };
}

/**
 * Make Elite's `Custom.4.1.binds` agree with actions.yaml, starting from the preset the
 * game ships (`ingame_preset`) and never from the player's own file. With `toGame`, the
 * game is also told to use it: every line of `StartPreset.4.start` is set to `Custom`.
 *
 * Everything that can be refused is checked before anything is written, so a refusal
 * never leaves the committed copy updated and the game's folder half done.
 */
function applyElite(
  game: Game,
  options: { write: boolean; toGame?: boolean; override?: string },
): IngameApplyResult {
  const live = game.config.ingame_config;
  const preset = game.config.ingame_preset;
  const toGame = options.write && options.toGame === true;
  let startPath: string | null = null;
  if (toGame) {
    if (live === undefined) {
      throw new IngameError(noPath(game, "ingame_config", "to write to"));
    }
    if (!existsSync(dirname(live))) {
      throw new IngameError(
        `the game's bindings folder ${dirname(live)} does not exist, so nothing can be ` +
          "written to it -- run the game once so it makes the folder." +
          whereLooked(game, "ingame_config"),
      );
    }
    if (preset === undefined) {
      throw new IngameError(noPath(game, "ingame_preset", "to start from"));
    }
    if (!existsSync(preset)) {
      throw new IngameError(
        `the game's preset ${preset} does not exist, so the game does not seem to be ` +
          "installed here." +
          whereLooked(game, "ingame_preset"),
      );
    }
    startPath = join(dirname(live), START_PRESET);
    if (!existsSync(startPath)) {
      throw new IngameError(
        `${startPath} does not exist, so the game cannot be told to use the new file -- ` +
          "run the game once so it writes it",
      );
    }
  }

  // The preset is the base. Where it is not installed (another machine, CI) the committed
  // copy stands in, which is a fixed point of the vocabulary.
  const committedPath = repoPath(ingameDistPath(game));
  const source =
    options.override ??
    (preset !== undefined && existsSync(preset)
      ? preset
      : existsSync(committedPath)
        ? committedPath
        : null);
  if (source === null) {
    throw new IngameError(
      `${game.slug} has no ingame_preset on disk and no committed copy to start from`,
    );
  }
  let result;
  try {
    result = applyBinds(readFileSync(source, "utf8"), game.actions.actions);
  } catch (error) {
    if (error instanceof EliteError) throw new IngameError(error.message);
    throw error;
  }
  const changes: IngameChange[] = result.changes.map((change) => ({
    action: change.action,
    display: `${describeControl(change.control).label} [${change.slot.toLowerCase()}]`,
    category: 0,
    from: change.from === "" ? "unbound" : change.from,
    to: change.to === "" ? "unbound" : change.to,
    by: change.action,
  }));

  const written: string[] = [];
  const backups: string[] = [];
  if (options.write) {
    const committed = ingameDistPath(game);
    writeText(committed, result.text);
    written.push(committed);
    if (toGame && live !== undefined && startPath !== null) {
      const when = new Date().toISOString().replace(/[:.]/g, "-");
      if (!existsSync(live) || readFileSync(live, "utf8") !== result.text) {
        if (existsSync(live)) {
          backups.push(`${live}.bak-${when}`);
          writeFileSync(`${live}.bak-${when}`, readFileSync(live));
        }
        writeFileSync(live, result.text, "utf8");
        written.push(live);
      }
      const start = readFileSync(startPath, "utf8");
      const eol = start.includes("\r\n") ? "\r\n" : "\n";
      const custom = start
        .split(/\r?\n/)
        .map((line) => (line.trim() === "" ? line : "Custom"))
        .join(eol);
      if (custom !== start) {
        backups.push(`${startPath}.bak-${when}`);
        writeFileSync(`${startPath}.bak-${when}`, readFileSync(startPath));
        writeFileSync(startPath, custom, "utf8");
        written.push(startPath);
      }
    }
  }
  return {
    source,
    changes,
    collisions: [],
    written,
    backup: backups[0] ?? null,
    backups,
    pedals: null,
  };
}

/**
 * Whether each layout's profiles are on the units as they are compiled now: written there
 * directly by the editor (`logs/units-written.json`), or else held by the Azeron app. Only
 * reads: the app's directory is the app's. `setName` narrows to one layout.
 */
export function unitsReport(game: Game, setName?: string, store?: string): UnitsReport {
  const found = findStore(store);
  const writes = loadDirectWrites();
  const units: UnitCheck[] = [];
  for (const profile of game.loadedProfiles()) {
    const set = profile.set ?? "";
    if (setName !== undefined && set !== setName) continue;
    const file = posixJoin(game.distDir(), profile.outputName);
    const base = {
      set,
      unit: profile.unit ?? "?",
      name: profile.name ?? profile.slug,
      file,
      importPath: hostPath(repoPath(file)),
      copies: 0,
      differences: [] as UnitDifference[],
    };
    if (!existsSync(repoPath(file))) {
      units.push({ ...base, status: "unbuilt" });
      continue;
    }
    const document = JSON.parse(readFileSync(repoPath(file), "utf8")) as ExportDocument;
    const compiled =
      document.profiles.find((entry) => entry.name === profile.name) ??
      document.profiles[profile.meta.template_profile ?? 0];
    if (compiled === undefined) {
      units.push({ ...base, status: "unbuilt" });
      continue;
    }
    const name = compiled.name;
    // Written straight to the unit as it is now: current, whatever the app's copy says.
    const direct = currentWrite(
      writes,
      profile.device.softwareDeviceId,
      layoutFingerprint(compiled, [...profile.device.unknownPins]),
    );
    if (direct !== null) {
      units.push({
        ...base,
        name,
        status: "written",
        written: { slot: direct.slot, at: direct.at },
      });
      continue;
    }
    const copies = found === null ? [] : findStoredProfiles(found, name);
    const newest = copies[0];
    if (newest === undefined) {
      units.push({ ...base, name, status: "missing" });
      continue;
    }
    const differences = compareUnit(compiled, newest.profile, profile.device, game.actions);
    units.push({
      ...base,
      name,
      status: differences.length === 0 ? "matches" : "differs",
      appFile: hostPath(newest.path),
      appModified: newest.modified.toISOString(),
      copies: copies.length,
      differences,
    });
  }
  return { store: found === null ? null : hostPath(found), units };
}
