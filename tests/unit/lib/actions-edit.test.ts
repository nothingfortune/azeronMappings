/**
 * Naming and tagging an action from the editor changes that line of actions.yaml and
 * nothing else, the same as changing its key does.
 *
 * The repo root is swapped for a scratch copy, because one test starts a game and the
 * others discover games in the real tree at the same time.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

vi.mock("../../../src/config/paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/config/paths.js")>();
  const root = mkdtempSync(join(tmpdir(), "azeron-actions-edit-"));
  for (const dir of ["genres", "devices"])
    cpSync(join(actual.repoRoot, dir), join(root, dir), { recursive: true });
  mkdirSync(join(root, "templates"));
  cpSync(
    join(actual.repoRoot, "templates", "everspace2-v5.json"),
    join(root, "templates", "everspace2-v5.json"),
  );
  mkdirSync(join(root, "games"));
  return {
    ...actual,
    repoRoot: root,
    repoPath: (...parts: readonly string[]) => {
      const joined = join(...parts);
      return isAbsolute(joined) ? joined : join(root, joined);
    },
  };
});

import { repoPath, repoRoot } from "../../../src/config/paths.js";
import { ActionFileError, patchActionBindings, yamlScalar } from "../../../src/lib/actionfile.js";
import { loadTemplate } from "../../../src/lib/io.js";
import { createGame } from "../../../src/lib/tasks.js";

interface ActionsFile {
  extends?: string;
  actions: Record<string, Record<string, unknown>>;
  duplicate_key_allowlist?: unknown[];
}

const read = (text: string): ActionsFile => parse(text) as ActionsFile;

const FILE = [
  "# header",
  "extends: genres/SpaceSims/actions.yaml",
  "actions:",
  "  # flight",
  "  throttle_up:        {key: KeyW,       ingame: MoveForward, ingame_scale: 1}",
  "  boost:              {meta: ShiftLeft, ingame: Boost, tags: [combat, movement]}",
  "  interact:           {key: KeyF,       ingame: Interact, label: Interact / fling}",
  '  quoted:             {key: KeyQ, label: "Fire, then reload", tags: [combat]}',
  "  free_look:          {ingame: FreeLook}  # kept",
  "",
  "duplicate_key_allowlist:",
  "  - {key: KeyF, actions: [interact, cruise]}",
  "",
].join("\n");

const lineOf = (text: string, id: string): string =>
  text.split("\n").find((line) => line.trimStart().startsWith(`${id}:`)) ?? "";

/** Every line but the ones for these ids, which must be exactly as they were. */
function othersUntouched(out: string, ...ids: string[]): void {
  const before = FILE.split("\n");
  const after = out.split("\n");
  expect(after.length).toBe(before.length);
  after.forEach((line, index) => {
    if (ids.some((id) => line.trimStart().startsWith(`${id}:`))) return;
    expect(line).toBe(before[index]);
  });
}

describe("yamlScalar", () => {
  it("leaves a plain label plain and quotes one a flow mapping could not hold", () => {
    expect(yamlScalar("Interact / fling")).toBe("Interact / fling");
    expect(yamlScalar("Fire (primary)")).toBe("Fire (primary)");
    expect(yamlScalar("Fire, then reload")).toBe('"Fire, then reload"');
    expect(yamlScalar("Mode: fast")).toBe('"Mode: fast"');
    expect(yamlScalar("Zoom #2")).toBe('"Zoom #2"');
    expect(yamlScalar("[Hold] aim")).toBe('"[Hold] aim"');
    expect(yamlScalar("{x}")).toBe('"{x}"');
    expect(yamlScalar("- first")).toBe('"- first"');
    expect(yamlScalar("trailing ")).toBe('"trailing "');
    expect(yamlScalar('say "hi"')).toBe('"say \\"hi\\""');
  });

  it("quotes what a reader would take for another type", () => {
    for (const text of ["true", "null", "123", "1.5", "~"]) {
      const out = yamlScalar(text);
      expect((parse(`{label: ${out}}`) as { label: unknown }).label).toBe(text);
    }
  });
});

