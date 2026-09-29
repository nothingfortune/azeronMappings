/** Gather everything the editor page needs into one embeddable object. */

import { loadInherited } from "../yaml-io.js";
import { loadProfileData } from "../io.js";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { dataDirs, repoPath } from "../../config/paths.js";
import type { ExportDocument } from "../../types/azeron.js";
import type { EditorGame, EditorGenre, EditorPayload } from "../../types/editor.js";
import type { ActionSetData, DeviceData } from "../../types/profile.js";
import { loadTemplate } from "../io.js";
import { Game, Genre } from "../model.js";

const DEFAULT_TEMPLATE = join(dataDirs.templates, "everspace2-v5.json");

export function buildPayload(): EditorPayload {
  const devices: Record<string, DeviceData> = {};
  if (existsSync(repoPath(dataDirs.devices))) {
    for (const file of readdirSync(repoPath(dataDirs.devices)).sort()) {
      if (!file.endsWith(".yaml")) continue;
      const data = loadInherited(join(dataDirs.devices, file)) as unknown as DeviceData;
      devices[data.device] = data;
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
    };
  });

  const genres: EditorGenre[] = Genre.discover().map((genre) => ({
    name: genre.name,
    actions: {
      actions: genre.actions.actions,
      duplicate_key_allowlist: genre.actions.duplicateKeyAllowlist,
    } satisfies ActionSetData,
    default: genre.config,
  }));

  return { generatedAt: new Date().toISOString(), devices, templates, games, genres };
}
