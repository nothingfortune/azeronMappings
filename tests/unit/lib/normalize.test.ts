/**
 * Where a parsed profile file becomes a profile: malformed files are refused, and the one
 * thing that can only be read one way is read that way.
 */
import { describe, expect, it } from "vitest";

import { ProfileShapeError, normalizeProfileData } from "../../../src/lib/normalize.js";

const profile = { device: "cyborg2-left", set: "s", unit: "left" };

describe("a stick with directions and no mode", () => {
  it("is a keyboard stick, which is the only mode a stick may have", () => {
    const data = normalizeProfileData(
      { profile, positions: { stick: { directions: { up: "throttle_up" } } } },
      "left.yaml",
    );
    expect(data.positions.stick).toEqual({ mode: "keyboard", directions: { up: "throttle_up" } });
  });

  it("keeps a mode that is written, whatever it says: the linter judges that", () => {
    const data = normalizeProfileData(
      { profile, positions: { stick: { mode: "mouse", directions: { up: "throttle_up" } } } },
      "left.yaml",
    );
    expect(data.positions.stick?.mode).toBe("mouse");
  });

  it("does not make a stick of a key", () => {
    const data = normalizeProfileData(
      { profile, positions: { pinky_1: { tap: "boost" } } },
      "l.yaml",
    );
    expect(data.positions.pinky_1).toEqual({ tap: "boost" });
  });
});

describe("a file that is not a profile", () => {
  it("is refused, with the reason", () => {
    expect(() => normalizeProfileData({ positions: {} }, "x.yaml")).toThrow(ProfileShapeError);
    expect(() => normalizeProfileData({ profile, positions: { pinky_1: null } }, "x.yaml")).toThrow(
      /empty or not a mapping/,
    );
  });
});
