/**
 * Checking a unit by pressing it: what each control should send, and what a run comes to.
 * The unit's own memory cannot be read; what it sends can.
 */
import { describe, expect, it } from "vitest";

import { describeSent, expectedPresses, sameSent, verdict } from "../../../src/lib/checkunit.js";
import type { ExpectedPress, Sent } from "../../../src/lib/checkunit.js";
import { Game } from "../../../src/lib/model.js";
import { LIVE_SET } from "../../helpers/fixtures.js";

const game = new Game("games/SpaceSims/everspace");
const unit = (hand: "left" | "right") => {
  const found = game.loadedProfiles().find((p) => p.set === LIVE_SET && p.unit === hand);
  if (!found) throw new Error(`no ${hand} unit`);
  return found;
};
const presses = (hand: "left" | "right"): ExpectedPress[] =>
  expectedPresses(unit(hand).data, unit(hand).device, game.actions);
const byId = (hand: "left" | "right", id: string): ExpectedPress => {
  const found = presses(hand).find((press) => press.id === id);
  if (!found) throw new Error(`no press ${id}`);
  return found;
};

const key = (code: string, ...modifiers: string[]): Sent => ({ kind: "key", code, modifiers });

describe("what each control should send", () => {
  it("walks the board as it is drawn: columns, the stick, the d-pad, the thumb keys", () => {
    const ids = presses("right").map((press) => press.id);
    expect(ids.indexOf("index_side")).toBeLessThan(ids.indexOf("stick:up"));
    expect(ids.indexOf("stick:left")).toBeLessThan(ids.indexOf("dpad_up"));
    expect(ids.indexOf("dpad_down")).toBeLessThan(ids.indexOf("thumb_aux_lower"));
    // Nothing on the empty keys.
    expect(ids).not.toContain("ring_1");
  });

  it("is a key, a modifier sent as itself, or a mouse button", () => {
    expect(byId("right", "middle_5")).toMatchObject({
      prompt: "Middle 5",
      does: "Inventory (I)",
      sends: key("KeyI"),
    });
    expect(byId("right", "index_side")).toMatchObject({
      does: "Boost (Left Shift)",
      sends: key("ShiftLeft"),
    });
    expect(byId("right", "middle_3").sends).toEqual({ kind: "mouse", button: "left" });
    expect(byId("right", "stick:up")).toMatchObject({
      prompt: "the stick away from you",
      sends: key("KeyW"),
    });
  });

  it("names a shared key after the action the layout put there", () => {
    // F is cruise and interact both; the d-pad press is interact.
    expect(byId("right", "dpad_press").does).toBe("Interact / fling (F)");
  });
});

describe("what arrived", () => {
  it("is the same send whatever order the modifiers came in", () => {
    expect(
      sameSent(key("KeyJ", "ShiftLeft", "ControlLeft"), key("KeyJ", "ControlLeft", "ShiftLeft")),
    ).toBe(true);
    expect(sameSent(key("KeyJ"), key("KeyJ", "ShiftLeft"))).toBe(false);
    expect(sameSent({ kind: "mouse", button: "left" }, key("KeyJ"))).toBe(false);
    expect(sameSent({ kind: "mouse", button: "left" }, { kind: "mouse", button: "left" })).toBe(
      true,
    );
  });

  it("is named after every action on it", () => {
    expect(describeSent(key("KeyI"), game.actions)).toBe("Inventory (I)");
    expect(describeSent(key("KeyF"), game.actions)).toMatch(/Cruise drive or .*Interact.* \(F\)/);
    expect(describeSent({ kind: "mouse", button: "right" }, game.actions)).toBe(
      "Fire secondary (Right mouse button)",
    );
    expect(describeSent(key("F13"), game.actions)).toBe("F13");
  });
});

describe("what a run comes to", () => {
  const all = presses("right");
  const pressedAsLaidOut = new Map(
    all.map((press) => [press.id, { arrived: press.sends, text: press.does }] as const),
  );

  it("matches when every control pressed sent what the layout has", () => {
    const result = verdict(all, pressedAsLaidOut);
    expect(result).toMatchObject({ matches: true, checked: all.length, differing: [] });
  });

  it("lists every control that sent something else, and counts the skipped apart", () => {
    const results = new Map(pressedAsLaidOut) as Map<
      string,
      { arrived: Sent; text: string } | "skipped"
    >;
    results.set("middle_5", { arrived: key("KeyG"), text: "Ultimate (G)" });
    results.set("pinky_1", "skipped");
    const result = verdict(all, results);
    expect(result.matches).toBe(false);
    expect(result.skipped).toBe(1);
    expect(result.differing.map((entry) => [entry.press.id, entry.arrived])).toEqual([
      ["middle_5", "Ultimate (G)"],
    ]);
    expect(result.onProbe).toBe(false);
  });

  it("knows nothing when nothing was pressed", () => {
    expect(verdict(all, new Map()).matches).toBe(false);
  });

  it("says when what arrived is the press-test profile's keys: the unit is on that slot", () => {
    const probeKeys = new Map(
      all.map((press, index) => [press.position, `F${String(13 + (index % 12))}`]),
    );
    const results = new Map(
      all
        .filter((press) => press.direction === undefined)
        .map((press) => {
          const code = probeKeys.get(press.position) ?? "";
          return [press.id, { arrived: key(code), text: code }] as const;
        }),
    );
    expect(verdict(all, results, probeKeys).onProbe).toBe(true);
  });
});
