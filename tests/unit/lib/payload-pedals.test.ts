/**
 * What the editor is handed about pedals: the device, each layout's assignments, and the
 * stick modes that know about them. Drawing them is a later job; reading them is this one.
 */

import { describe, expect, it } from "vitest";

import { buildPayload } from "../../../src/lib/editor/payload.js";
import { directionsFor } from "../../../src/lib/stickmodes.js";

const payload = buildPayload();
const everspace = payload.games.find((game) => game.slug === "everspace");

describe("the editor payload", () => {
  it("carries the pedals device, apart from the keypads", () => {
    const pedals = payload.pedals["logitech-pro-flight-pedals"];
    expect(pedals?.kind).toBe("pedals");
    expect(Object.keys(pedals?.axes ?? {})).toEqual(["rudder", "left_toe", "right_toe"]);
    // Everything that walks `devices` expects a position map.
    expect("logitech-pro-flight-pedals" in payload.devices).toBe(false);
    for (const device of Object.values(payload.devices)) {
      expect(Object.keys(device.positions).length).toBeGreaterThan(0);
    }
    expect(Object.keys(payload.devices).sort()).toEqual(["cyborg2-left", "cyborg2-right"]);
  });

  it("carries each layout's pedal assignments under the set name the profiles use", () => {
    const sets = new Set(everspace?.profiles.map((profile) => profile.data.profile.set));
    const assign = everspace?.sets.sets["akimbo-v10"]?.pedals?.assign;
    expect(sets.has("akimbo-v10")).toBe(true);
    expect(assign?.rudder?.drives).toBe("yaw");
    // The toes rest at a full deflection and are bound to nothing.
    expect(Object.keys(assign ?? {})).toEqual(["rudder"]);
    expect(everspace?.sets.sets["akimbo-v10"]?.pedals?.device).toBe("logitech-pro-flight-pedals");
  });

  it("says which layout the game's own file is generated for", () => {
    expect(everspace?.ingameSet).toBe("akimbo-v10");
  });

  it("carries the stick modes with what the pedals take and what each mode does about it", () => {
    const modes = payload.genres.find((genre) => genre.name === "SpaceSims")?.stickModes;
    expect(modes?.pedals?.takes).toEqual(["yaw"]);
    const mode2 = modes?.modes.mode2;
    if (!modes || !mode2) throw new Error("no mode 2 in the payload");
    expect(directionsFor(modes, mode2, "left", true).right).toBe("roll_right");
  });
});
