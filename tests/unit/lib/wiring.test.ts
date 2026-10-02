/**
 * The wiring: the key the editor gives an action so that a control can carry it to the game.
 */
import { describe, expect, it } from "vitest";

import { ueKeyFor } from "../../../src/lib/ingame.js";
import { lintProfiles } from "../../../src/lib/lint.js";
import { Game } from "../../../src/lib/model.js";
import { ActionSet, Profile } from "../../../src/lib/model-core.js";
import {
  WIRE_POOL,
  freeKey,
  needsWire,
  sendsSomething,
  wireAction,
} from "../../../src/lib/wiring.js";
import type { ActionSpec } from "../../../src/types/profile.js";
import { LIVE_SET } from "../../helpers/fixtures.js";

const game = new Game("games/SpaceSims/everspace");

describe("whether an action needs a key", () => {
  it("is so when it has nothing to be sent on, and is not the sensor's", () => {
    expect(needsWire({ label: "Free look" })).toBe(true);
    expect(needsWire({ label: "Free look", key: null })).toBe(true);
    expect(needsWire({ key: "KeyF" })).toBe(false);
    expect(needsWire({ meta: "ShiftLeft" })).toBe(false);
    expect(needsWire({ mouse: "left" })).toBe(false);
    expect(needsWire({ provided_by: "sensor" })).toBe(false);
    expect(needsWire(undefined)).toBe(false);
    expect(sendsSomething({ mouse: "middle" })).toBe(true);
    expect(sendsSomething({})).toBe(false);
  });
});

describe("the pool of keys", () => {
  it("holds nothing a game's defaults, its menus or the desktop already use", () => {
    for (const key of WIRE_POOL) {
      expect(key).not.toMatch(/^(Key[A-Z]|Digit\d|F\d+)$/);
      expect(key).not.toMatch(/^(Enter|Space|Tab|Escape|Backspace|CapsLock)$/);
      expect(key).not.toMatch(/^(Shift|Control|Alt|Meta)/);
    }
    expect(new Set(WIRE_POOL).size).toBe(WIRE_POOL.length);
  });

  it("holds only keys Everspace 2's own file has a name for", () => {
    for (const key of WIRE_POOL) expect(ueKeyFor({ key }), key).not.toBeNull();
  });

  it("has room for every action of the live game that has no key yet", () => {
    const actions = structuredClone(game.actions.actions);
    const unwired = Object.keys(actions).filter((id) => needsWire(actions[id]));
    expect(unwired.length).toBeGreaterThan(0);
    for (const id of unwired) expect(wireAction(actions, id), id).not.toBeNull();
    // Each got its own.
    const given = unwired.map((id) => actions[id]?.key);
    expect(new Set(given).size).toBe(unwired.length);
  });
});

describe("picking a key", () => {
  const actions: Record<string, ActionSpec> = {
    fire: { key: "KeyF" },
    look: { label: "Look" },
    held: { key: "Insert" },
    shifted: { meta: "Home" },
  };

  it("takes the first in the pool that no action is on, as a key or as a modifier", () => {
    expect(WIRE_POOL.slice(0, 3)).toEqual(["Insert", "Home", "PageUp"]);
    expect(freeKey(actions)).toBe("PageUp");
  });

  it("skips what the game cannot be told to listen for", () => {
    expect(freeKey(actions, (key) => key !== "PageUp")).toBe("Delete");
    expect(freeKey(actions, () => false)).toBeNull();
  });

  it("gives a key to an action without one, and leaves every other action as it was", () => {
    const working = structuredClone(actions);
    expect(wireAction(working, "look")).toBe("PageUp");
    expect(working.look).toEqual({ label: "Look", key: "PageUp" });
    expect({ ...working, look: actions.look }).toEqual(actions);
  });

  it("never re-deals a key: an action that has one keeps it", () => {
    const working = structuredClone(actions);
    expect(wireAction(working, "fire")).toBeNull();
    expect(wireAction(working, "nothing-by-this-name")).toBeNull();
    expect(working).toEqual(actions);
  });

  it("gives the next action the next key", () => {
    const working: Record<string, ActionSpec> = { a: {}, b: {} };
    expect(wireAction(working, "a")).toBe("Insert");
    expect(wireAction(working, "b")).toBe("Home");
  });

  it("says so, by giving nothing, when the pool is spent", () => {
    const full: Record<string, ActionSpec> = { wanted: {} };
    WIRE_POOL.forEach((key, index) => {
      full[`taken_${String(index)}`] = { key };
    });
    expect(wireAction(full, "wanted")).toBeNull();
    expect(full.wanted).toEqual({});
  });
});

describe("a control whose action has no key", () => {
  const live = game
    .loadedProfiles()
    .find((profile) => profile.set === LIVE_SET && profile.unit === "left");
  if (!live) throw new Error("no live left profile");
  // Free look has a row in the game and no key: the live layout does not use it.
  const withFreeLook = new Profile(
    { ...live.data, positions: { ...live.positions, pinky_5: { tap: "free_look" } } },
    live.device,
    { path: live.path, game },
  );
  const rules = (actions: ActionSet): string[] =>
    lintProfiles(actions, [withFreeLook], game.lintConfig).live.map((finding) => finding.rule);

  it("is an error, because the control would do nothing", () => {
    expect(needsWire(game.actions.actions.free_look)).toBe(true);
    const found = lintProfiles(game.actions, [withFreeLook], game.lintConfig).live.find(
      (finding) => finding.rule === "action-sends-nothing",
    );
    expect(found?.level).toBe("error");
    expect(found?.position).toBe("pinky_5");
    expect(found?.message).toContain("free_look");
  });

  it("is answered by wiring the action", () => {
    const actions = structuredClone(game.actions.actions);
    expect(wireAction(actions, "free_look")).not.toBeNull();
    const wired = new ActionSet({
      actions,
      duplicate_key_allowlist: game.actions.duplicateKeyAllowlist,
    });
    expect(rules(wired)).not.toContain("action-sends-nothing");
    expect(rules(wired)).not.toContain("key-collision");
  });
});
