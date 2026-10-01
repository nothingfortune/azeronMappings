/**
 * Patching a layout's pedals into sets.yaml: the file's comments and every other set must
 * come through, and anything that cannot be patched safely is refused.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { repoPath } from "../../../src/config/paths.js";
import { parseSets } from "../../../src/lib/pedals.js";
import { patchSetPedals, renderAssignment, SetsFileError } from "../../../src/lib/setsfile.js";
import type { SetPedals } from "../../../src/types/pedals.js";

const REAL = readFileSync(repoPath("games/SpaceSims/everspace/sets.yaml"), "utf8");

const TWO = `# header
sets:
  one:
    pedals:
      device: p
      assign:
        rudder: {drives: yaw}   # springs back

        # a note about the toes
        left_toe: {drives: thrust, invert: true}
  two:
    pedals:
      device: p
      assign:
        rudder: {drives: roll}
`;

const comments = (text: string): string[] =>
  text
    .split("\n")
    .filter((line) => line.trim().startsWith("#"))
    .map((line) => line.trim());

const read = (text: string) => parseSets(parse(text) as unknown, "test").sets;

describe("patchSetPedals", () => {
  it("leaves the file byte for byte alone when nothing changed", () => {
    const pedals = read(REAL)["akimbo-v10"]?.pedals;
    expect(pedals).toBeDefined();
    expect(patchSetPedals(REAL, "akimbo-v10", pedals ?? null)).toBe(REAL);
  });

  it("adds an axis and keeps every comment in the real file", () => {
    const next: SetPedals = {
      device: "logitech-pro-flight-pedals",
      assign: { rudder: { drives: "yaw" }, left_toe: { drives: "thrust", invert: true } },
    };
    const patched = patchSetPedals(REAL, "akimbo-v10", next);
    expect(read(patched)["akimbo-v10"]?.pedals).toEqual(next);
    expect(comments(patched)).toEqual(comments(REAL));
    // The rudder's line is the one it was; only the new line is new.
    expect(patched).toContain("rudder: {drives: yaw}\n");
    expect(patched.split("\n").length).toBe(REAL.split("\n").length + 1);
  });

  it("rewrites only the entry that changed, and keeps its trailing comment", () => {
    const patched = patchSetPedals(TWO, "one", {
      device: "p",
      assign: {
        rudder: { drives: "yaw", invert: true, dead_zone: 0.05 },
        left_toe: { drives: "thrust", invert: true },
      },
    });
    expect(patched).toContain(
      "rudder: {drives: yaw, invert: true, dead_zone: 0.05}   # springs back",
    );
    expect(patched).toContain("left_toe: {drives: thrust, invert: true}");
    expect(comments(patched)).toEqual(comments(TWO));
    expect(read(patched).two).toEqual(read(TWO).two);
  });

  it("removes an axis and keeps the comments around it", () => {
    const patched = patchSetPedals(TWO, "one", {
      device: "p",
      assign: { rudder: { drives: "yaw" } },
    });
    expect(read(patched).one?.pedals?.assign).toEqual({ rudder: { drives: "yaw" } });
    expect(comments(patched)).toEqual(comments(TWO));
  });

  it("writes `assign: {}` when the last axis goes, and a block again when one returns", () => {
    const emptied = patchSetPedals(TWO, "two", { device: "p", assign: {} });
    expect(emptied).toContain("assign: {}");
    expect(read(emptied).two?.pedals?.assign).toEqual({});
    const back = patchSetPedals(emptied, "two", {
      device: "p",
      assign: { rudder: { drives: "yaw" } },
    });
    expect(back).toContain("      assign:\n        rudder: {drives: yaw}");
    expect(back).not.toContain("{}");
  });

  it("removes a set's pedals with its data lines, keeping the comments", () => {
    const patched = patchSetPedals(REAL, "akimbo-v10", null);
    expect(read(patched)["akimbo-v10"]?.pedals).toBeUndefined();
    expect(comments(patched)).toEqual(comments(REAL));
    expect(patched).not.toContain("rudder:");
  });

  it("changes the device", () => {
    const patched = patchSetPedals(TWO, "two", {
      device: "q",
      assign: { rudder: { drives: "roll" } },
    });
    expect(read(patched).two?.pedals?.device).toBe("q");
    expect(read(patched).one).toEqual(read(TWO).one);
  });

  it("adds a set that is not in the file, after the others", () => {
    const patched = patchSetPedals(TWO, "three", {
      device: "p",
      assign: { rudder: { drives: "yaw" } },
    });
    expect(Object.keys(read(patched))).toEqual(["one", "two", "three"]);
    expect(read(patched).one).toEqual(read(TWO).one);
    expect(patched.startsWith("# header\n")).toBe(true);
  });

  it("gives pedals to a set that is listed with none", () => {
    const text = "sets:\n  a:\n  b: {}\n";
    const patched = patchSetPedals(text, "b", {
      device: "p",
      assign: { rudder: { drives: "yaw" } },
    });
    expect(read(patched).b?.pedals?.assign).toEqual({ rudder: { drives: "yaw" } });
    expect(Object.keys(read(patched))).toEqual(["a", "b"]);
  });

  it("starts a file that has no sets, comments kept", () => {
    const patched = patchSetPedals("# nothing yet\n", "a", { device: "p", assign: {} });
    expect(patched.startsWith("# nothing yet\n")).toBe(true);
    expect(read(patched).a?.pedals).toEqual({ device: "p", assign: {} });
  });

  it("keeps CRLF line endings", () => {
    const crlf = TWO.replace(/\n/g, "\r\n");
    const patched = patchSetPedals(crlf, "two", {
      device: "p",
      assign: { rudder: { drives: "pitch" } },
    });
    expect(patched).not.toMatch(/[^\r]\n/);
    expect(read(patched).two?.pedals?.assign.rudder?.drives).toBe("pitch");
  });

  it("does nothing to a set that is absent when asked to remove its pedals", () => {
    expect(patchSetPedals(TWO, "nope", null)).toBe(TWO);
  });

  it("refuses a pedals block it cannot edit line by line", () => {
    const text = "sets:\n  a:\n    pedals: {device: p, assign: {rudder: {drives: yaw}}}\n";
    expect(() => patchSetPedals(text, "a", { device: "p", assign: {} })).toThrow(SetsFileError);
  });

  it("renders every field in a stable order, quoting what needs it", () => {
    expect(
      renderAssignment({
        drives: "yaw",
        shared: true,
        exponent: 2,
        note: 'say "hi"',
        sensitivity: 1.5,
        scale: 0.5,
        dead_zone: 0.1,
        invert: false,
      }),
    ).toBe(
      '{drives: yaw, invert: false, dead_zone: 0.1, scale: 0.5, sensitivity: 1.5, exponent: 2, shared: true, note: "say \\"hi\\""}',
    );
  });
});
