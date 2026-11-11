/** Gather everything the editor page needs into one embeddable object. */

import { loadInherited } from "../yaml-io.js";
import { loadProfileData, loadStickModes } from "../io.js";
import { parsePedalsDevice } from "../pedals.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { dataDirs, repoPath } from "../../config/paths.js";
import type { ExportDocument } from "../../types/azeron.js";
import type { EditorGame, EditorGenre, EditorPayload } from "../../types/editor.js";
import type { PedalsDeviceData } from "../../types/pedals.js";
import type { ActionSetData, DeviceData } from "../../types/profile.js";
import { findStore } from "../install.js";
import { loadTemplate } from "../io.js";
import { loadLocal } from "../machine.js";
import type { LocalSettings } from "../machine.js";
import { Game, Genre } from "../model.js";
import { STYLE_ORDER } from "../styles.js";

const DEFAULT_TEMPLATE = join(dataDirs.templates, "everspace2-v5.json");

export function buildPayload(local: LocalSettings = loadLocal()): EditorPayload {
  const devices: Record<string, DeviceData> = {};
  // Pedals have axes, not pins. They are listed apart so everything that walks `devices`
  // expecting a position map keeps getting only keypads.
  const pedals: Record<string, PedalsDeviceData> = {};
  // A unit's id is this person's: local.yaml gives it, as loadDevice does for the CLI.
  if (existsSync(repoPath(dataDirs.devices))) {
    for (const file of readdirSync(repoPath(dataDirs.devices)).sort()) {
      if (!file.endsWith(".yaml")) continue;
      const path = join(dataDirs.devices, file);
      const data = loadInherited(path);
      if (data.kind === "pedals") {
        const device = parsePedalsDevice(data, path);
        pedals[device.device] = device;
      } else {
        const keypad = data as unknown as DeviceData;
        const id = local.devices[keypad.device]?.software_device_id;
        devices[keypad.device] = id === undefined ? keypad : { ...keypad, software_device_id: id };
      }
    }
  }

  const templates: Record<string, ExportDocument> = {};
  const addTemplate = (path: string | undefined): void => {
    if (!path || path in templates) return;
    if (!existsSync(repoPath(path))) return;
    templates[path] = loadTemplate(path);
  };
  addTemplate(DEFAULT_TEMPLATE);
  // Each unit's own export: the press test is built on it, as a new game's profiles are.
  for (const device of Object.values(devices)) addTemplate(device.template);

  const games: EditorGame[] = Game.discover().map((game) => {
    const profiles = game.profilePaths().map((path) => ({
      slug:
        path
          .split("/")
          .pop()
          ?.replace(/\.ya?ml$/, "") ?? path,
      path,
      data: loadProfileData(path),
    }));
    for (const profile of profiles) addTemplate(profile.data.profile.template);
    addTemplate(game.config.template);
    return {
      slug: game.slug,
      name: game.name,
      rel: game.rel,
      template: game.config.template ?? DEFAULT_TEMPLATE,
      actions: {
        actions: game.actions.actions,
        duplicate_key_allowlist: game.actions.duplicateKeyAllowlist,
      },
      lintConfig: game.lintConfig,
      profiles,
      sets: game.sets,
      setsText: existsSync(repoPath(join(game.rel, "sets.yaml")))
        ? readFileSync(repoPath(join(game.rel, "sets.yaml")), "utf8")
        : "",
      ...(game.config.ingame_set === undefined ? {} : { ingameSet: game.config.ingame_set }),
      ingameFile: {
        configured: game.places.ingame_config.from !== null,
        found: game.places.ingame_config.found,
        ownedCategories: game.config.ingame_owned_categories?.length ?? 0,
        format: game.config.ingame_format ?? "unreal-ini",
      },
    };
  });

  const genres: EditorGenre[] = Genre.discover().map((genre) => {
    const stickModes = loadStickModes(genre.rel);
    return {
      name: genre.name,
      actions: {
        actions: genre.actions.actions,
        duplicate_key_allowlist: genre.actions.duplicateKeyAllowlist,
      } satisfies ActionSetData,
      default: genre.config,
      ...(stickModes ? { stickModes } : {}),
      styles: [
        ...STYLE_ORDER.filter((name) => name in genre.styles),
        ...Object.keys(genre.styles).filter(
          (name) => !(STYLE_ORDER as readonly string[]).includes(name),
        ),
      ].map((name) => ({
        name,
        label: genre.styles[name]?.label ?? name,
        note: genre.styles[name]?.note ?? "",
      })),
    };
  });

  const store = findStore();
  return {
    generatedAt: new Date().toISOString(),
    devices,
    pedals,
    templates,
    games,
    genres,
    appStore: store !== null && existsSync(store),
  };
}
