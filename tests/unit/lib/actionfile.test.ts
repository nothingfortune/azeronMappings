/**
 * Saving a key from the editor changes that key and nothing else in actions.yaml. The file
 * extends a genre, carries an allowlist and explains itself in comments; regenerating it
 * lost all three.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { repoPath } from "../../../src/config/paths.js";
import { ActionFileError, patchActionBindings } from "../../../src/lib/actionfile.js";

interface ActionsFile {
  extends?: string;
  actions: Record<string, Record<string, unknown>>;
  duplicate_key_allowlist?: unknown[];
}

/** Parsed, typed just enough for the assertions. */
const read = (text: string): ActionsFile => parse(text) as ActionsFile;

const REAL = readFileSync(repoPath("games/SpaceSims/everspace/actions.yaml"), "utf8");

const FILE = [
  "# header",
  "extends: genres/SpaceSims/actions.yaml",
  "actions:",
  "  # flight",
  "  throttle_up:        {key: KeyW,       ingame: MoveForward, ingame_scale: 1}",
  "  boost:              {meta: ShiftLeft, ingame: Boost}",
  "  interact:           {key: KeyF,       ingame: Interact, label: Interact / fling}",
  "  free_look:          {ingame: FreeLook}",
  "",
  "duplicate_key_allowlist:",
  "  - {key: KeyF, actions: [interact, cruise]}",
  "",
].join("\n");

const lineOf = (text: string, id: string): string =>
  text.split("\n").find((line) => line.trimStart().startsWith(`${id}:`)) ?? "";

describe("patchActionBindings", () => {
  it("changes one key and leaves every other line exactly as it was", () => {
    const out = patchActionBindings(FILE, { throttle_up: { key: "KeyT" } });
    const before = FILE.split("\n");
    const after = out.split("\n");
    expect(after.length).toBe(before.length);
    after.forEach((line, index) => {
      if (line.trimStart().startsWith("throttle_up:")) return;
      expect(line).toBe(before[index]);
    });
    expect(lineOf(out, "throttle_up")).toBe(
      "  throttle_up:        {key: KeyT,       ingame: MoveForward, ingame_scale: 1}",
    );
  });

  it("keeps the table aligned when the new key is longer or shorter", () => {
    const out = patchActionBindings(FILE, { throttle_up: { key: "ArrowUp" } });
    expect(lineOf(out, "throttle_up")).toBe(
      "  throttle_up:        {key: ArrowUp,    ingame: MoveForward, ingame_scale: 1}",
    );
  });

  it("adds a key to an action that had none, and removes one", () => {
    const added = patchActionBindings(FILE, { free_look: { key: "KeyL" } });
    expect(read(added).actions.free_look).toEqual({ key: "KeyL", ingame: "FreeLook" });
    const removed = patchActionBindings(FILE, { interact: { key: null } });
    expect(read(removed).actions.interact).toEqual({
      ingame: "Interact",
      label: "Interact / fling",
    });
  });

  it("appends an action inherited from the genre that had no line of its own", () => {
    const out = patchActionBindings(FILE, { headlight: { key: "KeyB" } });
    expect(read(out).actions.headlight).toEqual({ key: "KeyB" });
    // Inside the actions block, not after the allowlist.
    expect(read(out).duplicate_key_allowlist).toHaveLength(1);
  });

  it("keeps extends, the allowlist and the comments", () => {
    const out = patchActionBindings(FILE, { boost: { meta: "ShiftRight" } });
    expect(out).toContain("# header");
    expect(out).toContain("  # flight");
    expect(read(out).extends).toBe("genres/SpaceSims/actions.yaml");
    expect(read(out).duplicate_key_allowlist).toEqual([
      { key: "KeyF", actions: ["interact", "cruise"] },
    ]);
  });

  it("does the same on the real file", () => {
    const out = patchActionBindings(REAL, { hover_up: { key: "Space" } });
    const changed = out.split("\n").filter((line, index) => line !== REAL.split("\n")[index]);
    expect(changed).toHaveLength(1);
    expect(read(out).actions.hover_up?.key).toBe("Space");
    expect(read(out).duplicate_key_allowlist).toEqual(read(REAL).duplicate_key_allowlist);
  });

  it("refuses an action written across several lines rather than reflowing it", () => {
    const multi = FILE.replace(
      "  boost:              {meta: ShiftLeft, ingame: Boost}",
      "  boost:\n    meta: ShiftLeft\n    ingame: Boost",
    );
    expect(() => patchActionBindings(multi, { boost: { meta: "AltLeft" } })).toThrow(
      /more than one line/,
    );
  });

  it("refuses something that is not a key name", () => {
    expect(() => patchActionBindings(FILE, { boost: { meta: "Shift, ingame: X" } })).toThrow(
      ActionFileError,
    );
  });
});
