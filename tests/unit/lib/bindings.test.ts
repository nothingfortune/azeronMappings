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
import { ActionSet, Profile } from "../../../src/lib/model-core.js";
import { live } from "../../helpers/fixtures.js";

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
    // The pointer axes are declared but never sent by a key.
    expect(result.unbound.some((row) => row.action === "pointer_y")).toBe(true);
  });

  it("flags a key that no action declares, which is how app-side edits show up", () => {
    const base = loadProfile(live("left"), game);
    const data = structuredClone(base.data);
    data.positions.middle_1 = { label: "Edited in the app", tap: { key: "F12" } };
    const edited = new Profile(data, base.device, { path: base.path, game });

    const result = sheet([edited]);
    expect(result.undeclared).toEqual([{ key: "F12", sentFrom: ["left:middle_1"] }]);
  });

  it("spells an undeclared key the way the linter spells it", () => {
    // The app writes a modifier as a legacy keycode. Reported verbatim as `17`, it could
    // not be matched against the linter's `unbound-key`, which names the same binding
    // ControlLeft. No action declares ControlLeft, so this one really is undeclared.
    const base = loadProfile("games/SpaceSims/everspace/profiles/single-v5.yaml", game);
    const data = structuredClone(base.data);
    data.positions.middle_1 = { label: "Edited in the app", tap: { meta_raw: "17" } };
    const edited = new Profile(data, base.device, { path: base.path, game });

    expect(sheet([edited]).undeclared).toEqual([
      { key: "ControlLeft", sentFrom: ["left:middle_1"] },
    ]);
  });
});

describe("rendering", () => {
  it("marks a required action that nothing sends as MISSING in the csv", () => {
    const base = loadProfile(live("left"), game);
    const csv = renderBindingsCsv(sheet([base]));
    const missing = csv
      .split("\n")
      .filter((line) => line.endsWith('"MISSING"'))
      .join("\n");
    // Target locking lives on the right unit, so the left one alone cannot send it.
    expect(missing).toContain("lock_target");
  });

  it("puts an untagged action after the ones that carry a role", () => {
    // `indexOf` returns -1 for an action with no role tag, which sorted it above combat.
    // Every action in the vocabulary is tagged today, so one is introduced here rather
    // than relying on the layout to supply the case.
    const base = loadProfile("games/SpaceSims/everspace/profiles/single-v5.yaml", game);
    const actions = new ActionSet({
      actions: { ...game.actions.actions, untagged_probe: { key: "F12" } },
    });
    const data = structuredClone(base.data);
    data.positions.middle_1 = { label: "Untagged", tap: "untagged_probe" };
    const edited = new Profile(data, base.device, { path: base.path, game });

    const rows = bindingSheet(game.name, actions, [edited]).rows;
    const untagged = rows.findIndex((row) => row.action === "untagged_probe");
    const combat = rows.findIndex((row) => row.tags.includes("combat"));
    expect(untagged).toBeGreaterThan(-1);
    expect(combat).toBeGreaterThan(-1);
    expect(untagged).toBeGreaterThan(combat);
  });

  it("writes a table a controls screen can be read against", () => {
    const markdown = renderBindingsMarkdown(sheet());
    expect(markdown).toContain("| Action | Key in game | Sent from | Tags |");
    expect(markdown).toContain("`mouse middle`");
  });
});
