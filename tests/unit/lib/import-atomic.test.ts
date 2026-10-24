/**
 * An import that fails must leave nothing behind. The template it would have stored is a
 * committed file, so a stray one is a file to find and delete by hand.
 *
 * The targets are absolute paths in a temporary directory, which `repoPath` passes through,
 * so no test in the suite can see a half-written file in games/ or templates/.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadTemplate } from "../../../src/lib/io.js";
import { Game } from "../../../src/lib/model.js";
import { importExport } from "../../../src/lib/tasks.js";
import type { ExportDocument } from "../../../src/types/azeron.js";

const game = new Game("games/SpaceSims/everspace");
let dir = "";
let TEMPLATE = "";
let PROFILE = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "azeron-import-"));
  TEMPLATE = join(dir, "template.json");
  PROFILE = join(dir, "profile.yaml");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("importExport", () => {
  it("writes nothing when the export cannot be decompiled", () => {
    const broken = { version: "2.0.2", profiles: [] } as unknown as ExportDocument;
    expect(() =>
      importExport({
        exported: broken,
        game,
        device: "cyborg2-left",
        profilePath: PROFILE,
        templatePath: TEMPLATE,
      }),
    ).toThrow();
    expect(existsSync(TEMPLATE)).toBe(false);
    expect(existsSync(PROFILE)).toBe(false);
  });

  it("restores a template it had to overwrite when the profile cannot be written", () => {
    const exported = loadTemplate("templates/everspace2-v5.json");
    const original = '{"kept": true}\n';
    writeFileSync(TEMPLATE, original, "utf8");
    // A directory where the profile file should go makes the second write fail.
    mkdirSync(PROFILE);
    expect(() =>
      importExport({
        exported,
        game,
        device: "cyborg2-left",
        profilePath: PROFILE,
        templatePath: TEMPLATE,
        overwrite: true,
      }),
    ).toThrow();
    expect(readFileSync(TEMPLATE, "utf8")).toBe(original);
  });

  it("removes a template it created when the profile cannot be written", () => {
    const exported = loadTemplate("templates/everspace2-v5.json");
    mkdirSync(PROFILE);
    expect(() =>
      importExport({
        exported,
        game,
        device: "cyborg2-left",
        profilePath: PROFILE,
        templatePath: TEMPLATE,
      }),
    ).toThrow();
    expect(existsSync(TEMPLATE)).toBe(false);
  });
});
