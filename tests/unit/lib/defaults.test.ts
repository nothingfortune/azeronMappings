/**
 * Genre defaults are inherited by every game in the genre, so a constraint violation in a
 * default propagates to all of them.
 */

import { describe, expect, it } from "vitest";

import { lintGenre } from "../../../src/lib/lint.js";
import { loadActionSet } from "../../../src/lib/io.js";
import { Genre } from "../../../src/lib/model.js";
import { SLOTS } from "../../../src/types/azeron.js";

const genres = Genre.discover();

describe("genre defaults", () => {
  it("discovers at least one genre", () => {
    expect(genres.length).toBeGreaterThan(0);
  });

  it.each(genres.map((genre) => [genre.name, genre] as const))(
    "%s lints with no findings and no acknowledgements",
    (_name, genre) => {
      const result = lintGenre(genre);
      expect(result.live.map((finding) => finding.rule)).toEqual([]);
      expect(result.acknowledged).toEqual([]);
    },
  );

  it.each(genres.map((genre) => [genre.name, genre] as const))(
    "%s only uses positions that exist on its device",
    (_name, genre) => {
      const profile = genre.defaultProfile();
      const unknown = Object.keys(profile.positions).filter(
        (position) => !(position in profile.device.positions),
      );
      expect(unknown).toEqual([]);
    },
  );

  it.each(genres.map((genre) => [genre.name, genre] as const))(
    "%s binds every required action",
    (_name, genre) => {
      const profile = genre.defaultProfile();
      const bound = new Set<string>();
      for (const spec of Object.values(profile.positions)) {
        for (const slot of SLOTS) {
          if (typeof spec[slot] === "string") bound.add(spec[slot]);
        }
        for (const value of Object.values(spec.directions ?? {})) {
          if (typeof value === "string") bound.add(value);
        }
      }
      const missing = Object.entries(genre.actions.actions)
        .filter(([, spec]) => (spec.tags ?? []).includes("required") && !spec.provided_by)
        .map(([id]) => id)
        .filter((id) => !bound.has(id));
      expect(missing).toEqual([]);
    },
  );

  it.each(genres.map((genre) => [genre.name, genre] as const))(
    "%s never delays a combat tap or latches anything",
    (_name, genre) => {
      const profile = genre.defaultProfile();
      for (const [position, spec] of Object.entries(profile.positions)) {
        const tap = spec.tap;
        const tags = typeof tap === "string" ? genre.actions.tags(tap) : new Set<string>();
        if (tags.has("combat")) {
          expect(spec.long ?? spec.double, `${position} delays a combat tap`).toBeUndefined();
        }
        expect(spec.hold, `${position} latches`).toBeFalsy();
      }
    },
  );
});

describe("action inheritance", () => {
  it("lets a game supply keys while the genre supplies roles", () => {
    const actions = loadActionSet("games/SpaceSims/everspace/actions.yaml");
    const boost = actions.actions.boost;
    expect(boost?.meta).toBe("ShiftLeft");
    expect(boost?.tags).toContain("required");
    expect(boost?.tags).toContain("movement");
  });

  it("lets a game override an inherited label", () => {
    const genre = loadActionSet("genres/SpaceSims/actions.yaml");
    const game = loadActionSet("games/SpaceSims/everspace/actions.yaml");
    expect(genre.actions.cruise?.label).toBe("Travel drive");
    expect(game.actions.cruise?.label).toBe("Cruise drive");
  });

  it("keeps the game's vocabulary to what the genre declares", () => {
    const genre = loadActionSet("genres/SpaceSims/actions.yaml");
    const game = loadActionSet("games/SpaceSims/everspace/actions.yaml");
    expect(Object.keys(game.actions).sort()).toEqual(Object.keys(genre.actions).sort());
  });
});
