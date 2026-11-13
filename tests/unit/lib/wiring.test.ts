/**
 * The wiring: the key the editor gives an action so that a control can carry it to the game.
 */
import { describe, expect, it } from "vitest";

import { ueKeyFor } from "../../../src/lib/ingame.js";
import { ANALOG_KEYCODES } from "../../../src/lib/keys.js";
import { lintProfiles } from "../../../src/lib/lint.js";
import { Game } from "../../../src/lib/model.js";
import { ActionSet, Profile } from "../../../src/lib/model-core.js";
import {
  WIRE_POOL,
  freeKey,
  needsWire,
  sendsSomething,
  unitSendFor,
  wireAction,
  wireFromGame,
} from "../../../src/lib/wiring.js";
import { liveTogether } from "../../../src/lib/modes.js";
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
      // F13 to F24 are function keys no keyboard sold today has, so no game's default is on one.
      expect(key).not.toMatch(/^(Key[A-Z]|Digit\d|F\d|F1[0-2])$/);
      expect(key).not.toMatch(/^(Enter|Space|Tab|Escape|Backspace|CapsLock)$/);
      expect(key).not.toMatch(/^(Shift|Control|Alt|Meta)/);
    }
    expect(new Set(WIRE_POOL).size).toBe(WIRE_POOL.length);
  });

  it("holds only keys a keyboard-mode stick can send too, so a wired action can go on one", () => {
    for (const key of WIRE_POOL) expect(ANALOG_KEYCODES[key], key).toBeTypeOf("number");
  });

  it("holds keys Everspace 2's own file has a name for, and then F13 to F24, which it has not", () => {
    const unnamed = WIRE_POOL.filter((key) => ueKeyFor({ key }) === null);
    expect(unnamed).toEqual(WIRE_POOL.filter((key) => /^F(1[3-9]|2[0-4])$/.test(key)));
  });

  it("hands out every key a game can bind in its own screen before F13 to F24", () => {
    const first = WIRE_POOL.findIndex((key) => key === "F13");
    expect(WIRE_POOL.slice(first)).toEqual([
      "F13",
      "F14",
      "F15",
      "F16",
      "F17",
      "F18",
      "F19",
      "F20",
      "F21",
      "F22",
      "F23",
      "F24",
    ]);
    // Every key a game can be told before then.
    for (const key of WIRE_POOL.slice(0, first)) expect(ueKeyFor({ key }), key).not.toBeNull();
  });

  it("finds nothing past F13 to F24 for a game whose file cannot name them", () => {
    const taken = Object.fromEntries(
      WIRE_POOL.filter((key) => !/^F(1[3-9]|2[0-4])$/.test(key)).map((key) => [key, { key }]),
    );
    const usable = (key: string): boolean => ueKeyFor({ key }) !== null;
    expect(freeKey(taken, usable)).toBeNull();
    expect(freeKey(taken)).toBe("F13");
  });

  it("holds enough for a default layout on both units", () => {
    expect(WIRE_POOL.length).toBeGreaterThanOrEqual(48);
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

describe("a keyboard binding, as a unit would send it", () => {
  it("is a key, a modifier, one modifier with a key, or a mouse button", () => {
    expect(unitSendFor("KeyR")).toEqual({ key: "KeyR" });
    expect(unitSendFor("ShiftLeft")).toEqual({ meta: "ShiftLeft" });
    expect(unitSendFor("ControlLeft+KeyR")).toEqual({ meta: "ControlLeft", key: "KeyR" });
    expect(unitSendFor("MouseLeft")).toEqual({ mouse: "left" });
    expect(unitSendFor("MouseRight")).toEqual({ mouse: "right" });
  });

  it("is nothing a unit cannot send: the wheel, the side buttons, two modifiers", () => {
    expect(unitSendFor("WheelUp")).toBeNull();
    expect(unitSendFor("Mouse4")).toBeNull();
    expect(unitSendFor("ControlLeft+ShiftLeft+KeyR")).toBeNull();
    expect(unitSendFor("ShiftLeft+MouseLeft")).toBeNull();
    expect(unitSendFor(undefined)).toBeNull();
    expect(unitSendFor("Nope")).toBeNull();
  });
});

describe("wiring from the game's own key", () => {
  it("sends the key the game already has the action on", () => {
    const actions: Record<string, ActionSpec> = {
      reload: { kbm: "KeyR" },
      sprint: { kbm: "ShiftLeft" },
      fire: { kbm: "MouseLeft" },
    };
    expect(wireFromGame(actions, "reload")).toEqual({ key: "KeyR" });
    expect(wireFromGame(actions, "sprint")).toEqual({ meta: "ShiftLeft" });
    expect(wireFromGame(actions, "fire")).toEqual({ mouse: "left" });
    expect(actions.reload).toEqual({ kbm: "KeyR", key: "KeyR" });
  });

  it("leaves the pool to an action whose key a unit cannot send or another sends", () => {
    const actions: Record<string, ActionSpec> = {
      next: { kbm: "WheelDown" },
      headlight: { key: "KeyL" },
      flashlight: { kbm: "KeyL" },
      bare: {},
    };
    expect(wireFromGame(actions, "next")).toBeNull();
    expect(wireFromGame(actions, "flashlight")).toBeNull();
    expect(wireFromGame(actions, "bare")).toBeNull();
    expect(wireFromGame(actions, "headlight")).toBeNull();
    expect(actions.flashlight).toEqual({ kbm: "KeyL" });
  });

  it("lets two actions share a key when they are never live together", () => {
    const live = liveTogether({ sets: { a: { modes: ["ship"] }, b: { modes: ["foot"] } } });
    const actions: Record<string, ActionSpec> = {
      fire: { key: "KeyF", mode: "ship" },
      shoot: { kbm: "KeyF", mode: "foot" },
    };
    expect(wireFromGame(actions, "shoot", live)).toEqual({ key: "KeyF" });
  });
});