describe("patchActionBindings: labels", () => {
  it("renames one action and leaves every other line as it was", () => {
    const out = patchActionBindings(FILE, { throttle_up: { label: "Thrust forward" } });
    othersUntouched(out, "throttle_up");
    expect(read(out).actions.throttle_up).toEqual({
      label: "Thrust forward",
      key: "KeyW",
      ingame: "MoveForward",
      ingame_scale: 1,
    });
  });

  it("replaces an existing label in place, keeping the table's alignment", () => {
    const out = patchActionBindings(FILE, { interact: { label: "Use" } });
    expect(lineOf(out, "interact")).toBe(
      "  interact:           {key: KeyF,       ingame: Interact, label: Use}",
    );
    othersUntouched(out, "interact");
  });

  it("quotes a label a flow mapping cannot hold, and it reads back exactly", () => {
    for (const label of ["Fire, then reload", "Mode: fast", "Zoom #2", "[Hold] aim", 'a "b"']) {
      const out = patchActionBindings(FILE, { boost: { label } });
      expect(read(out).actions.boost).toEqual({
        meta: "ShiftLeft",
        ingame: "Boost",
        tags: ["combat", "movement"],
        label,
      });
      othersUntouched(out, "boost");
    }
  });

  it("changes a label that is already quoted and contains a comma", () => {
    const out = patchActionBindings(FILE, { quoted: { label: "Fire" } });
    expect(read(out).actions.quoted).toEqual({ key: "KeyQ", label: "Fire", tags: ["combat"] });
    const back = patchActionBindings(out, { quoted: { label: "Fire, again" } });
    expect(read(back).actions.quoted?.label).toBe("Fire, again");
  });

  it("removes a label", () => {
    const out = patchActionBindings(FILE, { interact: { label: null } });
    expect(read(out).actions.interact).toEqual({ key: "KeyF", ingame: "Interact" });
  });

  it("keeps a trailing comment on the line", () => {
    const out = patchActionBindings(FILE, { free_look: { label: "Look around" } });
    expect(lineOf(out, "free_look")).toContain("# kept");
    expect(read(out).actions.free_look?.label).toBe("Look around");
  });

  it("refuses a label that is empty, multi-line, too long or not text", () => {
    for (const label of ["", "   ", "a\nb", "x".repeat(121), 7, true, {}]) {
      expect(() =>
        patchActionBindings(FILE, { boost: { label: label as unknown as string } }),
      ).toThrow(ActionFileError);
    }
  });
});

describe("patchActionBindings: tags", () => {
  it("sets, replaces and clears tags without touching the rest of the line", () => {
    const set = patchActionBindings(FILE, { throttle_up: { tags: ["movement", "required"] } });
    expect(read(set).actions.throttle_up?.tags).toEqual(["movement", "required"]);
    othersUntouched(set, "throttle_up");

    const replaced = patchActionBindings(FILE, { boost: { tags: ["utility"] } });
    expect(read(replaced).actions.boost).toEqual({
      meta: "ShiftLeft",
      ingame: "Boost",
      tags: ["utility"],
    });
    othersUntouched(replaced, "boost");

    // An empty list is how a tag the genre supplies is taken away: null would only drop the
    // field from this line and the genre's tags would come back.
    const cleared = patchActionBindings(FILE, { boost: { tags: [] } });
    expect(read(cleared).actions.boost?.tags).toEqual([]);

    const dropped = patchActionBindings(FILE, { boost: { tags: null } });
    expect(read(dropped).actions.boost).toEqual({ meta: "ShiftLeft", ingame: "Boost" });
  });

  it("changes a label and tags and a key in one go", () => {
    const out = patchActionBindings(FILE, {
      boost: { label: "Afterburner", tags: ["combat"], meta: "ShiftRight" },
    });
    expect(read(out).actions.boost).toEqual({
      meta: "ShiftRight",
      ingame: "Boost",
      tags: ["combat"],
      label: "Afterburner",
    });
    othersUntouched(out, "boost");
  });

  it("appends an inherited action with a label and tags, inside the actions block", () => {
    const out = patchActionBindings(FILE, { headlight: { label: "Lamp", tags: ["utility"] } });
    expect(read(out).actions.headlight).toEqual({ label: "Lamp", tags: ["utility"] });
    expect(read(out).duplicate_key_allowlist).toHaveLength(1);
    expect(read(out).extends).toBe("genres/SpaceSims/actions.yaml");
    expect(out).toContain("# header");
    expect(out).toContain("  # flight");
  });

  it("refuses tags that are not a list of words", () => {
    for (const tags of ["combat", [1], ["Combat"], ["a, b"], ["a", "a"], [null], {}]) {
      expect(() =>
        patchActionBindings(FILE, { boost: { tags: tags as unknown as string[] } }),
      ).toThrow(ActionFileError);
    }
  });
});

