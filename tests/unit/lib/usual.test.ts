/**
 * The usual bindings: a genre's `keyboard:` and `xbox:` suggestions, as a game's own `kbm`
 * and `pad` where it has none, never making a clash.
 */
import { describe, expect, it } from "vitest";

import { liveTogether } from "../../../src/lib/modes.js";
import { usualBindings } from "../../../src/lib/usual.js";
import { WIRE_POOL } from "../../../src/lib/wiring.js";
import { loadInherited } from "../../../src/lib/yaml-io.js";
import type { ActionSpec } from "../../../src/types/profile.js";

describe("the usual bindings", () => {
  it("copy the suggestions into kbm and pad", () => {
    expect(
      usualBindings({
        jump: { keyboard: "Space", xbox: "A" },
        fire: { keyboard: "MouseLeft" },
        look: { xbox: "RightStickUp" },
      }),
    ).toEqual({
      jump: { kbm: "Space", pad: "A" },
      fire: { kbm: "MouseLeft" },
      look: { pad: "RightStickUp" },
    });
  });

  it("leave a binding the game already has", () => {
    expect(
      usualBindings({ jump: { keyboard: "Space", xbox: "A", kbm: "KeyJ", pad: "B" } }),
    ).toEqual({});
  });

  it("skip one another action is already on, or has just been given", () => {
    expect(
      usualBindings({
        jump: { keyboard: "Space", xbox: "A" },
        boost: { kbm: "Space" },
        dodge: { keyboard: "KeyD", xbox: "A" },
      }),
    ).toEqual({ jump: { pad: "A" }, dodge: { kbm: "KeyD" } });
  });

  it("skip a key or mouse button a unit sends for another action, but not for its own", () => {
    expect(
      usualBindings({
        headlight: { key: "KeyB" },
        boost: { keyboard: "KeyB" },
        fire: { mouse: "left" },
        shoot: { keyboard: "MouseLeft" },
        quick: { key: "KeyR", meta: "ControlLeft" },
        reload: { keyboard: "ControlLeft+KeyR" },
        forward: { key: "KeyW", keyboard: "KeyW" },
      }),
    ).toEqual({ forward: { kbm: "KeyW" } });
  });

  it("let two actions share one when they are never live together", () => {
    const live = liveTogether({
      sets: { ship: { modes: ["ship"] }, foot: { modes: ["foot"] } },
    });
    expect(
      usualBindings(
        {
          fire: { keyboard: "MouseLeft", mode: "ship" },
          shoot: { keyboard: "MouseLeft", mode: "foot" },
        },
        live,
      ),
    ).toEqual({ fire: { kbm: "MouseLeft" }, shoot: { kbm: "MouseLeft" } });
  });

  it("skip what is not a binding, and a key the units are wired from", () => {
    expect(
      usualBindings({
        a: { keyboard: "Nope", xbox: "Z" },
        b: { keyboard: "Insert" },
        c: { keyboard: "ControlLeft+KeyR" },
      }),
    ).toEqual({ c: { kbm: "ControlLeft+KeyR" } });
  });
});

describe("each genre's suggestions", () => {
  for (const genre of ["FPS", "SpaceSims"]) {
    it(`${genre}: every one is used, none twice, none from the wiring pool`, () => {
      const data = loadInherited(`genres/${genre}/actions.yaml`) as {
        actions: Record<string, ActionSpec>;
      };
      const suggested = Object.values(data.actions).flatMap((spec) =>
        spec.keyboard === undefined ? [] : [spec.keyboard],
      );
      expect(suggested.length).toBeGreaterThan(10);
      expect(new Set(suggested).size).toBe(suggested.length);
      expect(suggested.filter((key) => WIRE_POOL.includes(key))).toEqual([]);
      const usual = usualBindings(data.actions);
      expect(Object.values(usual).filter((binding) => binding.kbm !== undefined).length).toBe(
        suggested.length,
      );
    });
  }
});
