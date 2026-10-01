/** dist/ is committed, so it must stay in step with the profile YAML. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import { compileProfile, dumps } from "../../../src/lib/compile.js";
import { applyPedalRows, applyVocabulary, parseInput } from "../../../src/lib/ingame.js";
import { loadTemplate } from "../../../src/lib/io.js";
import { Game } from "../../../src/lib/model.js";
import { ingameDistPath, pedalsFor } from "../../../src/lib/tasks.js";

describe("dist", () => {
  it("matches the profile YAML", () => {
    const stale: string[] = [];
    for (const game of Game.discover()) {
      for (const profile of game.loadedProfiles()) {
        const templatePath = profile.template ?? game.config.template;
        expect(templatePath, `${profile.path} has no template`).toBeTruthy();
        const text = dumps(
          compileProfile(profile, {
            template: loadTemplate(templatePath ?? ""),
            actions: game.actions.actions,
          }),
        );
        const outPath = join(game.distDir(), profile.outputName);
        const current = existsSync(repoPath(outPath))
          ? readFileSync(repoPath(outPath), "utf8")
          : null;
        if (current !== text) stale.push(outPath);
      }
    }
    expect(stale, "run `npm run azeron -- build` and stage the result").toEqual([]);
  });

  it("holds a copy of the game's bindings that agrees with actions.yaml", () => {
    // The in-game half is generated. If actions.yaml changes and the copy does not, the
    // game and the keypads have drifted apart and nothing else would say so.
    const stale: string[] = [];
    for (const game of Game.discover()) {
      const owned = new Set(game.config.ingame_owned_categories ?? []);
      if (owned.size === 0) continue;
      const path = ingameDistPath(game);
      expect(existsSync(repoPath(path)), `${path} is missing`).toBe(true);
      const current = readFileSync(repoPath(path), "utf8");
      const { changes } = applyVocabulary(parseInput(current), game.actions, owned);
      if (changes.length > 0) stale.push(`${path}: ${String(changes.length)} row(s)`);
      // The Joystick half, from the layout's pedals. Pedals with no captured name write
      // nothing, so until then this is trivially true; once names exist it is what says the
      // committed copy carries them.
      const pedals = pedalsFor(game);
      if (pedals !== null) {
        const written = applyPedalRows(parseInput(current), pedals.plan);
        if (written.changes.length > 0) {
          stale.push(`${path}: ${String(written.changes.length)} pedal field(s)`);
        }
      }
    }
    expect(stale, "run `npm run azeron -- ingame --apply` and stage the result").toEqual([]);
  });
});
