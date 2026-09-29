#!/usr/bin/env node
/** azeron -- build, decompile, lint, cheatsheet, editor, install. */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";

import { dataDirs, repoPath, repoRoot } from "./config/paths.js";
import { bindingSheet, renderBindingsCsv, renderBindingsMarkdown } from "./lib/bindings.js";
import { renderCheatsheet } from "./lib/cheatsheet.js";
import { CompileError, compileProfile, dumps } from "./lib/compile.js";
import { decompile, dumpProfile } from "./lib/decompile.js";
import { buildPayload } from "./lib/editor/payload.js";
import { renderEditorHtml } from "./lib/editor/html.js";
import {
  appIsRunning,
  findStore,
  installProfile,
  listDeviceIds,
  listStoredProfiles,
} from "./lib/install.js";
import { loadDevice, loadTemplate, writeText } from "./lib/io.js";
import { buildProbeProfile, buildStickCalibrationProfile } from "./lib/probe.js";
import { ERROR, WARNING, formatFinding, lintGame, lintGenre } from "./lib/lint.js";
import type { LintResult } from "./lib/lint.js";
import { Game, Genre } from "./lib/model.js";
import type { Profile } from "./lib/model-core.js";
import type { ProfileMeta } from "./types/profile.js";

const DEFAULT_DEVICE = "cyborg2-left";
const DEFAULT_PROBE_DEVICES = ["cyborg2-left", "cyborg2-right"];

function out(message: string): void {
  process.stdout.write(`${message}\n`);
}

function games(selector?: string): Game[] {
  const all = Game.discover();
  if (!selector) return all;
  const picked = all.filter((game) => [game.slug, game.name, game.rel].includes(selector));
  if (picked.length === 0) {
    throw new Error(`no game matches '${selector}' (have: ${all.map((g) => g.slug).join(", ")})`);
  }
  return picked;
}

function templateFor(profile: Profile, game: Game): string {
  const path = profile.template ?? game.config.template;
  if (!path) throw new CompileError(`${profile.path}: profile.template is required`);
  return path;
}

function compiled(profile: Profile, game: Game): string {
  return dumps(
    compileProfile(profile, {
      template: loadTemplate(templateFor(profile, game)),
      actions: game.actions.actions,
    }),
  );
}

function cmdBuild(selector: string | undefined, check: boolean): number {
  let failures = 0;
  for (const game of games(selector)) {
    for (const profile of game.loadedProfiles()) {
      const outPath = join(game.distDir(), profile.outputName);
      let text: string;
      try {
        text = compiled(profile, game);
      } catch (error) {
        process.stderr.write(`error: ${(error as Error).message}\n`);
        failures += 1;
        continue;
      }
      const previous = existsSync(repoPath(outPath))
        ? readFileSync(repoPath(outPath), "utf8")
        : null;
      if (check) {
        if (previous !== text) {
          out(`stale: ${outPath} does not match ${profile.path}`);
          failures += 1;
        }
        continue;
      }
      writeText(outPath, text);
      out(`${previous === text ? "unchanged" : "wrote    "} ${outPath}`);
    }
  }
  return failures > 0 ? 1 : 0;
}

function report(label: string, result: LintResult, strict: boolean, showAcked: boolean): number {
  const errors = result.live.filter((finding) => finding.level === ERROR);
  const warnings = result.live.filter((finding) => finding.level === WARNING);
  out(
    `${label}: ${String(errors.length)} error(s), ${String(warnings.length)} warning(s), ` +
      `${String(result.acknowledged.length)} acknowledged`,
  );
  for (const finding of result.live) out(`  ${formatFinding(finding)}`);
  if (showAcked) {
    for (const { finding, ack } of result.acknowledged) {
      const reason = (ack.reason ?? "").split(/\s+/).join(" ");
      out(
        `  acked   ${finding.rule.padEnd(22)} ${(finding.position ?? finding.key ?? "-").padEnd(28)} ${reason}`,
      );
    }
  }
  return errors.length > 0 || (strict && warnings.length > 0) ? 1 : 0;
}

