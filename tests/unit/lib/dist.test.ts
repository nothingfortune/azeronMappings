/** dist/ is committed, so it must stay in step with the profile YAML. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import { compileProfile, dumps } from "../../../src/lib/compile.js";
import { loadTemplate } from "../../../src/lib/io.js";
import { Game } from "../../../src/lib/model.js";

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
});
