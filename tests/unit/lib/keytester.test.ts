/** Matching what a unit sent to the control of the layout that sends it. */
import { describe, expect, it } from "vitest";

import type { ExpectedPress, Sent } from "../../../src/lib/checkunit.js";
import { hitName, matchSent } from "../../../src/lib/keytester.js";

const press = (id: string, sends: Sent, direction?: "up"): ExpectedPress => ({
  id,
  position: id.split(":")[0] ?? id,
  ...(direction === undefined ? {} : { direction }),
  prompt: id,
  does: id,
  sends,
});

const units = [
  {
    slug: "left",
    unit: "left",
    presses: [
      press("ring_4", { kind: "key", code: "KeyF", modifiers: [] }),
      press("index_side", { kind: "key", code: "ShiftLeft", modifiers: [] }),
      press("thumb", { kind: "key", code: "KeyF", modifiers: ["ShiftLeft"] }),
    ],
  },
  {
    slug: "right",
    unit: "right",
    presses: [
      press("index_1", { kind: "mouse", button: "left" }),
      press("stick:up", { kind: "key", code: "KeyW", modifiers: [] }, "up"),
    ],
  },
];

describe("the key tester's matching", () => {
  it("finds the control that sends exactly what arrived", () => {
    expect(
      matchSent({ kind: "key", code: "KeyF", modifiers: [] }, units).map((hit) => hit.press.id),
    ).toEqual(["ring_4"]);
    expect(
      matchSent({ kind: "key", code: "KeyF", modifiers: ["ShiftLeft"] }, units).map(
        (hit) => hit.press.id,
      ),
    ).toEqual(["thumb"]);
  });

  it("falls back to the key alone when a modifier is held that no control sends with it", () => {
    const hits = matchSent({ kind: "key", code: "KeyF", modifiers: ["ControlLeft"] }, units);
    expect(hits.map((hit) => [hit.press.id, hit.loose])).toEqual([["ring_4", true]]);
  });

  it("matches mouse buttons and stick directions, and names them as the board does", () => {
    const [click] = matchSent({ kind: "mouse", button: "left" }, units);
    expect(click?.unit).toBe("right");
    const [stick] = matchSent({ kind: "key", code: "KeyW", modifiers: [] }, units);
    expect(stick && hitName(stick)).toBe("stick up");
  });

  it("finds nothing for a key no control sends", () => {
    expect(matchSent({ kind: "key", code: "KeyQ", modifiers: [] }, units)).toEqual([]);
  });
});
