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
import { loadTemplate } from "../io.js";
import { Game, Genre } from "../model.js";

const DEFAULT_TEMPLATE = join(dataDirs.templates, "everspace2-v5.json");

export function buildPayload(): EditorPayload {
  const devices: Record<string, DeviceData> = {};
  // Pedals have axes, not pins. They are listed apart so everything that walks `devices`
  // expecting a position map keeps getting only keypads.
  const pedals: Record<string, PedalsDeviceData> = {};
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
        devices[keypad.device] = keypad;
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
        configured: game.config.ingame_config !== undefined,
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
    };
  });

  return { generatedAt: new Date().toISOString(), devices, pedals, templates, games, genres };
}