function cmdLint(selector: string | undefined, strict: boolean, showAcked: boolean): number {
  let worst = 0;
  if (!selector) {
    for (const genre of Genre.discover()) {
      worst |= report(`genres/${genre.name}`, lintGenre(genre), strict, showAcked);
    }
  }
  for (const game of games(selector)) {
    worst |= report(game.slug, lintGame(game), strict, showAcked);
  }
  return worst;
}

function cmdRoundtrip(selector: string | undefined): number {
  let failures = 0;
  for (const game of games(selector)) {
    for (const profile of game.loadedProfiles()) {
      if (!profile.meta.golden) {
        out(`skipped (not a golden decompile): ${profile.path}`);
        continue;
      }
      const templatePath = templateFor(profile, game);
      const template = loadTemplate(templatePath);
      const index = profile.meta.template_profile ?? 0;
      const expected = { ...template, profiles: [template.profiles[index]] };
      const built = compileProfile(profile, { template, actions: game.actions.actions });
      if (JSON.stringify(built) === JSON.stringify(expected)) {
        out(`round trip ok: ${profile.path}`);
      } else {
        out(`round trip DIFFERS: ${profile.path} vs ${templatePath}`);
        failures += 1;
      }
    }
  }
  return failures > 0 ? 1 : 0;
}

function cmdCheatsheet(selector: string | undefined): number {
  for (const game of games(selector)) {
    // One page per set, so a pair is learned as a pair rather than as two sheets.
    const bySet = new Map<string, Profile[]>();
    for (const profile of game.loadedProfiles()) {
      const key = profile.set ?? profile.slug;
      const list = bySet.get(key) ?? [];
      list.push(profile);
      bySet.set(key, list);
    }
    for (const [setName, profiles] of [...bySet].sort(([a], [b]) => a.localeCompare(b))) {
      const ordered = [...profiles].sort(
        (a, b) => Number(a.unit === "right") - Number(b.unit === "right"),
      );
      const outPath = join(game.distDir(), "cheatsheets", `${setName}.html`);
      writeText(outPath, renderCheatsheet(ordered, game.actions));
      out(`wrote ${outPath}  (${String(ordered.length)} unit(s))`);
    }
  }
  return 0;
}

const PROBE_ID = "7c3f5f2e-2a3b-4c21-9b7d-0d2f6a1c4e88";
const PROBE_STICK_ID = "b41d9a06-5f8e-4a77-9c15-3e6b2d4f8a19";

