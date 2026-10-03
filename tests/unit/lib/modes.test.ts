/**
 * Modes of play: actions live at the same time may not share a key, and a layout for one
 * mode answers only for that mode's actions.
 */
import { describe, expect, it } from "vitest";

import { checkActions, checkSet } from "../../../src/lib/lint.js";
import { ActionSet } from "../../../src/lib/model-core.js";
import {
  actionsLiveTogether,
  layoutModes,
  liveTogether,
  playsAction,
} from "../../../src/lib/modes.js";
import { freeKey, wireAction } from "../../../src/lib/wiring.js";
import type { SetsData } from "../../../src/types/pedals.js";
import type { ActionSpec } from "../../../src/types/profile.js";

const SETS: SetsData = {
  sets: {
    ship: { modes: ["ship", "fss", "ui"] },
    "on-foot": { modes: ["foot", "ui"] },
  },
};

describe("what is live together", () => {
  const live = liveTogether(SETS);

  it("is two modes some layout plays both of", () => {
    expect(live("ship", "fss")).toBe(true);
    expect(live("ship", "ui")).toBe(true);
    expect(live("foot", "ui")).toBe(true);
    expect(live("ship", "foot")).toBe(false);
  });

  it("always includes an action with no mode, and a mode with itself", () => {
    expect(live(undefined, "foot")).toBe(true);
    expect(live("foot", "foot")).toBe(true);
    expect(live("nowhere", "nowhere")).toBe(true);
    expect(live("nowhere", "ship")).toBe(false);
  });

  it("is everything for a game whose layouts list no modes", () => {
    expect(liveTogether({ sets: { a: {} } })("ship", "foot")).toBe(true);
    expect(liveTogether(undefined)("ship", "foot")).toBe(true);
  });

  it("reads off the actions' modes", () => {
    expect(actionsLiveTogether(live, { mode: "ship" }, { mode: "foot" })).toBe(false);
    expect(actionsLiveTogether(live, { mode: "ship" }, {})).toBe(true);
  });
});

describe("what a layout plays", () => {
  it("is its modes' actions and the ones with no mode", () => {
    const modes = layoutModes(SETS, "on-foot");
    expect(playsAction(modes, { mode: "foot" })).toBe(true);
    expect(playsAction(modes, { mode: "ui" })).toBe(true);
    expect(playsAction(modes, { mode: "ship" })).toBe(false);
    expect(playsAction(modes, {})).toBe(true);
  });

  it("is everything for a layout that lists no modes", () => {
    expect(layoutModes(SETS, "no-such-layout")).toBeNull();
    expect(playsAction(null, { mode: "ship" })).toBe(true);
  });
});

describe("a key two actions share", () => {
  const actions = (
    specs: Record<string, ActionSpec>,
    allow: { key: string; actions?: string[] }[] = [],
  ) => new ActionSet({ actions: specs, duplicate_key_allowlist: allow });
  const live = liveTogether(SETS);

  it("is a collision only between actions live at the same time", () => {
    const apart = actions({
      boost: { key: "KeyW", mode: "ship" },
      walk: { key: "KeyW", mode: "foot" },
    });
    expect(checkActions(apart, live)).toEqual([]);
    const together = actions({
      boost: { key: "KeyW", mode: "ship" },
      zoom: { key: "KeyW", mode: "fss" },
      walk: { key: "KeyW", mode: "foot" },
    });
    const found = checkActions(together, live);
    expect(found.map((finding) => finding.rule)).toEqual(["key-collision"]);
    // Only the two that clash are named: walking is never live with them.
    expect(found[0]?.message).toContain("(boost, zoom)");
  });

  it("is still a collision everywhere for a game with no modes", () => {
    const flat = actions({ a: { key: "KeyW" }, b: { key: "KeyW" } });
    expect(checkActions(flat).map((finding) => finding.rule)).toEqual(["key-collision"]);
  });

  it("is allowed by an allowance that names the actions, and only those", () => {
    const specs = { a: { key: "KeyE", mode: "ship" }, b: { key: "KeyE", mode: "ship" } };
    expect(checkActions(actions(specs, [{ key: "KeyE", actions: ["a", "b"] }]), live)).toEqual([]);
    expect(
      checkActions(actions(specs, [{ key: "KeyE", actions: ["a", "other"] }]), live).length,
    ).toBe(1);
    // A mouse button is allowed by its binding-sheet name.
    const mice = { a: { mouse: "left", mode: "ship" }, b: { mouse: "left", mode: "fss" } };
    expect(checkActions(actions(mice), live).length).toBe(1);
    expect(checkActions(actions(mice, [{ key: "mouse:left", actions: ["a", "b"] }]), live)).toEqual(
      [],
    );
    // An allowance that names no actions covers its key, as it always has.
    expect(checkActions(actions(specs, [{ key: "KeyE" }]), live)).toEqual([]);
  });
});

describe("a required action", () => {
  it("is only missing from a layout that plays its mode", () => {
    const set = new ActionSet({
      actions: {
        jump: { key: "Space", mode: "foot", tags: ["movement", "required"] },
        boost: { key: "Tab", mode: "ship", tags: ["movement", "required"] },
      },
    });
    const missing = (modes: ReadonlySet<string> | null) =>
      checkSet(
        [{ set: "s", slug: "s", positions: {}, device: { isStick: () => false } } as never],
        set,
        new Set(),
        modes,
      )
        .filter((finding) => finding.rule === "missing-required")
        .map((finding) => /'([a-z_]+)'/.exec(finding.message)?.[1]);
    expect(missing(new Set(["foot", "ui"]))).toEqual(["jump"]);
    expect(missing(null).sort()).toEqual(["boost", "jump"]);
  });
});

describe("the key the editor gives", () => {
  it("is free among the actions live with the one being wired, and only those", () => {
    const live = liveTogether(SETS);
    const specs: Record<string, ActionSpec> = {
      walk: { key: "Insert", mode: "foot" },
      look: { mode: "ship" },
      zoom: { key: "Insert", mode: "fss" },
    };
    // Insert is taken in the scanner, which is live with the ship; walking is not.
    expect(freeKey(specs, undefined, (other) => live("ship", other.mode))).toBe("Home");
    expect(wireAction(specs, "look", undefined, (other) => live("ship", other.mode))).toBe("Home");
    // Without modes every action holds its key against it.
    expect(freeKey({ walk: { key: "Insert", mode: "foot" } })).toBe("Home");
    expect(
      freeKey({ walk: { key: "Insert", mode: "foot" } }, undefined, (o) => live("ship", o.mode)),
    ).toBe("Insert");
  });
});
