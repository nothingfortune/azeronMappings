/**
 * A layout deleted or renamed takes its entry in sets.yaml with it, line by line, so the
 * file's comments and every other layout come through.
 */
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { removeSetEntry, renameSetEntry } from "../../../src/lib/setsfile.js";

const FILE = [
  "# header comment",
  "sets:",
  "  first:",
  "    modes: [ship]",
  "  # about second",
  "  second:",
  "    pedals:",
  "      device: logitech-pro-flight-pedals",
  "      assign:",
  "        rudder: {drives: yaw}",
  "  third:",
  "    modes: [srv]",
  "",
].join("\n");

const sets = (text: string): Record<string, unknown> =>
  (parse(text) as { sets: Record<string, unknown> }).sets;

describe("removeSetEntry", () => {
  it("takes the one entry out and leaves the others and the comments", () => {
    const out = removeSetEntry(FILE, "second");
    expect(Object.keys(sets(out))).toEqual(["first", "third"]);
    expect(out).toContain("# header comment");
    expect(out).not.toContain("rudder");
  });

  it("removes the last entry, and an emptied file reads as no sets", () => {
    let out = removeSetEntry(FILE, "third");
    expect(Object.keys(sets(out))).toEqual(["first", "second"]);
    out = removeSetEntry(removeSetEntry(out, "first"), "second");
    expect(sets(out)).toEqual({});
  });

  it("leaves a file with no such entry as it was", () => {
    expect(removeSetEntry(FILE, "nope")).toBe(FILE);
  });
});

describe("renameSetEntry", () => {
  it("renames the entry and keeps what is in it", () => {
    const out = renameSetEntry(FILE, "second", "renamed");
    expect(Object.keys(sets(out))).toEqual(["first", "renamed", "third"]);
    expect(sets(out).renamed).toEqual(sets(FILE).second);
  });

  it("refuses a name another layout has", () => {
    expect(() => renameSetEntry(FILE, "second", "third")).toThrow(/already has third/);
  });
});