function readBundle(name: string): string | null {
  const path = join(repoRoot, "build", name);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function cmdProbe(devices: string[], templatePath: string, outDir: string): number {
  const template = loadTemplate(templatePath);
  const loaded = devices.map((name) => loadDevice(name));
  const first = loaded[0];
  if (!first) throw new Error("probe needs at least one device");

  // One profile serves both units: the pins are what is being tested, and the same file
  // imports onto either unit.
  const { doc, assignments } = buildProbeProfile(template, {
    id: PROBE_ID,
    name: "PROBE 1 pins",
    unknownPins: [...first.unknownPins],
  });
  const profilePath = join(outDir, "probe-1-pins.json");
  writeText(profilePath, `${JSON.stringify(doc, null, 2)}\n`);

  const calibration = buildStickCalibrationProfile(template, {
    id: PROBE_STICK_ID,
    name: "PROBE 2 stick zero",
  });
  const stickPath = join(outDir, "probe-2-stick-zero.json");
  writeText(stickPath, `${JSON.stringify(calibration.doc, null, 2)}\n`);

  out(`wrote ${profilePath}  (${String(assignments.length)} probe keys)`);
  out(`wrote ${stickPath}     (${String(calibration.assignments.length)} stick sectors)`);
  out("");
  out("  1. Import probe-1-pins.json in the Azeron app and write it to the unit.");
  out("  2. Close the app, open the editor, and switch to Press test.");
  out("  3. Export the device YAML it produces over devices/<unit>.yaml.");
  out("");
  out("  `azeron editor` can download both profiles itself -- this command is for");
  out("  getting them without opening a browser.");
  return 0;
}

function cmdBindings(selector: string | undefined): number {
  for (const game of games(selector)) {
    const sheet = bindingSheet(game.name, game.actions, game.loadedProfiles());
    const base = join(game.distDir(), `${game.slug}-ingame-bindings`);
    writeText(`${base}.md`, renderBindingsMarkdown(sheet));
    writeText(`${base}.csv`, renderBindingsCsv(sheet));
    out(
      `wrote ${base}.md and .csv  (${String(sheet.rows.length)} sent, ` +
        `${String(sheet.unbound.length)} unsent, ${String(sheet.undeclared.length)} undeclared)`,
    );
  }
  return 0;
}

function cmdEditor(outPath: string): number {
  const bundle = readBundle("editor-app.js");
  if (bundle === null) {
    process.stderr.write("error: build/editor-app.js is missing. Run `npm run build` first.\n");
    return 1;
  }
  const html = renderEditorHtml(buildPayload(), bundle);
  writeText(outPath, html);
  out(`wrote ${outPath}  (${String(Math.round(html.length / 1024))} KB) -- open it in a browser`);
  return 0;
}

interface DecompileFlags {
  device: string;
  game?: string | undefined;
  set?: string | undefined;
  template?: string | undefined;
  outputName?: string | undefined;
  profileIndex: number;
  golden: boolean;
  out?: string | undefined;
}

function cmdDecompile(exportPath: string, flags: DecompileFlags): number {
  const game = flags.game ? games(flags.game)[0] : undefined;
  const meta: Partial<ProfileMeta> = {
    template: flags.template ?? relative(repoRoot, repoPath(exportPath)),
  };
  if (flags.set) meta.set = flags.set;
  if (flags.outputName) meta.output = flags.outputName;
  if (flags.golden) meta.golden = true;

  const text = dumpProfile(
    decompile(loadTemplate(exportPath), loadDevice(flags.device), {
      actions: game?.actions ?? null,
      profileIndex: flags.profileIndex,
      meta,
    }),
  );
  if (flags.out) {
    writeText(flags.out, text);
    out(`wrote ${flags.out}`);
  } else {
    process.stdout.write(text);
  }
  return 0;
}

interface InstallFlags {
  store?: string | undefined;
  deviceId?: string | undefined;
  yes: boolean;
  dryRun: boolean;
}

function cmdInstall(selector: string | undefined, flags: InstallFlags): number {
  const store = findStore(flags.store);
  if (!store) {
    process.stderr.write(
      "error: could not find the Azeron store. Pass --store, or set AZERON_STORE.\n",
    );
    return 1;
  }
  out(`store: ${store}`);
  const deviceIds = listDeviceIds(store);
  if (deviceIds.length === 0) {
    process.stderr.write("error: no devices in that store.\n");
    return 1;
  }
  for (const id of deviceIds) {
    const stored = listStoredProfiles(store, id);
    out(
      `  device ${id}: ${String(stored.length)} profile(s)${stored.length ? ` -- ${stored.map((p) => p.name).join(", ")}` : ""}`,
    );
  }

  // A dry run writes nothing, so it is allowed while the app is open.
  if (!flags.dryRun && appIsRunning()) {
    process.stderr.write(
      "error: the Azeron app is running. It rewrites this directory as it pleases -- " +
        "close it first.\n",
    );
    return 1;
  }

  if (!flags.yes && !flags.dryRun) {
    process.stderr.write(
      "error: this writes outside the repo. Re-run with --yes (or --dry-run).\n",
    );
    return 1;
  }

  let count = 0;
  for (const game of games(selector)) {
    for (const profile of game.loadedProfiles()) {
      const doc = compileProfile(profile, {
        template: loadTemplate(templateFor(profile, game)),
        actions: game.actions.actions,
      });
      const target = doc.profiles[0];
      if (!target) continue;
      // Each profile knows its unit, and each unit knows the id the app files it under,
      // so a pair installs onto the correct units without naming them.
      const deviceId = flags.deviceId ?? profile.device.softwareDeviceId;
      if (deviceId === undefined) {
        process.stderr.write(
          `error: ${profile.path}: device ${profile.device.name} has no ` +
            "software_device_id, and no --device-id was given.\n",
        );
        return 1;
      }
      if (!deviceIds.includes(deviceId)) {
        process.stderr.write(
          `error: device id ${deviceId} (${profile.device.name}) is not in the store. ` +
            "Connect the unit and open the app once so it registers.\n",
        );
        return 1;
      }
      const result = installProfile({
        store,
        deviceId,
        profile: target,
        dryRun: flags.dryRun,
      });
      out(
        `${flags.dryRun ? "would write" : "wrote     "} ${profile.unit ?? profile.slug} -> ${result.path}` +
          (result.shaped ? "" : "  (no stored profile to copy the shape from)") +
          (result.backedUpTo ? `  backup: ${result.backedUpTo}` : ""),
      );
      count += 1;
    }
  }
  out(`${String(count)} profile(s). Reopen the Azeron app, then write them to the device.`);
  return 0;
}

function usage(): void {
  out(`azeron <command>

  build [game] [--check]          compile profile YAML into ${dataDirs.dist}/
  lint [game] [--strict] [--show-acknowledged]
  roundtrip [game]                verify golden profiles rebuild their template
  cheatsheet [game]               per-profile layout diagram + binding checklist
  bindings [game]                 the in-game key list to check against the game
  editor [--out PATH]             side-by-side WYSIWYG editor (self-contained HTML)
  probe [--device D ...]          press-test profile + capture page for the real pin map
  decompile <export.json> [--device D] [--game G] [--set S] [--template T]
            [--output-name N] [--profile-index N] [--golden] [-o OUT]
  install [game] --device-id ID [--store PATH] [--yes] [--dry-run]
`);
}

export function main(argv: string[]): number {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    usage();
    return command ? 0 : 1;
  }

  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      check: { type: "boolean", default: false },
      strict: { type: "boolean", default: false },
      "show-acknowledged": { type: "boolean", default: false },
      golden: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      device: { type: "string", default: DEFAULT_DEVICE },
      game: { type: "string" },
      set: { type: "string" },
      template: { type: "string" },
      "output-name": { type: "string" },
      "profile-index": { type: "string", default: "0" },
      store: { type: "string" },
      "device-id": { type: "string" },
      out: { type: "string", short: "o" },
    },
  });

  switch (command) {
    case "build":
      return cmdBuild(positionals[0], values.check);
    case "lint":
      return cmdLint(positionals[0], values.strict, values["show-acknowledged"]);
    case "roundtrip":
      return cmdRoundtrip(positionals[0]);
    case "cheatsheet":
      return cmdCheatsheet(positionals[0]);
    case "bindings":
      return cmdBindings(positionals[0]);
    case "editor":
      return cmdEditor(values.out ?? join(dataDirs.dist, "editor.html"));
    case "probe": {
      const chosen = values.device === DEFAULT_DEVICE ? DEFAULT_PROBE_DEVICES : [values.device];
      return cmdProbe(
        chosen,
        values.template ?? join(dataDirs.templates, "everspace2-v5.json"),
        values.out ?? join(dataDirs.dist, "probe"),
      );
    }
    case "decompile": {
      const target = positionals[0];
      if (!target) throw new Error("decompile needs an export path");
      return cmdDecompile(target, {
        device: values.device,
        game: values.game,
        set: values.set,
        template: values.template,
        outputName: values["output-name"],
        profileIndex: Number(values["profile-index"]),
        golden: values.golden,
        out: values.out,
      });
    }
    case "install":
      return cmdInstall(positionals[0], {
        store: values.store,
        deviceId: values["device-id"],
        yes: values.yes,
        dryRun: values["dry-run"],
      });
    default:
      process.stderr.write(`unknown command '${command}'\n`);
      usage();
      return 1;
  }
}

const invokedDirectly = process.argv[1]?.includes("index") ?? false;
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`error: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
