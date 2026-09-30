/**
 * The binding sheet is compared against the game's controls screen, so it must report
 * three categories: actions that are sent, declared actions that nothing sends, and keys
 * a unit sends that no action declares.
 */

import { describe, expect, it } from "vitest";

import {
  bindingSheet,
  renderBindingsCsv,
  renderBindingsMarkdown,
} from "../../../src/lib/bindings.js";
import { loadProfile } from "../../../src/lib/io.js";
import { Game } from "../../../src/lib/model.js";
import { Profile } from "../../../src/lib/model-core.js";

const game = new Game("games/SpaceSims/everspace");
const sheet = (profiles = game.loadedProfiles()) => bindingSheet(game.name, game.actions, profiles);

describe("bindingSheet", () => {
  it("lists every unit and position that sends an action", () => {
    // Boost is held as a raw Shift on the left unit -- the app wrote it that way -- and
    // still counts as the boost action being sent.
    const row = sheet().rows.find((entry) => entry.action === "boost");
    expect(row?.key).toBe("ShiftLeft");
    expect(row?.sentFrom.length).toBeGreaterThan(0);
    expect(row?.sentFrom.every((where) => where.includes(":"))).toBe(true);
  });

  it("names stick directions rather than lumping them into one position", () => {
    const row = sheet().rows.find((entry) => entry.action === "throttle_up");
    expect(row?.sentFrom.some((where) => where.endsWith(".up"))).toBe(true);
  });

  it("separates what the game needs from what is actually sent", () => {
    const result = sheet();
    const sent = new Set(result.rows.map((row) => row.action));
    for (const row of result.unbound) expect(sent.has(row.action)).toBe(false);
    // The mouse-sensor axes are declared but never sent by a key.
    expect(result.unbound.some((row) => row.action === "pitch")).toBe(true);
  });

  it("flags a key that no action declares, which is how app-side edits show up", () => {
    const base = loadProfile("games/SpaceSims/everspace/profiles/akimbo-v9-left.yaml", game);
    const data = structuredClone(base.data);
    data.positions.middle_1 = { label: "Edited in the app", tap: { key: "F12" } };
    const edited = new Profile(data, base.device, { path: base.path, game });

    const result = sheet([edited]);
    expect(result.undeclared).toEqual([{ key: "F12", sentFrom: ["left:middle_1"] }]);
  });
});

describe("rendering", () => {
  it("marks a required action that nothing sends as MISSING in the csv", () => {
    const base = loadProfile("games/SpaceSims/everspace/profiles/akimbo-v9-left.yaml", game);
    const csv = renderBindingsCsv(sheet([base]));
    const missing = csv
      .split("\n")
      .filter((line) => line.endsWith('"MISSING"'))
      .join("\n");
    // Target locking lives on the right unit, so the left one alone cannot send it.
    expect(missing).toContain("lock_target");
  });

  it("writes a table a controls screen can be read against", () => {
    const markdown = renderBindingsMarkdown(sheet());
    expect(markdown).toContain("| Action | Key in game | Sent from | Tags |");
    expect(markdown).toContain("`mouse middle`");
  });
});