describe("patchActionBindings: what the page may send", () => {
  it("refuses a key that is not a string, rather than writing it", () => {
    for (const key of [5, true, { a: 1 }, ["KeyA"]]) {
      expect(() => patchActionBindings(FILE, { boost: { key: key as unknown as string } })).toThrow(
        /must be a key name/,
      );
    }
    // A new action's line is built from the same values.
    expect(() => patchActionBindings(FILE, { fresh: { key: 5 as unknown as string } })).toThrow(
      ActionFileError,
    );
  });

  it("refuses a field it does not know, and an id that is not an id", () => {
    expect(() =>
      patchActionBindings(FILE, { boost: { ingame: "X" } as unknown as { key: string } }),
    ).toThrow(/not a field/);
    expect(() => patchActionBindings(FILE, { "a: {b": { key: "KeyA" } })).toThrow(
      /not an action id/,
    );
    expect(() => patchActionBindings(FILE, { boost: null as unknown as { key: string } })).toThrow(
      ActionFileError,
    );
    expect(() => patchActionBindings(FILE, [] as unknown as Record<string, never>)).toThrow(
      ActionFileError,
    );
  });
});

describe("a game started from an export", () => {
  const SLUG = "zzActionsEdit";
  afterAll(() => {
    rmSync(repoPath(`games/FPS/${SLUG}`), { recursive: true, force: true });
  });

  it("has an actions.yaml the editor's save can patch, and nothing is lost", () => {
    createGame({
      exported: loadTemplate("templates/everspace2-v5.json"),
      name: "ZZ Actions Edit",
      slug: SLUG,
      genre: "FPS",
      device: "cyborg2-left",
      set: "v1",
    });
    const path = `games/FPS/${SLUG}/actions.yaml`;
    expect(existsSync(repoPath(path))).toBe(true);
    const text = readFileSync(repoPath(path), "utf8");
    expect(text.split("\n").filter((line) => /^ {2}\S+:/.test(line)).length).toBeGreaterThan(10);

    const before = read(text);
    expect(before.extends).toBe("genres/FPS/actions.yaml");
    // The seeded label is what a person reads, not the browser's code.
    expect(before.actions.key_f?.label).toBe("F (unnamed)");

    const out = patchActionBindings(text, {
      key_f: { label: "Fire, primary", tags: ["combat", "required"], key: "KeyG" },
    });
    const after = read(out);
    expect(after.actions.key_f).toEqual({
      label: "Fire, primary",
      tags: ["combat", "required"],
      key: "KeyG",
    });
    expect(after.actions.key_w).toEqual(before.actions.key_w);
    expect(Object.keys(after.actions)).toEqual(Object.keys(before.actions));
    expect(repoRoot).toContain("azeron-actions-edit-");
  });
});
